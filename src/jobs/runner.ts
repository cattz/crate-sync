import { eq, and, sql, desc, asc } from "drizzle-orm";
import type { Config } from "../config.js";
import { getDb } from "../db/client.js";
import * as schema from "../db/schema.js";
import { createLogger } from "../utils/logger.js";
import { handleSpotifySync } from "./handlers/spotify-sync.js";
import { handleLexiconMatch } from "./handlers/lexicon-match.js";
import { handleSearch } from "./handlers/search.js";
import { handleDownload } from "./handlers/download.js";
import { handleDownloadScan } from "./handlers/download-scan.js";
import { handleValidate } from "./handlers/validate.js";
import { handleLexiconTag } from "./handlers/lexicon-tag.js";
import { handleWishlistRun } from "./handlers/wishlist-run.js";

const log = createLogger("job-runner");

export type JobHandler = (
  job: schema.Job,
  config: Config,
) => Promise<void>;

const handlers: Record<string, JobHandler> = {
  spotify_sync: handleSpotifySync,
  lexicon_match: handleLexiconMatch,
  search: handleSearch,
  download: handleDownload,
  download_scan: handleDownloadScan,
  validate: handleValidate,
  lexicon_tag: handleLexiconTag,
  wishlist_run: handleWishlistRun,
};

/** Emit a job event for SSE listeners. */
export type JobEventListener = (event: {
  jobId: string;
  type: string;
  jobType?: string;
  status: string;
  payload?: unknown;
}) => void;

let eventListeners = new Set<JobEventListener>();

export function onJobEvent(listener: JobEventListener): () => void {
  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
}

export function emitJobEvent(jobId: string, type: string, status: string, payload?: unknown, jobType?: string) {
  for (const listener of eventListeners) {
    try {
      listener({ jobId, type, status, payload, jobType });
    } catch {
      // ignore listener errors
    }
  }
}

/**
 * Claim the next queued job atomically.
 * Uses UPDATE ... WHERE status='queued' to prevent double-processing.
 */
function claimNextJob(db: ReturnType<typeof getDb>): schema.Job | undefined {
  // Find the next eligible job
  const candidate = db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.status, "queued"))
    .orderBy(desc(schema.jobs.priority), asc(schema.jobs.createdAt))
    .limit(1)
    .get();

  if (!candidate) return undefined;

  // Atomically claim it
  const result = db
    .update(schema.jobs)
    .set({ status: "running", startedAt: Date.now() })
    .where(
      and(
        eq(schema.jobs.id, candidate.id),
        eq(schema.jobs.status, "queued"),
      ),
    )
    .returning()
    .get();

  return result;
}

/**
 * Mark a job as done with an optional result.
 */
export function completeJob(jobId: string, result?: unknown, jobType?: string): void {
  const db = getDb();
  db.update(schema.jobs)
    .set({
      status: "done",
      result: result ? JSON.stringify(result) : null,
      completedAt: Date.now(),
    })
    .where(eq(schema.jobs.id, jobId))
    .run();
  emitJobEvent(jobId, "job-done", "done", result, jobType);
}

/**
 * Mark a job as failed. Failed jobs stay failed — no automatic requeue.
 */
export function failJob(jobId: string, error: string): void {
  const db = getDb();
  const job = db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).get();
  if (!job) return;

  const nextAttempt = job.attempt + 1;

  db.update(schema.jobs)
    .set({
      status: "failed",
      error,
      attempt: nextAttempt,
      completedAt: Date.now(),
    })
    .where(eq(schema.jobs.id, jobId))
    .run();
  const jobPayload = job.payload ? JSON.parse(job.payload) : {};
  emitJobEvent(jobId, "job-failed", "failed", { ...jobPayload, error }, job.type);
}

/**
 * Create a new job.
 */
export function createJob(
  input: Omit<schema.NewJob, "id" | "createdAt">,
): schema.Job {
  const db = getDb();
  return db
    .insert(schema.jobs)
    .values(input)
    .returning()
    .get();
}

let running = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let scanInterval: ReturnType<typeof setInterval> | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;
let wishlistInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Purge completed/failed jobs older than retentionDays.
 */
