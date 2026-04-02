import { eq } from "drizzle-orm";
import { tracks, type Track } from "../schema.js";
import type { ITrackRepository, UpsertTrackData } from "../../ports/repositories.js";
import type { getDb } from "../client.js";

type Db = ReturnType<typeof getDb>;

export class DrizzleTrackRepository implements ITrackRepository {
  constructor(private db: Db) {}

  findById(id: string): Track | null {
    return (
      this.db
        .select()
        .from(tracks)
        .where(eq(tracks.id, id))
        .get() ?? null
    );
  }

  findBySpotifyId(spotifyId: string): Track | null {
    return (
      this.db
        .select()
        .from(tracks)
        .where(eq(tracks.spotifyId, spotifyId))
        .get() ?? null
    );
  }

  findAll(): Track[] {
    return this.db.select().from(tracks).all();
  }

  upsert(data: UpsertTrackData): Track {
    return this.db
      .insert(tracks)
      .values({
        spotifyId: data.spotifyId,
        title: data.title,
        artist: data.artist,
        album: data.album,
        durationMs: data.durationMs,
        isrc: data.isrc,
        spotifyUri: data.spotifyUri,
      })
      .onConflictDoUpdate({
        target: tracks.spotifyId,
        set: {
          title: data.title,
          artist: data.artist,
          album: data.album,
          durationMs: data.durationMs,
          isrc: data.isrc,
          spotifyUri: data.spotifyUri,
          updatedAt: Date.now(),
        },
      })
      .returning()
      .get();
  }

  updateFields(id: string, fields: Partial<Track>): void {
    this.db
      .update(tracks)
      .set({ ...fields, updatedAt: Date.now() })
      .where(eq(tracks.id, id))
      .run();
  }
}
