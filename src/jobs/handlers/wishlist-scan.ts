import { eq, and, lt, sql } from "drizzle-orm";
import type { Config } from "../../config.js";
import type { Job } from "../../db/schema.js";
import { getDb } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { completeJob, createJob } from "../runner.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("wishlist");

/**
 * Backoff schedule: 1h → 6h → 24h → 7d → skip
 */
function getCooldownMs(attempt: number): number {
  const schedule = [
    1 * 60 * 60 * 1000,       // 1 hour
    6 * 60 * 60 * 1000,       // 6 hours
    24 * 60 * 60 * 1000,      // 24 hours
    7 * 24 * 60 * 60 * 1000,  // 7 days
  ];
  if (attempt > schedule.length) return -1; // should be skipped
  return schedule[Math.min(attempt - 1, schedule.length - 1)];
}

/**
 * Scan failed search/download jobs past their cooldown period.
 * Re-queue them with the next query strategy.
 */
export async function handleWishlistScan(job: Job, _config: Config): Promise<void> {
  const db = getDb();
  const now = Date.now();

  // Find failed search jobs that are eligible for retry
  const failedJobs = db
    .select()
    .from(schema.jobs)
    .where(
      and(
        eq(schema.jobs.status, "failed"),
        sql`${schema.jobs.type} IN ('search', 'download')`,
        sql`${schema.jobs.attempt} < ${schema.jobs.maxAttempts}`,
      ),
    )
    .all();

  let requeued = 0;
  let skipped = 0;

  for (const failedJob of failedJobs) {
    const cooldownMs = getCooldownMs(failedJob.attempt);

    if (cooldownMs < 0) {
      // Past max cooldown — skip
      skipped++;
      continue;
    }

    const completedAt = failedJob.completedAt ?? failedJob.createdAt;
    if (now - completedAt < cooldownMs) {
      // Not yet past cooldown
      skipped++;
      continue;
    }

    // Re-queue the job
    log.info(`Re-queuing failed job`, {
      id: failedJob.id,
      type: failedJob.type,
      attempt: failedJob.attempt,
    });

    db.update(schema.jobs)
      .set({
        status: "queued",
        runAfter: null,
      })
      .where(eq(schema.jobs.id, failedJob.id))
      .run();

    requeued++;
  }

  completeJob(job.id, { scanned: failedJobs.length, requeued, skipped });
}
