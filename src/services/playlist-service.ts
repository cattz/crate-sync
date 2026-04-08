import { eq, and, sql, desc } from "drizzle-orm";
import {
  matches,
  downloads,
  jobs,
  playlists as playlistsTable,
  type Playlist,
  type Track,
} from "../db/schema.js";
import type { SpotifyPlaylist, SpotifyTrack } from "../types/spotify.js";
import type {
  IPlaylistRepository,
  ITrackRepository,
  IPlaylistTrackRepository,
} from "../ports/repositories.js";
import { extractPlaylistId } from "../utils/spotify-url.js";
import { composeDescription, parseDescription } from "../utils/description.js";
import { isShutdownRequested } from "../utils/shutdown.js";
import { normalizeBase, normalizeArtist } from "../matching/normalize.js";
import { getDb } from "../db/client.js";
import {
  DrizzlePlaylistRepository,
  DrizzleTrackRepository,
  DrizzlePlaylistTrackRepository,
  DrizzleMatchRepository,
  DrizzleDownloadRepository,
} from "../db/repositories/index.js";

export type TrackStatus =
  | "in_lexicon"
  | "pending_review"
  | "downloading"
  | "downloaded"
  | "download_failed"
  | "search_failed"
  | "wishlisted"
  | "not_matched";

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

export interface PlaylistServiceDeps {
  playlists: IPlaylistRepository;
  tracks: ITrackRepository;
  playlistTracks: IPlaylistTrackRepository;
  /**
   * Raw DB handle — only used for cross-domain deriveTrackStatus queries
   * (matches, downloads, jobs) that don't warrant full repository abstraction
   * in PlaylistService. These are read-only status lookups.
   */
  db: ReturnType<typeof getDb>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class PlaylistService {
  private playlists: IPlaylistRepository;
  private tracks: ITrackRepository;
  private playlistTracks: IPlaylistTrackRepository;
  private db: ReturnType<typeof getDb>;

  constructor(deps: PlaylistServiceDeps) {
    this.playlists = deps.playlists;
    this.tracks = deps.tracks;
    this.playlistTracks = deps.playlistTracks;
    this.db = deps.db;
  }

  /** Create a PlaylistService from a raw DB handle (convenience factory). */
  static fromDb(db: ReturnType<typeof getDb>): PlaylistService {
    return new PlaylistService({
      playlists: new DrizzlePlaylistRepository(db),
      tracks: new DrizzleTrackRepository(db),
      playlistTracks: new DrizzlePlaylistTrackRepository(db),
      db,
    });
  }

  /** Get all playlists, optionally filtered by name. */
  getPlaylists(options?: { filter?: string | RegExp }): Playlist[] {
    const all = this.playlists.findAll();
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

    return (
      this.playlists.findById(normalizedId) ??
      this.playlists.findBySpotifyId(normalizedId) ??
      this.playlists.findByName(normalizedId) ??
      null
    );
  }

  /** Get tracks for a playlist, ordered by position. */
  getPlaylistTracks(
    playlistId: string,
    options?: { enriched?: boolean },
  ): Array<Track & { position: number; trackStatus?: TrackStatus }> {
    const rows = this.playlistTracks.findByPlaylistId(playlistId);

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
      if (dl.status === "wishlisted") return "wishlisted";
      if (dl.status === "failed") return "download_failed";
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
    return this.playlists.upsert(data);
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
    return this.tracks.upsert(data);
  }

  /** Set tracks for a playlist (replaces all playlist_tracks entries). */
  setPlaylistTracks(
    playlistId: string,
    trackIds: string[],
    addedAt?: number,
  ): void {
    this.playlistTracks.setTracks(playlistId, trackIds, addedAt);
  }

  /** Rename a playlist in the local DB. */
  renamePlaylist(playlistId: string, newName: string): void {
    this.playlists.updateFields(playlistId, { name: newName });
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
    this.playlists.updateFields(playlistId, data);
  }

  /** Compose a Spotify description string from playlist tags + notes. */
  composeDescription(playlistId: string): string {
    const playlist = this.getPlaylist(playlistId);
    if (!playlist) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }
    return composeDescription(playlist.notes ?? null, playlist.tags ?? null);
  }

