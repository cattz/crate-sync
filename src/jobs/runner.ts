import { eq, and, sql, desc, asc } from "drizzle-orm";
import type { Config } from "../config.js";
import { getDb } from "../db/client.js";
import * as schema from "../db/schema.js";
import { createLogger } from "../utils/logger.js";
import { handleSpotifySync } from "./handlers/spotify-sync.js";
import { handleLexiconMatch } from "./handlers/lexicon-match.js";
import { handleSearch } from "./handlers/search.js";
import { handleDownload } from "./handlers/download.js";
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

function emitJobEvent(jobId: string, type: string, status: string, payload?: unknown, jobType?: string) {
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
  log.info("Job runner stopped");
}
