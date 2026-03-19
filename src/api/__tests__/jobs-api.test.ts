import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";

import * as schema from "../../db/schema.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(currentDir, "../../db/migrations");

let testDb: ReturnType<typeof drizzle<typeof schema>>;
let sqlite: InstanceType<typeof Database>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));

vi.mock("../../config.js", () => ({
  loadConfig: () => ({
    spotify: { clientId: "", clientSecret: "", redirectUri: "" },
    lexicon: { url: "http://localhost:48624", downloadRoot: "/tmp" },
    soulseek: { slskdUrl: "http://localhost:5030", slskdApiKey: "test", searchDelayMs: 0, downloadDir: "/tmp" },
    matching: { autoAcceptThreshold: 0.9, reviewThreshold: 0.7 },
    download: { formats: ["flac", "mp3"], minBitrate: 320, concurrency: 2 },
    jobRunner: { pollIntervalMs: 1000, wishlistIntervalMs: 21600000 },
  }),
}));

// Mock services used by sync routes
vi.mock("../../services/playlist-service.js", () => ({
  PlaylistService: vi.fn().mockImplementation(() => ({
    getPlaylist: vi.fn().mockReturnValue(null),
    getPlaylists: vi.fn().mockReturnValue([]),
  })),
}));

vi.mock("../../services/lexicon-service.js", () => ({
  LexiconService: vi.fn().mockImplementation(() => ({
    getTracks: vi.fn().mockResolvedValue([]),
    getPlaylistByName: vi.fn().mockResolvedValue(null),
  })),
}));

import { createApp } from "../server.js";

function freshDb() {
  sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  testDb = drizzle(sqlite, { schema });
  migrate(testDb, { migrationsFolder });
}

function insertJob(overrides: Partial<schema.NewJob> & { type: schema.JobType }) {
  const id = crypto.randomUUID();
  return testDb.insert(schema.jobs).values({
    id,
    status: "queued",
    priority: 0,
    payload: null,
    attempt: 0,
    maxAttempts: 3,
    createdAt: Date.now(),
    ...overrides,
  }).returning().get();
}

describe("Jobs API", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    freshDb();
    app = createApp();
  });

  afterEach(() => {
    sqlite.close();
  });

  async function get(path: string) {
    const res = await app.request(path);
    return { status: res.status, body: await res.json() };
  }

  async function post(path: string, body?: unknown) {
    const res = await app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  }

  async function del(path: string) {
    const res = await app.request(path, { method: "DELETE" });
    return { status: res.status, body: await res.json() };
  }

  describe("GET /api/jobs", () => {
    it("returns empty list when no jobs", async () => {
      const { status, body } = await get("/api/jobs");
      expect(status).toBe(200);
      expect(body.jobs).toEqual([]);
      expect(body.total).toBe(0);
    });

    it("returns all jobs", async () => {
      insertJob({ type: "search" });
      insertJob({ type: "match" });

      const { body } = await get("/api/jobs");
      expect(body.jobs.length).toBe(2);
      expect(body.total).toBe(2);
    });

    it("filters by status", async () => {
      insertJob({ type: "search", status: "queued" });
      insertJob({ type: "search", status: "done" as any });

      const { body } = await get("/api/jobs?status=queued");
      expect(body.jobs.length).toBe(1);
      expect(body.jobs[0].status).toBe("queued");
    });

    it("filters by type", async () => {
      insertJob({ type: "search" });
      insertJob({ type: "match" });

      const { body } = await get("/api/jobs?type=search");
      expect(body.jobs.length).toBe(1);
      expect(body.jobs[0].type).toBe("search");
    });

    it("parses payload JSON", async () => {
      insertJob({ type: "search", payload: JSON.stringify({ trackId: "t1" }) });

      const { body } = await get("/api/jobs");
      expect(body.jobs[0].payload).toEqual({ trackId: "t1" });
    });
  });

  describe("GET /api/jobs/:id", () => {
    it("returns job detail with children", async () => {
      const parent = insertJob({ type: "match" });
      const child = insertJob({ type: "search", parentJobId: parent.id });

      const { status, body } = await get(`/api/jobs/${parent.id}`);
      expect(status).toBe(200);
      expect(body.id).toBe(parent.id);
      expect(body.children.length).toBe(1);
      expect(body.children[0].id).toBe(child.id);
    });

    it("returns 404 for unknown job", async () => {
      const { status } = await get("/api/jobs/nonexistent");
      expect(status).toBe(404);
    });
  });

  describe("GET /api/jobs/stats", () => {
    it("returns counts by status and type", async () => {
      insertJob({ type: "search", status: "queued" });
      insertJob({ type: "search", status: "done" as any });
      insertJob({ type: "match", status: "queued" });

      const { body } = await get("/api/jobs/stats");
      expect(body.byStatus.queued).toBe(2);
      expect(body.byStatus.done).toBe(1);
      expect(body.byType.search).toBe(2);
      expect(body.byType.match).toBe(1);
    });
  });

  describe("POST /api/jobs/:id/retry", () => {
    it("re-queues a failed job", async () => {
      const job = insertJob({ type: "search", status: "failed" as any });

      testDb.update(schema.jobs)
        .set({ status: "failed", error: "timeout" })
        .where(eq(schema.jobs.id, job.id))
        .run();

      const { status, body } = await post(`/api/jobs/${job.id}/retry`);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);

      const updated = testDb.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get();
      expect(updated!.status).toBe("queued");
      expect(updated!.error).toBeNull();
    });

    it("rejects retry of non-failed job", async () => {
      const job = insertJob({ type: "search", status: "queued" });

      const { status } = await post(`/api/jobs/${job.id}/retry`);
      expect(status).toBe(400);
    });
  });

  describe("DELETE /api/jobs/:id", () => {
    it("cancels a queued job", async () => {
      const job = insertJob({ type: "search", status: "queued" });

      const { status, body } = await del(`/api/jobs/${job.id}`);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);

      const found = testDb.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get();
      expect(found).toBeUndefined();
    });

    it("rejects cancel of non-queued job", async () => {
      const job = insertJob({ type: "search" });
      testDb.update(schema.jobs)
        .set({ status: "running" })
        .where(eq(schema.jobs.id, job.id))
        .run();

      const { status } = await del(`/api/jobs/${job.id}`);
      expect(status).toBe(400);
    });
  });

  describe("POST /api/jobs/retry-all", () => {
    it("re-queues all failed jobs", async () => {
      const j1 = insertJob({ type: "search" });
      const j2 = insertJob({ type: "download" });
      insertJob({ type: "match", status: "queued" }); // not failed

      testDb.update(schema.jobs).set({ status: "failed" }).where(eq(schema.jobs.id, j1.id)).run();
      testDb.update(schema.jobs).set({ status: "failed" }).where(eq(schema.jobs.id, j2.id)).run();

      const { body } = await post("/api/jobs/retry-all", {});
      expect(body.retried).toBe(2);
    });

    it("filters by type", async () => {
      const j1 = insertJob({ type: "search" });
      const j2 = insertJob({ type: "download" });

      testDb.update(schema.jobs).set({ status: "failed" }).where(eq(schema.jobs.id, j1.id)).run();
      testDb.update(schema.jobs).set({ status: "failed" }).where(eq(schema.jobs.id, j2.id)).run();

      const { body } = await post("/api/jobs/retry-all", { type: "search" });
      expect(body.retried).toBe(1);
    });
  });
});
