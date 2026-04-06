/**
 * Repository port interfaces — abstract contracts for data persistence.
 *
 * Services depend on these interfaces, never on concrete Drizzle implementations.
 * Concrete adapters live in src/db/repositories/.
 */
import type {
  Playlist,
  Track,
  Match,
  NewMatch,
  Download,
  Rejection,
} from "../db/schema.js";

// ---------------------------------------------------------------------------
// IPlaylistRepository
// ---------------------------------------------------------------------------

export interface UpsertPlaylistData {
  spotifyId: string;
  name: string;
  description?: string | null;
  snapshotId?: string | null;
  isOwned?: number | null;
  ownerId?: string | null;
  ownerName?: string | null;
  notes?: string | null;
  tags?: string | null;
}

export interface IPlaylistRepository {
  findById(id: string): Playlist | null;
  findBySpotifyId(spotifyId: string): Playlist | null;
  findByName(name: string): Playlist | null;
  findAll(): Playlist[];
  upsert(data: UpsertPlaylistData): Playlist;
  updateFields(id: string, fields: Partial<Playlist>): void;
  remove(id: string): void;
}

// ---------------------------------------------------------------------------
// ITrackRepository
// ---------------------------------------------------------------------------

export interface UpsertTrackData {
  spotifyId: string;
  title: string;
  artist: string;
  album?: string | null;
  durationMs: number;
  isrc?: string | null;
  spotifyUri?: string | null;
  isLocal?: number | null;
}

export interface ITrackRepository {
  findById(id: string): Track | null;
  findBySpotifyId(spotifyId: string): Track | null;
  findAll(): Track[];
  upsert(data: UpsertTrackData): Track;
  updateFields(id: string, fields: Partial<Track>): void;
}

// ---------------------------------------------------------------------------
// IPlaylistTrackRepository
// ---------------------------------------------------------------------------

export interface PlaylistTrackWithTrack extends Track {
  position: number;
}

export interface IPlaylistTrackRepository {
  /** Get tracks for a playlist, joined with track data, ordered by position. */
  findByPlaylistId(playlistId: string): PlaylistTrackWithTrack[];

  /** Get trackId + position only (no join), ordered by position. */
  findTrackIdsByPlaylistId(playlistId: string): Array<{ trackId: string; position: number }>;

  /** Get all playlist associations for a track (with playlist name and tags). */
  findPlaylistsForTrack(trackId: string): Array<{
    playlistId: string;
    playlistName: string;
    playlistTags: string | null;
  }>;

  /** Replace all tracks for a playlist. */
  setTracks(playlistId: string, trackIds: string[], addedAt?: number | null): void;

  /** Upsert a single junction entry (insert or update position). */
  upsertJunction(playlistId: string, trackId: string, position: number, addedAt?: number | null): void;

  /** Remove junction entries for tracks no longer in the playlist. */
  removeStale(playlistId: string, validTrackIds: Set<string>): void;

  /** Remove all junction entries for a playlist. */
  removeByPlaylistId(playlistId: string): void;
}

// ---------------------------------------------------------------------------
// IMatchRepository
// ---------------------------------------------------------------------------

export interface IMatchRepository {
  findById(id: string): Match | null;

  /** Find all matches for a given source → target type pair. */
  findBySourceAndTargetType(
    sourceType: string,
    targetType: string,
  ): Match[];

  /** Find matches for a specific source ID and target type. */
  findBySourceIdAndTargetType(
    sourceType: string,
    sourceId: string,
    targetType: string,
  ): Match[];

  /** Find matches by status (optionally filtered by source/target type). */
  findByStatus(
    status: string,
    sourceType?: string,
    targetType?: string,
  ): Match[];

  /**
   * Upsert a match with the complex conflict-resolution logic:
   * - Never downgrade confirmed → pending/rejected
   * - Never override manual rejection
   */
  upsertWithConflict(data: NewMatch): void;

  /** Simple status + fields update. */
  updateStatus(id: string, status: string, extra?: Partial<Match>): void;

  /** Aggregate match counts by status for a source/target type. */
  getStats(
    sourceType: string,
    targetType: string,
  ): { pending: number; confirmed: number; rejected: number };
}

// ---------------------------------------------------------------------------
// IDownloadRepository
// ---------------------------------------------------------------------------

export interface IDownloadRepository {
  findById(id: string): Download | null;
  findByTrackId(trackId: string): Download | null;
  findByStatus(status: string): Download[];

  /** Find completed downloads with a non-null filePath. */
  findCompletedWithFilePath(): Array<{ trackId: string; filePath: string }>;

  insert(data: {
    trackId: string;
    playlistId?: string | null;
    status: string;
    origin?: string;
    createdAt?: number;
  }): Download;

  updateFields(id: string, fields: Partial<Download>): void;
}

// ---------------------------------------------------------------------------
// IRejectionRepository
// ---------------------------------------------------------------------------

export interface IRejectionRepository {
  /** Get all rejected fileKeys for a track+context. */
  findFileKeysByTrackAndContext(trackId: string, context: string): Set<string>;

  /** Get the rejection reason for a specific track+context+fileKey combo. */
  findReason(trackId: string, context: string, fileKey: string): string | null;

  /** Record a rejection (idempotent — ignores conflicts). */
  insert(data: {
    trackId: string;
    context: string;
    fileKey: string;
    reason?: string | null;
  }): void;
}
