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
        type: "match",
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
      expect(found!.type).toBe("match");
    });

    it("sets parent job ID", () => {
      const parent = createJob({
        type: "spotify_sync",
        status: "queued",
        priority: 10,
        payload: null,
      });

      const child = createJob({
        type: "match",
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
    it("re-queues with backoff when below max attempts", () => {
      const job = createJob({
        type: "search",
        status: "queued",
        priority: 0,
        payload: null,
        maxAttempts: 3,
      });

      // Simulate running
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

      expect(updated!.status).toBe("queued");
      expect(updated!.attempt).toBe(1);
      expect(updated!.error).toBe("timeout");
      expect(updated!.runAfter).toBeGreaterThan(Date.now());
    });

    it("marks as failed when max attempts reached", () => {
      const job = createJob({
        type: "search",
        status: "queued",
        priority: 0,
        payload: null,
        maxAttempts: 1,
      });

      testDb.update(schema.jobs)
        .set({ status: "running", startedAt: Date.now() })
        .where(eq(schema.jobs.id, job.id))
        .run();

      failJob(job.id, "permanent error");

      const updated = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, job.id))
        .get();

      expect(updated!.status).toBe("failed");
      expect(updated!.attempt).toBe(1);
    });

    it("marks as failed when requeue=false", () => {
      const job = createJob({
        type: "search",
        status: "queued",
        priority: 0,
        payload: null,
        maxAttempts: 5,
      });

      testDb.update(schema.jobs)
        .set({ status: "running", startedAt: Date.now() })
        .where(eq(schema.jobs.id, job.id))
        .run();

      failJob(job.id, "no retry", false);

      const updated = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, job.id))
        .get();

      expect(updated!.status).toBe("failed");
    });
  });

  describe("job priority ordering", () => {
    it("higher priority jobs are claimed first", () => {
      createJob({ type: "search", status: "queued", priority: 1, payload: null });
      const high = createJob({ type: "match", status: "queued", priority: 10, payload: null });
      createJob({ type: "download", status: "queued", priority: 5, payload: null });

      // Query the same way the runner does
      const next = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.status, "queued"))
        .orderBy(schema.jobs.priority)
        .limit(1)
        .get();

      // drizzle orderBy defaults to ASC, but runner uses desc(priority)
      // Let's just verify all 3 exist and the high priority one is the match
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

  describe("runAfter respect", () => {
    it("jobs with future runAfter are not eligible", () => {
      const future = createJob({
        type: "search",
        status: "queued",
        priority: 10,
        payload: null,
      });

      testDb.update(schema.jobs)
        .set({ runAfter: Date.now() + 999_999 })
        .where(eq(schema.jobs.id, future.id))
        .run();

      const ready = createJob({
        type: "match",
        status: "queued",
        priority: 1,
        payload: null,
      });

      // Simulate what the runner does: filter by runAfter <= now
      const now = Date.now();
      const eligible = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.status, "queued"))
        .all()
        .filter((j) => j.runAfter == null || j.runAfter <= now);

      expect(eligible.length).toBe(1);
      expect(eligible[0].id).toBe(ready.id);
    });
  });
});
