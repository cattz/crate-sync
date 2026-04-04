import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";

import * as schema from "../../db/schema.js";
import type { Config } from "../../config.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(currentDir, "../../db/migrations");

let testDb: ReturnType<typeof drizzle<typeof schema>>;
let sqlite: InstanceType<typeof Database>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));

// ---------------------------------------------------------------------------
// Mock services
// ---------------------------------------------------------------------------

const mockMatchPlaylist = vi.fn();
const mockSyncTags = vi.fn();
vi.mock("../../services/sync-pipeline.js", () => {
  function createMockInstance() {
    return {
      matchPlaylist: mockMatchPlaylist,
      syncTags: mockSyncTags,
    };
  }
  const MockSyncPipeline = vi.fn().mockImplementation(() => createMockInstance());
  MockSyncPipeline.fromConfig = vi.fn().mockImplementation(() => createMockInstance());
  return { SyncPipeline: MockSyncPipeline };
});

const mockGetPlaylistTracks = vi.fn().mockResolvedValue([]);
vi.mock("../../services/spotify-service.js", () => ({
  SpotifyService: vi.fn().mockImplementation(function () {
    return {
      getPlaylistTracks: mockGetPlaylistTracks,
    };
  }),
}));

const mockSyncPlaylistTracksFromApi = vi.fn().mockReturnValue({ added: 0, updated: 0 });
vi.mock("../../services/playlist-service.js", () => ({
  PlaylistService: {
    fromDb: vi.fn().mockImplementation(() => ({
      syncPlaylistTracksFromApi: mockSyncPlaylistTracksFromApi,
    })),
  },
}));

const mockFindDownloadedFile = vi.fn();
const mockCheckFileStable = vi.fn();
const mockValidateDownload = vi.fn();
const mockMoveToPlaylistFolder = vi.fn();
const mockSearchAndRank = vi.fn();
const mockCleanupEmptyDirs = vi.fn().mockReturnValue(0);
vi.mock("../../services/download-service.js", () => {
  function createMockInstance() {
    return {
      findDownloadedFile: mockFindDownloadedFile,
      checkFileStable: mockCheckFileStable,
      validateDownload: mockValidateDownload,
      moveToPlaylistFolder: mockMoveToPlaylistFolder,
      searchAndRank: mockSearchAndRank,
      cleanupEmptyDirs: mockCleanupEmptyDirs,
    };
  }
  const MockDownloadService = vi.fn().mockImplementation(() => createMockInstance());
  MockDownloadService.fromDb = vi.fn().mockImplementation(() => createMockInstance());
  return { DownloadService: MockDownloadService };
});

vi.mock("../../services/soulseek-service.js", () => ({
  SoulseekService: vi.fn().mockImplementation(function () {
    return {
      rateLimitedSearch: vi.fn().mockResolvedValue([]),
      isConnected: vi.fn().mockResolvedValue(true),
      waitForConnection: vi.fn().mockResolvedValue(true),
    };
  }),
}));

