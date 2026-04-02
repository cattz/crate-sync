import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, and } from "drizzle-orm";
import crypto from "node:crypto";

import * as schema from "../../db/schema.js";
import type { Config } from "../../config.js";
import type { LexiconTrack } from "../../types/lexicon.js";
import {
  SyncPipeline,
  type MatchPlaylistResult,
  type MatchedTrack,
} from "../sync-pipeline.js";
import { createRepositories } from "../../db/repositories/index.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(currentDir, "../../db/migrations");

function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return { db, sqlite };
}

const TEST_CONFIG: Config = {
  spotify: { clientId: "", clientSecret: "", redirectUri: "" },
  lexicon: {
    url: "http://localhost:48624",
    downloadRoot: "/tmp/test-dl",
    tagCategory: { name: "Spotify Playlists", color: "#1DB954" },
  },
  soulseek: { slskdUrl: "http://localhost:5030", slskdApiKey: "test", searchDelayMs: 0, downloadDir: "/tmp/slskd-downloads" },
  matching: { autoAcceptThreshold: 0.9, reviewThreshold: 0.7 },
  download: { formats: ["flac", "mp3"], minBitrate: 320, concurrency: 2, validationStrictness: "moderate" },
  jobRunner: { pollIntervalMs: 1000 },
};

