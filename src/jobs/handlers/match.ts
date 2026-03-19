import type { Config } from "../../config.js";
import type { Job } from "../../db/schema.js";
import { SyncPipeline } from "../../services/sync-pipeline.js";
import { completeJob, createJob } from "../runner.js";

interface MatchPayload {
  playlistId: string;
}

/**
 * Run matchPlaylist(), auto-confirm high-confidence matches, and create
 * search jobs for not-found tracks.
 */
export async function handleMatch(job: Job, config: Config): Promise<void> {
  const payload: MatchPayload = JSON.parse(job.payload ?? "{}");
  const pipeline = new SyncPipeline(config);

  const result = await pipeline.matchPlaylist(payload.playlistId);

  // Auto-apply high-confidence decisions (they're already confirmed by matchPlaylist)
  // Create search jobs for tracks not found in Lexicon
  for (const item of result.notFound) {
    createJob({
      type: "search",
      status: "queued",
      priority: 3,
      payload: JSON.stringify({
        trackId: item.dbTrackId,
        playlistId: payload.playlistId,
        title: item.track.title,
        artist: item.track.artist,
        album: item.track.album,
        durationMs: item.track.durationMs,
        queryIndex: 0,
      }),
      parentJobId: job.id,
    });
  }

  completeJob(job.id, {
    playlistId: payload.playlistId,
    found: result.found.length,
    needsReview: result.needsReview.length,
    notFound: result.notFound.length,
    total: result.total,
  });
}