  /** Remove a playlist and its playlist_tracks entries. */
  removePlaylist(playlistId: string): void {
    this.playlistTracks.removeByPlaylistId(playlistId);
    this.playlists.remove(playlistId);
  }

  /**
   * Import tracks into a new playlist. Deduplicates by title+artist.
   * If a matching track already exists in the DB, reuses it.
   */
  importTracks(
    playlistName: string,
    tracks: Array<{ title: string; artist: string; album?: string; durationMs?: number; isrc?: string }>,
  ): { playlistId: string; added: number; duplicates: number } {
    const playlist = this.createLocalPlaylist(playlistName);
    const trackIds: string[] = [];
    const seen = new Set<string>();
    let duplicates = 0;

    for (const t of tracks) {
      const key = `${t.artist.toLowerCase()}::${t.title.toLowerCase()}`;
      if (seen.has(key)) {
        duplicates++;
        continue;
      }
      seen.add(key);

      // Reuse existing track if it matches by title+artist
      const existing = this.tracks.findByTitleArtist(t.title, t.artist);
      if (existing) {
        trackIds.push(existing.id);
      } else {
        const inserted = this.tracks.insert({
          title: t.title,
          artist: t.artist,
          album: t.album,
          durationMs: t.durationMs,
          isrc: t.isrc,
        });
        trackIds.push(inserted.id);
      }
    }

    this.setPlaylistTracks(playlist.id, trackIds);
    return { playlistId: playlist.id, added: trackIds.length, duplicates };
  }

  /**
   * Find duplicate tracks within a playlist.
   * A track is a duplicate if it matches an earlier track by:
   * 1. Same spotifyUri (exact duplicate)
   * 2. Same ISRC (same recording, different releases)
   * 3. Same normalized title + artist
   *
   * Returns groups of duplicates. The first track in each group is the one to keep.
   */
  findDuplicates(
    playlistId: string,
  ): Array<{ kept: Track & { position: number }; duplicates: Array<Track & { position: number }>; reason: string }> {
    const tracks = this.getPlaylistTracks(playlistId);
    const groups: Array<{ kept: Track & { position: number }; duplicates: Array<Track & { position: number }>; reason: string }> = [];

    // Track which canonical entry each track maps to, keyed by match criterion
    const seenUri = new Map<string, number>(); // spotifyUri → index in tracks
    const seenIsrc = new Map<string, number>(); // isrc → index
    const seenNorm = new Map<string, number>(); // normalizedKey → index

    // Map from "kept" track index → group entry
    const groupMap = new Map<number, (typeof groups)[number]>();

    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      let matchIdx: number | undefined;
      let reason = "";

      // 1. Exact URI match
      if (t.spotifyUri) {
        const prev = seenUri.get(t.spotifyUri);
        if (prev !== undefined) {
          matchIdx = prev;
          reason = "same URI";
        } else {
          seenUri.set(t.spotifyUri, i);
        }
      }

      // 2. ISRC match
      if (matchIdx === undefined && t.isrc) {
        const prev = seenIsrc.get(t.isrc);
        if (prev !== undefined) {
          matchIdx = prev;
          reason = "same ISRC";
        } else {
          seenIsrc.set(t.isrc, i);
        }
      }

      // 3. Normalized title + artist
      if (matchIdx === undefined) {
        const key = `${normalizeArtist(t.artist)}::${normalizeBase(t.title)}`;
        const prev = seenNorm.get(key);
        if (prev !== undefined) {
          matchIdx = prev;
          reason = "same title + artist";
        } else {
          seenNorm.set(key, i);
        }
      }

      if (matchIdx !== undefined) {
        const existing = groupMap.get(matchIdx);
        if (existing) {
          existing.duplicates.push(t);
        } else {
          const group = { kept: tracks[matchIdx], duplicates: [t], reason };
          groups.push(group);
          groupMap.set(matchIdx, group);
        }
      }
    }