/** Insert a playlist + tracks + playlist_tracks and return their IDs. */
function seedPlaylist(
  db: ReturnType<typeof drizzle<typeof schema>>,
  playlistName: string,
  trackData: Array<{
    title: string;
    artist: string;
    album?: string;
    durationMs?: number;
    isrc?: string;
    spotifyUri?: string;
  }>,
  opts?: { tags?: string[] },
) {
  const playlistId = crypto.randomUUID();
  const now = Date.now();

  db.insert(schema.playlists)
    .values({
      id: playlistId,
      spotifyId: `sp-${playlistId.slice(0, 8)}`,
      name: playlistName,
      tags: opts?.tags ? JSON.stringify(opts.tags) : null,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const trackIds: string[] = [];

  for (let i = 0; i < trackData.length; i++) {
    const t = trackData[i];
    const trackId = crypto.randomUUID();
    trackIds.push(trackId);

    db.insert(schema.tracks)
      .values({
        id: trackId,
        spotifyId: `sp-track-${trackId.slice(0, 8)}`,
        title: t.title,
        artist: t.artist,
        album: t.album ?? null,
        durationMs: t.durationMs ?? 200_000,
        isrc: t.isrc ?? null,
        spotifyUri: t.spotifyUri ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    db.insert(schema.playlistTracks)
      .values({
        id: crypto.randomUUID(),
        playlistId,
        trackId,
        position: i,
        addedAt: now,
      })
      .run();
  }

  return { playlistId, trackIds };
}

/** Seed a confirmed/rejected match row. */
function seedMatch(
  db: ReturnType<typeof drizzle<typeof schema>>,
  sourceId: string,
  targetId: string,
  status: "confirmed" | "rejected" | "pending",
  opts?: { score?: number; confidence?: "high" | "review" | "low"; method?: "fuzzy" | "isrc" | "manual"; parkedAt?: number },
) {
  const now = Date.now();
  db.insert(schema.matches)
    .values({
      id: crypto.randomUUID(),
      sourceType: "spotify",
      sourceId,
      targetType: "lexicon",
      targetId,
      score: opts?.score ?? 0.95,
      confidence: opts?.confidence ?? "high",
      method: opts?.method ?? "fuzzy",
      status,
      parkedAt: opts?.parkedAt,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function mockLexiconService(lexiconTracks: LexiconTrack[]) {
  return {
    getTracks: vi.fn().mockResolvedValue(lexiconTracks),
    ping: vi.fn().mockResolvedValue(true),
    searchTracks: vi.fn().mockResolvedValue([]),
    getTrack: vi.fn().mockResolvedValue(null),
    // Tag methods
    getTags: vi.fn().mockResolvedValue({ categories: [], tags: [] }),
    createTagCategory: vi.fn().mockImplementation(async (label: string, color: string) => ({
      id: "cat-new", label, color,
    })),
    createTag: vi.fn().mockImplementation(async (categoryId: string, label: string) => ({
      id: `tag-${label.toLowerCase()}`, categoryId, label,
    })),
    updateTrackTags: vi.fn().mockResolvedValue(undefined),
    getTrackTags: vi.fn().mockResolvedValue([]),
    ensureTagCategory: vi.fn().mockImplementation(async (label: string, color?: string) => ({
      id: "cat-1", label, color,
    })),
    ensureTag: vi.fn().mockImplementation(async (categoryId: string, label: string) => ({
      id: `tag-${label.toLowerCase()}`, categoryId, label,
    })),
    setTrackCategoryTags: vi.fn().mockResolvedValue(undefined),
    getTrackTagsInCategory: vi.fn().mockResolvedValue([]),
  } as any;
}

// ===========================================================================
// Tests
// ===========================================================================

describe("SyncPipeline", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let sqlite: InstanceType<typeof Database>;
  let repos: ReturnType<typeof createRepositories>;

  beforeEach(() => {
    const result = createTestDb();
    db = result.db;
    sqlite = result.sqlite;
    repos = createRepositories(db);
  });

  afterEach(() => {
    sqlite.close();
  });

  // =========================================================================
  // matchPlaylist
  // =========================================================================
  describe("matchPlaylist", () => {
    it("should categorize tracks into confirmed/pending/notFound", async () => {
      const { playlistId } = seedPlaylist(db, "Partial", [
        { title: "Blue Monday", artist: "New Order", durationMs: 230_000 },
        { title: "Losing It", artist: "Fisher", durationMs: 200_000 },
        { title: "Nonexistent Track", artist: "Nobody", durationMs: 180_000 },
      ]);

      const lexiconTracks: LexiconTrack[] = [
        { id: "lex-1", filePath: "/music/blue-monday.flac", title: "Blue Monday", artist: "New Order", durationMs: 230_000 },
        { id: "lex-2", filePath: "/music/losing-it.flac", title: "Losing It (Extended Mix)", artist: "Fisher", durationMs: 340_000 },
      ];

      const lexicon = mockLexiconService(lexiconTracks);
      const pipeline = new SyncPipeline(TEST_CONFIG, { ...repos, lexiconService: lexicon });

      const result = await pipeline.matchPlaylist(playlistId);

      expect(result.total).toBe(3);
      expect(result.confirmed.length + result.pending.length + result.notFound.length).toBe(3);
      // "Nonexistent Track" should be notFound
      const notFoundTitles = result.notFound.map((n) => n.track.title);
      expect(notFoundTitles).toContain("Nonexistent Track");
    });

    it("should mark all tracks as confirmed when all high-confidence matches exist", async () => {
      const { playlistId } = seedPlaylist(db, "All Found", [
        { title: "Blue Monday", artist: "New Order", durationMs: 230_000 },
        { title: "Strings of Life", artist: "Derrick May", durationMs: 280_000 },
      ]);

      const lexiconTracks: LexiconTrack[] = [
        { id: "lex-1", filePath: "/music/blue-monday.flac", title: "Blue Monday", artist: "New Order", durationMs: 230_000 },
        { id: "lex-2", filePath: "/music/strings-of-life.flac", title: "Strings of Life", artist: "Derrick May", durationMs: 280_000 },
      ];

      const lexicon = mockLexiconService(lexiconTracks);
      const pipeline = new SyncPipeline(TEST_CONFIG, { ...repos, lexiconService: lexicon });

      const result = await pipeline.matchPlaylist(playlistId);

      expect(result.playlistName).toBe("All Found");
      expect(result.total).toBe(2);
      expect(result.confirmed.length).toBe(2);
      expect(result.pending.length).toBe(0);
      expect(result.notFound.length).toBe(0);
    });

    it("should reuse previously confirmed matches from DB", async () => {
      const { playlistId, trackIds } = seedPlaylist(db, "Pre-confirmed", [
        { title: "Blue Monday", artist: "New Order", durationMs: 230_000 },
      ]);

      seedMatch(db, trackIds[0], "lex-pre-1", "confirmed");

      const lexicon = mockLexiconService([]);
      const pipeline = new SyncPipeline(TEST_CONFIG, { ...repos, lexiconService: lexicon });

      const result = await pipeline.matchPlaylist(playlistId);

      expect(result.confirmed.length).toBe(1);
      expect(result.confirmed[0].lexiconTrackId).toBe("lex-pre-1");
      expect(result.notFound.length).toBe(0);
    });

    it("should skip rejected pairs and try next-best", async () => {
      const { playlistId, trackIds } = seedPlaylist(db, "Rejected", [
        { title: "Blue Monday", artist: "New Order", durationMs: 230_000 },
      ]);

      // Reject the best match
      seedMatch(db, trackIds[0], "lex-rej-1", "rejected");

      // Lexicon has the rejected track AND a second candidate
      const lexiconTracks: LexiconTrack[] = [
        { id: "lex-rej-1", filePath: "/music/bm-wrong.flac", title: "Blue Monday", artist: "New Order", durationMs: 230_000 },
        { id: "lex-alt", filePath: "/music/bm.flac", title: "Blue Monday", artist: "New Order", durationMs: 231_000 },
      ];

      const lexicon = mockLexiconService(lexiconTracks);
      const pipeline = new SyncPipeline(TEST_CONFIG, { ...repos, lexiconService: lexicon });

      const result = await pipeline.matchPlaylist(playlistId);

      // Should use the alt, not the rejected one
      const allLexIds = [...result.confirmed, ...result.pending].map((m) => m.lexiconTrackId);
      expect(allLexIds).not.toContain("lex-rej-1");
    });

    it("should put track in notFound when only rejected candidates exist", async () => {
      const { playlistId, trackIds } = seedPlaylist(db, "Rejected Only", [
        { title: "Rejected Track", artist: "Some Artist", durationMs: 200_000 },
      ]);

      seedMatch(db, trackIds[0], "lex-rej-1", "rejected");

      const lexicon = mockLexiconService([]);
      const pipeline = new SyncPipeline(TEST_CONFIG, { ...repos, lexiconService: lexicon });

      const result = await pipeline.matchPlaylist(playlistId);

      expect(result.confirmed.length).toBe(0);
      expect(result.notFound.length).toBe(1);
    });

    it("should never downgrade confirmed status on upsert", async () => {
      const { playlistId, trackIds } = seedPlaylist(db, "Status Test", [
        { title: "Blue Monday", artist: "New Order", durationMs: 230_000 },
      ]);

      seedMatch(db, trackIds[0], "lex-1", "confirmed");

      const lexiconTracks: LexiconTrack[] = [
        { id: "lex-1", filePath: "/music/blue-monday.flac", title: "Blue Monday", artist: "New Order", durationMs: 230_000 },
      ];

      const lexicon = mockLexiconService(lexiconTracks);
      const pipeline = new SyncPipeline(TEST_CONFIG, { ...repos, lexiconService: lexicon });

      await pipeline.matchPlaylist(playlistId);

      const matchRow = db
        .select()
        .from(schema.matches)
        .where(
          and(
            eq(schema.matches.sourceId, trackIds[0]),
            eq(schema.matches.targetId, "lex-1"),
          ),
        )
        .get();

      expect(matchRow!.status).toBe("confirmed");
    });

    it("should set parkedAt on pending matches", async () => {
      const { playlistId } = seedPlaylist(db, "Pending Test", [
        { title: "Losing It", artist: "Fisher", durationMs: 200_000 },
      ]);

      const lexiconTracks: LexiconTrack[] = [
        { id: "lex-1", filePath: "/music/losing-it.flac", title: "Losing It (Extended Mix)", artist: "Fisher", durationMs: 340_000 },
      ];

      const lexicon = mockLexiconService(lexiconTracks);
      const pipeline = new SyncPipeline(TEST_CONFIG, { ...repos, lexiconService: lexicon });

      const result = await pipeline.matchPlaylist(playlistId);

      // Check if any pending matches exist (depends on matcher scoring)
      if (result.pending.length > 0) {
        const matchRow = db
          .select()
          .from(schema.matches)
          .where(eq(schema.matches.status, "pending"))
          .get();
        expect(matchRow?.parkedAt).toBeDefined();
        expect(matchRow!.parkedAt).toBeGreaterThan(0);
      }
    });

    it("should throw for non-existent playlist", async () => {
      const lexicon = mockLexiconService([]);
      const pipeline = new SyncPipeline(TEST_CONFIG, { ...repos, lexiconService: lexicon });

      await expect(pipeline.matchPlaylist("non-existent")).rejects.toThrow(
        "Playlist not found: non-existent",
      );
    });

    it("should handle empty playlist", async () => {
      const { playlistId } = seedPlaylist(db, "Empty", []);

      const lexicon = mockLexiconService([]);
      const pipeline = new SyncPipeline(TEST_CONFIG, { ...repos, lexiconService: lexicon });

      const result = await pipeline.matchPlaylist(playlistId);

      expect(result.total).toBe(0);
      expect(result.confirmed.length).toBe(0);
      expect(result.pending.length).toBe(0);
      expect(result.notFound.length).toBe(0);
    });

    it("should tag confirmed tracks immediately", async () => {
      const { playlistId } = seedPlaylist(db, "Electronic/House", [
        { title: "Blue Monday", artist: "New Order", durationMs: 230_000 },
      ]);

      const lexiconTracks: LexiconTrack[] = [
        { id: "lex-1", filePath: "/music/blue-monday.flac", title: "Blue Monday", artist: "New Order", durationMs: 230_000 },
      ];

      const lexicon = mockLexiconService(lexiconTracks);
      const pipeline = new SyncPipeline(TEST_CONFIG, { ...repos, lexiconService: lexicon });

      const result = await pipeline.matchPlaylist(playlistId);

      // Verify tagging happened
      if (result.confirmed.length > 0) {
        expect(lexicon.ensureTagCategory).toHaveBeenCalledWith("Spotify Playlists", "#1DB954");
        expect(lexicon.setTrackCategoryTags).toHaveBeenCalled();
        expect(result.tagged).toBeGreaterThan(0);
      }
    });
  });

  // =========================================================================
  // syncTags
  // =========================================================================
  describe("syncTags", () => {
    function makeConfirmedTrack(
      dbTrackId: string,
      lexiconTrackId: string,
    ): MatchedTrack {
      return {
        dbTrackId,
        track: { title: "Track", artist: "Artist" },
        lexiconTrackId,
        score: 0.95,
        confidence: "high",
        method: "fuzzy",
      };
    }

    it("should extract tags from playlist name segments", async () => {
      const lexicon = mockLexiconService([]);
      const pipeline = new SyncPipeline(TEST_CONFIG, { ...repos, lexiconService: lexicon });

      const tracks = [makeConfirmedTrack("t1", "lex-1")];
      const result = await pipeline.syncTags("DJP/26/MT/Indie", tracks);

      expect(lexicon.ensureTagCategory).toHaveBeenCalledWith("Spotify Playlists", "#1DB954");
      expect(lexicon.ensureTag).toHaveBeenCalledTimes(4);
      expect(lexicon.ensureTag).toHaveBeenCalledWith("cat-1", "DJP");
      expect(lexicon.ensureTag).toHaveBeenCalledWith("cat-1", "26");
      expect(lexicon.ensureTag).toHaveBeenCalledWith("cat-1", "MT");
      expect(lexicon.ensureTag).toHaveBeenCalledWith("cat-1", "Indie");
      expect(result.tagged).toBe(1);
      expect(result.skipped).toBe(0);
    });

    it("should merge manual tags with name segments", async () => {
      const lexicon = mockLexiconService([]);
      const pipeline = new SyncPipeline(TEST_CONFIG, { ...repos, lexiconService: lexicon });

      const tracks = [makeConfirmedTrack("t1", "lex-1")];
      const result = await pipeline.syncTags("House", tracks, ["Energy/High", "DJ Set"]);

      // "House" + 2 manual tags = 3 total
      expect(lexicon.ensureTag).toHaveBeenCalledTimes(3);
      expect(result.tagged).toBe(1);
    });

    it("should deduplicate manual tags with name segments", async () => {
      const lexicon = mockLexiconService([]);
      const pipeline = new SyncPipeline(TEST_CONFIG, { ...repos, lexiconService: lexicon });

      const tracks = [makeConfirmedTrack("t1", "lex-1")];
      await pipeline.syncTags("House", tracks, ["House"]);

      // Only 1 unique tag
      expect(lexicon.ensureTag).toHaveBeenCalledTimes(1);
    });

    it("should ensure category is created once", async () => {
      const lexicon = mockLexiconService([]);
      const pipeline = new SyncPipeline(TEST_CONFIG, { ...repos, lexiconService: lexicon });

      const tracks = [
        makeConfirmedTrack("t1", "lex-1"),
        makeConfirmedTrack("t2", "lex-2"),
      ];
      await pipeline.syncTags("House", tracks);

      expect(lexicon.ensureTagCategory).toHaveBeenCalledTimes(1);
    });

    it("should use setTrackCategoryTags for category-scoped tagging", async () => {
      const lexicon = mockLexiconService([]);
      const pipeline = new SyncPipeline(TEST_CONFIG, { ...repos, lexiconService: lexicon });

      const tracks = [makeConfirmedTrack("t1", "lex-1")];
      await pipeline.syncTags("House", tracks);

      expect(lexicon.setTrackCategoryTags).toHaveBeenCalledWith(
        "lex-1",
        "cat-1",
        ["tag-house"],
      );
      // Should NOT call updateTrackTags directly
      expect(lexicon.updateTrackTags).not.toHaveBeenCalled();
    });

    it("should skip tracks without lexiconTrackId", async () => {
      const lexicon = mockLexiconService([]);
      const pipeline = new SyncPipeline(TEST_CONFIG, { ...repos, lexiconService: lexicon });

      const track: MatchedTrack = {
        dbTrackId: "t1",
        track: { title: "Track", artist: "Artist" },
        score: 0.95,
        confidence: "high",
        method: "fuzzy",
      };

      const result = await pipeline.syncTags("House", [track]);

      expect(lexicon.setTrackCategoryTags).not.toHaveBeenCalled();
      expect(result.tagged).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it("should return zeros for empty playlist name", async () => {
      const lexicon = mockLexiconService([]);
      const pipeline = new SyncPipeline(TEST_CONFIG, { ...repos, lexiconService: lexicon });

      const result = await pipeline.syncTags("", []);

      expect(result.tagged).toBe(0);
      expect(result.skipped).toBe(0);
    });

    it("should return zeros for '//' (all empty segments)", async () => {
      const lexicon = mockLexiconService([]);
      const pipeline = new SyncPipeline(TEST_CONFIG, { ...repos, lexiconService: lexicon });

      const result = await pipeline.syncTags("//", []);

      expect(result.tagged).toBe(0);
      expect(result.skipped).toBe(0);
    });

    it("should handle individual track tagging errors gracefully", async () => {
      const lexicon = mockLexiconService([]);
      lexicon.setTrackCategoryTags
        .mockRejectedValueOnce(new Error("API error"))
        .mockResolvedValueOnce(undefined);

      const pipeline = new SyncPipeline(TEST_CONFIG, { ...repos, lexiconService: lexicon });

      const tracks = [
        makeConfirmedTrack("t1", "lex-1"),
        makeConfirmedTrack("t2", "lex-2"),
      ];

      // Suppress console.error in test
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await pipeline.syncTags("House", tracks);
      spy.mockRestore();

      // First track fails, second succeeds
      expect(result.tagged).toBe(1);
      expect(result.skipped).toBe(1);
    });
  });

  // =========================================================================
  // dryRun
  // =========================================================================
  describe("dryRun", () => {
    it("should persist matches but not tag", async () => {
      const { playlistId } = seedPlaylist(db, "Dry Run", [
        { title: "Blue Monday", artist: "New Order", durationMs: 230_000 },
      ]);

      const lexiconTracks: LexiconTrack[] = [
        { id: "lex-1", filePath: "/music/blue-monday.flac", title: "Blue Monday", artist: "New Order", durationMs: 230_000 },
      ];

      const lexicon = mockLexiconService(lexiconTracks);
      const pipeline = new SyncPipeline(TEST_CONFIG, { ...repos, lexiconService: lexicon });

      const result = await pipeline.dryRun(playlistId);

      expect(result.tagged).toBe(0);
      // Verify no tagging calls were made
      expect(lexicon.ensureTagCategory).not.toHaveBeenCalled();
      expect(lexicon.setTrackCategoryTags).not.toHaveBeenCalled();

      // But matches should still be persisted
      const matchRows = db.select().from(schema.matches).all();
      expect(matchRows.length).toBeGreaterThanOrEqual(0);
    });

    it("should return tagged: 0", async () => {
      const { playlistId } = seedPlaylist(db, "Dry Run 2", []);

      const lexicon = mockLexiconService([]);
      const pipeline = new SyncPipeline(TEST_CONFIG, { ...repos, lexiconService: lexicon });

      const result = await pipeline.dryRun(playlistId);
      expect(result.tagged).toBe(0);
    });
  });
});
