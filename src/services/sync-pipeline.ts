import { eq, and } from "drizzle-orm";

import type { Config } from "../config.js";
import type { TrackInfo } from "../types/common.js";
import { getDb } from "../db/client.js";
import * as schema from "../db/schema.js";
import { createMatcher } from "../matching/index.js";
import { LexiconService } from "./lexicon-service.js";
import { DownloadService } from "./download-service.js";

// ---------------------------------------------------------------------------
// Dependency injection types
// ---------------------------------------------------------------------------

export interface SyncPipelineDeps {
  /** Override the DB instance (useful for tests). */
  db?: ReturnType<typeof getDb>;
  /** Override the LexiconService factory (useful for tests). */
  lexiconService?: LexiconService;
  /** Override the DownloadService factory (useful for tests). */
  downloadService?: DownloadService;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MatchedTrack {
  dbTrackId: string;
  track: TrackInfo;
  lexiconTrackId?: string;
  score: number;
  confidence: "high" | "review" | "low";
  method: string;
}

export interface PhaseOneResult {
  playlistName: string;
  found: MatchedTrack[];
  needsReview: MatchedTrack[];
  notFound: Array<{ dbTrackId: string; track: TrackInfo }>;
  total: number;
}

export interface ReviewDecision {
  dbTrackId: string;
  accepted: boolean;
}

export interface PhaseTwoResult {
  confirmed: MatchedTrack[];
  missing: Array<{ dbTrackId: string; track: TrackInfo }>;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export class SyncPipeline {
  private deps: SyncPipelineDeps;

  constructor(
    private config: Config,
    deps?: SyncPipelineDeps,
  ) {
    this.deps = deps ?? {};
  }

  private getDb() {
    return this.deps.db ?? getDb();
  }

  private getLexiconService() {
    return this.deps.lexiconService ?? new LexiconService(this.config.lexicon);
  }

  private getDownloadService() {
    return (
      this.deps.downloadService ??
      new DownloadService(
        this.config.soulseek,
        this.config.download,
        this.config.lexicon,
      )
    );
  }

  // -------------------------------------------------------------------------
  // Phase 1 — Match all tracks in a playlist against Lexicon
  // -------------------------------------------------------------------------

  async matchPlaylist(playlistId: string): Promise<PhaseOneResult> {
    const db = this.getDb();

    // 1. Fetch playlist metadata
    const playlist = await db.query.playlists.findFirst({
      where: eq(schema.playlists.id, playlistId),
    });

    if (!playlist) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }

    // 2. Fetch tracks for this playlist (ordered by position)
    const playlistTrackRows = await db
      .select({
        trackId: schema.playlistTracks.trackId,
        position: schema.playlistTracks.position,
      })
      .from(schema.playlistTracks)
      .where(eq(schema.playlistTracks.playlistId, playlistId))
      .orderBy(schema.playlistTracks.position);

    const trackIds = playlistTrackRows.map((r) => r.trackId);

    // Fetch all track details in one go
    const trackRows = await db.query.tracks.findMany();
    const trackMap = new Map(trackRows.map((t) => [t.id, t]));

    // 3. Get Lexicon tracks via service
    const lexicon = this.getLexiconService();
    const lexiconTracks = await lexicon.getTracks();

    // Convert Lexicon tracks to TrackInfo candidates (with an ID index)
    const lexiconCandidates: TrackInfo[] = lexiconTracks.map((lt) => ({
      title: lt.title,
      artist: lt.artist,
      album: lt.album ?? undefined,
      durationMs: lt.durationMs ?? undefined,
    }));

    // 4. Build the matcher
    const matcher = createMatcher(this.config.matching);

    // 5. Load existing matches from DB
    //    - Confirmed matches: reuse directly (skip re-matching)
    //    - Rejected matches: pair-specific — only block that specific
    //      source↔target pair, not all future matching for the source
    const existingMatches = await db
      .select()
      .from(schema.matches)
      .where(
        and(
          eq(schema.matches.sourceType, "spotify"),
          eq(schema.matches.targetType, "lexicon"),
        ),
      );

    // Confirmed: most recent confirmed match per source
    const confirmedBySource = new Map<string, schema.Match>();
    // Rejected pairs: Set of "sourceId:targetId" strings
    const rejectedPairs = new Set<string>();

    for (const m of existingMatches) {
      if (m.status === "confirmed") {
        const existing = confirmedBySource.get(m.sourceId);
        if (!existing || m.updatedAt > existing.updatedAt) {
          confirmedBySource.set(m.sourceId, m);
        }
      } else if (m.status === "rejected") {
        rejectedPairs.add(`${m.sourceId}:${m.targetId}`);
      }
    }

    // 6. Categorise each playlist track
    const found: MatchedTrack[] = [];
    const needsReview: MatchedTrack[] = [];
    const notFound: Array<{ dbTrackId: string; track: TrackInfo }> = [];
    const newMatchRows: schema.NewMatch[] = [];

    for (const dbTrackId of trackIds) {
      const row = trackMap.get(dbTrackId);
      if (!row) continue;

      const trackInfo: TrackInfo = {
        title: row.title,
        artist: row.artist,
        album: row.album ?? undefined,
        durationMs: row.durationMs,
        isrc: row.isrc ?? undefined,
        uri: row.spotifyUri ?? undefined,
      };

      // Reuse existing confirmed match
      const prev = confirmedBySource.get(dbTrackId);

      if (prev) {
        found.push({
          dbTrackId,
          track: trackInfo,
          lexiconTrackId: prev.targetId,
          score: prev.score,
          confidence: prev.confidence,
          method: prev.method,
        });
        continue;
      }

      // Run matcher against all Lexicon candidates
      const results = matcher.match(trackInfo, lexiconCandidates);

      // Find the best result that isn't in a rejected pair
      let best: (typeof results)[0] | undefined;
      let lexiconTrackId: string | undefined;

      for (const candidate of results) {
        const lexIdx = lexiconCandidates.indexOf(candidate.candidate);
        const candidateId = lexIdx >= 0 ? lexiconTracks[lexIdx].id : undefined;

        if (candidateId && rejectedPairs.has(`${dbTrackId}:${candidateId}`)) {
          continue; // This specific pair was rejected, try next
        }

        best = candidate;
        lexiconTrackId = candidateId;
        break;
      }

      if (!best) {
        notFound.push({ dbTrackId, track: trackInfo });
        continue;
      }

      const matched: MatchedTrack = {
        dbTrackId,
        track: trackInfo,
        lexiconTrackId,
        score: best.score,
        confidence: best.confidence,
        method: best.method,
      };

      if (best.confidence === "high") {
        found.push(matched);
      } else if (best.confidence === "review") {
        needsReview.push(matched);
      } else {
        notFound.push({ dbTrackId, track: trackInfo });
      }

      // Queue a new match row for persistence
      const status =
        best.confidence === "high"
          ? ("confirmed" as const)
          : best.confidence === "review"
            ? ("pending" as const)
            : ("rejected" as const);

      if (lexiconTrackId) {
        newMatchRows.push({
          sourceType: "spotify",
          sourceId: dbTrackId,
          targetType: "lexicon",
          targetId: lexiconTrackId,
          score: best.score,
          confidence: best.confidence,
          method: best.method as "isrc" | "fuzzy" | "manual",
          status,
        });
      }
    }

    // 7. Persist new matches (skip conflicts from previous runs)
    if (newMatchRows.length > 0) {
      for (const row of newMatchRows) {
        await db
          .insert(schema.matches)
          .values(row)
          .onConflictDoNothing();
      }
    }

    return {
      playlistName: playlist.name,
      found,
      needsReview,
      notFound,
      total: trackIds.length,
    };
  }

