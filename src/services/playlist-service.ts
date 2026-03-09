import { eq, and, sql, count, desc } from "drizzle-orm";
import { getDb } from "../db/client.js";
import {
  playlists,
  tracks,
  playlistTracks,
  type Playlist,
  type Track,
  type PlaylistTrack,
} from "../db/schema.js";

export class PlaylistService {
  private db: ReturnType<typeof getDb>;

  constructor(db: ReturnType<typeof getDb>) {
    this.db = db;
  }

  /** Get all playlists. */
  getPlaylists(): Playlist[] {
    return this.db.select().from(playlists).all();
  }

  /** Get playlist by local DB id or spotify_id. */
  getPlaylist(id: string): Playlist | null {
    // Try local id first
    const byId = this.db
      .select()
      .from(playlists)
      .where(eq(playlists.id, id))
      .get();

    if (byId) return byId;

    // Fall back to spotify_id
    const bySpotifyId = this.db
      .select()
      .from(playlists)
      .where(eq(playlists.spotifyId, id))
      .get();

    return bySpotifyId ?? null;
  }

  /** Get tracks for a playlist, ordered by position. */
  getPlaylistTracks(
    playlistId: string,
  ): Array<Track & { position: number }> {
    const rows = this.db
      .select({
        id: tracks.id,
        spotifyId: tracks.spotifyId,
        title: tracks.title,
        artist: tracks.artist,
        album: tracks.album,
        durationMs: tracks.durationMs,
        isrc: tracks.isrc,
        spotifyUri: tracks.spotifyUri,
        createdAt: tracks.createdAt,
        updatedAt: tracks.updatedAt,
        position: playlistTracks.position,
      })
      .from(playlistTracks)
      .innerJoin(tracks, eq(playlistTracks.trackId, tracks.id))
      .where(eq(playlistTracks.playlistId, playlistId))
      .orderBy(playlistTracks.position)
      .all();

    return rows;
  }

  /**
   * Find duplicate tracks within a playlist.
   * Groups by spotify_id first, then by title+artist for tracks without spotify_id.
   */
  findDuplicatesInPlaylist(
    playlistId: string,
  ): Array<{ track: Track; duplicates: Track[] }> {
    const playlistTrackRows = this.getPlaylistTracks(playlistId);
    const result: Array<{ track: Track; duplicates: Track[] }> = [];

    // Group by spotify_id
    const bySpotifyId = new Map<string, Track[]>();
    const noSpotifyId: Track[] = [];

    for (const row of playlistTrackRows) {
      const { position: _, ...track } = row;
      if (track.spotifyId) {
        const group = bySpotifyId.get(track.spotifyId) ?? [];
        group.push(track);
        bySpotifyId.set(track.spotifyId, group);
      } else {
        noSpotifyId.push(track);
      }
    }

    // Collect spotify_id duplicates
    for (const [, group] of bySpotifyId) {
      if (group.length > 1) {
        result.push({ track: group[0], duplicates: group.slice(1) });
      }
    }

    // Group remaining by title+artist (case-insensitive)
    const byTitleArtist = new Map<string, Track[]>();
    for (const track of noSpotifyId) {
      const key = `${track.title.toLowerCase()}::${track.artist.toLowerCase()}`;
      const group = byTitleArtist.get(key) ?? [];
      group.push(track);
      byTitleArtist.set(key, group);
    }

    for (const [, group] of byTitleArtist) {
      if (group.length > 1) {
        result.push({ track: group[0], duplicates: group.slice(1) });
      }
    }

    return result;
  }

  /** Find duplicate tracks across all playlists. */
  findDuplicatesAcrossPlaylists(): Array<{
    track: Track;
    playlists: Playlist[];
  }> {
    // Get all tracks that appear in more than one playlist
    const allPt = this.db
      .select({
        trackId: playlistTracks.trackId,
        playlistId: playlistTracks.playlistId,
      })
      .from(playlistTracks)
      .all();

    // Group playlist IDs by track ID
    const trackPlaylists = new Map<string, Set<string>>();
    for (const row of allPt) {
      const set = trackPlaylists.get(row.trackId) ?? new Set();
      set.add(row.playlistId);
      trackPlaylists.set(row.trackId, set);
    }

    const result: Array<{ track: Track; playlists: Playlist[] }> = [];

    for (const [trackId, playlistIdSet] of trackPlaylists) {
      if (playlistIdSet.size <= 1) continue;

      const track = this.db
        .select()
        .from(tracks)
        .where(eq(tracks.id, trackId))
        .get();

      if (!track) continue;

      const trackPlaylists_: Playlist[] = [];
      for (const pid of playlistIdSet) {
        const playlist = this.db
          .select()
          .from(playlists)
          .where(eq(playlists.id, pid))
          .get();
        if (playlist) trackPlaylists_.push(playlist);
      }

      result.push({ track, playlists: trackPlaylists_ });
    }

    return result;
  }

  /** Upsert a playlist (insert or update by spotify_id). */
  upsertPlaylist(data: {
    spotifyId: string;
    name: string;
    description?: string;
    snapshotId?: string;
  }): Playlist {
    const row = this.db
      .insert(playlists)
      .values({
        spotifyId: data.spotifyId,
        name: data.name,
        description: data.description,
        snapshotId: data.snapshotId,
      })
      .onConflictDoUpdate({
        target: playlists.spotifyId,
        set: {
          name: data.name,
          description: data.description,
          snapshotId: data.snapshotId,
          updatedAt: Date.now(),
        },
      })
      .returning()
      .get();

    return row;
  }

  /** Upsert a track (insert or update by spotify_id). */
  upsertTrack(data: {
    spotifyId: string;
    title: string;
    artist: string;
    album?: string;
    durationMs: number;
    isrc?: string;
    spotifyUri?: string;
  }): Track {
    const row = this.db
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

    return row;
  }

  /** Set tracks for a playlist (replaces all playlist_tracks entries). */
  setPlaylistTracks(
    playlistId: string,
    trackIds: string[],
    addedAt?: number,
  ): void {
    // Delete existing entries for this playlist
    this.db
      .delete(playlistTracks)
      .where(eq(playlistTracks.playlistId, playlistId))
      .run();

    // Insert new entries with positions
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

  /** Remove a playlist and its playlist_tracks entries. */
  removePlaylist(playlistId: string): void {
    // Delete playlist_tracks first (foreign key)
    this.db
      .delete(playlistTracks)
      .where(eq(playlistTracks.playlistId, playlistId))
      .run();

    // Delete the playlist
    this.db
      .delete(playlists)
      .where(eq(playlists.id, playlistId))
      .run();
  }
}
