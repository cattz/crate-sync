import { eq, and, sql, desc } from "drizzle-orm";
import { getDb } from "../db/client.js";
import {
  playlists,
  tracks,
  playlistTracks,
  matches,
  downloads,
  jobs,
  type Playlist,
  type Track,
  type PlaylistTrack,
} from "../db/schema.js";
import type { SpotifyTrack } from "../types/spotify.js";
import { extractPlaylistId } from "../utils/spotify-url.js";
import { SpotifyService } from "./spotify-service.js";

export type TrackStatus =
  | "in_lexicon"
  | "pending_review"
  | "downloading"
  | "downloaded"
  | "download_failed"
  | "search_failed"
  | "not_matched";

export class PlaylistService {
  private db: ReturnType<typeof getDb>;

  constructor(db: ReturnType<typeof getDb>) {
    this.db = db;
  }

  /** Get all playlists, optionally filtered by name. */
  getPlaylists(options?: { filter?: string | RegExp }): Playlist[] {
    const all = this.db.select().from(playlists).all();
    if (!options?.filter) return all;

    const pattern = options.filter;
    if (pattern instanceof RegExp) {
      return all.filter((p) => pattern.test(p.name));
    }
    const q = pattern.toLowerCase();
    return all.filter((p) => p.name.toLowerCase().includes(q));
  }

  /** Get playlist by local DB id, spotify_id, or Spotify URL. */
  getPlaylist(id: string): Playlist | null {
    const normalizedId = extractPlaylistId(id);

    // Try local id first
    const byId = this.db
      .select()
      .from(playlists)
      .where(eq(playlists.id, normalizedId))
      .get();

    if (byId) return byId;

    // Fall back to spotify_id
    const bySpotifyId = this.db
      .select()
      .from(playlists)
      .where(eq(playlists.spotifyId, normalizedId))
      .get();

    if (bySpotifyId) return bySpotifyId;

    // Fall back to name (exact match)
    const byName = this.db
      .select()
      .from(playlists)
      .where(eq(playlists.name, normalizedId))
      .get();

    return byName ?? null;
  }

  /** Get tracks for a playlist, ordered by position. */
  getPlaylistTracks(
    playlistId: string,
    options?: { enriched?: boolean },
  ): Array<Track & { position: number; trackStatus?: TrackStatus }> {
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

    if (!options?.enriched) return rows;

    return rows.map((row) => ({
      ...row,
      trackStatus: this.deriveTrackStatus(row.id),
    }));
  }

  /** Derive display status for a track from matches and downloads tables. */
  private deriveTrackStatus(trackId: string): TrackStatus {
    // Check for lexicon match (sourceType=spotify, sourceId=track.id, targetType=lexicon)
    const match = this.db
      .select({ status: matches.status })
      .from(matches)
      .where(
        and(
          eq(matches.sourceType, "spotify"),
          eq(matches.sourceId, trackId),
          eq(matches.targetType, "lexicon"),
        ),
      )
      .orderBy(desc(matches.updatedAt))
      .limit(1)
      .get();

    if (match) {
      if (match.status === "confirmed") return "in_lexicon";
      if (match.status === "pending") return "pending_review";
      // rejected matches fall through to check downloads
    }

    // Check for latest download
    const dl = this.db
      .select({ status: downloads.status })
      .from(downloads)
      .where(eq(downloads.trackId, trackId))
      .orderBy(desc(downloads.createdAt))
      .limit(1)
      .get();

    if (dl) {
      if (dl.status === "downloading" || dl.status === "searching" || dl.status === "validating" || dl.status === "moving") return "downloading";
      if (dl.status === "done") return "downloaded";
      if (dl.status === "failed") return "download_failed";
      // pending downloads
      if (dl.status === "pending") return "downloading";
    }

    // Check for failed search jobs (track went through pipeline but search found nothing)
    const searchJob = this.db
      .select({ status: jobs.status })
      .from(jobs)
      .where(
        and(
          eq(jobs.type, "search"),
          sql`json_extract(${jobs.payload}, '$.trackId') = ${trackId}`,
        ),
      )
      .orderBy(desc(jobs.createdAt))
      .limit(1)
      .get();

    if (searchJob?.status === "failed") return "search_failed";

    return "not_matched";
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

  /** Rename a playlist in the local DB. */
  renamePlaylist(playlistId: string, newName: string): void {
    this.db
      .update(playlists)
      .set({ name: newName, updatedAt: Date.now() })
      .where(eq(playlists.id, playlistId))
      .run();
  }

  /** Bulk rename playlists matching a pattern. Optionally scoped to specific playlist IDs. */
  bulkRename(
    pattern: string | RegExp,
    replacement: string,
    options?: { dryRun?: boolean; playlistIds?: string[] },
  ): Array<{ id: string; oldName: string; newName: string }> {
    const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;
    let candidates = this.getPlaylists();

    if (options?.playlistIds && options.playlistIds.length > 0) {
      const idSet = new Set(options.playlistIds);
      candidates = candidates.filter((p) => idSet.has(p.id));
    }

    const results: Array<{ id: string; oldName: string; newName: string }> = [];

    for (const pl of candidates) {
      const newName = pl.name.replace(regex, replacement);
      if (newName !== pl.name) {
        results.push({ id: pl.id, oldName: pl.name, newName });
      }
    }

    if (!options?.dryRun) {
      for (const r of results) {
        this.renamePlaylist(r.id, r.newName);
      }
    }

    return results;
  }

  /** Update local playlist metadata (tags, notes, pinned). Partial update. */
  updateMetadata(
    playlistId: string,
    data: { tags?: string; notes?: string; pinned?: number },
  ): void {
    this.db
      .update(playlists)
      .set({ ...data, updatedAt: Date.now() })
      .where(eq(playlists.id, playlistId))
      .run();
  }

  /** Compose a Spotify description string from playlist tags + notes. */
  composeDescription(playlistId: string): string {
    const playlist = this.getPlaylist(playlistId);
    if (!playlist) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }
    return SpotifyService.composeDescription(playlist.notes ?? null, playlist.tags ?? null);
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

  /**
   * Get tracks that differ between local DB and Spotify.
   * Compares local playlist tracks (by spotifyUri) against Spotify's current state.
   */
  getPlaylistDiff(
    playlistId: string,
    spotifyTracks: SpotifyTrack[],
  ): {
    toAdd: string[];
    toRemove: string[];
    renamed: boolean;
  } {
    const playlist = this.getPlaylist(playlistId);
    if (!playlist) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }

    const localTracks = this.getPlaylistTracks(playlistId);

    // Build sets of Spotify URIs
    const localUris = new Set(
      localTracks
        .map((t) => t.spotifyUri)
        .filter((uri): uri is string => uri != null),
    );
    const spotifyUris = new Set(spotifyTracks.map((t) => t.uri));

    // URIs in local but not in Spotify → need to add
    const toAdd = [...localUris].filter((uri) => !spotifyUris.has(uri));

    // URIs in Spotify but not in local → need to remove
    const toRemove = [...spotifyUris].filter((uri) => !localUris.has(uri));

    // Check if name differs (we can't know the Spotify name here, so
    // the caller is responsible for comparing names separately)
    const renamed = false;

    return { toAdd, toRemove, renamed };
  }

  /** Update the snapshot_id for a playlist. */
  updateSnapshotId(playlistId: string, snapshotId: string): void {
    this.db
      .update(playlists)
      .set({ snapshotId, updatedAt: Date.now() })
      .where(eq(playlists.id, playlistId))
      .run();
  }
}
