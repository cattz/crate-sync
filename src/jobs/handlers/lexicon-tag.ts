import { eq, and } from "drizzle-orm";
import type { Config } from "../../config.js";
import type { Job } from "../../db/schema.js";
import { getDb } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { SyncPipeline } from "../../services/sync-pipeline.js";
import { completeJob } from "../runner.js";

interface LexiconTagPayload {
  playlistId: string;
}

/**
 * Tag confirmed matches under the configured Lexicon category.
 * No Lexicon playlist creation — only category-scoped tagging.
 */
export async function handleLexiconTag(job: Job, config: Config): Promise<void> {
  const payload: LexiconTagPayload = JSON.parse(job.payload ?? "{}");
  const db = getDb();

  const playlist = await db.query.playlists.findFirst({
    where: eq(schema.playlists.id, payload.playlistId),
  });

  if (!playlist) {
    throw new Error(`Playlist not found: ${payload.playlistId}`);
  }

  // Get all track IDs for this playlist
  const playlistTrackRows = db
    .select({ trackId: schema.playlistTracks.trackId })
    .from(schema.playlistTracks)
    .where(eq(schema.playlistTracks.playlistId, payload.playlistId))
    .all();

  const trackIds = new Set(playlistTrackRows.map((r) => r.trackId));

  // Get confirmed matches filtered to this playlist's tracks
  const confirmedMatches = db
    .select()
    .from(schema.matches)
    .where(
      and(
        eq(schema.matches.sourceType, "spotify"),
        eq(schema.matches.targetType, "lexicon"),
        eq(schema.matches.status, "confirmed"),
      ),
    )
    .all()
    .filter((m) => trackIds.has(m.sourceId));

  if (confirmedMatches.length === 0) {
    completeJob(job.id, { tagged: 0 });
    return;
  }

  // Build MatchedTrack objects for syncTags
  const confirmedTracks = confirmedMatches.map((m) => ({
    dbTrackId: m.sourceId,
    lexiconTrackId: m.targetId,
    track: { title: "", artist: "" },
    score: m.score,
    confidence: m.confidence as "high" | "review" | "low",
    method: m.method,
  }));

  const pipeline = SyncPipeline.fromConfig(config);
  await pipeline.syncTags(playlist.name, confirmedTracks);

  completeJob(job.id, { tagged: confirmedMatches.length });
}