    return groups;
  }

  /**
   * Remove duplicate tracks from a playlist.
   * Keeps the first occurrence, removes subsequent duplicates.
   */
  removeDuplicates(
    playlistId: string,
    opts?: { dryRun?: boolean },
  ): { groups: ReturnType<PlaylistService["findDuplicates"]>; removed: number } {
    const groups = this.findDuplicates(playlistId);
    const removed = groups.reduce((sum, g) => sum + g.duplicates.length, 0);

    if (opts?.dryRun || removed === 0) {
      return { groups, removed };
    }

    // Build set of track IDs to remove (by position, since same track could appear multiple times)
    const removePositions = new Set<number>();
    for (const g of groups) {
      for (const dup of g.duplicates) {
        removePositions.add(dup.position);
      }
    }

    // Rebuild playlist without duplicate positions
    const tracks = this.getPlaylistTracks(playlistId);
    const keepTrackIds = tracks
      .filter((t) => !removePositions.has(t.position))
      .map((t) => t.id);

    this.setPlaylistTracks(playlistId, keepTrackIds);

    return { groups, removed };
  }

  /**
   * Merge tracks from source playlists into a target playlist (union — no duplicates).
   * Preserves target's existing track order and appends new tracks at the end.
   *
   * @throws Error if a source ID is the same as the target ID
   */
  mergePlaylists(
    targetId: string,
    sourceIds: string[],
    opts?: { deleteSources?: boolean; dryRun?: boolean },
  ): { added: number; duplicates: number; sourcesDeleted: number } {
    // Validate: source cannot be the same as target
    for (const sourceId of sourceIds) {
      if (sourceId === targetId) {
        throw new Error("Cannot merge a playlist into itself");
      }
    }

    // Get target playlist's existing track IDs (ordered)
    const targetTracks = this.playlistTracks.findTrackIdsByPlaylistId(targetId);
    const existingTrackIds = new Set(targetTracks.map((t) => t.trackId));
    const mergedTrackIds = targetTracks.map((t) => t.trackId);

    let added = 0;
    let duplicates = 0;

    // For each source playlist, get its tracks in order
    for (const sourceId of sourceIds) {
      const sourceTracks = this.playlistTracks.findTrackIdsByPlaylistId(sourceId);
      for (const st of sourceTracks) {
        if (existingTrackIds.has(st.trackId)) {
          duplicates++;
        } else {
          existingTrackIds.add(st.trackId);
          mergedTrackIds.push(st.trackId);
          added++;
        }
      }
    }

    // In dry-run mode, return counts without modifying anything
    if (opts?.dryRun) {
      return { added, duplicates, sourcesDeleted: opts.deleteSources ? sourceIds.length : 0 };
    }

    // Update target's playlist_tracks with the merged list
    this.playlistTracks.setTracks(targetId, mergedTrackIds);

    // If deleteSources, remove source playlists
    let sourcesDeleted = 0;
    if (opts?.deleteSources) {
      for (const sourceId of sourceIds) {
        this.playlistTracks.removeByPlaylistId(sourceId);
        this.playlists.remove(sourceId);
        sourcesDeleted++;
      }
    }

    return { added, duplicates, sourcesDeleted };
  }

  /** Create a new local-only playlist (no Spotify ID). */
  createLocalPlaylist(name: string): Playlist {
    return this.db
      .insert(playlistsTable)
      .values({ name })
      .returning()
      .get();
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

    // Build sets of Spotify URIs — exclude local/broken URIs entirely
    const localUris = new Set(
      localTracks
        .map((t) => t.spotifyUri)
        .filter((uri): uri is string => uri != null && !uri.startsWith("spotify:local:")),
    );
    const spotifyUris = new Set(spotifyTracks.map((t) => t.uri));

    // URIs in local but not in Spotify → need to add
    const toAdd = [...localUris].filter((uri) => !spotifyUris.has(uri));

    // URIs in Spotify but not in local → need to remove
    // Only remove if we have real local tracks to compare against
    const toRemove = localUris.size > 0
      ? [...spotifyUris].filter((uri) => !localUris.has(uri))
      : []; // Don't remove anything if local only has broken tracks

    const renamed = false;

    return { toAdd, toRemove, renamed };
  }

  /** Update the snapshot_id for a playlist. */
  updateSnapshotId(playlistId: string, snapshotId: string): void {
    this.playlists.updateFields(playlistId, { snapshotId });
  }

  // ---------------------------------------------------------------------------
  // API → DB sync (moved from SpotifyService)
  // ---------------------------------------------------------------------------

  /**
   * Sync playlists from the Spotify API into the local DB.
   * Upserts each playlist by spotify_id.
   */
  syncPlaylistsFromApi(
    apiPlaylists: SpotifyPlaylist[],
    currentUserId: string,
  ): { added: number; updated: number; unchanged: number } {
    let added = 0;
    let updated = 0;
    let unchanged = 0;

    for (const pl of apiPlaylists) {
      if (isShutdownRequested()) break;

      const isOwned = pl.ownerId === currentUserId ? 1 : 0;
      const existing = this.playlists.findBySpotifyId(pl.id);

      if (!existing) {
        const parsed = parseDescription(pl.description);
        this.playlists.upsert({
          spotifyId: pl.id,
          name: pl.name,
          description: pl.description ?? null,
          snapshotId: pl.snapshotId,
          isOwned,
          ownerId: pl.ownerId,
          ownerName: pl.ownerName,
          notes: parsed.notes || null,
          tags: parsed.tags.length > 0 ? JSON.stringify(parsed.tags) : null,
        });
        // Update lastSynced separately since upsert doesn't handle it
        const inserted = this.playlists.findBySpotifyId(pl.id);
        if (inserted) this.playlists.updateFields(inserted.id, { lastSynced: Date.now() });
        added++;
      } else if (
        existing.snapshotId !== pl.snapshotId ||
        existing.name !== pl.name ||
        existing.isOwned !== isOwned
      ) {
        this.playlists.updateFields(existing.id, {
          name: pl.name,
          description: pl.description ?? null,
          snapshotId: pl.snapshotId,
          isOwned,
          ownerId: pl.ownerId,
          ownerName: pl.ownerName,
          lastSynced: Date.now(),
        });
        updated++;
      } else {
        unchanged++;
      }
    }

    return { added, updated, unchanged };
  }

  /**
   * Sync a single playlist's tracks from Spotify API data into the local DB.
   * Upserts each track by spotify_id, then syncs the playlist_tracks junction.
   */
  syncPlaylistTracksFromApi(
    spotifyPlaylistId: string,
    apiTracks: SpotifyTrack[],
  ): { added: number; updated: number } {
    const playlist = this.playlists.findBySpotifyId(spotifyPlaylistId);

    if (!playlist) {
      throw new Error(
        `Playlist with spotify_id "${spotifyPlaylistId}" not found in DB. Run syncPlaylistsFromApi() first.`,
      );
    }

    let added = 0;
    let updated = 0;
    const syncedTrackIds = new Set<string>();

    for (let position = 0; position < apiTracks.length; position++) {
      const t = apiTracks[position];

      const existingTrack = this.tracks.findBySpotifyId(t.id);
      let trackId: string;

      const isLocal = t.isLocal || t.uri.startsWith("spotify:local:") ? 1 : 0;

      if (!existingTrack) {
        const inserted = this.tracks.upsert({
          spotifyId: t.id,
          title: t.title,
          artist: t.artist,
          album: t.album,
          durationMs: t.durationMs,
          isrc: t.isrc ?? null,
          spotifyUri: t.uri,
          isLocal,
        });
        trackId = inserted.id;
        added++;
      } else {
        if (
          existingTrack.title !== t.title ||
          existingTrack.artist !== t.artist ||
          existingTrack.album !== t.album ||
          existingTrack.isLocal !== isLocal
        ) {
          this.tracks.upsert({
            spotifyId: t.id,
            title: t.title,
            artist: t.artist,
            album: t.album,
            durationMs: t.durationMs,
            isrc: t.isrc ?? null,
            spotifyUri: t.uri,
            isLocal,
          });
          updated++;
        }
        trackId = existingTrack.id;
      }

      this.playlistTracks.upsertJunction(playlist.id, trackId, position);
      syncedTrackIds.add(trackId);
    }

    // Remove tracks no longer in the playlist (use IDs we actually synced, not re-lookup)
    this.playlistTracks.removeStale(playlist.id, syncedTrackIds);

    // Count broken tracks: local tracks in the data + unavailable tracks (null from API)
    const localCount = apiTracks.filter(t => t.isLocal || t.uri.startsWith("spotify:local:")).length;
    const unavailableCount = (apiTracks as SpotifyTrack[] & { unavailableCount?: number }).unavailableCount ?? 0;
    const brokenCount = localCount + unavailableCount;
    this.playlists.updateFields(playlist.id, { lastSynced: Date.now(), brokenTracks: brokenCount });

    return { added, updated };
  }
}
