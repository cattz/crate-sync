import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { onJobEvent } from "../../jobs/runner.js";

export const jobRoutes = new Hono();

// GET /api/jobs — list jobs, filterable by type/status/playlist
jobRoutes.get("/", (c) => {
  const db = getDb();
  const type = c.req.query("type");
  const status = c.req.query("status");
  const parentJobId = c.req.query("parentJobId");
  const limit = Number(c.req.query("limit") ?? 100);
  const offset = Number(c.req.query("offset") ?? 0);

  const conditions = [];
  if (type) conditions.push(eq(schema.jobs.type, type as schema.JobType));
  if (status) conditions.push(eq(schema.jobs.status, status as schema.JobStatus));
  if (parentJobId) conditions.push(eq(schema.jobs.parentJobId, parentJobId));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = db
    .select()
    .from(schema.jobs)
    .where(where)
    .orderBy(desc(schema.jobs.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

  // Get total count
  const countRow = db
    .select({ count: sql<number>`count(*)` })
    .from(schema.jobs)
    .where(where)
    .get();

  return c.json({
    jobs: rows.map(formatJob),
    total: countRow?.count ?? 0,
    limit,
    offset,
  });
});

// GET /api/jobs/stats — job statistics
jobRoutes.get("/stats", (c) => {
  const db = getDb();

  const stats = db
    .select({
      status: schema.jobs.status,
      count: sql<number>`count(*)`,
    })
    .from(schema.jobs)
    .groupBy(schema.jobs.status)
    .all();

  const byType = db
    .select({
      type: schema.jobs.type,
      count: sql<number>`count(*)`,
    })
    .from(schema.jobs)
    .groupBy(schema.jobs.type)
    .all();

  return c.json({
    byStatus: Object.fromEntries(stats.map((s) => [s.status, s.count])),
    byType: Object.fromEntries(byType.map((t) => [t.type, t.count])),
  });
});

// GET /api/jobs/stream — SSE for real-time job updates
jobRoutes.get("/stream", (c) => {
  return streamSSE(c, async (stream) => {
    const unsubscribe = onJobEvent((event) => {
      stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event),
      }).catch(() => {});
    });

    // Keep stream open
    await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        unsubscribe();
        resolve();
      });
    });
  });
});

// GET /api/jobs/:id — job detail
jobRoutes.get("/:id", (c) => {
  const db = getDb();
  const job = db.select().from(schema.jobs).where(eq(schema.jobs.id, c.req.param("id"))).get();

  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  // Get child jobs
  const children = db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.parentJobId, job.id))
    .orderBy(asc(schema.jobs.createdAt))
    .all();

  return c.json({
    ...formatJob(job),
    children: children.map(formatJob),
  });
});

// POST /api/jobs/:id/retry — re-queue a failed job
jobRoutes.post("/:id/retry", (c) => {
  const db = getDb();
  const job = db.select().from(schema.jobs).where(eq(schema.jobs.id, c.req.param("id"))).get();

  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  if (job.status !== "failed") {
    return c.json({ error: "Can only retry failed jobs" }, 400);
  }

  db.update(schema.jobs)
    .set({
      status: "queued",
      error: null,
      runAfter: null,
    })
    .where(eq(schema.jobs.id, job.id))
    .run();

  return c.json({ ok: true });
});

// DELETE /api/jobs/:id — cancel a queued job
jobRoutes.delete("/:id", (c) => {
  const db = getDb();
  const job = db.select().from(schema.jobs).where(eq(schema.jobs.id, c.req.param("id"))).get();

  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  if (job.status !== "queued") {
    return c.json({ error: "Can only cancel queued jobs" }, 400);
  }

  db.delete(schema.jobs).where(eq(schema.jobs.id, job.id)).run();

  return c.json({ ok: true });
});

// DELETE /api/jobs — bulk-delete jobs by status (done or failed)
jobRoutes.delete("/", (c) => {
  const db = getDb();
  const status = c.req.query("status");

  if (status !== "done" && status !== "failed") {
    return c.json({ error: "Query param ?status must be 'done' or 'failed'" }, 400);
  }

  const result = db
    .delete(schema.jobs)
    .where(eq(schema.jobs.status, status as schema.JobStatus))
    .returning()
    .all();

  return c.json({ deleted: result.length });
});

// POST /api/jobs/wishlist/run — trigger a wishlist run
jobRoutes.post("/wishlist/run", (c) => {
  const db = getDb();

  const job = db
    .insert(schema.jobs)
    .values({
      type: "wishlist_run",
      status: "queued",
      priority: 5,
      payload: JSON.stringify({ triggeredAt: Date.now() }),
    })
    .returning()
    .get();

  return c.json({ ok: true, jobId: job.id });
});

// POST /api/jobs/retry-all — re-queue all failed jobs of a type
jobRoutes.post("/retry-all", async (c) => {
  const db = getDb();
  const body = await c.req.json<{ type?: string }>().catch(() => ({ type: undefined }));

  const conditions = [eq(schema.jobs.status, "failed" as schema.JobStatus)];
  if (body.type) {
    conditions.push(eq(schema.jobs.type, body.type as schema.JobType));
  }

  const result = db
    .update(schema.jobs)
    .set({ status: "queued", error: null, runAfter: null })
    .where(and(...conditions))
    .returning()
    .all();

  return c.json({ retried: result.length });
});

function formatJob(job: schema.Job) {
  return {
    ...job,
    payload: job.payload ? JSON.parse(job.payload) : null,
    result: job.result ? JSON.parse(job.result) : null,
  };
}
