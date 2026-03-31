import { eq } from "drizzle-orm";
import type { Config } from "../../config.js";
import type { Job } from "../../db/schema.js";
import { getDb } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { SyncPipeline } from "../../services/sync-pipeline.js";
import { completeJob, createJob } from "../runner.js";

interface LexiconMatchPayload {
  playlistId: string;
  playlistName?: string;
}

/**
 * Run matchPlaylist() and create search jobs for not-found tracks.
 * Confirmed tracks are tagged immediately by the sync pipeline.
 * Pending matches are parked for async review.
 */
export async function handleLexiconMatch(job: Job, config: Config): Promise<void> {
  const payload: LexiconMatchPayload = JSON.parse(job.payload ?? "{}");
  const pipeline = new SyncPipeline(config);

  // Resolve playlist name (prefer payload, fall back to DB lookup)
  let playlistName = payload.playlistName;
  if (!playlistName) {
    const db = getDb();
    const playlist = await db.query.playlists.findFirst({
      where: eq(schema.playlists.id, payload.playlistId),
    });
    playlistName = playlist?.name;
  }

  const result = await pipeline.matchPlaylist(payload.playlistId);

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
    playlistName,
    confirmed: result.confirmed.length,
    pending: result.pending.length,
    notFound: result.notFound.length,
    total: result.total,
  });
}
