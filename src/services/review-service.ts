import { eq, and, sql, inArray } from "drizzle-orm";

import type { Config } from "../config.js";
import type { TrackInfo } from "../types/common.js";
import { getDb } from "../db/client.js";
import * as schema from "../db/schema.js";

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
  db?: ReturnType<typeof getDb>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ReviewService {
  private deps: ReviewServiceDeps;

  constructor(
    private config: Config,
    deps?: ReviewServiceDeps,
  ) {
    this.deps = deps ?? {};
  }

  private getDb() {
    return this.deps.db ?? getDb();
  }

  /**
   * List all pending matches, optionally filtered by playlist.
   * Sorted by parkedAt ASC (FIFO).
   */
  async getPending(playlistId?: string): Promise<PendingReview[]> {
    const db = this.getDb();

    // Get all pending spotify→lexicon matches
    let matchRows = await db
      .select()
      .from(schema.matches)
      .where(
        and(
          eq(schema.matches.status, "pending"),
          eq(schema.matches.sourceType, "spotify"),
          eq(schema.matches.targetType, "lexicon"),
        ),
      );

    // Filter by playlist if provided
    if (playlistId) {
      const ptRows = await db
        .select({ trackId: schema.playlistTracks.trackId })
        .from(schema.playlistTracks)
        .where(eq(schema.playlistTracks.playlistId, playlistId));
      const trackIdSet = new Set(ptRows.map((r) => r.trackId));
      matchRows = matchRows.filter((m) => trackIdSet.has(m.sourceId));
    }

    // Sort by parkedAt ASC (oldest first)
    matchRows.sort((a, b) => (a.parkedAt ?? 0) - (b.parkedAt ?? 0));

    // Enrich with track details and playlist names
    const results: PendingReview[] = [];

    for (const match of matchRows) {
      // Load spotify track
      const trackRow = await db.query.tracks.findFirst({
        where: eq(schema.tracks.id, match.sourceId),
      });
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
      const ptRow = await db.query.playlistTracks.findFirst({
        where: eq(schema.playlistTracks.trackId, match.sourceId),
      });

      let playlistName = "";
      if (ptRow) {
        const pl = await db.query.playlists.findFirst({
          where: eq(schema.playlists.id, ptRow.playlistId),
        });
        playlistName = pl?.name ?? "";
      }

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
    const db = this.getDb();

    const match = await db.query.matches.findFirst({
      where: eq(schema.matches.id, matchId),
    });

    if (!match) {
      throw new Error(`Match not found: ${matchId}`);
    }

    // Idempotent: already confirmed is a no-op
    if (match.status === "confirmed") return;

    if (match.status !== "pending") {
      throw new Error(`Unexpected match status: ${match.status}`);
    }

    await db
      .update(schema.matches)
      .set({ status: "confirmed", updatedAt: Date.now() })
      .where(eq(schema.matches.id, matchId));
  }

  /** Reject a single pending match and auto-queue a download. Idempotent on already-rejected. */
  async reject(matchId: string): Promise<void> {
    const db = this.getDb();

    const match = await db.query.matches.findFirst({
      where: eq(schema.matches.id, matchId),
    });

    if (!match) {
      throw new Error(`Match not found: ${matchId}`);
    }

    // Idempotent: already rejected is a no-op
    if (match.status === "rejected") return;

    if (match.status !== "pending") {
      throw new Error(`Unexpected match status: ${match.status}`);
    }

    await db
      .update(schema.matches)
      .set({ status: "rejected", updatedAt: Date.now() })
      .where(eq(schema.matches.id, matchId));

    // Auto-queue download — use INSERT OR IGNORE to avoid duplicates
    try {
      await db
        .insert(schema.downloads)
        .values({
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
        const db = this.getDb();
        const match = await db.query.matches.findFirst({
          where: eq(schema.matches.id, id),
        });

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
    const db = this.getDb();

    const rows = await db
      .select({
        pending: sql<number>`SUM(CASE WHEN ${schema.matches.status} = 'pending' THEN 1 ELSE 0 END)`,
        confirmed: sql<number>`SUM(CASE WHEN ${schema.matches.status} = 'confirmed' THEN 1 ELSE 0 END)`,
        rejected: sql<number>`SUM(CASE WHEN ${schema.matches.status} = 'rejected' THEN 1 ELSE 0 END)`,
      })
      .from(schema.matches)
      .where(
        and(
          eq(schema.matches.sourceType, "spotify"),
          eq(schema.matches.targetType, "lexicon"),
        ),
      );

    const row = rows[0];
    return {
      pending: Number(row?.pending ?? 0),
      confirmed: Number(row?.confirmed ?? 0),
      rejected: Number(row?.rejected ?? 0),
    };
  }
}
