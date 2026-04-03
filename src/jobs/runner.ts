import { eq, and, sql, desc, asc } from "drizzle-orm";
import type { HubConnection } from "@microsoft/signalr";
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
import { handleOrphanRescue } from "./handlers/orphan-rescue.js";
import {
  connectTransferHub,
  disconnectTransferHub,
  isHubConnected,
  type TransferEvent,
  type SlskdHubTransfer,
} from "../services/slskd-hub.js";
import { handleTransferCompleted, handleTransferFailed } from "./handlers/transfer-event.js";

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
  orphan_rescue: handleOrphanRescue,
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
let orphanRescueInterval: ReturnType<typeof setInterval> | null = null;
let hubConnection: HubConnection | null = null;

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

    // Clear stale scan jobs that were never claimed (queued > 5min) or stuck running (> 10min)
    const now = Date.now();
    const staleQueued = db
      .select()
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.type, "download_scan"),
          eq(schema.jobs.status, "queued"),
          sql`${schema.jobs.createdAt} < ${now - 5 * 60_000}`,
        ),
      )
      .all();

    const staleRunning = db
      .select()
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.type, "download_scan"),
          eq(schema.jobs.status, "running"),
          sql`${schema.jobs.startedAt} < ${now - 10 * 60_000}`,
        ),
      )
      .all();

    if (staleQueued.length > 0 || staleRunning.length > 0) {
      const staleIds = [...staleQueued, ...staleRunning].map((j) => j.id);
      for (const id of staleIds) {
        db.delete(schema.jobs).where(eq(schema.jobs.id, id)).run();
      }
      log.warn(`Cleared ${staleIds.length} stale download_scan jobs`);
    }

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
        priority: 20,
      });
    }
  } catch (err) {
    log.error(`Failed to schedule download scan`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Create an orphan_rescue job if none is already queued or running.
 */
function scheduleOrphanRescue(): void {
  try {
    const db = getDb();
    const now = Date.now();

    // Clear stale orphan_rescue jobs (queued > 5min or running > 30min)
    db.delete(schema.jobs).where(
      and(
        eq(schema.jobs.type, "orphan_rescue"),
        sql`(${schema.jobs.status} = 'queued' AND ${schema.jobs.createdAt} < ${now - 5 * 60_000})
          OR (${schema.jobs.status} = 'running' AND ${schema.jobs.startedAt} < ${now - 30 * 60_000})`,
      ),
    ).run();

    const existing = db
      .select()
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.type, "orphan_rescue"),
          sql`${schema.jobs.status} IN ('queued', 'running')`,
        ),
      )
      .limit(1)
      .get();

    if (!existing) {
      createJob({
        type: "orphan_rescue",
        status: "queued",
        priority: 20,
      });
      log.info("Scheduled orphan rescue scan");
    }
  } catch (err) {
    log.error(`Failed to schedule orphan rescue`, {
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

  // Reset orphaned "running" jobs from a previous crash back to queued
  const db = getDb();
  const orphaned = db
    .update(schema.jobs)
    .set({ status: "queued", error: null, startedAt: null })
    .where(eq(schema.jobs.status, "running"))
    .run();
  if (orphaned.changes > 0) {
    log.info(`Reset ${orphaned.changes} orphaned running jobs to queued`);
  }

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

  // Connect to slskd SignalR transfer hub for real-time download events.
  // Requires slskdUrl and slskdApiKey to be configured.
  let signalrConnected = false;
  if (config.soulseek.slskdUrl && config.soulseek.slskdApiKey) {
    try {
      hubConnection = connectTransferHub(
        config.soulseek.slskdUrl,
        config.soulseek.slskdApiKey,
        (event: TransferEvent) => handleTransferEvent(event, config),
      );
      signalrConnected = true;
      log.info("SignalR transfer hub connection initiated");
    } catch (err) {
      log.warn("Failed to initiate SignalR connection, falling back to scanner", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Start the periodic download scanner.
  // When SignalR or webhook is active, use a longer interval — the scanner is just a safety net.
  const webhookEnabled = config.soulseek.webhook?.enabled ?? false;
  const hasRealtimeSource = signalrConnected || webhookEnabled;
  const scanIntervalMs = hasRealtimeSource
    ? (config.soulseek.webhook?.fallbackScanIntervalMs ?? 60_000)
    : (config.soulseek.fileScanIntervalMs ?? 15_000);
  scanInterval = setInterval(scheduleDownloadScan, scanIntervalMs);
  log.info("Download scanner scheduled", { intervalMs: scanIntervalMs, signalrConnected, webhookEnabled });

  // Start periodic wishlist scan (once per hour)
  function scheduleWishlistRun() {
    const db = getDb();

    // Clear stale wishlist_run jobs (queued > 5min or running > 30min)
    const now = Date.now();
    db.delete(schema.jobs).where(
      and(
        eq(schema.jobs.type, "wishlist_run"),
        sql`(${schema.jobs.status} = 'queued' AND ${schema.jobs.createdAt} < ${now - 5 * 60_000})
          OR (${schema.jobs.status} = 'running' AND ${schema.jobs.startedAt} < ${now - 30 * 60_000})`,
      ),
    ).run();

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
        createJob({ type: "wishlist_run", status: "queued", priority: 20 });
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

  // Start daily orphan rescue scan (once per day)
  orphanRescueInterval = setInterval(scheduleOrphanRescue, 24 * 3_600_000);
  scheduleOrphanRescue(); // run once on startup
  log.info("Orphan rescue scan scheduled", { intervalMs: 24 * 3_600_000 });

  // Start polling
  poll();
}

// ---------------------------------------------------------------------------
// SignalR event dispatch
// ---------------------------------------------------------------------------

function handleTransferEvent(event: TransferEvent, config: Config): void {
  switch (event.type) {
    case "COMPLETED":
      if (event.transfer) {
        handleTransferCompleted(event.transfer, config).catch((err) => {
          log.error("Error handling transfer COMPLETED", {
            error: err instanceof Error ? err.message : String(err),
            filename: event.transfer?.filename,
          });
        });
      }
      break;

    case "FAILED":
      if (event.transfer) {
        handleTransferFailed(event.transfer, config).catch((err) => {
          log.error("Error handling transfer FAILED", {
            error: err instanceof Error ? err.message : String(err),
            filename: event.transfer?.filename,
          });
        });
      }
      break;

    case "PROGRESS":
      if (event.transfer) {
        emitDownloadProgress(event.transfer);
      }
      break;

    case "LIST":
      // Initial list of downloads on connect — emit progress for any active ones
      if (event.transfers) {
        for (const t of event.transfers) {
          if (t.percentComplete > 0 && t.percentComplete < 100) {
            emitDownloadProgress(t);
          }
        }
      }
      break;

    // ENQUEUED and UPDATE are informational — no action needed
    default:
      break;
  }
}

/** Emit a download-progress event to SSE listeners for the frontend. */
function emitDownloadProgress(transfer: SlskdHubTransfer): void {
  emitJobEvent("signalr", "download-progress", "downloading", {
    username: transfer.username,
    filename: transfer.filename,
    percentComplete: transfer.percentComplete,
    speed: transfer.averageSpeed,
    bytesTransferred: transfer.bytesTransferred,
    size: transfer.size,
  });
}

/** Check if the SignalR hub is currently connected. */
export function isSignalRConnected(): boolean {
  return isHubConnected(hubConnection);
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
  if (orphanRescueInterval) {
    clearInterval(orphanRescueInterval);
    orphanRescueInterval = null;
  }
  // Disconnect SignalR hub
  if (hubConnection) {
    disconnectTransferHub(hubConnection).catch(() => {});
    hubConnection = null;
  }
  log.info("Job runner stopped");
}