  // -------------------------------------------------------------------------
  // Phase 2 — Apply user review decisions
  // -------------------------------------------------------------------------

  applyReviewDecisions(
    phaseOne: PhaseOneResult,
    decisions: ReviewDecision[],
  ): PhaseTwoResult {
    const db = this.getDb();
    const decisionMap = new Map(decisions.map((d) => [d.dbTrackId, d.accepted]));

    const confirmed: MatchedTrack[] = [...phaseOne.found];
    const missing: Array<{ dbTrackId: string; track: TrackInfo }> = [
      ...phaseOne.notFound,
    ];

    for (const item of phaseOne.needsReview) {
      const accepted = decisionMap.get(item.dbTrackId);

      if (accepted === true) {
        confirmed.push(item);

        // Persist the confirmation
        if (item.lexiconTrackId) {
          db.update(schema.matches)
            .set({ status: "confirmed" })
            .where(
              and(
                eq(schema.matches.sourceType, "spotify"),
                eq(schema.matches.sourceId, item.dbTrackId),
                eq(schema.matches.targetType, "lexicon"),
                eq(schema.matches.targetId, item.lexiconTrackId),
              ),
            )
            .run();
        }
      } else {
        // rejected or no decision → treat as missing
        missing.push({ dbTrackId: item.dbTrackId, track: item.track });

        if (item.lexiconTrackId) {
          db.update(schema.matches)
            .set({ status: "rejected" })
            .where(
              and(
                eq(schema.matches.sourceType, "spotify"),
                eq(schema.matches.sourceId, item.dbTrackId),
                eq(schema.matches.targetType, "lexicon"),
                eq(schema.matches.targetId, item.lexiconTrackId),
              ),
            )
            .run();
        }
      }
    }

    return { confirmed, missing };
  }

