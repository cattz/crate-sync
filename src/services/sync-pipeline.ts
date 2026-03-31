import { eq, and, sql } from "drizzle-orm";

import type { Config } from "../config.js";
import type { TrackInfo } from "../types/common.js";
import { getDb } from "../db/client.js";
import * as schema from "../db/schema.js";
import { createMatcher } from "../matching/index.js";
import { LexiconService } from "./lexicon-service.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("sync-pipeline");

// ---------------------------------------------------------------------------
// Dependency injection types
// ---------------------------------------------------------------------------

export interface SyncPipelineDeps {
  /** Override the DB instance (useful for tests). */
  db?: ReturnType<typeof getDb>;
  /** Override the LexiconService factory (useful for tests). */
  lexiconService?: LexiconService;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MatchedTrack {
  dbTrackId: string;
  track: TrackInfo;
  lexiconTrackId?: string;
  /** The Lexicon candidate's details (for review UI comparison). */
  lexiconTrack?: TrackInfo;
  score: number;
  confidence: "high" | "review" | "low";
  method: string;
}

export interface MatchPlaylistResult {
  playlistName: string;
  confirmed: MatchedTrack[];
  pending: MatchedTrack[];
  notFound: Array<{ dbTrackId: string; track: TrackInfo }>;
  total: number;
  tagged: number;
}

export interface MatchTrackResult {
  status: "confirmed" | "pending" | "not_found";
  match?: { lexiconTrackId: string; score: number; confidence: string; method: string };
  tagged: boolean;
}

export interface TagResult {
  tagged: number;
  skipped: number;
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

  // -------------------------------------------------------------------------
  // matchTrack — match a single track against Lexicon
  // -------------------------------------------------------------------------

