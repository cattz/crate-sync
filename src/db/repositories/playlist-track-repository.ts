import { eq } from "drizzle-orm";
import { playlistTracks, tracks, playlists, type Track } from "../schema.js";
import type {
  IPlaylistTrackRepository,
  PlaylistTrackWithTrack,
} from "../../ports/repositories.js";
import type { getDb } from "../client.js";

type Db = ReturnType<typeof getDb>;

export class DrizzlePlaylistTrackRepository implements IPlaylistTrackRepository {
  constructor(private db: Db) {}

  findByPlaylistId(playlistId: string): PlaylistTrackWithTrack[] {
    return this.db
      .select({
        id: tracks.id,
        spotifyId: tracks.spotifyId,
        title: tracks.title,
        artist: tracks.artist,
        album: tracks.album,
        durationMs: tracks.durationMs,
        isrc: tracks.isrc,
        spotifyUri: tracks.spotifyUri,
        isLocal: tracks.isLocal,
        createdAt: tracks.createdAt,
        updatedAt: tracks.updatedAt,
        position: playlistTracks.position,
      })
      .from(playlistTracks)
      .innerJoin(tracks, eq(playlistTracks.trackId, tracks.id))
      .where(eq(playlistTracks.playlistId, playlistId))
      .orderBy(playlistTracks.position)
      .all();
  }

  findTrackIdsByPlaylistId(
    playlistId: string,
  ): Array<{ trackId: string; position: number }> {
    return this.db
      .select({
        trackId: playlistTracks.trackId,
        position: playlistTracks.position,
      })
      .from(playlistTracks)
      .where(eq(playlistTracks.playlistId, playlistId))
      .orderBy(playlistTracks.position)
      .all();
  }

  findPlaylistsForTrack(trackId: string): Array<{
    playlistId: string;
    playlistName: string;
    playlistTags: string | null;
  }> {
    return this.db
      .select({
        playlistId: playlistTracks.playlistId,
        playlistName: playlists.name,
        playlistTags: playlists.tags,
      })
      .from(playlistTracks)
      .innerJoin(playlists, eq(playlistTracks.playlistId, playlists.id))
      .where(eq(playlistTracks.trackId, trackId))
      .all();
  }

  setTracks(
    playlistId: string,
    trackIds: string[],
    addedAt?: number | null,
  ): void {
    this.db
      .delete(playlistTracks)
      .where(eq(playlistTracks.playlistId, playlistId))
      .run();

    for (let i = 0; i < trackIds.length; i++) {
      this.db
        .insert(playlistTracks)
        .values({
          playlistId,
          trackId: trackIds[i],
          position: i,
          addedAt: addedAt ?? null,
        })
        .run();
    }
  }

  upsertJunction(
    playlistId: string,
    trackId: string,
    position: number,
    addedAt?: number | null,
  ): void {
    this.db
      .insert(playlistTracks)
      .values({
        playlistId,
        trackId,
        position,
        addedAt: addedAt ?? Date.now(),
      })
      .onConflictDoUpdate({
        target: [playlistTracks.playlistId, playlistTracks.trackId],
        set: { position },
      })
      .run();
  }

  removeStale(playlistId: string, validTrackIds: Set<string>): void {
    const currentJunctions = this.db
      .select({
        id: playlistTracks.id,
        trackId: playlistTracks.trackId,
      })
      .from(playlistTracks)
      .where(eq(playlistTracks.playlistId, playlistId))
      .all();

    for (const junction of currentJunctions) {
      if (!validTrackIds.has(junction.trackId)) {
        this.db
          .delete(playlistTracks)
          .where(eq(playlistTracks.id, junction.id))
          .run();
      }
    }
  }

  removeByPlaylistId(playlistId: string): void {
    this.db
      .delete(playlistTracks)
      .where(eq(playlistTracks.playlistId, playlistId))
      .run();
  }
}
