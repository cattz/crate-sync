import { eq, and } from "drizzle-orm";
import type { Config } from "../../config.js";
import type { Job } from "../../db/schema.js";
import { getDb } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { DownloadService } from "../../services/download-service.js";
import { AcquisitionService } from "../../services/acquisition-service.js";
import { SoulseekService } from "../../services/soulseek-service.js";
import { DrizzleRejectionRepository } from "../../db/repositories/index.js";
import { buildSources } from "../../sources/registry.js";
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
 * Run search across all configured sources. Local sources are tried first via
 * AcquisitionService; if a local match is found the file is validated and placed
 * directly (skipping the download job). Soulseek is used as a fallback.
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

  const db = getDb();

  // -------------------------------------------------------------------------
  // Phase 1: Try local sources via AcquisitionService
  // -------------------------------------------------------------------------
  const localSources = buildSources(config);

  if (localSources.length > 0) {
    const rejections = new DrizzleRejectionRepository(db);
    const acquisitionService = new AcquisitionService(
      localSources,
      rejections,
      config.matching,
      config.download,
      config.lexicon,
    );

    const localResult = await acquisitionService.searchAllSources(track, payload.trackId);

    if (localResult && localResult.candidates.length > 0) {
      const best = localResult.candidates[0];

      if (best.score >= 0.3 && best.candidate.localPath) {
        // Local match found — validate and place directly
        log.info(`Local source match`, {
          sourceId: localResult.sourceId,
          score: best.score,
          localPath: best.candidate.localPath,
        });

        // Look up playlist name
        const playlist = await db.query.playlists.findFirst({
          where: eq(schema.playlists.id, payload.playlistId),
        });
        const playlistName = playlist?.name ?? "Unknown";

        const placed = await acquisitionService.validateAndPlace(
          best.candidate,
          track,
          payload.trackId,
          playlistName,
        );

        if (placed) {
          // Record download as done (skip download job entirely)
          db.insert(schema.downloads)
            .values({
              trackId: payload.trackId,
              playlistId: payload.playlistId,
              status: "done",
              origin: "not_found",
              filePath: placed.finalPath,
              sourceId: placed.sourceId,
              sourceKey: placed.sourceKey,
              startedAt: Date.now(),
              completedAt: Date.now(),
            })
            .run();

          completeJob(job.id, {
            source: placed.sourceId,
            localMatch: true,
            filePath: placed.finalPath,
            score: best.score,
            diagnostics: localResult.diagnostics,
          });
          return;
        }

        // Validation failed — fall through to Soulseek
        log.info(`Local match failed validation, falling through to Soulseek`, {
          sourceId: localResult.sourceId,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Phase 2: Soulseek search (existing behavior)
  // -------------------------------------------------------------------------

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