  // -------------------------------------------------------------------------
  // Phase 3 — Download missing tracks
  // -------------------------------------------------------------------------

  async downloadMissing(
    phaseTwo: PhaseTwoResult,
    playlistName: string,
    onProgress?: (
      completed: number,
      total: number,
      trackTitle: string,
      success: boolean,
      error?: string,
    ) => void,
  ): Promise<{ succeeded: number; failed: number }> {
    const downloadService = this.getDownloadService();

    const batchItems = phaseTwo.missing.map((m) => ({
      track: m.track,
      dbTrackId: m.dbTrackId,
      playlistName,
    }));

    let succeeded = 0;
    let failed = 0;

    const results = await downloadService.downloadBatch(
      batchItems,
      (done, total, result) => {
        if (result.success) succeeded++;
        else failed++;

        // Find the original track for the title
        const item = batchItems.find((b) => b.dbTrackId === result.trackId);
        const title = item?.track.title ?? "Unknown";
        onProgress?.(done, total, title, result.success, result.error);
      },
    );

    // Update download records in DB
    const db = this.getDb();
    for (const result of results) {
      await db.insert(schema.downloads).values({
        trackId: result.trackId,
        status: result.success ? "done" : "failed",
        filePath: result.filePath ?? null,
        error: result.error ?? null,
        startedAt: Date.now(),
        completedAt: Date.now(),
      });
    }

    return { succeeded, failed };
  }

  // -------------------------------------------------------------------------
  // Phase 3b — Sync confirmed tracks to a Lexicon playlist
  // -------------------------------------------------------------------------

  async syncToLexicon(
    playlistId: string,
    playlistName: string,
    allMatchedTrackIds: string[],
  ): Promise<void> {
    const lexicon = this.getLexiconService();

    // Check if the playlist already exists in Lexicon
    const existing = await lexicon.getPlaylistByName(playlistName);

    if (existing) {
      // Replace the full track list in Spotify order
      await lexicon.setPlaylistTracks(existing.id, allMatchedTrackIds);
    } else {
      // Create a new playlist with all matched tracks
      await lexicon.createPlaylist(playlistName, allMatchedTrackIds);
    }

    // Log the sync action
    const db = this.getDb();
    await db.insert(schema.syncLog).values({
      playlistId,
      action: "sync_to_lexicon",
      details: `Synced ${allMatchedTrackIds.length} tracks to Lexicon playlist "${playlistName}"`,
    });
  }

  // -------------------------------------------------------------------------
  // Dry run — Phase 1 only, no side-effects
  // -------------------------------------------------------------------------

  async dryRun(playlistId: string): Promise<PhaseOneResult> {
    // dryRun is identical to matchPlaylist — it runs Phase 1 and returns
    // the categorised results without proceeding to review or download.
    // Match persistence still occurs so repeated dry runs benefit from cache.
    return this.matchPlaylist(playlistId);
  }
}
