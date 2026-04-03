import { eq, and, sql, lte } from "drizzle-orm";
import type { Config } from "../../config.js";
import type { Job } from "../../db/schema.js";
import { getDb } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { completeJob, createJob } from "../runner.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("wishlist");

/**
 * Process the wishlist:
 * 1. Re-queue wishlisted downloads whose nextRetryAt has passed
 * 2. Optionally re-queue failed search/download jobs (manual trigger)
 */
export async function handleWishlistRun(job: Job, config: Config): Promise<void> {
  const db = getDb();
  const now = Date.now();
  const maxRetries = config.wishlist?.maxRetries ?? 5;

  // 1. Find wishlisted downloads ready for retry
  const readyForRetry = db
    .select()
    .from(schema.downloads)
    .where(
      and(
        eq(schema.downloads.status, "wishlisted"),
        lte(schema.downloads.nextRetryAt, now),
      ),
    )
    .all();

  let searchesCreated = 0;
  let givenUp = 0;

  for (const dl of readyForRetry) {
    const retries = (dl.wishlistRetries ?? 0) + 1;

    if (retries > maxRetries) {
      // Give up
      db.update(schema.downloads)
        .set({ status: "failed", error: `Gave up after ${retries} wishlist retries`, completedAt: now })
        .where(eq(schema.downloads.id, dl.id))
        .run();
      givenUp++;
      continue;
    }

    // Look up track info for the search job payload
    const track = db
      .select()
      .from(schema.tracks)
      .where(eq(schema.tracks.id, dl.trackId))
      .get();

    if (!track) {
      log.warn(`Wishlist track not found in DB`, { downloadId: dl.id, trackId: dl.trackId });
      continue;
    }

    // Create a new search job (skip if one is already queued/running for this track)
    const existingSearch = db
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.type, "search"),
          sql`${schema.jobs.status} IN ('queued', 'running')`,
          sql`json_extract(${schema.jobs.payload}, '$.trackId') = ${dl.trackId}`,
        ),
      )
      .limit(1)
      .get();

    if (!existingSearch) {
      createJob({
        type: "search",
        status: "queued",
        priority: 2,
        payload: JSON.stringify({
          trackId: dl.trackId,
          playlistId: dl.playlistId,
          title: track.title,
          artist: track.artist,
          album: track.album,
          durationMs: track.durationMs,
          queryIndex: 0,
        }),
      });
    }

    // Update retry count and next retry time
    const retryIntervalMs = (config.wishlist?.retryIntervalHours ?? 24) * 3600_000;
    db.update(schema.downloads)
      .set({
        wishlistRetries: retries,
        nextRetryAt: now + retryIntervalMs,
      })
      .where(eq(schema.downloads.id, dl.id))
      .run();

    searchesCreated++;
    log.info(`Wishlist retry ${retries}/${maxRetries}`, {
      trackId: dl.trackId,
      title: track.title,
      artist: track.artist,
    });
  }

  // 2. Also re-queue any orphaned failed search jobs (manual cleanup)
  const failedJobs = db
    .select()
    .from(schema.jobs)
    .where(
      sql`${schema.jobs.status} = 'failed' AND ${schema.jobs.type} IN ('search', 'download')`,
    )
    .all();

  let requeued = 0;
  for (const failedJob of failedJobs) {
    db.update(schema.jobs)
      .set({ status: "queued", error: null })
      .where(eq(schema.jobs.id, failedJob.id))
      .run();
    requeued++;
  }

  log.info(`Wishlist run complete`, { readyForRetry: readyForRetry.length, searchesCreated, givenUp, failedRequeued: requeued });
  completeJob(job.id, { wishlistProcessed: readyForRetry.length, searchesCreated, givenUp, failedRequeued: requeued });
}
