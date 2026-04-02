import { eq, and } from "drizzle-orm";
import type { Config } from "../../config.js";
import type { Job } from "../../db/schema.js";
import { getDb } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { DownloadService } from "../../services/download-service.js";
import { SoulseekService } from "../../services/soulseek-service.js";
import { completeJob, failJob, createJob } from "../runner.js";
import { generateSearchQueries } from "../../search/query-builder.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("search-handler");

interface SearchPayload {
  trackId: string;
  playlistId: string;
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  queryIndex: number;
}

/**
 * Run search with query builder strategies. On results: create download job.
 * On failure: re-queue with next strategy or mark failed with backoff.
 */
export async function handleSearch(job: Job, config: Config): Promise<void> {
  const payload: SearchPayload = JSON.parse(job.payload ?? "{}");

  const track = {
    title: payload.title,
    artist: payload.artist,
    album: payload.album,
    durationMs: payload.durationMs,
  };

  const strategies = generateSearchQueries(track);

  // Start from the strategy index stored in the payload
  const startIndex = payload.queryIndex;

  if (startIndex >= strategies.length) {
    // All strategies exhausted
    failJob(job.id, `All ${strategies.length} search strategies exhausted`, false);
    return;
  }

  // Wait for slskd to be connected before searching
  const soulseek = new SoulseekService(config.soulseek);
  if (!(await soulseek.isConnected())) {
    log.info("slskd not connected, waiting up to 60s...");
    const connected = await soulseek.waitForConnection(60_000);
    if (!connected) {
      failJob(job.id, "slskd not connected to Soulseek network (timed out after 60s)");
      return;
    }
  }

  const db = getDb();
  const downloadService = DownloadService.fromDb(
    db,
    config.soulseek,
    config.download,
    config.lexicon,
  );

  // Try strategies starting from queryIndex
  const { ranked, diagnostics, strategy, strategyLog } = await downloadService.searchAndRank(track, payload.trackId);

  if (ranked.length > 0 && ranked[0].score >= 0.3) {
    // Found a good result — create download job
    const best = ranked[0];
    createJob({
      type: "download",
      status: "queued",
      priority: 4,
      payload: JSON.stringify({
        trackId: payload.trackId,
        playlistId: payload.playlistId,
        title: payload.title,
        artist: payload.artist,
        album: payload.album,
        durationMs: payload.durationMs,
        file: {
          filename: best.file.filename,
          size: best.file.size,
          username: best.file.username,
          bitRate: best.file.bitRate,
        },
        score: best.score,
        strategy,
      }),
      parentJobId: job.id,
    });

    completeJob(job.id, {
      strategy,
      strategyLog,
      candidates: ranked.length,
      bestScore: ranked[0].score,
    });
  } else {
    // No viable results — add to wishlist for periodic retry
    const db = getDb();
    const retryIntervalMs = (config.wishlist?.retryIntervalHours ?? 24) * 3600_000;
    const maxRetries = config.wishlist?.maxRetries ?? 5;

    // Find or create a wishlist download entry for this track
    const existing = db
      .select()
      .from(schema.downloads)
      .where(
        and(
          eq(schema.downloads.trackId, payload.trackId),
          eq(schema.downloads.status, "wishlisted"),
        ),
      )
      .get();

    if (existing) {
      // Increment retry count
      const retries = (existing.wishlistRetries ?? 0) + 1;
      if (retries >= maxRetries) {
        // Give up — mark as permanently failed
        db.update(schema.downloads)
          .set({ status: "failed", error: `Gave up after ${retries} wishlist retries`, completedAt: Date.now() })
          .where(eq(schema.downloads.id, existing.id))
          .run();
        log.info(`Wishlist gave up on track after ${retries} retries`, { trackId: payload.trackId, title: payload.title });
      } else {
        db.update(schema.downloads)
          .set({ wishlistRetries: retries, nextRetryAt: Date.now() + retryIntervalMs })
          .where(eq(schema.downloads.id, existing.id))
          .run();
        log.info(`Wishlist retry ${retries}/${maxRetries} scheduled`, { trackId: payload.trackId, title: payload.title });
      }
    } else {
      // Create new wishlist entry
      db.insert(schema.downloads).values({
        trackId: payload.trackId,
        playlistId: payload.playlistId,
        status: "wishlisted",
        origin: "not_found",
        error: `No viable results: ${diagnostics}`,
        wishlistRetries: 0,
        nextRetryAt: Date.now() + retryIntervalMs,
        createdAt: Date.now(),
      }).run();
      log.info(`Added to wishlist`, { trackId: payload.trackId, title: payload.title, artist: payload.artist });
    }

    failJob(
      job.id,
      `No viable results: ${diagnostics}. Strategies tried: ${strategyLog.map((s) => s.label).join(", ")}. Added to wishlist.`,
    );
  }
}
