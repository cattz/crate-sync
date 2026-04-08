import { eq, and } from "drizzle-orm";
import { tracks, type Track } from "../schema.js";
import type { ITrackRepository, UpsertTrackData, InsertTrackData } from "../../ports/repositories.js";
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

  findByTitleArtist(title: string, artist: string): Track | null {
    return (
      this.db
        .select()
        .from(tracks)
        .where(and(eq(tracks.title, title), eq(tracks.artist, artist)))
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
        isLocal: data.isLocal ?? 0,
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
          isLocal: data.isLocal ?? 0,
          updatedAt: Date.now(),
        },
      })
      .returning()
      .get();
  }

  insert(data: InsertTrackData): Track {
    return this.db
      .insert(tracks)
      .values({
        title: data.title,
        artist: data.artist,
        album: data.album,
        durationMs: data.durationMs ?? 0,
        isrc: data.isrc,
        isLocal: 1,
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
