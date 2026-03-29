import type { Config } from "../../config.js";
import type { Job } from "../../db/schema.js";
import { getDb } from "../../db/client.js";
import { DownloadService } from "../../services/download-service.js";
import { completeJob, failJob, createJob } from "../runner.js";
import { generateSearchQueries } from "../../search/query-builder.js";

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

  const db = getDb();
  const downloadService = new DownloadService(
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
    // No viable results
    failJob(
      job.id,
      `No viable results: ${diagnostics}. Strategies tried: ${strategyLog.map((s) => s.label).join(", ")}`,
    );
  }
}
