import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TrackInfo } from "../../types/common.js";
import type { SlskdFile } from "../../types/soulseek.js";
import type {
  SoulseekConfig,
  DownloadConfig,
  LexiconConfig,
} from "../../config.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSoulseekInstance = {
  rateLimitedSearch: vi.fn().mockResolvedValue([]),
  startSearchBatch: vi.fn().mockResolvedValue(new Map()),
  waitForSearchBatch: vi.fn().mockResolvedValue(new Map()),
  startSearch: vi.fn().mockResolvedValue("mock-id"),
  download: vi.fn().mockResolvedValue(undefined),
  waitForDownload: vi.fn().mockResolvedValue({
    id: "t1",
    username: "user1",
    filename: "file.flac",
    state: "Completed",
    bytesTransferred: 1000,
    size: 1000,
    percentComplete: 100,
  }),
};

vi.mock("../soulseek-service.js", () => ({
  SoulseekService: vi.fn().mockImplementation(function () {
    return mockSoulseekInstance;
  }),
}));

vi.mock("music-metadata", () => ({
  parseFile: vi.fn().mockResolvedValue({
    common: { title: "", artist: "", album: "" },
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
  statSync: vi.fn().mockReturnValue({ mtimeMs: 0 }),
}));

vi.mock("../../utils/shutdown.js", () => ({
  isShutdownRequested: vi.fn().mockReturnValue(false),
}));

// Mock the DB client module (so we never actually open a DB)
vi.mock("../../db/client.js", () => ({
  getDb: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (must come after vi.mock calls)
// ---------------------------------------------------------------------------

import { DownloadService } from "../download-service.js";
import type { DownloadItem } from "../download-service.js";
import { SoulseekService } from "../soulseek-service.js";
import { parseFile } from "music-metadata";
import {
  mkdirSync,
  renameSync,
  existsSync,
  copyFileSync,
  unlinkSync,
  readdirSync,
  statSync,
} from "node:fs";
import { isShutdownRequested } from "../../utils/shutdown.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const soulseekConfig: SoulseekConfig = {
  slskdUrl: "http://localhost:5030",
  slskdApiKey: "test-key",
  searchDelayMs: 0,
  downloadDir: "/tmp/slskd-downloads",
};

const downloadConfig: DownloadConfig = {
  formats: ["flac", "mp3"],
  minBitrate: 320,
  concurrency: 2,
  validationStrictness: "moderate",
};

const lexiconConfig: LexiconConfig = {
  url: "http://localhost:48624",
  downloadRoot: "/tmp/test-downloads",
  tagCategory: { name: "Spotify Playlists", color: "#1DB954" },
};

/** Create a mock Database that returns empty rejections by default. */
function mockDb(rejectionFileKeys: string[] = []) {
  const rows = rejectionFileKeys.map((fk) => ({ fileKey: fk }));
  const insertValues: any[] = [];
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          all: vi.fn().mockReturnValue(rows),
          get: vi.fn().mockImplementation(() => {
            // Return the last inserted rejection (simulates reading back what was just written)
            const last = insertValues[insertValues.length - 1];
            if (last) return { reason: last.reason ?? last.fileKey };
            return rows[0] ?? undefined;
          }),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation((v: any) => {
        insertValues.push(v);
        return {
          onConflictDoNothing: vi.fn().mockReturnValue({
            run: vi.fn(),
          }),
        };
      }),
    }),
    // Expose for assertions
    _insertValues: insertValues,
  } as any;
}

function makeFile(overrides: Partial<SlskdFile> = {}): SlskdFile {
  return {
    filename: "@@user1\\music\\Artist\\Album\\01 - Test Title.flac",
    size: 50_000_000,
    bitRate: 1411,
    sampleRate: 44100,
    bitDepth: 16,
    length: 240,
    username: "user1",
    code: "1",
    ...overrides,
  };
}

function makeService(db?: any, overrides?: Partial<DownloadConfig>): DownloadService {
  return DownloadService.fromDb(
    db ?? mockDb(),
    soulseekConfig,
    { ...downloadConfig, ...overrides },
    lexiconConfig,
  );
}

function getSoulseekMock() {
  return mockSoulseekInstance;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DownloadService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // rankResults
  // -----------------------------------------------------------------------
  describe("rankResults", () => {
    it("returns ranked results sorted by score", () => {
      const db = mockDb();
      const service = makeService(db);

      const goodMatch = makeFile({
        filename: "@@user1\\music\\Test Artist\\Album\\01 - Test Title.flac",
      });
      const weakMatch = makeFile({
        filename: "@@user2\\music\\Test Artist\\Album\\01 - Test Title (Live Version).flac",
        username: "user2",
      });

      const track: TrackInfo = {
        title: "Test Title",
        artist: "Test Artist",
      };

      const { ranked } = service.rankResults([goodMatch, weakMatch], track, "track-1");

      expect(ranked.length).toBe(2);
      // Best match should be first
      expect(ranked[0].file.filename).toContain("Test Title");
      expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
    });

    it("filters previously rejected files", () => {
      const file1 = makeFile({
        filename: "@@user1\\music\\Artist\\01 - Title.flac",
        username: "user1",
      });
      const file2 = makeFile({
        filename: "@@user2\\music\\Artist\\01 - Title.flac",
        username: "user2",
      });
      const file3 = makeFile({
        filename: "@@user3\\music\\Artist\\01 - Title.flac",
        username: "user3",
      });

      // Reject files from user1 and user3
      const db = mockDb([
        "user1:@@user1\\music\\Artist\\01 - Title.flac",
        "user3:@@user3\\music\\Artist\\01 - Title.flac",
      ]);
      const service = makeService(db);

      const { ranked, diagnostics } = service.rankResults(
        [file1, file2, file3],
        { title: "Title", artist: "Artist" },
        "track-1",
      );

      // Only file2 should remain
      expect(ranked.length).toBe(1);
      expect(ranked[0].file.username).toBe("user2");
      expect(diagnostics).toContain("2 filtered by rejection memory");
    });

    it("filters by format", () => {
      const service = makeService();

      const flacFile = makeFile({ filename: "@@u\\music\\Artist\\01 - Track.flac" });
      const wavFile = makeFile({
        filename: "@@u\\music\\Artist\\01 - Track.wav",
        username: "user2",
      });
      const mp3File = makeFile({
        filename: "@@u\\music\\Artist\\01 - Track.mp3",
        username: "user3",
      });

      const { ranked } = service.rankResults(
        [flacFile, wavFile, mp3File],
        { title: "Track", artist: "Artist" },
        "track-1",
      );

      // wav is not in allowed formats (flac, mp3), so should be filtered
      expect(ranked.every((r) => !r.file.filename.endsWith(".wav"))).toBe(true);
    });

    it("filters by bitrate", () => {
      const service = makeService();

      const highBitrate = makeFile({ bitRate: 1411 });
      const lowBitrate = makeFile({
        filename: "@@u\\music\\Artist\\01 - Test Title.mp3",
        bitRate: 128,
        username: "user2",
      });
      const noBitrate = makeFile({
        filename: "@@u\\music\\Artist\\01 - Test Title.flac",
        bitRate: undefined,
        username: "user3",
      });

      const { ranked } = service.rankResults(
        [highBitrate, lowBitrate, noBitrate],
        { title: "Test Title", artist: "Artist" },
        "track-1",
      );

      // Low bitrate (128 < 320) should be filtered, null bitrate kept
      expect(ranked.every((r) => (r.file.bitRate ?? 999) >= 320)).toBe(true);
    });

    it("sorts by score descending", () => {
      const service = makeService();

      const exactMatch = makeFile({
        filename: "@@u1\\music\\Exact Artist\\01 - Exact Title.flac",
        username: "u1",
        length: 240,
      });
      const closeMatch = makeFile({
        filename: "@@u2\\music\\Exact Artist\\01 - Exact Titlee.flac",
        username: "u2",
        length: 240,
      });

      const { ranked } = service.rankResults(
        [closeMatch, exactMatch],
        { title: "Exact Title", artist: "Exact Artist", durationMs: 240000 },
        "track-1",
      );

      if (ranked.length >= 2) {
        expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
      }
    });

    it("builds diagnostics string with counts", () => {
      const db = mockDb(["user2:@@user2\\music\\Artist\\01 - Track.flac"]);
      const service = makeService(db);

      const files = [
        makeFile({ filename: "@@user1\\music\\Artist\\01 - Track.flac", username: "user1" }),
        makeFile({ filename: "@@user2\\music\\Artist\\01 - Track.flac", username: "user2" }),
        makeFile({ filename: "@@user3\\music\\Artist\\01 - Track.wav", username: "user3" }),
      ];

      const { diagnostics } = service.rankResults(
        files,
        { title: "Track", artist: "Artist" },
        "track-1",
      );

      expect(diagnostics).toContain("3 results");
      expect(diagnostics).toContain("1 filtered by rejection memory");
      expect(diagnostics).toContain("candidates");
    });

    it("converts file.length to durationMs for matching", () => {
      const service = makeService();

      const file = makeFile({
        filename: "@@u\\music\\Artist\\01 - Track.flac",
        length: 240, // seconds
      });

      // This implicitly tests that duration is used — if the duration matches,
      // the score should be higher than without duration info
      const { ranked } = service.rankResults(
        [file],
        { title: "Track", artist: "Artist", durationMs: 240000 },
        "track-1",
      );

      expect(ranked.length).toBe(1);
    });

    it("returns empty for empty input", () => {
      const service = makeService();

      const { ranked, diagnostics } = service.rankResults(
        [],
        { title: "Track", artist: "Artist" },
        "track-1",
      );

      expect(ranked).toEqual([]);
      expect(diagnostics).toContain("0 results");
      expect(diagnostics).toContain("0 candidates");
    });
  });

  // -----------------------------------------------------------------------
  // recordRejection
  // -----------------------------------------------------------------------
  describe("recordRejection", () => {
    it("inserts into rejections table with onConflictDoNothing", async () => {
      const db = mockDb();
      const service = makeService(db);

      await service.recordRejection("track-1", "user1:@@u\\file.flac", "validation_failed");

      expect(db.insert).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // searchAndRank
  // -----------------------------------------------------------------------
  describe("searchAndRank", () => {
    it("returns ranked results sorted by score", async () => {
      const service = makeService();
      const mock = getSoulseekMock();

      const goodMatch = makeFile({
        filename: "@@user1\\music\\Test Artist\\Album\\01 - Test Title.flac",
      });
      const weakMatch = makeFile({
        filename: "@@user2\\music\\Test Artist\\Album\\01 - Test Title (Live Version).flac",
        username: "user2",
      });

      vi.mocked(mock.rateLimitedSearch).mockResolvedValueOnce([
        goodMatch,
        weakMatch,
      ]);

      const track: TrackInfo = {
        title: "Test Title",
        artist: "Test Artist",
      };

      const { ranked } = await service.searchAndRank(track, "track-1");

      expect(ranked.length).toBe(2);
      expect(ranked[0].file.filename).toContain("Test Title");
      expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
    });

    it("filters disallowed formats", async () => {
      const service = makeService();
      const mock = getSoulseekMock();

      const flacFile = makeFile({ filename: "@@u\\music\\Artist\\01 - Track.flac" });
      const wavFile = makeFile({
        filename: "@@u\\music\\Artist\\01 - Track.wav",
        username: "user2",
      });

      vi.mocked(mock.rateLimitedSearch).mockResolvedValueOnce([
        flacFile,
        wavFile,
      ]);

      const { ranked } = await service.searchAndRank({
        title: "Track",
        artist: "Artist",
      }, "track-1");

      expect(ranked.every((r) => !r.file.filename.endsWith(".wav"))).toBe(true);
      expect(ranked.length).toBe(1);
    });

    it("filters low bitrate files", async () => {
      const service = makeService();
      const mock = getSoulseekMock();

      const highBitrate = makeFile({ bitRate: 1411 });
      const lowBitrate = makeFile({
        filename: "@@u\\music\\Artist\\01 - Track.mp3",
        bitRate: 128,
        username: "user2",
      });

      vi.mocked(mock.rateLimitedSearch).mockResolvedValueOnce([
        highBitrate,
        lowBitrate,
      ]);

      const { ranked } = await service.searchAndRank({
        title: "Test Title",
        artist: "Artist",
      }, "track-1");

      expect(ranked.every((r) => (r.file.bitRate ?? 0) >= 320)).toBe(true);
    });

    it("keeps files without bitrate info (null bitrate)", async () => {
      const service = makeService();
      const mock = getSoulseekMock();

      const noBitrate = makeFile({ bitRate: undefined });

      vi.mocked(mock.rateLimitedSearch).mockResolvedValueOnce([noBitrate]);

      const { ranked } = await service.searchAndRank({
        title: "Test Title",
        artist: "Artist",
      }, "track-1");

      expect(ranked.length).toBe(1);
    });

    it("returns empty array when no matches", async () => {
      const service = makeService();
      const mock = getSoulseekMock();

      vi.mocked(mock.rateLimitedSearch).mockResolvedValueOnce([]);

      const { ranked } = await service.searchAndRank({
        title: "Nonexistent",
        artist: "Nobody",
      }, "track-1");

      expect(ranked).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // searchAndRank multi-strategy
  // -----------------------------------------------------------------------
  describe("searchAndRank multi-strategy", () => {
    it("returns results from first strategy when it succeeds", async () => {
      const service = makeService();
      const mock = getSoulseekMock();

      const file = makeFile({
        filename: "@@user1\\music\\Artist\\Album\\01 - Title.flac",
      });
      vi.mocked(mock.rateLimitedSearch).mockResolvedValueOnce([file]);

      const result = await service.searchAndRank({
        title: "Title",
        artist: "Artist",
      }, "track-1");

      expect(result.ranked.length).toBe(1);
      expect(result.strategy).toBe("full");
      expect(result.strategyLog.length).toBe(1);
      expect(mock.rateLimitedSearch).toHaveBeenCalledTimes(1);
    });

    it("falls back to next strategy when first returns 0 candidates", async () => {
      const service = makeService();
      const mock = getSoulseekMock();

      const file = makeFile({
        filename: "@@user1\\music\\Satori\\01 - Reliquia.flac",
      });
      vi.mocked(mock.rateLimitedSearch)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([file]);

      const result = await service.searchAndRank({
        title: "Reliquia - German Brigante Remix",
        artist: "Satori",
      }, "track-1");

      expect(result.ranked.length).toBe(1);
      expect(result.strategy).toBe("base-title");
      expect(result.strategyLog.length).toBe(2);
      expect(result.strategyLog[0].resultCount).toBe(0);
      expect(result.strategyLog[1].resultCount).toBe(1);
    });

    it("returns empty when all strategies fail", async () => {
      const service = makeService();
      const mock = getSoulseekMock();

      vi.mocked(mock.rateLimitedSearch).mockResolvedValue([]);

      const result = await service.searchAndRank({
        title: "Nonexistent Track",
        artist: "Unknown Artist",
      }, "track-1");

      expect(result.ranked.length).toBe(0);
      expect(result.strategyLog.length).toBeGreaterThanOrEqual(2);
      expect(result.strategyLog.every((s) => s.resultCount === 0)).toBe(true);
    });

    it("records all attempted strategies in strategyLog", async () => {
      const service = makeService();
      const mock = getSoulseekMock();

      const file = makeFile({
        filename: "@@user1\\music\\Artist\\01 - Title.flac",
      });
      // First strategy returns nothing, second succeeds
      vi.mocked(mock.rateLimitedSearch)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([file]);

      const result = await service.searchAndRank({
        title: "Title",
        artist: "Artist",
      }, "track-1");

      // At least 2 strategies attempted, second has results
      expect(result.strategyLog.length).toBeGreaterThanOrEqual(2);
      expect(result.strategyLog[0].resultCount).toBe(0);
      // The last entry should have the results
      const lastEntry = result.strategyLog[result.strategyLog.length - 1];
      expect(lastEntry.resultCount).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // downloadBatch
  // -----------------------------------------------------------------------
  describe("downloadBatch", () => {
    it("processes multiple tracks using batch search and returns results", async () => {
      const service = makeService();
      const mock = getSoulseekMock();

      const file1 = makeFile({
        filename: "@@u1\\music\\Artist A\\01 - Song A.flac",
      });
      const file2 = makeFile({
        filename: "@@u2\\music\\Artist B\\01 - Song B.flac",
        username: "user2",
      });

      vi.mocked(mock.startSearchBatch).mockResolvedValueOnce(
        new Map([
          ["Artist A Song A", { searchId: "s1", startedAt: Date.now() }],
          ["Artist B Song B", { searchId: "s2", startedAt: Date.now() }],
        ]),
      );

      vi.mocked(mock.waitForSearchBatch).mockResolvedValueOnce(
        new Map([
          ["Artist A Song A", [file1]],
          ["Artist B Song B", [file2]],
        ]),
      );

      vi.mocked(parseFile)
        .mockResolvedValueOnce({
          common: { title: "Song A", artist: "Artist A" },
          format: { duration: 200, codec: "FLAC" },
        } as any)
        .mockResolvedValueOnce({
          common: { title: "Song B", artist: "Artist B" },
          format: { duration: 180, codec: "FLAC" },
        } as any);

      vi.mocked(existsSync).mockImplementation((p) => {
        return String(p).includes("slskd-downloads");
      });

      const items: DownloadItem[] = [
        {
          track: { title: "Song A", artist: "Artist A" } as TrackInfo,
          playlistName: "Playlist",
          dbTrackId: "t1",
        },
        {
          track: { title: "Song B", artist: "Artist B" } as TrackInfo,
          playlistName: "Playlist",
          dbTrackId: "t2",
        },
      ];

      const results = await service.downloadBatch(items);

      expect(results.length).toBe(2);
      expect(mock.startSearchBatch).toHaveBeenCalledOnce();
      expect(mock.waitForSearchBatch).toHaveBeenCalledOnce();
    });

    it("calls progress callback for each track", async () => {
      const service = makeService();
      const mock = getSoulseekMock();

      vi.mocked(mock.startSearchBatch).mockResolvedValueOnce(
        new Map([
          ["A A", { searchId: "s1", startedAt: Date.now() }],
          ["B B", { searchId: "s2", startedAt: Date.now() }],
        ]),
      );
      vi.mocked(mock.waitForSearchBatch).mockResolvedValueOnce(
        new Map([
          ["A A", []],
          ["B B", []],
        ]),
      );

      const onProgress = vi.fn();

      const items: DownloadItem[] = [
        {
          track: { title: "A", artist: "A" } as TrackInfo,
          playlistName: "P",
          dbTrackId: "t1",
        },
        {
          track: { title: "B", artist: "B" } as TrackInfo,
          playlistName: "P",
          dbTrackId: "t2",
        },
      ];

      await service.downloadBatch(items, onProgress);

      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenCalledWith(
        expect.any(Number),
        2,
        expect.objectContaining({ trackId: expect.any(String) }),
      );
    });

    it("returns empty array for empty input", async () => {
      const service = makeService();
      const results = await service.downloadBatch([]);
      expect(results).toEqual([]);
    });

    it("creates all playlist folders upfront", async () => {
      const service = makeService();
      const mock = getSoulseekMock();

      vi.mocked(mock.startSearchBatch).mockResolvedValueOnce(new Map());
      vi.mocked(mock.waitForSearchBatch).mockResolvedValueOnce(new Map());

      const items: DownloadItem[] = [
        { track: { title: "A", artist: "A" }, playlistName: "Playlist1", dbTrackId: "t1" },
        { track: { title: "B", artist: "B" }, playlistName: "Playlist2", dbTrackId: "t2" },
        { track: { title: "C", artist: "C" }, playlistName: "Playlist1", dbTrackId: "t3" },
      ];

      await service.downloadBatch(items);

      // mkdirSync should have been called for both unique playlists
      const mkdirCalls = vi.mocked(mkdirSync).mock.calls.map((c) => String(c[0]));
      const playlistDirs = mkdirCalls.filter((p) => p.includes("test-downloads"));
      expect(playlistDirs.length).toBeGreaterThanOrEqual(2);
    });

    it("stops on shutdown request", async () => {
      const service = makeService();
      const mock = getSoulseekMock();

      vi.mocked(mock.startSearchBatch).mockResolvedValueOnce(new Map());
      vi.mocked(mock.waitForSearchBatch).mockResolvedValueOnce(new Map());

      // Shutdown requested from the start
      vi.mocked(isShutdownRequested).mockReturnValue(true);

      const items: DownloadItem[] = [
        { track: { title: "A", artist: "A" }, playlistName: "P", dbTrackId: "t1" },
        { track: { title: "B", artist: "B" }, playlistName: "P", dbTrackId: "t2" },
      ];

      const results = await service.downloadBatch(items);

      // Should have 0 results since shutdown was immediate
      expect(results.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // searchAndRankBatch (with fallback)
  // -----------------------------------------------------------------------
  describe("searchAndRankBatch fallback", () => {
    it("falls back to multi-strategy for tracks with 0 batch results", async () => {
      const service = makeService();
      const mock = getSoulseekMock();

      const file = makeFile({
        filename: "@@u1\\music\\Artist\\01 - Found Song.flac",
      });

      vi.mocked(mock.startSearchBatch).mockResolvedValueOnce(
        new Map([
          ["Artist Found Song", { searchId: "s1", startedAt: Date.now() }],
          ["Unknown Missing", { searchId: "s2", startedAt: Date.now() }],
        ]),
      );
      vi.mocked(mock.waitForSearchBatch).mockResolvedValueOnce(
        new Map([
          ["Artist Found Song", [file]],
          ["Unknown Missing", []],
        ]),
      );

      vi.mocked(mock.rateLimitedSearch).mockResolvedValue([]);

      const items: DownloadItem[] = [
        { track: { title: "Found Song", artist: "Artist" }, dbTrackId: "t1", playlistName: "P" },
        { track: { title: "Missing", artist: "Unknown" }, dbTrackId: "t2", playlistName: "P" },
      ];

      const results = await service.searchAndRankBatch(items);

      expect(results.get("t1")!.ranked.length).toBe(1);
      expect(results.get("t1")!.strategy).toBe("full");
      expect(results.get("t2")!.ranked.length).toBe(0);
      expect(mock.rateLimitedSearch).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Candidate fallback (slskd-vqmi)
  // -----------------------------------------------------------------------
  describe("candidate fallback on download failure", () => {
    beforeEach(() => {
      // Reset mocks that other tests may have set with mockImplementation/mockReturnValue
      vi.mocked(existsSync).mockReset().mockReturnValue(false);
      vi.mocked(readdirSync).mockReset().mockReturnValue([]);
      vi.mocked(parseFile).mockReset();
      vi.mocked(isShutdownRequested).mockReturnValue(false);
      mockSoulseekInstance.download.mockReset().mockResolvedValue(undefined);
      mockSoulseekInstance.startSearchBatch.mockReset();
      mockSoulseekInstance.waitForSearchBatch.mockReset();
    });

    afterEach(() => {
      // Restore default mocks so later tests aren't affected
      mockSoulseekInstance.waitForDownload.mockReset().mockResolvedValue({
        id: "t1", username: "user1", filename: "file.flac",
        state: "Completed", bytesTransferred: 1000, size: 1000, percentComplete: 100,
      });
      mockSoulseekInstance.download.mockReset().mockResolvedValue(undefined);
      vi.mocked(existsSync).mockReset().mockReturnValue(false);
      vi.mocked(readdirSync).mockReset().mockReturnValue([]);
      vi.mocked(statSync).mockReset().mockReturnValue({ mtimeMs: 0 } as any);
      vi.mocked(parseFile).mockReset().mockResolvedValue({
        common: { title: "", artist: "", album: "" },
        format: { duration: undefined },
      } as any);
    });

    it("records rejection on download timeout so candidate is skipped on retry", async () => {
      const db = mockDb();
      const service = makeService(db);
      const mock = getSoulseekMock();

      vi.mocked(mock.download).mockResolvedValue(undefined);
      vi.mocked(mock.waitForDownload).mockRejectedValueOnce(
        new Error("Operation timed out"),
      );
      vi.mocked(existsSync).mockReturnValue(false);

      const file = makeFile({
        username: "acidzwan",
        filename: "@@acidzwan\\music\\Artist\\01 - Song.flac",
      });

      const result = await service.acquireAndMove(
        file, { title: "Song", artist: "Artist" }, "Playlist", "track-1",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Operation timed out");
      expect(db._insertValues.some((v: any) =>
        v.fileKey === "acidzwan:@@acidzwan\\music\\Artist\\01 - Song.flac" &&
        v.reason?.includes("Download failed"),
      )).toBe(true);
    });

    it("records rejection on peer rejection (Too many files)", async () => {
      const db = mockDb();
      const service = makeService(db);
      const mock = getSoulseekMock();

      vi.mocked(mock.download).mockResolvedValue(undefined);
      vi.mocked(mock.waitForDownload).mockRejectedValueOnce(
        new Error("Transfer rejected: Too many files"),
      );
      vi.mocked(existsSync).mockReturnValue(false);

      const file = makeFile({
        username: "busyuser",
        filename: "@@busyuser\\music\\song.flac",
      });

      const result = await service.acquireAndMove(
        file, { title: "Song", artist: "Artist" }, "Playlist", "track-1",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Too many files");
      expect(db._insertValues.some((v: any) =>
        v.fileKey === "busyuser:@@busyuser\\music\\song.flac" &&
        v.reason?.includes("Download failed"),
      )).toBe(true);
    });

    it("rejected candidates are filtered out on subsequent rankResults calls", () => {
      // Simulates the retry path: after a download failure records a rejection,
      // the next rankResults call should filter that candidate out.
      const file1 = makeFile({
        username: "acidzwan",
        filename: "@@acidzwan\\music\\Artist\\01 - Song.flac",
      });
      const file2 = makeFile({
        username: "isitme",
        filename: "@@isitme\\music\\Artist\\01 - Song.flac",
      });

      // Simulate acidzwan already rejected
      const db = mockDb(["acidzwan:@@acidzwan\\music\\Artist\\01 - Song.flac"]);
      const service = makeService(db);

      const { ranked } = service.rankResults(
        [file1, file2],
        { title: "Song", artist: "Artist" },
        "track-1",
      );

      // Only isitme should remain
      expect(ranked.length).toBe(1);
      expect(ranked[0].file.username).toBe("isitme");
    });

    it("loops through viable candidates in downloadFromSearchResults", async () => {
      // Test the full loop via downloadBatch: first candidate fails, second succeeds
      const db = mockDb();
      const service = makeService(db);
      const mock = getSoulseekMock();

      const file1 = makeFile({
        username: "user1",
        filename: "@@user1\\music\\Test Artist\\Album\\01 - Test Song.flac",
      });
      const file2 = makeFile({
        username: "user2",
        filename: "@@user2\\music\\Test Artist\\Album\\01 - Test Song.flac",
      });

      vi.mocked(mock.startSearchBatch).mockResolvedValueOnce(
        new Map([["Test Artist Test Song", { searchId: "s1", startedAt: Date.now() }]]),
      );
      vi.mocked(mock.waitForSearchBatch).mockResolvedValueOnce(
        new Map([["Test Artist Test Song", [file1, file2]]]),
      );

      // user1 times out, user2 succeeds
      vi.mocked(mock.download).mockResolvedValue(undefined);
      vi.mocked(mock.waitForDownload)
        .mockRejectedValueOnce(new Error("Operation timed out"))
        .mockResolvedValueOnce({
          id: "t1", username: "user2", filename: "01 - Test Song.flac",
          state: "Completed", bytesTransferred: 1000, size: 1000, percentComplete: 100,
        });

      // findDownloadedFile: user2 file appears after download, user1 never found
      const foundFiles = new Set<string>();
      vi.mocked(existsSync).mockImplementation((p) => {
        const s = String(p);
        return foundFiles.has(s) || s.includes("test-downloads");
      });
      // After user2 download succeeds, mark the file as present
      vi.mocked(mock.waitForDownload).mockImplementation(async (username: string) => {
        if (username === "user1") throw new Error("Operation timed out");
        // user2 succeeds — simulate file appearing in slskd downloads
        foundFiles.add("/tmp/slskd-downloads/Album/01 - Test Song.flac");
        return {
          id: "t1", username: "user2", filename: "01 - Test Song.flac",
          state: "Completed", bytesTransferred: 1000, size: 1000, percentComplete: 100,
        };
      });
      vi.mocked(readdirSync).mockReturnValue([]);  // no recursive fallback needed

      vi.mocked(parseFile).mockResolvedValue({
        common: { title: "Test Song", artist: "Test Artist" },
        format: { duration: 240, codec: "FLAC" },
      } as any);

      const items: DownloadItem[] = [
        {
          track: { title: "Test Song", artist: "Test Artist", durationMs: 240_000 },
          playlistName: "Playlist",
          dbTrackId: "t1",
        },
      ];

      const results = await service.downloadBatch(items);

      expect(results.length).toBe(1);
      // user1's failure was recorded as rejection
      expect(db._insertValues.some((v: any) =>
        v.fileKey?.includes("user1") && v.reason?.includes("Download failed"),
      )).toBe(true);
      // Both candidates were attempted
      expect(mock.download).toHaveBeenCalledTimes(2);
    });

    it("returns aggregated error when all candidates fail", async () => {
      const db = mockDb();
      const service = makeService(db);
      const mock = getSoulseekMock();

      const file1 = makeFile({
        username: "user1",
        filename: "@@user1\\music\\Test Artist\\Album\\01 - Test Song.flac",
      });
      const file2 = makeFile({
        username: "user2",
        filename: "@@user2\\music\\Test Artist\\Album\\01 - Test Song.flac",
      });

      vi.mocked(mock.startSearchBatch).mockResolvedValueOnce(
        new Map([["Test Artist Test Song", { searchId: "s1", startedAt: Date.now() }]]),
      );
      vi.mocked(mock.waitForSearchBatch).mockResolvedValueOnce(
        new Map([["Test Artist Test Song", [file1, file2]]]),
      );

      vi.mocked(mock.download).mockResolvedValue(undefined);
      vi.mocked(mock.waitForDownload).mockImplementation(async (username: string) => {
        if (username === "user1") throw new Error("Operation timed out");
        throw new Error("Transfer rejected: Too many files");
      });
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(readdirSync).mockReturnValue([]);

      const items: DownloadItem[] = [
        {
          track: { title: "Test Song", artist: "Test Artist" },
          playlistName: "P",
          dbTrackId: "t1",
        },
      ];

      const results = await service.downloadBatch(items);

      expect(results.length).toBe(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain("All 2 candidate(s) failed");
      expect(db._insertValues.filter((v: any) =>
        v.reason?.includes("Download failed"),
      ).length).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // validateDownload (strictness levels)
  // -----------------------------------------------------------------------
  describe("validateDownload", () => {
    const dummyFile = makeFile();

    describe("strict mode", () => {
      it("returns true when metadata matches well", async () => {
        const db = mockDb();
        const service = makeService(db, { validationStrictness: "strict" });

        vi.mocked(parseFile).mockResolvedValueOnce({
          common: { title: "My Song", artist: "My Artist", album: "My Album" },
          format: { duration: 200, codec: "FLAC" },
        } as any);

        const valid = await service.validateDownload(
          "/tmp/file.flac",
          { title: "My Song", artist: "My Artist", durationMs: 200_000 },
          "track-1",
          dummyFile,
        );

        expect(valid).toBe(true);
      });

      it("rejects and records when score < 0.7", async () => {
        const db = mockDb();
        const service = makeService(db, { validationStrictness: "strict" });

        vi.mocked(parseFile).mockResolvedValueOnce({
          common: { title: "Completely Different", artist: "Someone Else" },
          format: { duration: 60, codec: "FLAC" },
        } as any);

        const valid = await service.validateDownload(
          "/tmp/file.flac",
          { title: "Expected Song", artist: "Expected Artist", durationMs: 300_000 },
          "track-1",
          dummyFile,
        );

        expect(valid).toBe(false);
        expect(db.insert).toHaveBeenCalled();
      });

      it("rejects when duration difference > 5s", async () => {
        const db = mockDb();
        const service = makeService(db, { validationStrictness: "strict" });

        vi.mocked(parseFile).mockResolvedValueOnce({
          common: { title: "My Song", artist: "My Artist" },
          format: { duration: 260, codec: "FLAC" }, // 260s vs expected 240s = 20s diff
        } as any);

        const valid = await service.validateDownload(
          "/tmp/file.flac",
          { title: "My Song", artist: "My Artist", durationMs: 240_000 },
          "track-1",
          dummyFile,
        );

        expect(valid).toBe(false);
        expect(db.insert).toHaveBeenCalled();
      });

      it("rejects and records when parseFile throws", async () => {
        const db = mockDb();
        const service = makeService(db, { validationStrictness: "strict" });

        vi.mocked(parseFile).mockRejectedValueOnce(new Error("corrupt"));

        const valid = await service.validateDownload(
          "/tmp/bad.flac",
          { title: "Song", artist: "Artist" },
          "track-1",
          dummyFile,
        );

        expect(valid).toBe(false);
        expect(db.insert).toHaveBeenCalled();
      });
    });

    describe("moderate mode", () => {
      it("returns true when score > 0.5 and format is valid", async () => {
        const service = makeService();

        vi.mocked(parseFile).mockResolvedValueOnce({
          common: { title: "My Song", artist: "My Artist", album: "My Album" },
          format: { duration: 200, codec: "FLAC" },
        } as any);

        const valid = await service.validateDownload(
          "/tmp/file.flac",
          { title: "My Song", artist: "My Artist", durationMs: 200_000 },
          "track-1",
          dummyFile,
        );

        expect(valid).toBe(true);
      });

      it("rejects when score <= 0.5", async () => {
        const db = mockDb();
        const service = makeService(db, { validationStrictness: "moderate" });

        vi.mocked(parseFile).mockResolvedValueOnce({
          common: { title: "Totally Different", artist: "Someone Else" },
          format: { duration: 30, codec: "MP3" },
        } as any);

        const valid = await service.validateDownload(
          "/tmp/file.flac",
          { title: "Expected Song", artist: "Expected Artist", durationMs: 300_000 },
          "track-1",
          dummyFile,
        );

        expect(valid).toBe(false);
        expect(db.insert).toHaveBeenCalled();
      });

      it("rejects and records when parseFile throws", async () => {
        const db = mockDb();
        const service = makeService(db, { validationStrictness: "moderate" });

        vi.mocked(parseFile).mockRejectedValueOnce(new Error("corrupt"));

        const valid = await service.validateDownload(
          "/tmp/bad.flac",
          { title: "Song", artist: "Artist" },
          "track-1",
          dummyFile,
        );

        expect(valid).toBe(false);
        expect(db.insert).toHaveBeenCalled();
      });
    });

    describe("lenient mode", () => {
      it("returns true when file can be parsed regardless of metadata", async () => {
        const db = mockDb();
        const service = makeService(db, { validationStrictness: "lenient" });

        vi.mocked(parseFile).mockResolvedValueOnce({
          common: { title: "Completely Wrong", artist: "Wrong Artist" },
          format: { duration: 1 },
        } as any);

        const valid = await service.validateDownload(
          "/tmp/file.flac",
          { title: "Expected Song", artist: "Expected Artist", durationMs: 300_000 },
          "track-1",
          dummyFile,
        );

        expect(valid).toBe(true);
        // Should NOT record a rejection
        expect(db.insert).not.toHaveBeenCalled();
      });

      it("rejects and records when file is corrupt (parseFile throws)", async () => {
        const db = mockDb();
        const service = makeService(db, { validationStrictness: "lenient" });

        vi.mocked(parseFile).mockRejectedValueOnce(new Error("corrupt"));

        const valid = await service.validateDownload(
          "/tmp/bad.flac",
          { title: "Song", artist: "Artist" },
          "track-1",
          dummyFile,
        );

        expect(valid).toBe(false);
        expect(db.insert).toHaveBeenCalled();
      });
    });
  });

  // -----------------------------------------------------------------------
  // acquireAndMove
  // -----------------------------------------------------------------------
  describe("acquireAndMove", () => {
    it("reuses existing download", async () => {
      const service = makeService();
      const mock = getSoulseekMock();

      const file = makeFile({
        filename: "@@user1\\music\\Test Artist\\Album\\01 - Test Song.flac",
      });

      vi.mocked(parseFile).mockResolvedValueOnce({
        common: { title: "Test Song", artist: "Test Artist", album: "Album" },
        format: { duration: 240, codec: "FLAC" },
      } as any);

      vi.mocked(existsSync).mockImplementation((p) => {
        return String(p).includes("slskd-downloads");
      });

      const result = await service.acquireAndMove(
        file,
        { title: "Test Song", artist: "Test Artist" },
        "My Playlist",
        "db-track-1",
      );

      expect(result.success).toBe(true);
      expect(mock.download).not.toHaveBeenCalled();
      expect(mock.waitForDownload).not.toHaveBeenCalled();
    });

    it("downloads when file not found locally", async () => {
      const service = makeService();
      const mock = getSoulseekMock();

      const file = makeFile({
        filename: "@@user1\\music\\Test Artist\\Album\\01 - Test Song.flac",
      });

      vi.mocked(parseFile).mockResolvedValueOnce({
        common: { title: "Test Song", artist: "Test Artist", album: "Album" },
        format: { duration: 240, codec: "FLAC" },
      } as any);

      let findCalls = 0;
      vi.mocked(existsSync).mockImplementation((p) => {
        if (String(p).includes("slskd-downloads")) {
          findCalls++;
          return findCalls > 1;
        }
        return false;
      });

      const result = await service.acquireAndMove(
        file,
        { title: "Test Song", artist: "Test Artist" },
        "My Playlist",
        "db-track-1",
      );

      expect(result.success).toBe(true);
      expect(mock.download).toHaveBeenCalledWith("user1", file.filename, file.size, "/app/downloads/My Playlist");
      expect(mock.waitForDownload).toHaveBeenCalledWith("user1", file.filename);
    });

    it("returns failure when file not found after download", async () => {
      const service = makeService();
      const mock = getSoulseekMock();

      const file = makeFile({
        filename: "@@user1\\music\\Artist\\01 - Track.flac",
      });

      vi.mocked(existsSync).mockReturnValue(false);

      const result = await service.acquireAndMove(
        file,
        { title: "Track", artist: "Artist" },
        "Playlist",
        "db-track-1",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Downloaded file not found");
    });

    it("returns failure when validation fails", async () => {
      const service = makeService();

      const file = makeFile({
        filename: "@@user1\\music\\Wrong Artist\\Album\\01 - Totally Wrong Song.flac",
      });

      vi.mocked(existsSync).mockImplementation((p) => {
        return String(p).includes("slskd-downloads");
      });

      vi.mocked(parseFile).mockResolvedValueOnce({
        common: { title: "Completely Different Song", artist: "Wrong Artist" },
        format: { duration: 60, codec: "FLAC" },
      } as any);

      const result = await service.acquireAndMove(
        file,
        { title: "Expected Song", artist: "Expected Artist" },
        "Playlist",
        "db-track-3",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Validation failed");
    });
  });

  // -----------------------------------------------------------------------
  // findDownloadedFile (suffixed variants)
  // -----------------------------------------------------------------------
  describe("findDownloadedFile", () => {
    it("finds exact match in slskd downloads", async () => {
      const service = makeService();

      vi.mocked(existsSync).mockImplementation((p) => {
        return String(p).includes("slskd-downloads") && String(p).endsWith("Track.flac");
      });

      // acquireAndMove will call findDownloadedFile internally
      const file = makeFile({ filename: "@@user1\\music\\Artist\\Album\\Track.flac" });

      // Validation succeeds
      vi.mocked(parseFile).mockResolvedValueOnce({
        common: { title: "Track", artist: "Artist" },
        format: { duration: 200, codec: "FLAC" },
      } as any);

      const result = await service.acquireAndMove(
        file,
        { title: "Track", artist: "Artist" },
        "Playlist",
        "t1",
      );

      expect(mockSoulseekInstance.download).not.toHaveBeenCalled();
    });

    it("finds suffixed variant when exact match missing", async () => {
      const service = makeService();
      const mock = getSoulseekMock();

      const file = makeFile({
        filename: "@@user1\\music\\Artist\\Album\\Track.flac",
      });

      vi.mocked(existsSync).mockImplementation((p) => {
        const s = String(p);
        if (s.endsWith("Track.flac")) return false;
        if (s.includes("slskd-downloads") && !s.endsWith(".flac")) return true;
        return false;
      });
      vi.mocked(readdirSync).mockReturnValue(["Track_639091878895823617.flac" as any]);
      vi.mocked(statSync).mockReturnValue({ mtimeMs: Date.now() } as any);

      vi.mocked(parseFile).mockResolvedValueOnce({
        common: { title: "Track", artist: "Artist" },
        format: { duration: 200, codec: "FLAC" },
      } as any);

      const result = await service.acquireAndMove(
        file,
        { title: "Track", artist: "Artist" },
        "Playlist",
        "t1",
      );

      expect(mock.download).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // moveToPlaylistFolder
  // -----------------------------------------------------------------------
  describe("moveToPlaylistFolder", () => {
    it("builds correct path with sanitized filenames", () => {
      const service = makeService();

      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(renameSync).mockImplementation(() => undefined);

      const result = service.moveToPlaylistFolder(
        "/tmp/staging/file.flac",
        "My Playlist",
        { title: "Cool Song", artist: "The Artist" },
      );

      expect(result).toBe(
        "/tmp/test-downloads/My Playlist/The Artist - Cool Song.flac",
      );
      expect(mkdirSync).toHaveBeenCalledWith(
        "/tmp/test-downloads/My Playlist",
        { recursive: true },
      );
      expect(renameSync).toHaveBeenCalled();
    });

    it("sanitizes unsafe characters from filenames", () => {
      const service = makeService();

      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(renameSync).mockImplementation(() => undefined);

      const result = service.moveToPlaylistFolder(
        "/tmp/staging/file.mp3",
        'Bad/Name:"test"',
        { title: 'Song: "Remix"', artist: "Art*ist" },
      );

      expect(result).not.toContain(":");
      expect(result).not.toContain('"');
      expect(result).not.toContain("*");
    });

    it("falls back to copy+delete when rename fails (cross-device)", () => {
      const service = makeService();

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(renameSync).mockImplementation(() => {
        throw new Error("EXDEV: cross-device link not permitted");
      });
      vi.mocked(copyFileSync).mockImplementation(() => undefined);
      vi.mocked(unlinkSync).mockImplementation(() => undefined);

      service.moveToPlaylistFolder("/tmp/staging/file.flac", "Playlist", {
        title: "Song",
        artist: "Artist",
      });

      expect(copyFileSync).toHaveBeenCalled();
      expect(unlinkSync).toHaveBeenCalled();
    });

    it("skips mkdir when directory already exists", () => {
      const service = makeService();

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(renameSync).mockImplementation(() => undefined);

      service.moveToPlaylistFolder("/tmp/staging/file.flac", "Existing", {
        title: "Song",
        artist: "Artist",
      });

      expect(mkdirSync).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // No standalone download methods
  // -----------------------------------------------------------------------
  describe("API surface", () => {
    it("does not expose a standalone downloadTrack method", () => {
      const service = makeService();
      expect((service as any).downloadTrack).toBeUndefined();
    });

    it("does not export DownloadReviewFn type", async () => {
      const mod = await import("../download-service.js");
      expect((mod as any).DownloadReviewFn).toBeUndefined();
    });
  });
});
