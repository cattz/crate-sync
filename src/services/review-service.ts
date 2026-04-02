import type { Config } from "../config.js";
import type { TrackInfo } from "../types/common.js";
import type {
  IMatchRepository,
  ITrackRepository,
  IPlaylistRepository,
  IPlaylistTrackRepository,
  IDownloadRepository,
} from "../ports/repositories.js";
import { getDb } from "../db/client.js";
import {
  DrizzleMatchRepository,
  DrizzleTrackRepository,
  DrizzlePlaylistRepository,
  DrizzlePlaylistTrackRepository,
  DrizzleDownloadRepository,
} from "../db/repositories/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingReview {
  matchId: string;
  spotifyTrack: TrackInfo;
  lexiconTrack: TrackInfo;
  score: number;
  confidence: string;
  method: string;
  playlistName: string;
  parkedAt: number;
}

export interface ReviewStats {
  pending: number;
  confirmed: number;
  rejected: number;
}

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

export interface ReviewServiceDeps {
  matches: IMatchRepository;
  tracks: ITrackRepository;
  playlists: IPlaylistRepository;
  playlistTracks: IPlaylistTrackRepository;
  downloads: IDownloadRepository;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ReviewService {
  private matches: IMatchRepository;
  private trackRepo: ITrackRepository;
  private playlistRepo: IPlaylistRepository;
  private playlistTrackRepo: IPlaylistTrackRepository;
  private downloadRepo: IDownloadRepository;

  constructor(
    private config: Config,
    deps: ReviewServiceDeps,
  ) {
    this.matches = deps.matches;
    this.trackRepo = deps.tracks;
    this.playlistRepo = deps.playlists;
    this.playlistTrackRepo = deps.playlistTracks;
    this.downloadRepo = deps.downloads;
  }

  /** Create a ReviewService from a raw DB handle (convenience factory). */
  static fromDb(config: Config, db?: ReturnType<typeof getDb>): ReviewService {
    const database = db ?? getDb();
    return new ReviewService(config, {
      matches: new DrizzleMatchRepository(database),
      tracks: new DrizzleTrackRepository(database),
      playlists: new DrizzlePlaylistRepository(database),
      playlistTracks: new DrizzlePlaylistTrackRepository(database),
      downloads: new DrizzleDownloadRepository(database),
    });
  }

  /**
   * List all pending matches, optionally filtered by playlist.
   * Sorted by parkedAt ASC (FIFO).
   */
  async getPending(playlistId?: string): Promise<PendingReview[]> {
    // Get all pending spotify→lexicon matches
    let matchRows = this.matches.findByStatus("pending", "spotify", "lexicon");

    // Filter by playlist if provided
    if (playlistId) {
      const ptRows = this.playlistTrackRepo.findTrackIdsByPlaylistId(playlistId);
      const trackIdSet = new Set(ptRows.map((r) => r.trackId));
      matchRows = matchRows.filter((m) => trackIdSet.has(m.sourceId));
    }

    // Sort by parkedAt ASC (oldest first)
    matchRows.sort((a, b) => (a.parkedAt ?? 0) - (b.parkedAt ?? 0));

    // Enrich with track details and playlist names
    const results: PendingReview[] = [];

    for (const match of matchRows) {
      // Load spotify track
      const trackRow = this.trackRepo.findById(match.sourceId);
      if (!trackRow) continue;

      const spotifyTrack: TrackInfo = {
        title: trackRow.title,
        artist: trackRow.artist,
        album: trackRow.album ?? undefined,
        durationMs: trackRow.durationMs,
        isrc: trackRow.isrc ?? undefined,
        uri: trackRow.spotifyUri ?? undefined,
      };

      // Build lexicon track from stored target metadata
      let lexiconTrack: TrackInfo;
      if (match.targetMeta) {
        const meta = JSON.parse(match.targetMeta) as Partial<TrackInfo>;
        lexiconTrack = {
          title: meta.title ?? "",
          artist: meta.artist ?? "",
          album: meta.album,
          durationMs: meta.durationMs,
        };
      } else {
        lexiconTrack = { title: "", artist: "" };
      }

      // Resolve playlist name
      const playlistsForTrack = this.playlistTrackRepo.findPlaylistsForTrack(match.sourceId);
      const playlistName = playlistsForTrack[0]?.playlistName ?? "";

      results.push({
        matchId: match.id,
        spotifyTrack,
        lexiconTrack,
        score: match.score,
        confidence: match.confidence,
        method: match.method,
        playlistName,
        parkedAt: match.parkedAt ?? 0,
      });
    }

    return results;
  }

  /** Confirm a single pending match. Idempotent on already-confirmed. */
  async confirm(matchId: string): Promise<void> {
    const match = this.matches.findById(matchId);

    if (!match) {
      throw new Error(`Match not found: ${matchId}`);
    }

    // Idempotent: already confirmed is a no-op
    if (match.status === "confirmed") return;

    if (match.status !== "pending") {
      throw new Error(`Unexpected match status: ${match.status}`);
    }

    this.matches.updateStatus(matchId, "confirmed");
  }

  /** Reject a single pending match and auto-queue a download. Idempotent on already-rejected. */
  async reject(matchId: string): Promise<void> {
    const match = this.matches.findById(matchId);

    if (!match) {
      throw new Error(`Match not found: ${matchId}`);
    }

    // Idempotent: already rejected is a no-op
    if (match.status === "rejected") return;

    if (match.status !== "pending") {
      throw new Error(`Unexpected match status: ${match.status}`);
    }

    this.matches.updateStatus(matchId, "rejected", { method: "manual" as const });

    // Auto-queue download — use try/catch to avoid duplicates
    try {
      this.downloadRepo.insert({
        trackId: match.sourceId,
        status: "pending",
        origin: "review_rejected",
        createdAt: Date.now(),
      });
    } catch {
      // Ignore conflict (download already exists for this track)
    }
  }

  /** Confirm multiple matches. Returns count of successful confirmations. */
  async bulkConfirm(matchIds: string[]): Promise<{ confirmed: number }> {
    let confirmed = 0;
    for (const id of matchIds) {
      try {
        await this.confirm(id);
        confirmed++;
      } catch {
        // Skip invalid or errored matches
      }
    }
    return { confirmed };
  }

  /** Reject multiple matches and auto-queue downloads. Returns counts. */
  async bulkReject(matchIds: string[]): Promise<{ rejected: number; downloadsQueued: number }> {
    let rejected = 0;
    let downloadsQueued = 0;
    for (const id of matchIds) {
      try {
        const match = this.matches.findById(id);

        if (!match) continue;
        if (match.status === "rejected") continue;

        await this.reject(id);
        rejected++;
        downloadsQueued++;
      } catch {
        // Skip
      }
    }
    return { rejected, downloadsQueued };
  }

  /** Get aggregate counts of matches by status. */
  async getStats(): Promise<ReviewStats> {
    return this.matches.getStats("spotify", "lexicon");
  }
}
