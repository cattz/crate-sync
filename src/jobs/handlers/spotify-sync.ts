import { eq } from "drizzle-orm";
import type { Config } from "../../config.js";
import type { Job } from "../../db/schema.js";
import { getDb } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { SpotifyService } from "../../services/spotify-service.js";
import { completeJob, createJob } from "../runner.js";

interface SpotifySyncPayload {
  playlistId: string;
}

/**
 * Fetch playlist from Spotify API, upsert tracks to DB, then create a match job.
 */
export async function handleSpotifySync(job: Job, config: Config): Promise<void> {
  const payload: SpotifySyncPayload = JSON.parse(job.payload ?? "{}");
  const db = getDb();

  const playlist = await db.query.playlists.findFirst({
    where: eq(schema.playlists.id, payload.playlistId),
  });

  if (!playlist) {
    throw new Error(`Playlist not found: ${payload.playlistId}`);
  }

  // If the playlist has a Spotify ID, refresh from Spotify
  if (playlist.spotifyId) {
    const spotify = new SpotifyService(config.spotify);
    await spotify.syncPlaylistTracks(playlist.spotifyId);
  }

  // Create a match job for this playlist
  createJob({
    type: "lexicon_match",
    status: "queued",
    priority: 5,
    payload: JSON.stringify({ playlistId: payload.playlistId }),
    parentJobId: job.id,
  });

  completeJob(job.id, { playlistId: payload.playlistId });
}
