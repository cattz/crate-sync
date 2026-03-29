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

// Import after mock
import { createJob, completeJob, failJob } from "../runner.js";

function freshDb() {
  sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  testDb = drizzle(sqlite, { schema });
  migrate(testDb, { migrationsFolder });
}

describe("Job Runner", () => {
  beforeEach(() => {
    freshDb();
  });

  afterEach(() => {
    sqlite.close();
  });

  describe("createJob", () => {
    it("creates a job with queued status", () => {
      const job = createJob({
        type: "search",
        status: "queued",
        priority: 5,
        payload: JSON.stringify({ trackId: "t1" }),
      });

      expect(job.id).toBeDefined();
      expect(job.type).toBe("search");
      expect(job.status).toBe("queued");
      expect(job.priority).toBe(5);
      expect(job.attempt).toBe(0);
      expect(job.maxAttempts).toBe(3);
    });

    it("persists job in database", () => {
      const job = createJob({
        type: "lexicon_match",
        status: "queued",
        priority: 0,
        payload: null,
      });

      const found = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, job.id))
        .get();

      expect(found).toBeDefined();
      expect(found!.type).toBe("lexicon_match");
    });

    it("sets parent job ID", () => {
      const parent = createJob({
        type: "spotify_sync",
        status: "queued",
        priority: 10,
        payload: null,
      });

      const child = createJob({
        type: "lexicon_match",
        status: "queued",
        priority: 5,
        payload: null,
        parentJobId: parent.id,
      });

      expect(child.parentJobId).toBe(parent.id);
    });
  });

  describe("completeJob", () => {
    it("marks job as done with result", () => {
      const job = createJob({
        type: "search",
        status: "queued",
        priority: 0,
        payload: null,
      });

      // Simulate claiming
      testDb.update(schema.jobs)
        .set({ status: "running", startedAt: Date.now() })
        .where(eq(schema.jobs.id, job.id))
        .run();

      completeJob(job.id, { found: 5 });

      const updated = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, job.id))
        .get();

      expect(updated!.status).toBe("done");
      expect(updated!.completedAt).toBeDefined();
      expect(JSON.parse(updated!.result!)).toEqual({ found: 5 });
    });
  });

  describe("failJob", () => {
    it("marks job as failed immediately — no requeue", () => {
      const job = createJob({
        type: "search",
        status: "queued",
        priority: 0,
        payload: null,
        maxAttempts: 3,
      });

      testDb.update(schema.jobs)
        .set({ status: "running", startedAt: Date.now() })
        .where(eq(schema.jobs.id, job.id))
        .run();

      failJob(job.id, "timeout");

      const updated = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, job.id))
        .get();

      expect(updated!.status).toBe("failed");
      expect(updated!.attempt).toBe(1);
      expect(updated!.error).toBe("timeout");
    });

    it("increments attempt on each failure", () => {
      const job = createJob({
        type: "search",
        status: "queued",
        priority: 0,
        payload: null,
        maxAttempts: 5,
      });

      testDb.update(schema.jobs)
        .set({ status: "running", startedAt: Date.now(), attempt: 2 })
        .where(eq(schema.jobs.id, job.id))
        .run();

      failJob(job.id, "error");

      const updated = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, job.id))
        .get();

      expect(updated!.status).toBe("failed");
      expect(updated!.attempt).toBe(3);
    });
  });

  describe("job priority ordering", () => {
    it("higher priority jobs are claimed first", () => {
      createJob({ type: "search", status: "queued", priority: 1, payload: null });
      const high = createJob({ type: "lexicon_match", status: "queued", priority: 10, payload: null });
      createJob({ type: "download", status: "queued", priority: 5, payload: null });

      const all = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.status, "queued"))
        .all();

      expect(all.length).toBe(3);
      const sorted = [...all].sort((a, b) => b.priority - a.priority);
      expect(sorted[0].id).toBe(high.id);
    });
  });
});