function purgeOldJobs(retentionDays: number): void {
  try {
    const db = getDb();
    const cutoff = Date.now() - retentionDays * 86_400_000;
    const result = db
      .delete(schema.jobs)
      .where(
        and(
          sql`${schema.jobs.status} IN ('done', 'failed')`,
          sql`${schema.jobs.completedAt} < ${cutoff}`,
        ),
      )
      .returning()
      .all();

    if (result.length > 0) {
      log.info(`Purged ${result.length} old jobs (retention: ${retentionDays}d)`);
    }
  } catch (err) {
    log.error("Failed to purge old jobs", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Create a download_scan job if none is already queued or running.
 */
function scheduleDownloadScan(): void {
  try {
    const db = getDb();
    const existing = db
      .select()
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.type, "download_scan"),
          sql`${schema.jobs.status} IN ('queued', 'running')`,
        ),
      )
      .limit(1)
      .get();

    if (!existing) {
      createJob({
        type: "download_scan",
        status: "queued",
        priority: 1,
      });
    }
  } catch (err) {
    log.error(`Failed to schedule download scan`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Start the job runner polling loop.
 * Runs in the same process as the Hono server.
 */
export function startJobRunner(config: Config): void {
  if (running) return;
  running = true;

  const maxConcurrency = config.jobRunner.concurrency ?? 3;
  const activeJobs = new Set<Promise<void>>();

  log.info("Job runner started", {
    pollIntervalMs: config.jobRunner.pollIntervalMs,
    concurrency: maxConcurrency,
  });

  async function processJob(job: schema.Job): Promise<void> {
    const jobPayload = job.payload ? JSON.parse(job.payload) : undefined;
    log.info(`Processing job`, { id: job.id, type: job.type, attempt: job.attempt });
    emitJobEvent(job.id, "job-started", "running", jobPayload, job.type);

    const handler = handlers[job.type];
    if (!handler) {
      failJob(job.id, `Unknown job type: ${job.type}`);
    } else {
      try {
        await handler(job, config);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error(`Job failed`, { id: job.id, type: job.type, error: message });
        failJob(job.id, message);
      }
    }
  }

  async function poll() {
    if (!running) return;

    try {
      const db = getDb();

      // Claim jobs up to the concurrency limit
      while (activeJobs.size < maxConcurrency) {
        const job = claimNextJob(db);
        if (!job) break;

        const task = processJob(job).finally(() => activeJobs.delete(task));
        activeJobs.add(task);
      }
    } catch (err) {
      log.error(`Job runner poll error`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (running) {
      pollTimer = setTimeout(poll, config.jobRunner.pollIntervalMs);
    }
  }

  // Start the periodic download scanner
  const scanIntervalMs = config.soulseek.fileScanIntervalMs ?? 15_000;
  scanInterval = setInterval(scheduleDownloadScan, scanIntervalMs);
  log.info("Download scanner scheduled", { intervalMs: scanIntervalMs });

  // Start periodic wishlist scan (once per hour)
  function scheduleWishlistRun() {
    const db = getDb();
    const existing = db
      .select()
      .from(schema.jobs)
      .where(sql`${schema.jobs.type} = 'wishlist_run' AND ${schema.jobs.status} IN ('queued', 'running')`)
      .get();
    if (!existing) {
      // Only create if there are wishlisted downloads ready for retry
      const ready = db
        .select({ id: schema.downloads.id })
        .from(schema.downloads)
        .where(sql`${schema.downloads.status} = 'wishlisted' AND ${schema.downloads.nextRetryAt} <= ${Date.now()}`)
        .limit(1)
        .get();
      if (ready) {
        createJob({ type: "wishlist_run", status: "queued", priority: 1 });
        log.info("Scheduled automatic wishlist run");
      }
    }
  }
  wishlistInterval = setInterval(scheduleWishlistRun, 3_600_000); // every hour
  scheduleWishlistRun(); // run once on startup

  // Start periodic job cleanup (once per hour)
  const retentionDays = config.jobRunner.retentionDays ?? 7;
  purgeOldJobs(retentionDays); // run once on startup
  cleanupInterval = setInterval(() => purgeOldJobs(retentionDays), 3_600_000);
  log.info("Job cleanup scheduled", { retentionDays, intervalMs: 3_600_000 });

  // Start polling
  poll();
}

/**
 * Stop the job runner.
 */
export function stopJobRunner(): void {
  running = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  if (wishlistInterval) {
    clearInterval(wishlistInterval);
    wishlistInterval = null;
  }
  log.info("Job runner stopped");
}
