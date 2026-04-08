import { eq } from "drizzle-orm";
import { playlists, type Playlist } from "../schema.js";
import type { IPlaylistRepository, UpsertPlaylistData } from "../../ports/repositories.js";
import type { getDb } from "../client.js";

type Db = ReturnType<typeof getDb>;

export class DrizzlePlaylistRepository implements IPlaylistRepository {
  constructor(private db: Db) {}

  findById(id: string): Playlist | null {
    return (
      this.db
        .select()
        .from(playlists)
        .where(eq(playlists.id, id))
        .get() ?? null
    );
  }

  findBySpotifyId(spotifyId: string): Playlist | null {
    return (
      this.db
        .select()
        .from(playlists)
        .where(eq(playlists.spotifyId, spotifyId))
        .get() ?? null
    );
  }

  findByName(name: string): Playlist | null {
    return (
      this.db
        .select()
        .from(playlists)
        .where(eq(playlists.name, name))
        .get() ?? null
    );
  }

  findAll(): Playlist[] {
    return this.db.select().from(playlists).all();
  }

  upsert(data: UpsertPlaylistData): Playlist {
    return this.db
      .insert(playlists)
      .values({
        spotifyId: data.spotifyId,
        name: data.name,
        description: data.description,
        snapshotId: data.snapshotId,
        isOwned: data.isOwned,
        ownerId: data.ownerId,
        ownerName: data.ownerName,
        notes: data.notes,
        tags: data.tags,
        source: data.source,
      })
      .onConflictDoUpdate({
        target: playlists.spotifyId,
        set: {
          name: data.name,
          description: data.description,
          snapshotId: data.snapshotId,
          isOwned: data.isOwned,
          ownerId: data.ownerId,
          ownerName: data.ownerName,
          notes: data.notes,
          tags: data.tags,
          updatedAt: Date.now(),
        },
      })
      .returning()
      .get();
  }

  updateFields(id: string, fields: Partial<Playlist>): void {
    this.db
      .update(playlists)
      .set({ ...fields, updatedAt: Date.now() })
      .where(eq(playlists.id, id))
      .run();
  }

  remove(id: string): void {
    this.db.delete(playlists).where(eq(playlists.id, id)).run();
  }
}
