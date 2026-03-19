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
import type { LexiconTrack, LexiconPlaylist } from "../../types/lexicon.js";
import type { DownloadResult } from "../download-service.js";
import {
  SyncPipeline,
  type PhaseOneResult,
  type MatchedTrack,
  type PhaseTwoResult,
} from "../sync-pipeline.js";

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
  lexicon: { url: "http://localhost:48624", downloadRoot: "/tmp/test-dl" },
  soulseek: { slskdUrl: "http://localhost:5030", slskdApiKey: "test", searchDelayMs: 0, downloadDir: "/tmp/slskd-downloads" },
  matching: { autoAcceptThreshold: 0.9, reviewThreshold: 0.7 },
  download: { formats: ["flac", "mp3"], minBitrate: 320, concurrency: 2 },
  jobRunner: { pollIntervalMs: 1000, wishlistIntervalMs: 6 * 60 * 60 * 1000 },
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
) {
  const playlistId = crypto.randomUUID();
  const now = Date.now();

  db.insert(schema.playlists)
    .values({
      id: playlistId,
      spotifyId: `sp-${playlistId.slice(0, 8)}`,
      name: playlistName,
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
  opts?: { score?: number; confidence?: "high" | "review" | "low"; method?: "fuzzy" | "isrc" | "manual" },
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
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function mockLexiconService(lexiconTracks: LexiconTrack[], playlists: LexiconPlaylist[] = []) {
  return {
    getTracks: vi.fn().mockResolvedValue(lexiconTracks),
    getPlaylistByName: vi.fn().mockImplementation(async (name: string) => {
      return playlists.find((p) => p.name === name) ?? null;
    }),
    createPlaylist: vi.fn().mockImplementation(async (name: string, trackIds: string[]) => {
      const pl: LexiconPlaylist = { id: crypto.randomUUID(), name, trackIds };
      playlists.push(pl);
      return pl;
    }),
    setPlaylistTracks: vi.fn().mockResolvedValue(undefined),
    // Stubs for unused methods
    ping: vi.fn().mockResolvedValue(true),
    searchTracks: vi.fn().mockResolvedValue([]),
    getTrack: vi.fn().mockResolvedValue(null),
    getPlaylists: vi.fn().mockResolvedValue(playlists),
    addTracksToPlaylist: vi.fn().mockResolvedValue(undefined),
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
  } as any;
}

function mockDownloadService(results: DownloadResult[]) {
  return {
    downloadBatch: vi.fn().mockImplementation(
      async (
        _items: unknown[],
        onProgress?: (completed: number, total: number, result: DownloadResult) => void,
      ) => {
        let done = 0;
        for (const r of results) {
          done++;
          onProgress?.(done, results.length, r);
        }
        return results;
      },
    ),
    searchAndRank: vi.fn().mockResolvedValue([]),
    downloadTrack: vi.fn().mockResolvedValue({ trackId: "", success: false }),
  } as any;
}

// ===========================================================================
// Tests
// ===========================================================================

describe("SyncPipeline", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let sqlite: InstanceType<typeof Database>;

  beforeEach(() => {
    const result = createTestDb();
    db = result.db;
    sqlite = result.sqlite;
  });

  afterEach(() => {
    sqlite.close();
  });

  // =========================================================================
  // Phase 1 — matchPlaylist (crate-sync-eutp)
  // =========================================================================
  describe("Phase 1 — matchPlaylist", () => {
    it("should mark all tracks as found when all exist in Lexicon", async () => {
      const { playlistId, trackIds } = seedPlaylist(db, "All Found", [
        { title: "Blue Monday", artist: "New Order", durationMs: 230_000 },
        { title: "Strings of Life", artist: "Derrick May", durationMs: 280_000 },
      ]);

      const lexiconTracks: LexiconTrack[] = [
        { id: "lex-1", filePath: "/music/blue-monday.flac", title: "Blue Monday", artist: "New Order", durationMs: 230_000 },
        { id: "lex-2", filePath: "/music/strings-of-life.flac", title: "Strings of Life", artist: "Derrick May", durationMs: 280_000 },
      ];

      const lexicon = mockLexiconService(lexiconTracks);
      const pipeline = new SyncPipeline(TEST_CONFIG, { db, lexiconService: lexicon });

      const result = await pipeline.matchPlaylist(playlistId);

      expect(result.playlistName).toBe("All Found");
      expect(result.total).toBe(2);
      expect(result.found.length).toBe(2);
      expect(result.needsReview.length).toBe(0);
      expect(result.notFound.length).toBe(0);
    });

    it("should produce a mix of found/needsReview/notFound for partial matches", async () => {
      const { playlistId } = seedPlaylist(db, "Partial", [
        { title: "Blue Monday", artist: "New Order", durationMs: 230_000 },
        { title: "Losing It", artist: "Fisher", durationMs: 200_000 },
        { title: "Nonexistent Track", artist: "Nobody", durationMs: 180_000 },
      ]);

      // Lexicon has exact match for first, partial for second, nothing for third
      const lexiconTracks: LexiconTrack[] = [
        { id: "lex-1", filePath: "/music/blue-monday.flac", title: "Blue Monday", artist: "New Order", durationMs: 230_000 },
        { id: "lex-2", filePath: "/music/losing-it.flac", title: "Losing It (Extended Mix)", artist: "Fisher", durationMs: 340_000 },
      ];

      const lexicon = mockLexiconService(lexiconTracks);
      const pipeline = new SyncPipeline(TEST_CONFIG, { db, lexiconService: lexicon });

      const result = await pipeline.matchPlaylist(playlistId);

      expect(result.total).toBe(3);
      // The exact match should be found
      expect(result.found.length).toBeGreaterThanOrEqual(1);
      // "Nonexistent Track" should be notFound since no Lexicon candidate matches
      const notFoundTitles = result.notFound.map((n) => n.track.title);
      expect(notFoundTitles).toContain("Nonexistent Track");
      // Total categorized should equal total
      expect(result.found.length + result.needsReview.length + result.notFound.length).toBe(3);
    });

    it("should mark all tracks as notFound when Lexicon has no matching tracks", async () => {
      const { playlistId } = seedPlaylist(db, "No Matches", [
        { title: "Track A", artist: "Artist X", durationMs: 200_000 },
        { title: "Track B", artist: "Artist Y", durationMs: 250_000 },
      ]);

      // Lexicon has completely different tracks
      const lexiconTracks: LexiconTrack[] = [
        { id: "lex-99", filePath: "/music/unrelated.flac", title: "Completely Different Song", artist: "Unknown DJ" },
      ];

      const lexicon = mockLexiconService(lexiconTracks);
      const pipeline = new SyncPipeline(TEST_CONFIG, { db, lexiconService: lexicon });

      const result = await pipeline.matchPlaylist(playlistId);

      expect(result.total).toBe(2);
      expect(result.found.length).toBe(0);
      // All should be either notFound or needsReview (low-confidence matches may end up in notFound)
      expect(result.notFound.length + result.needsReview.length).toBe(2);
    });

    it("should respect previously confirmed matches from the DB", async () => {
      const { playlistId, trackIds } = seedPlaylist(db, "Pre-confirmed", [
        { title: "Blue Monday", artist: "New Order", durationMs: 230_000 },
      ]);

      // Seed a confirmed match
      seedMatch(db, trackIds[0], "lex-pre-1", "confirmed");

      // Lexicon service returns empty — should not matter, the confirmed match takes precedence
      const lexicon = mockLexiconService([]);
      const pipeline = new SyncPipeline(TEST_CONFIG, { db, lexiconService: lexicon });

      const result = await pipeline.matchPlaylist(playlistId);

      expect(result.found.length).toBe(1);
      expect(result.found[0].lexiconTrackId).toBe("lex-pre-1");
      expect(result.notFound.length).toBe(0);
    });

    it("should exclude previously rejected matches", async () => {
      const { playlistId, trackIds } = seedPlaylist(db, "Pre-rejected", [
        { title: "Rejected Track", artist: "Some Artist", durationMs: 200_000 },
      ]);

      // Seed a rejected match
      seedMatch(db, trackIds[0], "lex-rej-1", "rejected");

      const lexicon = mockLexiconService([]);
      const pipeline = new SyncPipeline(TEST_CONFIG, { db, lexiconService: lexicon });

      const result = await pipeline.matchPlaylist(playlistId);

      expect(result.found.length).toBe(0);
      expect(result.notFound.length).toBe(1);
      expect(result.notFound[0].dbTrackId).toBe(trackIds[0]);
    });
  });

  // =========================================================================
  // Phase 2 — applyReviewDecisions (crate-sync-krns)
  // =========================================================================
  describe("Phase 2 — applyReviewDecisions", () => {
    function makePhaseOneResult(
      found: MatchedTrack[],
      needsReview: MatchedTrack[],
      notFound: Array<{ dbTrackId: string; track: { title: string; artist: string } }>,
    ): PhaseOneResult {
      return {
        playlistName: "Test Playlist",
        found,
        needsReview,
        notFound: notFound.map((n) => ({ dbTrackId: n.dbTrackId, track: n.track })),
        total: found.length + needsReview.length + notFound.length,
      };
    }

    function makeMatchedTrack(
      dbTrackId: string,
      title: string,
      lexiconTrackId: string,
    ): MatchedTrack {
      return {
        dbTrackId,
        track: { title, artist: "Test Artist" },
        lexiconTrackId,
        score: 0.8,
        confidence: "review",
        method: "fuzzy",
      };
    }

    it("should move all accepted reviews to confirmed", () => {
      const reviewTrack1 = makeMatchedTrack("t1", "Track 1", "lex-1");
      const reviewTrack2 = makeMatchedTrack("t2", "Track 2", "lex-2");

      // Seed match rows so the DB update has something to target
      seedMatch(db, "t1", "lex-1", "pending", { confidence: "review" });
      seedMatch(db, "t2", "lex-2", "pending", { confidence: "review" });

      const phaseOne = makePhaseOneResult([], [reviewTrack1, reviewTrack2], []);

      const pipeline = new SyncPipeline(TEST_CONFIG, { db });
      const result = pipeline.applyReviewDecisions(phaseOne, [
        { dbTrackId: "t1", accepted: true },
        { dbTrackId: "t2", accepted: true },
      ]);

      expect(result.confirmed.length).toBe(2);
      expect(result.missing.length).toBe(0);

      // Verify DB was updated
      const matchRows = db.select().from(schema.matches).all();
      const confirmedRows = matchRows.filter((m) => m.status === "confirmed");
      expect(confirmedRows.length).toBe(2);
    });

    it("should move all rejected reviews to missing", () => {
      const reviewTrack1 = makeMatchedTrack("t1", "Track 1", "lex-1");
      const reviewTrack2 = makeMatchedTrack("t2", "Track 2", "lex-2");

      seedMatch(db, "t1", "lex-1", "pending", { confidence: "review" });
      seedMatch(db, "t2", "lex-2", "pending", { confidence: "review" });

      const phaseOne = makePhaseOneResult([], [reviewTrack1, reviewTrack2], []);

      const pipeline = new SyncPipeline(TEST_CONFIG, { db });
      const result = pipeline.applyReviewDecisions(phaseOne, [
        { dbTrackId: "t1", accepted: false },
        { dbTrackId: "t2", accepted: false },
      ]);

      expect(result.confirmed.length).toBe(0);
      expect(result.missing.length).toBe(2);

      // Verify DB was updated to rejected
      const matchRows = db.select().from(schema.matches).all();
      const rejectedRows = matchRows.filter((m) => m.status === "rejected");
      expect(rejectedRows.length).toBe(2);
    });

    it("should correctly categorise a mix of accept/reject", () => {
      const foundTrack = makeMatchedTrack("t0", "Already Found", "lex-0");
      foundTrack.confidence = "high";
      const reviewTrack1 = makeMatchedTrack("t1", "Accept Me", "lex-1");
      const reviewTrack2 = makeMatchedTrack("t2", "Reject Me", "lex-2");

      seedMatch(db, "t1", "lex-1", "pending", { confidence: "review" });
      seedMatch(db, "t2", "lex-2", "pending", { confidence: "review" });

      const phaseOne = makePhaseOneResult(
        [foundTrack],
        [reviewTrack1, reviewTrack2],
        [{ dbTrackId: "t3", track: { title: "Missing", artist: "Nobody" } }],
      );

      const pipeline = new SyncPipeline(TEST_CONFIG, { db });
      const result = pipeline.applyReviewDecisions(phaseOne, [
        { dbTrackId: "t1", accepted: true },
        { dbTrackId: "t2", accepted: false },
      ]);

      // confirmed = found (1) + accepted review (1)
      expect(result.confirmed.length).toBe(2);
      // missing = notFound (1) + rejected review (1)
      expect(result.missing.length).toBe(2);
    });

    it("should update match status in DB correctly", () => {
      const review = makeMatchedTrack("t1", "Track 1", "lex-1");

      seedMatch(db, "t1", "lex-1", "pending", { confidence: "review" });

      const phaseOne = makePhaseOneResult([], [review], []);

      const pipeline = new SyncPipeline(TEST_CONFIG, { db });
      pipeline.applyReviewDecisions(phaseOne, [
        { dbTrackId: "t1", accepted: true },
      ]);

      const match = db
        .select()
        .from(schema.matches)
        .where(
          and(
            eq(schema.matches.sourceId, "t1"),
            eq(schema.matches.targetId, "lex-1"),
          ),
        )
        .get();

      expect(match).toBeDefined();
      expect(match!.status).toBe("confirmed");
    });
  });

  // =========================================================================
  // Phase 3 — downloadMissing (crate-sync-iwed)
  // =========================================================================
  describe("Phase 3 — downloadMissing", () => {
    it("should trigger downloads via DownloadService and record results in DB", async () => {
      // We need real track IDs in the DB for the FK constraint on downloads
      const { playlistId, trackIds } = seedPlaylist(db, "Download Test", [
        { title: "Track A", artist: "Artist A", durationMs: 200_000 },
        { title: "Track B", artist: "Artist B", durationMs: 250_000 },
      ]);

      const downloadResults: DownloadResult[] = [
        { trackId: trackIds[0], success: true, filePath: "/tmp/test-dl/track-a.flac" },
        { trackId: trackIds[1], success: true, filePath: "/tmp/test-dl/track-b.flac" },
      ];

      const dlService = mockDownloadService(downloadResults);
      const pipeline = new SyncPipeline(TEST_CONFIG, { db, downloadService: dlService });

      const phaseTwo: PhaseTwoResult = {
        confirmed: [],
        missing: [
          { dbTrackId: trackIds[0], track: { title: "Track A", artist: "Artist A" } },
          { dbTrackId: trackIds[1], track: { title: "Track B", artist: "Artist B" } },
        ],
      };

      const result = await pipeline.downloadMissing(phaseTwo, "Download Test");

      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(0);

      // Verify downloadBatch was called
      expect(dlService.downloadBatch).toHaveBeenCalledOnce();

      // Verify download records were created in DB
      const downloads = db.select().from(schema.downloads).all();
      expect(downloads.length).toBe(2);
      expect(downloads.every((d) => d.status === "done")).toBe(true);
    });

    it("should handle concurrent downloads and track failures", async () => {
      const { playlistId, trackIds } = seedPlaylist(db, "Mixed DL", [
        { title: "Success Track", artist: "Artist", durationMs: 200_000 },
        { title: "Fail Track", artist: "Artist", durationMs: 200_000 },
      ]);

      const downloadResults: DownloadResult[] = [
        { trackId: trackIds[0], success: true, filePath: "/tmp/test-dl/success.flac" },
        { trackId: trackIds[1], success: false, error: "No matching files found on Soulseek" },
      ];

      const dlService = mockDownloadService(downloadResults);
      const pipeline = new SyncPipeline(TEST_CONFIG, { db, downloadService: dlService });

      const phaseTwo: PhaseTwoResult = {
        confirmed: [],
        missing: [
          { dbTrackId: trackIds[0], track: { title: "Success Track", artist: "Artist" } },
          { dbTrackId: trackIds[1], track: { title: "Fail Track", artist: "Artist" } },
        ],
      };

      const result = await pipeline.downloadMissing(phaseTwo, "Mixed DL");

      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(1);

      const downloads = db.select().from(schema.downloads).all();
      const doneRows = downloads.filter((d) => d.status === "done");
      const failedRows = downloads.filter((d) => d.status === "failed");
      expect(doneRows.length).toBe(1);
      expect(failedRows.length).toBe(1);
    });

    it("should call the progress callback", async () => {
      const { trackIds } = seedPlaylist(db, "Progress Test", [
        { title: "Track", artist: "Artist", durationMs: 200_000 },
      ]);

      const downloadResults: DownloadResult[] = [
        { trackId: trackIds[0], success: true, filePath: "/tmp/test-dl/track.flac" },
      ];

      const dlService = mockDownloadService(downloadResults);
      const pipeline = new SyncPipeline(TEST_CONFIG, { db, downloadService: dlService });

      const progressCalls: Array<[number, number, string, boolean]> = [];

      const phaseTwo: PhaseTwoResult = {
        confirmed: [],
        missing: [
          { dbTrackId: trackIds[0], track: { title: "Track", artist: "Artist" } },
        ],
      };

      await pipeline.downloadMissing(phaseTwo, "Progress Test", (completed, total, title, success) => {
        progressCalls.push([completed, total, title, success]);
      });

      expect(progressCalls.length).toBe(1);
      expect(progressCalls[0]).toEqual([1, 1, "Track", true]);
    });

    it("should create download records in DB for each result", async () => {
      const { trackIds } = seedPlaylist(db, "DB Records", [
        { title: "Track 1", artist: "A1", durationMs: 200_000 },
        { title: "Track 2", artist: "A2", durationMs: 200_000 },
        { title: "Track 3", artist: "A3", durationMs: 200_000 },
      ]);

      const downloadResults: DownloadResult[] = [
        { trackId: trackIds[0], success: true, filePath: "/tmp/t1.flac" },
        { trackId: trackIds[1], success: false, error: "timeout" },
        { trackId: trackIds[2], success: true, filePath: "/tmp/t3.flac" },
      ];

      const dlService = mockDownloadService(downloadResults);
      const pipeline = new SyncPipeline(TEST_CONFIG, { db, downloadService: dlService });

      const phaseTwo: PhaseTwoResult = {
        confirmed: [],
        missing: trackIds.map((id, i) => ({
          dbTrackId: id,
          track: { title: `Track ${i + 1}`, artist: `A${i + 1}` },
        })),
      };

      await pipeline.downloadMissing(phaseTwo, "DB Records");

      const downloads = db.select().from(schema.downloads).all();
      expect(downloads.length).toBe(3);

      // Check that failed record has error info
      const failedRecord = downloads.find((d) => d.trackId === trackIds[1]);
      expect(failedRecord).toBeDefined();
      expect(failedRecord!.status).toBe("failed");
      expect(failedRecord!.error).toBe("timeout");
    });
  });

  // =========================================================================
  // syncToLexicon (crate-sync-pjne)
  // =========================================================================
  describe("syncToLexicon", () => {
    it("should create a new playlist in Lexicon when it does not exist", async () => {
      const { playlistId } = seedPlaylist(db, "New Playlist", []);

      const lexicon = mockLexiconService([], []);
      const pipeline = new SyncPipeline(TEST_CONFIG, { db, lexiconService: lexicon });

      await pipeline.syncToLexicon(playlistId, "New Playlist", ["lex-1", "lex-2", "lex-3"]);

      expect(lexicon.getPlaylistByName).toHaveBeenCalledWith("New Playlist");
      expect(lexicon.createPlaylist).toHaveBeenCalledWith("New Playlist", ["lex-1", "lex-2", "lex-3"]);
      expect(lexicon.setPlaylistTracks).not.toHaveBeenCalled();

      // Verify sync_log entry
      const logs = db.select().from(schema.syncLog).all();
      expect(logs.length).toBe(1);
      expect(logs[0].action).toBe("sync_to_lexicon");
      expect(logs[0].details).toContain("3 tracks");
    });

    it("should update an existing playlist in Lexicon", async () => {
      const { playlistId } = seedPlaylist(db, "Existing Playlist", []);

      const existingPlaylist: LexiconPlaylist = {
        id: "lex-pl-1",
        name: "Existing Playlist",
        trackIds: ["old-1", "old-2"],
      };

      const lexicon = mockLexiconService([], [existingPlaylist]);
      const pipeline = new SyncPipeline(TEST_CONFIG, { db, lexiconService: lexicon });

      await pipeline.syncToLexicon(playlistId, "Existing Playlist", ["lex-1", "lex-2", "lex-3"]);

      expect(lexicon.getPlaylistByName).toHaveBeenCalledWith("Existing Playlist");
      expect(lexicon.setPlaylistTracks).toHaveBeenCalledWith("lex-pl-1", ["lex-1", "lex-2", "lex-3"]);
      expect(lexicon.createPlaylist).not.toHaveBeenCalled();
    });

    it("should preserve track order matching Spotify order", async () => {
      const { playlistId } = seedPlaylist(db, "Ordered", []);

      const lexicon = mockLexiconService([], []);
      const pipeline = new SyncPipeline(TEST_CONFIG, { db, lexiconService: lexicon });

      const orderedIds = ["lex-3", "lex-1", "lex-5", "lex-2", "lex-4"];
      await pipeline.syncToLexicon(playlistId, "Ordered", orderedIds);

      // The order passed to createPlaylist should be exactly as provided
      expect(lexicon.createPlaylist).toHaveBeenCalledWith("Ordered", orderedIds);
      const callArgs = lexicon.createPlaylist.mock.calls[0];
      expect(callArgs[1]).toEqual(orderedIds);
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

    it("should parse playlist name segments and create tags", async () => {
      const lexicon = mockLexiconService([]);
      const pipeline = new SyncPipeline(TEST_CONFIG, { db, lexiconService: lexicon });

      const tracks = [makeConfirmedTrack("t1", "lex-1")];
      const result = await pipeline.syncTags("DJP/26/MT/Indie", tracks);

      // Should create Spotify category
      expect(lexicon.createTagCategory).toHaveBeenCalledWith("Spotify", "#1DB954");
      // Should create 4 tags
      expect(lexicon.createTag).toHaveBeenCalledTimes(4);
      expect(lexicon.createTag).toHaveBeenCalledWith("cat-new", "DJP");
      expect(lexicon.createTag).toHaveBeenCalledWith("cat-new", "26");
      expect(lexicon.createTag).toHaveBeenCalledWith("cat-new", "MT");
      expect(lexicon.createTag).toHaveBeenCalledWith("cat-new", "Indie");

      expect(result.tagged).toBe(1);
      expect(result.skipped).toBe(0);
    });

    it("should reuse existing Spotify category and tags", async () => {
      const lexicon = mockLexiconService([]);
      // Pre-populate category and tags
      lexicon.getTags.mockResolvedValue({
        categories: [{ id: "cat-1", label: "Spotify", color: "#1DB954" }],
        tags: [
          { id: "tag-1", categoryId: "cat-1", label: "DJP" },
          { id: "tag-2", categoryId: "cat-1", label: "26" },
        ],
      });

      const pipeline = new SyncPipeline(TEST_CONFIG, { db, lexiconService: lexicon });

      const tracks = [makeConfirmedTrack("t1", "lex-1")];
      const result = await pipeline.syncTags("DJP/26", tracks);

      // Should NOT create category
      expect(lexicon.createTagCategory).not.toHaveBeenCalled();
      // Should NOT create tags (both exist)
      expect(lexicon.createTag).not.toHaveBeenCalled();

      expect(result.tagged).toBe(1);
    });

    it("should merge new tags with existing track tags", async () => {
      const lexicon = mockLexiconService([]);
      lexicon.getTags.mockResolvedValue({
        categories: [{ id: "cat-1", label: "Spotify" }],
        tags: [{ id: "tag-1", categoryId: "cat-1", label: "House" }],
      });
      // Track already has some tags
      lexicon.getTrackTags.mockResolvedValue(["tag-existing"]);

      const pipeline = new SyncPipeline(TEST_CONFIG, { db, lexiconService: lexicon });

      const tracks = [makeConfirmedTrack("t1", "lex-1")];
      await pipeline.syncTags("House", tracks);

      // Should update with merged tags (existing + new)
      expect(lexicon.updateTrackTags).toHaveBeenCalledWith(
        "lex-1",
        expect.arrayContaining(["tag-existing", "tag-1"]),
      );
    });

    it("should skip tracks that already have all tags", async () => {
      const lexicon = mockLexiconService([]);
      lexicon.getTags.mockResolvedValue({
        categories: [{ id: "cat-1", label: "Spotify" }],
        tags: [{ id: "tag-1", categoryId: "cat-1", label: "House" }],
      });
      // Track already has the tag
      lexicon.getTrackTags.mockResolvedValue(["tag-1"]);

      const pipeline = new SyncPipeline(TEST_CONFIG, { db, lexiconService: lexicon });

      const tracks = [makeConfirmedTrack("t1", "lex-1")];
      const result = await pipeline.syncTags("House", tracks);

      expect(lexicon.updateTrackTags).not.toHaveBeenCalled();
      expect(result.tagged).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it("should skip tracks without lexiconTrackId", async () => {
      const lexicon = mockLexiconService([]);
      const pipeline = new SyncPipeline(TEST_CONFIG, { db, lexiconService: lexicon });

      const track: MatchedTrack = {
        dbTrackId: "t1",
        track: { title: "Track", artist: "Artist" },
        score: 0.95,
        confidence: "high",
        method: "fuzzy",
      };

      const result = await pipeline.syncTags("House", [track]);

      expect(lexicon.getTrackTags).not.toHaveBeenCalled();
      expect(result.tagged).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it("should return zeros for empty playlist name", async () => {
      const lexicon = mockLexiconService([]);
      const pipeline = new SyncPipeline(TEST_CONFIG, { db, lexiconService: lexicon });

      const result = await pipeline.syncTags("", []);

      expect(result.tagged).toBe(0);
      expect(result.skipped).toBe(0);
      expect(lexicon.getTags).not.toHaveBeenCalled();
    });

    it("should tag even for single-segment names (no slash)", async () => {
      const lexicon = mockLexiconService([]);
      const pipeline = new SyncPipeline(TEST_CONFIG, { db, lexiconService: lexicon });

      const tracks = [makeConfirmedTrack("t1", "lex-1")];
      const result = await pipeline.syncTags("Techno", tracks);

      expect(lexicon.createTagCategory).toHaveBeenCalled();
      expect(lexicon.createTag).toHaveBeenCalledTimes(1);
      expect(result.tagged).toBe(1);
    });
  });
});
