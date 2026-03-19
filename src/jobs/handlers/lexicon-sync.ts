import { eq, and } from "drizzle-orm";
import type { Config } from "../../config.js";
import type { Job } from "../../db/schema.js";
import { getDb } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { SyncPipeline } from "../../services/sync-pipeline.js";
import { completeJob } from "../runner.js";

interface LexiconSyncPayload {
  playlistId: string;
  /** If provided, sync tags too. */
  syncTags?: boolean;
}

/**
 * Sync confirmed matches to Lexicon playlist + tags.
 */
export async function handleLexiconSync(job: Job, config: Config): Promise<void> {
  const payload: LexiconSyncPayload = JSON.parse(job.payload ?? "{}");
  const db = getDb();

  const playlist = await db.query.playlists.findFirst({
    where: eq(schema.playlists.id, payload.playlistId),
  });

  if (!playlist) {
    throw new Error(`Playlist not found: ${payload.playlistId}`);
  }

  // Get all confirmed matches for tracks in this playlist
  const playlistTrackRows = db
    .select({ trackId: schema.playlistTracks.trackId })
    .from(schema.playlistTracks)
    .where(eq(schema.playlistTracks.playlistId, payload.playlistId))
    .all();

  const trackIds = new Set(playlistTrackRows.map((r) => r.trackId));

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

  const lexiconTrackIds = confirmedMatches
    .map((m) => m.targetId)
    .filter(Boolean);

  if (lexiconTrackIds.length === 0) {
    completeJob(job.id, { synced: 0 });
    return;
  }

  const pipeline = new SyncPipeline(config);
  await pipeline.syncToLexicon(payload.playlistId, playlist.name, lexiconTrackIds);

  // Optionally sync tags
  if (payload.syncTags) {
    const confirmedTracks = confirmedMatches.map((m) => ({
      dbTrackId: m.sourceId,
      lexiconTrackId: m.targetId,
      track: { title: "", artist: "" },
      score: m.score,
      confidence: m.confidence as "high" | "review" | "low",
      method: m.method,
    }));
    await pipeline.syncTags(playlist.name, confirmedTracks);
  }

  completeJob(job.id, { synced: lexiconTrackIds.length });
}
