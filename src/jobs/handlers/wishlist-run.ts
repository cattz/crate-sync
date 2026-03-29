import { eq, sql } from "drizzle-orm";
import type { Config } from "../../config.js";
import type { Job } from "../../db/schema.js";
import { getDb } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { completeJob } from "../runner.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("wishlist");

/**
 * Re-queue all eligible failed search/download jobs.
 * Manual-only trigger — no automatic interval timer.
 */
export async function handleWishlistRun(job: Job, _config: Config): Promise<void> {
  const db = getDb();

  // Find all failed search/download jobs
  const failedJobs = db
    .select()
    .from(schema.jobs)
    .where(
      sql`${schema.jobs.status} = 'failed' AND ${schema.jobs.type} IN ('search', 'download')`,
    )
    .all();

  let requeued = 0;

  for (const failedJob of failedJobs) {
    log.info(`Re-queuing failed job`, {
      id: failedJob.id,
      type: failedJob.type,
      attempt: failedJob.attempt,
    });

    db.update(schema.jobs)
      .set({
        status: "queued",
        error: null,
      })
      .where(eq(schema.jobs.id, failedJob.id))
      .run();

    requeued++;
  }

  completeJob(job.id, { scanned: failedJobs.length, requeued });
}