  async matchTrack(trackId: string): Promise<MatchTrackResult> {
    const db = this.getDb();

    // 1. Fetch track from DB
    const row = await db.query.tracks.findFirst({
      where: eq(schema.tracks.id, trackId),
    });

    if (!row) {
      throw new Error(`Track not found: ${trackId}`);
    }

    const trackInfo: TrackInfo = {
      title: row.title,
      artist: row.artist,
      album: row.album ?? undefined,
      durationMs: row.durationMs,
      isrc: row.isrc ?? undefined,
      uri: row.spotifyUri ?? undefined,
    };

    // 2. Find playlists this track belongs to (for tags)
    const playlistRows = await db
      .select({
        playlistId: schema.playlistTracks.playlistId,
        playlistName: schema.playlists.name,
        playlistTags: schema.playlists.tags,
      })
      .from(schema.playlistTracks)
      .innerJoin(schema.playlists, eq(schema.playlistTracks.playlistId, schema.playlists.id))
      .where(eq(schema.playlistTracks.trackId, trackId));

    // 3. Check for existing confirmed match
    const existingMatches = await db
      .select()
      .from(schema.matches)
      .where(
        and(
          eq(schema.matches.sourceType, "spotify"),
          eq(schema.matches.sourceId, trackId),
          eq(schema.matches.targetType, "lexicon"),
        ),
      );

    const rejectedPairs = new Set<string>();
    let existingConfirmed: schema.Match | undefined;

    for (const m of existingMatches) {
      if (m.status === "confirmed") {
        if (!existingConfirmed || m.updatedAt > existingConfirmed.updatedAt) {
          existingConfirmed = m;
        }
      } else if (m.status === "rejected") {
        rejectedPairs.add(`${m.sourceId}:${m.targetId}`);
      }
    }

    // If already confirmed, tag and return
    if (existingConfirmed) {
      let tagged = false;
      if (existingConfirmed.targetId) {
        tagged = await this.tagTrackFromPlaylists(
          existingConfirmed.targetId,
          playlistRows,
        );
      }
      return {
        status: "confirmed",
        match: {
          lexiconTrackId: existingConfirmed.targetId,
          score: existingConfirmed.score,
          confidence: existingConfirmed.confidence,
          method: existingConfirmed.method,
        },
        tagged,
      };
    }

    // 4. Get Lexicon tracks and run matcher
    const lexicon = this.getLexiconService();
    const lexiconTracks = await lexicon.getTracks();

    const lexiconCandidates: TrackInfo[] = lexiconTracks.map((lt) => ({
      title: lt.title,
      artist: lt.artist,
      album: lt.album ?? undefined,
      durationMs: lt.durationMs ?? undefined,
    }));

    const matcher = createMatcher(this.config.matching, "lexicon", this.config.matching.lexiconWeights);
    const results = matcher.match(trackInfo, lexiconCandidates);

    // Find best non-rejected match
    let best: (typeof results)[0] | undefined;
    let lexiconTrackId: string | undefined;

    for (const candidate of results) {
      const lexIdx = lexiconCandidates.indexOf(candidate.candidate);
      const candidateId = lexIdx >= 0 ? lexiconTracks[lexIdx].id : undefined;

      if (candidateId && rejectedPairs.has(`${trackId}:${candidateId}`)) {
        continue;
      }

      best = candidate;
      lexiconTrackId = candidateId;
      break;
    }

    if (!best || best.confidence === "low" || !lexiconTrackId) {
      return { status: "not_found", tagged: false };
    }

    // 5. Persist match
    const status =
      best.confidence === "high"
        ? ("confirmed" as const)
        : ("pending" as const);

    const lexiconById = new Map<string, TrackInfo>();
    for (let i = 0; i < lexiconTracks.length; i++) {
      lexiconById.set(lexiconTracks[i].id, lexiconCandidates[i]);
    }

    const targetMeta = lexiconTrackId
      ? JSON.stringify(lexiconById.get(lexiconTrackId))
      : undefined;

    await db
      .insert(schema.matches)
      .values({
        sourceType: "spotify",
        sourceId: trackId,
        targetType: "lexicon",
        targetId: lexiconTrackId,
        score: best.score,
        confidence: best.confidence,
        method: best.method as "isrc" | "fuzzy" | "manual",
        status,
        targetMeta,
        parkedAt: status === "pending" ? Date.now() : undefined,
      })
      .onConflictDoUpdate({
        target: [
          schema.matches.sourceType,
          schema.matches.sourceId,
          schema.matches.targetType,
          schema.matches.targetId,
        ],
        set: {
          score: sql`excluded.score`,
          confidence: sql`excluded.confidence`,
          method: sql`excluded.method`,
          targetMeta: sql`excluded.target_meta`,
          status: sql`CASE WHEN ${schema.matches.status} = 'confirmed' THEN 'confirmed' ELSE excluded.status END`,
          parkedAt: sql`excluded.parked_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      });

    // 6. Tag if confirmed
    let tagged = false;
    if (status === "confirmed") {
      tagged = await this.tagTrackFromPlaylists(lexiconTrackId, playlistRows);
    }

    return {
      status: status === "confirmed" ? "confirmed" : "pending",
      match: {
        lexiconTrackId,
        score: best.score,
        confidence: best.confidence,
        method: best.method,
      },
      tagged,
    };
  }

  // -------------------------------------------------------------------------
  // tagTrackFromPlaylists — tag a single confirmed track using playlist names
  // -------------------------------------------------------------------------

  private async tagTrackFromPlaylists(
    lexiconTrackId: string,
    playlistRows: Array<{ playlistName: string; playlistTags: string | null }>,
  ): Promise<boolean> {
    // Collect all tag segments from playlist names and manual tags
    const segments: string[] = [];

    for (const row of playlistRows) {
      const nameSegments = row.playlistName
        .split("/")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const seg of nameSegments) {
        if (!segments.includes(seg)) segments.push(seg);
      }

      if (row.playlistTags) {
        const manual = JSON.parse(row.playlistTags) as string[];
        for (const tag of manual) {
          if (!segments.includes(tag)) segments.push(tag);
        }
      }
    }

    if (segments.length === 0) return false;

    try {
      const lexicon = this.getLexiconService();
      const categoryConfig = this.config.lexicon.tagCategory;
      const category = await lexicon.ensureTagCategory(
        categoryConfig.name,
        categoryConfig.color,
      );

      const tagIds: string[] = [];
      for (const label of segments) {
        const tag = await lexicon.ensureTag(category.id, label);
        tagIds.push(tag.id);
      }

      await lexicon.setTrackCategoryTags(lexiconTrackId, category.id, tagIds);
      return true;
    } catch (err) {
      log.error(`Failed to tag track ${lexiconTrackId}:`, err);
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // matchPlaylist — match all tracks, tag confirmed, park pending
  // -------------------------------------------------------------------------

  async matchPlaylist(playlistId: string): Promise<MatchPlaylistResult> {
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

    // 3. Load all track rows for O(1) lookup
    const trackRows = await db.query.tracks.findMany();
    const trackMap = new Map(trackRows.map((t) => [t.id, t]));

    // 4. Get Lexicon tracks via service
    const lexicon = this.getLexiconService();
    const lexiconTracks = await lexicon.getTracks();

    // Convert Lexicon tracks to TrackInfo candidates
    const lexiconCandidates: TrackInfo[] = lexiconTracks.map((lt) => ({
      title: lt.title,
      artist: lt.artist,
      album: lt.album ?? undefined,
      durationMs: lt.durationMs ?? undefined,
    }));

    // Lexicon ID → TrackInfo for review UI
    const lexiconById = new Map<string, TrackInfo>();
    for (let i = 0; i < lexiconTracks.length; i++) {
      lexiconById.set(lexiconTracks[i].id, lexiconCandidates[i]);
    }

    // 5. Build the matcher
    const matcher = createMatcher(this.config.matching, "lexicon", this.config.matching.lexiconWeights);

    // 6. Load existing matches from DB
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

    // 7. Categorise each playlist track
    const confirmed: MatchedTrack[] = [];
    const pending: MatchedTrack[] = [];
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
        confirmed.push({
          dbTrackId,
          track: trackInfo,
          lexiconTrackId: prev.targetId,
          lexiconTrack: lexiconById.get(prev.targetId),
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
        lexiconTrack: lexiconTrackId ? lexiconById.get(lexiconTrackId) : undefined,
        score: best.score,
        confidence: best.confidence,
        method: best.method,
      };

      if (best.confidence === "high") {
        confirmed.push(matched);
      } else if (best.confidence === "review") {
        pending.push(matched);
      } else {
        notFound.push({ dbTrackId, track: trackInfo });
      }

      // Build target metadata for review service
      const targetMeta = lexiconTrackId
        ? JSON.stringify(lexiconById.get(lexiconTrackId))
        : undefined;

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
          targetMeta,
          parkedAt: status === "pending" ? Date.now() : undefined,
        });
      }
    }

    // 8. Persist new matches — update score/confidence on conflict,
    //    but never downgrade a confirmed match back to pending/rejected
    if (newMatchRows.length > 0) {
      for (const row of newMatchRows) {
        await db
          .insert(schema.matches)
          .values(row)
          .onConflictDoUpdate({
            target: [
              schema.matches.sourceType,
              schema.matches.sourceId,
              schema.matches.targetType,
              schema.matches.targetId,
            ],
            set: {
              score: sql`excluded.score`,
              confidence: sql`excluded.confidence`,
              method: sql`excluded.method`,
              targetMeta: sql`excluded.target_meta`,
              // Only update status if existing is not confirmed
              status: sql`CASE WHEN ${schema.matches.status} = 'confirmed' THEN 'confirmed' ELSE excluded.status END`,
              parkedAt: sql`excluded.parked_at`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
      }
    }

    // 9. Tag confirmed tracks
    log.info(`Tagging ${confirmed.length} confirmed tracks for "${playlist.name}"`);
    const manualTags = playlist.tags ? JSON.parse(playlist.tags) as string[] : undefined;
    const tagResult = await this.syncTags(playlist.name, confirmed, manualTags);
    log.info(`Tag result: ${tagResult.tagged} tagged, ${tagResult.skipped} skipped`);

    // 10. Return result
    return {
      playlistName: playlist.name,
      confirmed,
      pending,
      notFound,
      total: trackIds.length,
      tagged: tagResult.tagged,
    };
  }

  // -------------------------------------------------------------------------
  // syncTags — tag confirmed tracks in Lexicon under configured category
  // -------------------------------------------------------------------------

  async syncTags(
    playlistName: string,
    confirmedTracks: MatchedTrack[],
    manualTags?: string[],
  ): Promise<TagResult> {
    // 1. Extract tag labels from playlist name
    const segments = playlistName
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean);

    // 2. Merge manual tags, deduplicate
    if (manualTags) {
      for (const tag of manualTags) {
        if (!segments.includes(tag)) {
          segments.push(tag);
        }
      }
    }

    if (segments.length === 0) {
      return { tagged: 0, skipped: 0 };
    }

    const lexicon = this.getLexiconService();

    // 4-5. Ensure tag category exists
    const categoryConfig = this.config.lexicon.tagCategory;
    const category = await lexicon.ensureTagCategory(
      categoryConfig.name,
      categoryConfig.color,
    );

    // 6. Ensure each tag exists under the category
    const tagIds: string[] = [];
    for (const label of segments) {
      const tag = await lexicon.ensureTag(category.id, label);
      tagIds.push(tag.id);
    }

    // 7. Tag each confirmed track (category-scoped)
    let tagged = 0;
    let skipped = 0;

    for (const track of confirmedTracks) {
      if (!track.lexiconTrackId) {
        skipped++;
        continue;
      }

      try {
        await lexicon.setTrackCategoryTags(track.lexiconTrackId, category.id, tagIds);
        tagged++;
      } catch (err) {
        // Log and continue on individual track tagging errors
        log.error(`Failed to tag track ${track.lexiconTrackId}:`, err);
        skipped++;
      }
    }

    return { tagged, skipped };
  }

  // -------------------------------------------------------------------------
  // dryRun — match and persist, but do NOT tag
  // -------------------------------------------------------------------------

  async dryRun(playlistId: string): Promise<MatchPlaylistResult> {
    const db = this.getDb();

    // Same as matchPlaylist but without tagging
    const playlist = await db.query.playlists.findFirst({
      where: eq(schema.playlists.id, playlistId),
    });

    if (!playlist) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }

    const playlistTrackRows = await db
      .select({
        trackId: schema.playlistTracks.trackId,
        position: schema.playlistTracks.position,
      })
      .from(schema.playlistTracks)
      .where(eq(schema.playlistTracks.playlistId, playlistId))
      .orderBy(schema.playlistTracks.position);

    const trackIds = playlistTrackRows.map((r) => r.trackId);

    const trackRows = await db.query.tracks.findMany();
    const trackMap = new Map(trackRows.map((t) => [t.id, t]));

    const lexicon = this.getLexiconService();
    const lexiconTracks = await lexicon.getTracks();

    const lexiconCandidates: TrackInfo[] = lexiconTracks.map((lt) => ({
      title: lt.title,
      artist: lt.artist,
      album: lt.album ?? undefined,
      durationMs: lt.durationMs ?? undefined,
    }));

    const lexiconById = new Map<string, TrackInfo>();
    for (let i = 0; i < lexiconTracks.length; i++) {
      lexiconById.set(lexiconTracks[i].id, lexiconCandidates[i]);
    }

    const matcher = createMatcher(this.config.matching, "lexicon", this.config.matching.lexiconWeights);

    const existingMatches = await db
      .select()
      .from(schema.matches)
      .where(
        and(
          eq(schema.matches.sourceType, "spotify"),
          eq(schema.matches.targetType, "lexicon"),
        ),
      );

    const confirmedBySource = new Map<string, schema.Match>();
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

    const confirmed: MatchedTrack[] = [];
    const pendingArr: MatchedTrack[] = [];
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

      const prev = confirmedBySource.get(dbTrackId);

      if (prev) {
        confirmed.push({
          dbTrackId,
          track: trackInfo,
          lexiconTrackId: prev.targetId,
          lexiconTrack: lexiconById.get(prev.targetId),
          score: prev.score,
          confidence: prev.confidence,
          method: prev.method,
        });
        continue;
      }

      const results = matcher.match(trackInfo, lexiconCandidates);

      let best: (typeof results)[0] | undefined;
      let lexiconTrackId: string | undefined;

      for (const candidate of results) {
        const lexIdx = lexiconCandidates.indexOf(candidate.candidate);
        const candidateId = lexIdx >= 0 ? lexiconTracks[lexIdx].id : undefined;

        if (candidateId && rejectedPairs.has(`${dbTrackId}:${candidateId}`)) {
          continue;
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
        lexiconTrack: lexiconTrackId ? lexiconById.get(lexiconTrackId) : undefined,
        score: best.score,
        confidence: best.confidence,
        method: best.method,
      };

      if (best.confidence === "high") {
        confirmed.push(matched);
      } else if (best.confidence === "review") {
        pendingArr.push(matched);
      } else {
        notFound.push({ dbTrackId, track: trackInfo });
      }

      const targetMeta = lexiconTrackId
        ? JSON.stringify(lexiconById.get(lexiconTrackId))
        : undefined;

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
          targetMeta,
          parkedAt: status === "pending" ? Date.now() : undefined,
        });
      }
    }

    // Persist matches (even in dry run, for cache/rejection memory)
    if (newMatchRows.length > 0) {
      for (const row of newMatchRows) {
        await db
          .insert(schema.matches)
          .values(row)
          .onConflictDoUpdate({
            target: [
              schema.matches.sourceType,
              schema.matches.sourceId,
              schema.matches.targetType,
              schema.matches.targetId,
            ],
            set: {
              score: sql`excluded.score`,
              confidence: sql`excluded.confidence`,
              method: sql`excluded.method`,
              targetMeta: sql`excluded.target_meta`,
              status: sql`CASE WHEN ${schema.matches.status} = 'confirmed' THEN 'confirmed' ELSE excluded.status END`,
              parkedAt: sql`excluded.parked_at`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
      }
    }

    // No tagging in dry run
    return {
      playlistName: playlist.name,
      confirmed,
      pending: pendingArr,
      notFound,
      total: trackIds.length,
      tagged: 0,
    };
  }
}