vi.mock("../../services/lexicon-service.js", () => ({
  LexiconService: vi.fn().mockImplementation(function () {
    return {
      getTracks: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock("music-metadata", () => ({
  parseFile: vi.fn().mockResolvedValue({
    common: { title: "", artist: "" },
    format: { duration: undefined },
  }),
}));

vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
  renameSync: vi.fn(),
  copyFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  readdirSync: vi.fn().mockReturnValue([]),
  statSync: vi.fn().mockReturnValue({ mtimeMs: 0, size: 100 }),
  rmdirSync: vi.fn(),
}));

vi.mock("../../search/query-builder.js", () => ({
  generateSearchQueries: vi.fn().mockReturnValue([
    { label: "full", query: "artist title" },
    { label: "title-only", query: "title" },
  ]),
}));

// Mock the source registry to return no local sources (tests exercise Soulseek path)
vi.mock("../../sources/registry.js", () => ({
  buildSources: vi.fn().mockReturnValue([]),
}));

const mockFuzzyMatch = vi.fn().mockReturnValue([]);
vi.mock("../../matching/fuzzy.js", () => ({
  FuzzyMatchStrategy: vi.fn().mockImplementation(function () {
    return { match: mockFuzzyMatch };
  }),
}));

import { handleDownloadScan } from "../handlers/download-scan.js";
import { handleLexiconMatch } from "../handlers/lexicon-match.js";
import { handleLexiconTag } from "../handlers/lexicon-tag.js";
import { handleSearch } from "../handlers/search.js";
import { handleSpotifySync } from "../handlers/spotify-sync.js";
import { handleOrphanRescue } from "../handlers/orphan-rescue.js";
import { handleTransferCompleted, handleTransferFailed } from "../handlers/transfer-event.js";
import { handleValidate } from "../handlers/validate.js";
import { handleWishlistRun } from "../handlers/wishlist-run.js";
import { existsSync, readdirSync } from "node:fs";

// ---------------------------------------------------------------------------
// Test config
// ---------------------------------------------------------------------------
const TEST_CONFIG: Config = {
  spotify: { clientId: "", clientSecret: "", redirectUri: "" },
  lexicon: {
    url: "http://localhost:48624",
    downloadRoot: "/tmp/test-dl",
    tagCategory: { name: "Playlist", color: "#1DB954" },
  },
  soulseek: {
    slskdUrl: "http://localhost:5030",
    slskdApiKey: "test",
    searchDelayMs: 0,
    downloadDir: "/tmp/slskd",
    downloadTimeoutMs: 600_000,
    fileScanIntervalMs: 15_000,
  },
  matching: {
    autoAcceptThreshold: 0.9,
    reviewThreshold: 0.7,
    notFoundThreshold: 0.65,
    lexiconWeights: { title: 0.3, artist: 0.3, album: 0.15, duration: 0.25 },
    soulseekWeights: { title: 0.3, artist: 0.25, album: 0.1, duration: 0.35 },
  },
  download: {
    formats: ["flac", "mp3"],
    minBitrate: 320,
    concurrency: 2,
    validationStrictness: "moderate",
  },
  jobRunner: { pollIntervalMs: 1000, concurrency: 3, retentionDays: 7 },
  wishlist: { retryIntervalHours: 24, maxRetries: 5 },
  logging: { level: "info", file: false },
  sources: { priority: ["soulseek"], local: {} },
};

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------
function freshDb() {
  sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  testDb = drizzle(sqlite, { schema });
  migrate(testDb, { migrationsFolder });
}

function seedPlaylist(
  name: string,
  trackData: Array<{ title: string; artist: string; durationMs?: number }>,
) {
  const playlistId = crypto.randomUUID();
  const now = Date.now();

  testDb
    .insert(schema.playlists)
    .values({
      id: playlistId,
      spotifyId: `sp-${playlistId.slice(0, 8)}`,
      name,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const trackIds: string[] = [];
  for (let i = 0; i < trackData.length; i++) {
    const t = trackData[i];
    const trackId = crypto.randomUUID();
    trackIds.push(trackId);

    testDb
      .insert(schema.tracks)
      .values({
        id: trackId,
        spotifyId: `sp-track-${trackId.slice(0, 8)}`,
        title: t.title,
        artist: t.artist,
        durationMs: t.durationMs ?? 200_000,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    testDb
      .insert(schema.playlistTracks)
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

function makeJob(
  overrides: Partial<schema.NewJob> & { type: schema.JobType },
): schema.Job {
  const id = crypto.randomUUID();
  const now = Date.now();
  const job: schema.NewJob = {
    id,
    status: "running",
    priority: 0,
    payload: null,
    attempt: 0,
    maxAttempts: 3,
    createdAt: now,
    startedAt: now,
    ...overrides,
  };
  return testDb.insert(schema.jobs).values(job).returning().get();
}

function seedDownload(overrides: Partial<schema.NewDownload & { id: string }>) {
  const id = overrides.id ?? crypto.randomUUID();
  const now = Date.now();
  testDb
    .insert(schema.downloads)
    .values({
      id,
      trackId: "t1",
      status: "downloading",
      origin: "not_found",
      createdAt: now,
      startedAt: now,
      ...overrides,
    })
    .run();
  return id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Handler Details", () => {
  beforeEach(() => {
    freshDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    sqlite.close();
  });

  // =========================================================================
  // download-scan handler
  // =========================================================================
  describe("handleDownloadScan", () => {
    it("completes with scanned:0 when no pending downloads", async () => {
      const job = makeJob({ type: "download_scan" });
      await handleDownloadScan(job, TEST_CONFIG);

      const updated = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, job.id))
        .get();

      expect(updated!.status).toBe("done");
      const result = JSON.parse(updated!.result!);
      expect(result.scanned).toBe(0);
      expect(result.completed).toBe(0);
      expect(result.timedOut).toBe(0);
    });

    it("finds completed file, validates, moves, marks done", async () => {
      const { trackIds, playlistId } = seedPlaylist("TestPL", [
        { title: "Song A", artist: "Artist A" },
      ]);

      seedDownload({
        trackId: trackIds[0],
        playlistId,
        slskdUsername: "user1",
        slskdFilename: "@@user1\\music\\Song A.flac",
        startedAt: Date.now(),
      });

      mockFindDownloadedFile.mockReturnValue("/tmp/slskd/Song A.flac");
      mockCheckFileStable.mockResolvedValue(true);
      mockValidateDownload.mockResolvedValue(true);
      mockMoveToPlaylistFolder.mockReturnValue("/tmp/test-dl/TestPL/Song A.flac");

      const job = makeJob({ type: "download_scan" });
      await handleDownloadScan(job, TEST_CONFIG);

      const updated = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, job.id))
        .get();

      const result = JSON.parse(updated!.result!);
      expect(result.scanned).toBe(1);
      expect(result.completed).toBe(1);
      expect(result.timedOut).toBe(0);

      // Download row should be marked done
      const downloads = testDb.select().from(schema.downloads).all();
      expect(downloads[0].status).toBe("done");
      expect(downloads[0].filePath).toBe("/tmp/test-dl/TestPL/Song A.flac");
    });

    it("file not found, not timed out yet — stays downloading", async () => {
      const { trackIds, playlistId } = seedPlaylist("TestPL", [
        { title: "Song A", artist: "Artist A" },
      ]);

      seedDownload({
        trackId: trackIds[0],
        playlistId,
        slskdUsername: "user1",
        slskdFilename: "@@user1\\music\\Song A.flac",
        startedAt: Date.now(), // just started — no timeout
      });

      mockFindDownloadedFile.mockReturnValue(null);

      const job = makeJob({ type: "download_scan" });
      await handleDownloadScan(job, TEST_CONFIG);

      const result = JSON.parse(
        testDb.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get()!.result!,
      );
      expect(result.scanned).toBe(1);
      expect(result.completed).toBe(0);
      expect(result.timedOut).toBe(0);

      // Download should still be in downloading state
      const dl = testDb.select().from(schema.downloads).all();
      expect(dl[0].status).toBe("downloading");
    });

    it("file not found, past timeout — marks failed and creates search job", async () => {
      const { trackIds, playlistId } = seedPlaylist("TestPL", [
        { title: "Song A", artist: "Artist A" },
      ]);

      // Started long ago — well past the 600s timeout
      const longAgo = Date.now() - 900_000;
      seedDownload({
        trackId: trackIds[0],
        playlistId,
        slskdUsername: "user1",
        slskdFilename: "@@user1\\music\\Song A.flac",
        startedAt: longAgo,
        createdAt: longAgo,
      });

      mockFindDownloadedFile.mockReturnValue(null);

      const job = makeJob({ type: "download_scan" });
      await handleDownloadScan(job, TEST_CONFIG);

      const result = JSON.parse(
        testDb.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get()!.result!,
      );
      expect(result.scanned).toBe(1);
      expect(result.completed).toBe(0);
      expect(result.timedOut).toBe(1);

      // Download should be marked failed
      const dl = testDb.select().from(schema.downloads).all();
      expect(dl[0].status).toBe("failed");
      expect(dl[0].error).toContain("timed out");

      // A new search job should have been created
      const searchJobs = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.type, "search"))
        .all();
      expect(searchJobs.length).toBe(1);
      const searchPayload = JSON.parse(searchJobs[0].payload!);
      expect(searchPayload.trackId).toBe(trackIds[0]);
      expect(searchPayload.playlistId).toBe(playlistId);
    });
  });

  // =========================================================================
  // lexicon-match handler
  // =========================================================================
  describe("handleLexiconMatch", () => {
    it("calls syncPipeline.matchPlaylist and completes with playlistName", async () => {
      const { playlistId } = seedPlaylist("Deep House", [
        { title: "Track 1", artist: "DJ A" },
      ]);

      mockMatchPlaylist.mockResolvedValue({
        playlistName: "Deep House",
        confirmed: [{ dbTrackId: "t1", lexiconTrackId: "lex1" }],
        pending: [],
        notFound: [],
        total: 1,
        tagged: 1,
      });

      const job = makeJob({
        type: "lexicon_match",
        payload: JSON.stringify({ playlistId }),
      });

      await handleLexiconMatch(job, TEST_CONFIG);

      expect(mockMatchPlaylist).toHaveBeenCalledWith(playlistId);

      const updated = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, job.id))
        .get();

      expect(updated!.status).toBe("done");
      const result = JSON.parse(updated!.result!);
      expect(result.playlistName).toBe("Deep House");
      expect(result.confirmed).toBe(1);
      expect(result.notFound).toBe(0);
    });

    it("creates search jobs for not-found tracks", async () => {
      const { playlistId, trackIds } = seedPlaylist("Techno", [
        { title: "Missing", artist: "Unknown" },
      ]);

      mockMatchPlaylist.mockResolvedValue({
        playlistName: "Techno",
        confirmed: [],
        pending: [],
        notFound: [
          {
            dbTrackId: trackIds[0],
            track: { title: "Missing", artist: "Unknown", durationMs: 200_000 },
          },
        ],
        total: 1,
        tagged: 0,
      });

      const job = makeJob({
        type: "lexicon_match",
        payload: JSON.stringify({ playlistId }),
      });

      await handleLexiconMatch(job, TEST_CONFIG);

      const searchJobs = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.type, "search"))
        .all();

      expect(searchJobs.length).toBe(1);
      expect(searchJobs[0].parentJobId).toBe(job.id);
      const payload = JSON.parse(searchJobs[0].payload!);
      expect(payload.trackId).toBe(trackIds[0]);
      expect(payload.title).toBe("Missing");
    });

    it("uses playlistName from payload when provided", async () => {
      const { playlistId } = seedPlaylist("DB Name", [
        { title: "T1", artist: "A1" },
      ]);

      mockMatchPlaylist.mockResolvedValue({
        playlistName: "DB Name",
        confirmed: [],
        pending: [],
        notFound: [],
        total: 1,
        tagged: 0,
      });

      const job = makeJob({
        type: "lexicon_match",
        payload: JSON.stringify({ playlistId, playlistName: "Override Name" }),
      });

      await handleLexiconMatch(job, TEST_CONFIG);

      const result = JSON.parse(
        testDb.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get()!.result!,
      );
      expect(result.playlistName).toBe("Override Name");
    });
  });

  // =========================================================================
  // lexicon-tag handler
  // =========================================================================
  describe("handleLexiconTag", () => {
    it("calls syncPipeline.syncTags for confirmed matches", async () => {
      const { playlistId, trackIds } = seedPlaylist("House", [
        { title: "Tagged Song", artist: "DJ B" },
      ]);

      // Insert a confirmed match
      testDb
        .insert(schema.matches)
        .values({
          id: crypto.randomUUID(),
          sourceType: "spotify",
          sourceId: trackIds[0],
          targetType: "lexicon",
          targetId: "lex-789",
          score: 0.95,
          confidence: "high",
          method: "fuzzy",
          status: "confirmed",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        .run();

      mockSyncTags.mockResolvedValue({ tagged: 1, skipped: 0 });

      const job = makeJob({
        type: "lexicon_tag",
        payload: JSON.stringify({ playlistId }),
      });

      await handleLexiconTag(job, TEST_CONFIG);

      expect(mockSyncTags).toHaveBeenCalledWith(
        "House",
        expect.arrayContaining([
          expect.objectContaining({
            dbTrackId: trackIds[0],
            lexiconTrackId: "lex-789",
          }),
        ]),
      );

      const updated = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, job.id))
        .get();

      expect(updated!.status).toBe("done");
      expect(JSON.parse(updated!.result!).tagged).toBe(1);
    });

    it("completes with tagged:0 when no confirmed matches exist", async () => {
      const { playlistId } = seedPlaylist("Empty", [
        { title: "No Match", artist: "Nobody" },
      ]);

      const job = makeJob({
        type: "lexicon_tag",
        payload: JSON.stringify({ playlistId }),
      });

      await handleLexiconTag(job, TEST_CONFIG);

      expect(mockSyncTags).not.toHaveBeenCalled();
      const result = JSON.parse(
        testDb.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get()!.result!,
      );
      expect(result.tagged).toBe(0);
    });

    it("throws when playlist not found", async () => {
      const job = makeJob({
        type: "lexicon_tag",
        payload: JSON.stringify({ playlistId: "nonexistent" }),
      });

      await expect(handleLexiconTag(job, TEST_CONFIG)).rejects.toThrow(
        "Playlist not found: nonexistent",
      );
    });
  });

  // =========================================================================
  // search handler
  // =========================================================================
  describe("handleSearch", () => {
    it("successful search creates download job", async () => {
      mockSearchAndRank.mockResolvedValue({
        ranked: [
          {
            file: {
              filename: "@@user1\\music\\Artist - Title.flac",
              size: 50_000_000,
              username: "user1",
              bitRate: 1411,
            },
            score: 0.85,
          },
        ],
        diagnostics: "",
        strategy: "full",
        strategyLog: [{ label: "full", query: "Artist Title", resultCount: 3 }],
      });

      const job = makeJob({
        type: "search",
        payload: JSON.stringify({
          trackId: "t1",
          playlistId: "p1",
          title: "Title",
          artist: "Artist",
          durationMs: 200_000,
          queryIndex: 0,
        }),
      });

      await handleSearch(job, TEST_CONFIG);

      // Job should be completed
      const updated = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, job.id))
        .get();
      expect(updated!.status).toBe("done");

      const result = JSON.parse(updated!.result!);
      expect(result.strategy).toBe("full");
      expect(result.bestScore).toBe(0.85);

      // A download job should have been created
      const downloadJobs = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.type, "download"))
        .all();
      expect(downloadJobs.length).toBe(1);
      expect(downloadJobs[0].parentJobId).toBe(job.id);

      const dlPayload = JSON.parse(downloadJobs[0].payload!);
      expect(dlPayload.trackId).toBe("t1");
      expect(dlPayload.file.username).toBe("user1");
    });

    it("no results fails the job", async () => {
      // Seed track and playlist so the wishlist insert satisfies FK constraints
      const { trackIds, playlistId } = seedPlaylist("SearchPL", [
        { title: "Title", artist: "Artist" },
      ]);

      mockSearchAndRank.mockResolvedValue({
        ranked: [],
        diagnostics: "0 results from soulseek",
        strategy: undefined,
        strategyLog: [{ label: "full", query: "Artist Title", resultCount: 0 }],
      });

      const job = makeJob({
        type: "search",
        payload: JSON.stringify({
          trackId: trackIds[0],
          playlistId,
          title: "Title",
          artist: "Artist",
          durationMs: 200_000,
          queryIndex: 0,
        }),
      });

      await handleSearch(job, TEST_CONFIG);

      const updated = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, job.id))
        .get();
      expect(updated!.status).toBe("failed");
      expect(updated!.error).toContain("No viable results");
    });

    it("low-scoring results also fail the job", async () => {
      // Seed track and playlist so the wishlist insert satisfies FK constraints
      const { trackIds, playlistId } = seedPlaylist("SearchPL", [
        { title: "Title", artist: "Artist" },
      ]);

      mockSearchAndRank.mockResolvedValue({
        ranked: [
          {
            file: {
              filename: "@@user1\\music\\Wrong.mp3",
              size: 5_000_000,
              username: "user1",
              bitRate: 128,
            },
            score: 0.2,
          },
        ],
        diagnostics: "best score too low",
        strategy: undefined,
        strategyLog: [{ label: "full", query: "Artist Title", resultCount: 1 }],
      });

      const job = makeJob({
        type: "search",
        payload: JSON.stringify({
          trackId: trackIds[0],
          playlistId,
          title: "Title",
          artist: "Artist",
          durationMs: 200_000,
          queryIndex: 0,
        }),
      });

      await handleSearch(job, TEST_CONFIG);

      const updated = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, job.id))
        .get();
      expect(updated!.status).toBe("failed");
    });

    it("fails when all strategies exhausted (queryIndex >= strategies.length)", async () => {
      const job = makeJob({
        type: "search",
        payload: JSON.stringify({
          trackId: "t1",
          playlistId: "p1",
          title: "Title",
          artist: "Artist",
          durationMs: 200_000,
          queryIndex: 10, // way past the 2 mock strategies
        }),
      });

      await handleSearch(job, TEST_CONFIG);

      const updated = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, job.id))
        .get();
      expect(updated!.status).toBe("failed");
      expect(updated!.error).toContain("strategies exhausted");
    });
  });

  // =========================================================================
  // spotify-sync handler
  // =========================================================================
  describe("handleSpotifySync", () => {
    it("fetches playlist and creates lexicon_match child job", async () => {
      const { playlistId } = seedPlaylist("My Playlist", [
        { title: "T1", artist: "A1" },
      ]);

      const job = makeJob({
        type: "spotify_sync",
        payload: JSON.stringify({ playlistId }),
      });

      await handleSpotifySync(job, TEST_CONFIG);

      // Spotify sync should have been called
      expect(mockGetPlaylistTracks).toHaveBeenCalled();

      // Job should be completed
      const updated = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, job.id))
        .get();
      expect(updated!.status).toBe("done");

      const result = JSON.parse(updated!.result!);
      expect(result.playlistName).toBe("My Playlist");

      // A lexicon_match job should have been created
      const matchJobs = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.type, "lexicon_match"))
        .all();
      expect(matchJobs.length).toBe(1);
      expect(matchJobs[0].parentJobId).toBe(job.id);

      const matchPayload = JSON.parse(matchJobs[0].payload!);
      expect(matchPayload.playlistId).toBe(playlistId);
      expect(matchPayload.playlistName).toBe("My Playlist");
    });

    it("throws when playlist not found", async () => {
      const job = makeJob({
        type: "spotify_sync",
        payload: JSON.stringify({ playlistId: "nonexistent" }),
      });

      await expect(handleSpotifySync(job, TEST_CONFIG)).rejects.toThrow(
        "Playlist not found: nonexistent",
      );
    });

    it("skips Spotify API call when playlist has no spotifyId", async () => {
      const playlistId = crypto.randomUUID();
      const now = Date.now();
      testDb
        .insert(schema.playlists)
        .values({
          id: playlistId,
          spotifyId: null,
          name: "Local Only",
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const job = makeJob({
        type: "spotify_sync",
        payload: JSON.stringify({ playlistId }),
      });

      await handleSpotifySync(job, TEST_CONFIG);

      // Spotify API should NOT have been called
      expect(mockGetPlaylistTracks).not.toHaveBeenCalled();

      // But a lexicon_match job should still be created
      const matchJobs = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.type, "lexicon_match"))
        .all();
      expect(matchJobs.length).toBe(1);
    });
  });

  // =========================================================================
  // orphan-rescue handler
  // =========================================================================
  describe("handleOrphanRescue", () => {
    function mockDirent(name: string, isDir: boolean, isFile: boolean) {
      return {
        name,
        isDirectory: () => isDir,
        isFile: () => isFile,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isFIFO: () => false,
        isSocket: () => false,
        isSymbolicLink: () => false,
        path: "",
        parentPath: "",
      };
    }

    it("completes with scanned:0 when download dir has no audio files", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([]);

      const job = makeJob({ type: "orphan_rescue" });
      await handleOrphanRescue(job, TEST_CONFIG);

      const updated = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, job.id))
        .get();

      expect(updated!.status).toBe("done");
      const result = JSON.parse(updated!.result!);
      expect(result.scanned).toBe(0);
      expect(result.rescued).toBe(0);
    });

    it("matches orphan against downloading record by basename", async () => {
      const { trackIds, playlistId } = seedPlaylist("TestPL", [
        { title: "Song A", artist: "Artist A" },
      ]);

      // Use forward slashes for basename() compatibility on macOS
      seedDownload({
        trackId: trackIds[0],
        playlistId,
        slskdUsername: "user1",
        slskdFilename: "@@user1/music/Song A.flac",
        startedAt: Date.now(),
      });

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockImplementation(((path: string) => {
        if (path === "/tmp/slskd") {
          return [mockDirent("Song A.flac", false, true)];
        }
        if (path === "/tmp/test-dl") {
          return [];
        }
        return [];
      }) as typeof readdirSync);

      mockCheckFileStable.mockResolvedValue(true);
      mockMoveToPlaylistFolder.mockReturnValue("/tmp/test-dl/TestPL/Song A.flac");

      const job = makeJob({ type: "orphan_rescue" });
      await handleOrphanRescue(job, TEST_CONFIG);

      const updated = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, job.id))
        .get();

      const result = JSON.parse(updated!.result!);
      expect(result.scanned).toBe(1);
      expect(result.rescued).toBe(1);

      const dl = testDb.select().from(schema.downloads).all();
      expect(dl[0].status).toBe("done");
      expect(dl[0].filePath).toBe("/tmp/test-dl/TestPL/Song A.flac");
    });

    it("fuzzy matches orphan against wishlisted tracks", async () => {
      const { trackIds, playlistId } = seedPlaylist("TestPL", [
        { title: "Song B", artist: "Artist B" },
      ]);

      seedDownload({
        trackId: trackIds[0],
        playlistId,
        status: "wishlisted",
        startedAt: Date.now(),
      });

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockImplementation(((path: string) => {
        if (path === "/tmp/slskd") {
          return [mockDirent("Artist B - Song B.flac", false, true)];
        }
        if (path === "/tmp/test-dl") {
          return [];
        }
        return [];
      }) as typeof readdirSync);

      mockFuzzyMatch.mockReturnValue([
        {
          candidate: { title: "Song B", artist: "Artist B", durationMs: 200_000 },
          score: 0.92,
          confidence: "high",
          method: "fuzzy",
        },
      ]);

      mockCheckFileStable.mockResolvedValue(true);
      mockMoveToPlaylistFolder.mockReturnValue("/tmp/test-dl/TestPL/Song B.flac");

      const job = makeJob({ type: "orphan_rescue" });
      await handleOrphanRescue(job, TEST_CONFIG);

      const updated = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, job.id))
        .get();

      const result = JSON.parse(updated!.result!);
      expect(result.rescued).toBe(1);

      const dl = testDb
        .select()
        .from(schema.downloads)
        .where(eq(schema.downloads.trackId, trackIds[0]))
        .get();
      expect(dl!.status).toBe("done");
    });

    it("skips files already tracked as done", async () => {
      const { trackIds, playlistId } = seedPlaylist("TestPL", [
        { title: "Done Song", artist: "Artist" },
      ]);

      seedDownload({
        trackId: trackIds[0],
        playlistId,
        status: "done",
        filePath: "/tmp/slskd/Done Song.flac",
      });

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockImplementation(((path: string) => {
        if (path === "/tmp/slskd") {
          return [mockDirent("Done Song.flac", false, true)];
        }
        if (path === "/tmp/test-dl") {
          return [];
        }
        return [];
      }) as typeof readdirSync);

      const job = makeJob({ type: "orphan_rescue" });
      await handleOrphanRescue(job, TEST_CONFIG);

      const updated = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, job.id))
        .get();

      const result = JSON.parse(updated!.result!);
      expect(result.scanned).toBe(1);
      expect(result.rescued).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it("cleans up empty directories after rescue", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockImplementation(((path: string) => {
        if (path === "/tmp/slskd") {
          return [mockDirent("Orphan.flac", false, true)];
        }
        if (path === "/tmp/test-dl") {
          return [];
        }
        return [];
      }) as typeof readdirSync);

      mockCleanupEmptyDirs.mockReturnValue(3);

      const job = makeJob({ type: "orphan_rescue" });
      await handleOrphanRescue(job, TEST_CONFIG);

      expect(mockCleanupEmptyDirs).toHaveBeenCalled();

      const updated = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, job.id))
        .get();

      const result = JSON.parse(updated!.result!);
      expect(result.dirsRemoved).toBe(3);
    });

    it("completes with correct counts", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([]);

      const job = makeJob({ type: "orphan_rescue" });
      await handleOrphanRescue(job, TEST_CONFIG);

      const updated = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, job.id))
        .get();

      expect(updated!.status).toBe("done");
      const result = JSON.parse(updated!.result!);
      expect(result).toHaveProperty("scanned");
      expect(result).toHaveProperty("rescued");
      expect(result).toHaveProperty("unmatched");
      expect(result).toHaveProperty("errors");
    });
  });

  // =========================================================================
  // transfer-event handlers
  // =========================================================================
  describe("handleTransferCompleted", () => {
    const baseTransfer = {
      id: "t1",
      size: 50_000_000,
      state: "Completed",
      bytesTransferred: 50_000_000,
      bytesRemaining: 0,
      averageSpeed: 1000,
      percentComplete: 100,
      elapsedTime: 5000,
      remainingTime: 0,
      startTime: null,
      endTime: null,
      exception: null,
      direction: 0 as number,
      token: 1234,
      placeInQueue: null,
    };

    it("finds matching download, validates, moves, marks done", async () => {
      const { trackIds, playlistId } = seedPlaylist("TestPL", [
        { title: "Song A", artist: "Artist A" },
      ]);

      seedDownload({
        trackId: trackIds[0],
        playlistId,
        slskdUsername: "user1",
        slskdFilename: "@@user1\\music\\Song A.flac",
        startedAt: Date.now(),
      });

      mockFindDownloadedFile.mockReturnValue("/tmp/slskd/Song A.flac");
      mockCheckFileStable.mockResolvedValue(true);
      mockValidateDownload.mockResolvedValue(true);
      mockMoveToPlaylistFolder.mockReturnValue("/tmp/test-dl/TestPL/Song A.flac");

      await handleTransferCompleted(
        { ...baseTransfer, username: "user1", filename: "@@user1\\music\\Song A.flac" },
        TEST_CONFIG,
      );

      const dl = testDb.select().from(schema.downloads).all();
      expect(dl[0].status).toBe("done");
      expect(dl[0].filePath).toBe("/tmp/test-dl/TestPL/Song A.flac");
    });

    it("ignores non-download transfers (uploads)", async () => {
      await handleTransferCompleted(
        { ...baseTransfer, username: "user1", filename: "@@user1\\music\\Song A.flac", direction: 1 },
        TEST_CONFIG,
      );

      expect(mockFindDownloadedFile).not.toHaveBeenCalled();
    });

    it("handles no matching download gracefully", async () => {
      await handleTransferCompleted(
        { ...baseTransfer, username: "user1", filename: "@@user1\\music\\Unknown.flac" },
        TEST_CONFIG,
      );

      expect(mockFindDownloadedFile).not.toHaveBeenCalled();
      expect(mockMoveToPlaylistFolder).not.toHaveBeenCalled();
    });
  });

  describe("handleTransferFailed", () => {
    const baseFailedTransfer = {
      id: "t1",
      size: 50_000_000,
      state: "Errored",
      bytesTransferred: 0,
      bytesRemaining: 50_000_000,
      averageSpeed: 0,
      percentComplete: 0,
      elapsedTime: null,
      remainingTime: null,
      startTime: null,
      endTime: null,
      direction: 0 as number,
      token: 1234,
      placeInQueue: null,
    };

    it("marks download as failed", async () => {
      const { trackIds, playlistId } = seedPlaylist("TestPL", [
        { title: "Song A", artist: "Artist A" },
      ]);

      seedDownload({
        trackId: trackIds[0],
        playlistId,
        slskdUsername: "user1",
        slskdFilename: "@@user1\\music\\Song A.flac",
        startedAt: Date.now(),
      });

      await handleTransferFailed(
        { ...baseFailedTransfer, username: "user1", filename: "@@user1\\music\\Song A.flac", exception: "Connection reset" },
        TEST_CONFIG,
      );

      const dl = testDb.select().from(schema.downloads).all();
      expect(dl[0].status).toBe("failed");
      expect(dl[0].error).toContain("Connection reset");
    });

    it("creates retry search job", async () => {
      const { trackIds, playlistId } = seedPlaylist("TestPL", [
        { title: "Song A", artist: "Artist A" },
      ]);

      seedDownload({
        trackId: trackIds[0],
        playlistId,
        slskdUsername: "user1",
        slskdFilename: "@@user1\\music\\Song A.flac",
        startedAt: Date.now(),
      });

      await handleTransferFailed(
        { ...baseFailedTransfer, username: "user1", filename: "@@user1\\music\\Song A.flac", exception: "Timeout" },
        TEST_CONFIG,
      );

      const searchJobs = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.type, "search"))
        .all();

      expect(searchJobs.length).toBe(1);
      const payload = JSON.parse(searchJobs[0].payload!);
      expect(payload.trackId).toBe(trackIds[0]);
      expect(payload.playlistId).toBe(playlistId);
    });
  });

  // =========================================================================
  // validate handler
  // =========================================================================
  describe("handleValidate", () => {
    it("returns success for valid file", async () => {
      mockValidateDownload.mockResolvedValue(true);

      const job = makeJob({
        type: "validate",
        payload: JSON.stringify({
          trackId: "t1",
          filePath: "/tmp/slskd/Song.flac",
          title: "Song",
          artist: "Artist",
          durationMs: 200_000,
        }),
      });

      await handleValidate(job, TEST_CONFIG);

      const updated = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, job.id))
        .get();

      expect(updated!.status).toBe("done");
      const result = JSON.parse(updated!.result!);
      expect(result.valid).toBe(true);
      expect(result.trackId).toBe("t1");
    });

    it("returns failure for corrupt file (validation fails)", async () => {
      mockValidateDownload.mockResolvedValue(false);

      const job = makeJob({
        type: "validate",
        payload: JSON.stringify({
          trackId: "t1",
          filePath: "/tmp/slskd/Corrupt.flac",
          title: "Song",
          artist: "Artist",
          durationMs: 200_000,
        }),
      });

      await expect(handleValidate(job, TEST_CONFIG)).rejects.toThrow(
        "File failed metadata validation",
      );
    });

    it("returns failure for wrong track (validation fails)", async () => {
      mockValidateDownload.mockResolvedValue(false);

      const job = makeJob({
        type: "validate",
        payload: JSON.stringify({
          trackId: "t1",
          filePath: "/tmp/slskd/WrongTrack.flac",
          title: "Expected Song",
          artist: "Expected Artist",
          durationMs: 200_000,
        }),
      });

      await expect(handleValidate(job, TEST_CONFIG)).rejects.toThrow(
        "File failed metadata validation",
      );
    });

    it("passes file info to validateDownload when provided", async () => {
      mockValidateDownload.mockResolvedValue(true);

      const job = makeJob({
        type: "validate",
        payload: JSON.stringify({
          trackId: "t1",
          filePath: "/tmp/slskd/Song.flac",
          title: "Song",
          artist: "Artist",
          file: {
            filename: "@@user1\\music\\Song.flac",
            username: "user1",
            size: 50_000_000,
          },
        }),
      });

      await handleValidate(job, TEST_CONFIG);

      expect(mockValidateDownload).toHaveBeenCalledWith(
        "/tmp/slskd/Song.flac",
        expect.objectContaining({ title: "Song", artist: "Artist" }),
        "t1",
        expect.objectContaining({ filename: "@@user1\\music\\Song.flac", username: "user1" }),
      );
    });
  });

  // =========================================================================
  // wishlist-run handler
  // =========================================================================
  describe("handleWishlistRun", () => {
    it("skips creating search job if one already exists for that track (dedup)", async () => {
      const { trackIds, playlistId } = seedPlaylist("TestPL", [
        { title: "Song A", artist: "Artist A" },
      ]);

      seedDownload({
        trackId: trackIds[0],
        playlistId,
        status: "wishlisted",
        wishlistRetries: 0,
        nextRetryAt: Date.now() - 10_000,
      });

      makeJob({
        type: "search",
        status: "queued",
        payload: JSON.stringify({ trackId: trackIds[0] }),
      });

      const job = makeJob({ type: "wishlist_run" });
      await handleWishlistRun(job, TEST_CONFIG);

      const searchJobs = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.type, "search"))
        .all();

      expect(searchJobs.length).toBe(1);
    });

    it("gives up after max retries", async () => {
      const { trackIds, playlistId } = seedPlaylist("TestPL", [
        { title: "Song A", artist: "Artist A" },
      ]);

      seedDownload({
        trackId: trackIds[0],
        playlistId,
        status: "wishlisted",
        wishlistRetries: 5,
        nextRetryAt: Date.now() - 10_000,
      });

      const job = makeJob({ type: "wishlist_run" });
      await handleWishlistRun(job, TEST_CONFIG);

      const dl = testDb.select().from(schema.downloads).all();
      expect(dl[0].status).toBe("failed");
      expect(dl[0].error).toContain("Gave up");

      const updated = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, job.id))
        .get();
      const result = JSON.parse(updated!.result!);
      expect(result.givenUp).toBe(1);
      expect(result.searchesCreated).toBe(0);
    });

    it("creates search job for wishlisted download ready for retry", async () => {
      const { trackIds, playlistId } = seedPlaylist("TestPL", [
        { title: "Song A", artist: "Artist A" },
      ]);

      seedDownload({
        trackId: trackIds[0],
        playlistId,
        status: "wishlisted",
        wishlistRetries: 1,
        nextRetryAt: Date.now() - 10_000,
      });

      const job = makeJob({ type: "wishlist_run" });
      await handleWishlistRun(job, TEST_CONFIG);

      const searchJobs = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.type, "search"))
        .all();

      expect(searchJobs.length).toBe(1);
      const payload = JSON.parse(searchJobs[0].payload!);
      expect(payload.trackId).toBe(trackIds[0]);
      expect(payload.title).toBe("Song A");

      const updated = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, job.id))
        .get();
      const result = JSON.parse(updated!.result!);
      expect(result.searchesCreated).toBe(1);
    });
  });
});
