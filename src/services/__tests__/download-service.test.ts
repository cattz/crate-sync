import { describe, it, expect, vi, beforeEach } from "vitest";
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

// ---------------------------------------------------------------------------
// Imports (must come after vi.mock calls)
// ---------------------------------------------------------------------------

import { DownloadService } from "../download-service.js";
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
};

const lexiconConfig: LexiconConfig = {
  url: "http://localhost:48624",
  downloadRoot: "/tmp/test-downloads",
};

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

function makeService(): DownloadService {
  return new DownloadService(soulseekConfig, downloadConfig, lexiconConfig);
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
        filename: "@@user2\\music\\Other\\Album\\01 - Something Else.flac",
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

      const { ranked } = await service.searchAndRank(track);

      expect(ranked.length).toBe(2);
      // Best match should be first
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
      });

      // wav is not in allowed formats (flac, mp3), so should be filtered
      expect(ranked.every((r) => !r.file.filename.endsWith(".wav"))).toBe(
        true,
      );
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
      });

      // Low bitrate (128 < 320) should be filtered
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
      });

      expect(ranked.length).toBe(1);
    });

    it("returns empty array when no matches", async () => {
      const service = makeService();
      const mock = getSoulseekMock();

      vi.mocked(mock.rateLimitedSearch).mockResolvedValueOnce([]);

      const { ranked } = await service.searchAndRank({
        title: "Nonexistent",
        artist: "Nobody",
      });

      expect(ranked).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // downloadTrack
  // -----------------------------------------------------------------------
  describe("downloadTrack", () => {
    it("succeeds with full flow: search -> download -> validate -> move", async () => {
      const service = makeService();
      const mock = getSoulseekMock();

      const file = makeFile({
        filename: "@@user1\\music\\Test Artist\\Album\\01 - Test Song.flac",
      });
      vi.mocked(mock.rateLimitedSearch).mockResolvedValueOnce([file]);

      // Validation: parseFile returns matching metadata
      vi.mocked(parseFile).mockResolvedValueOnce({
        common: {
          title: "Test Song",
          artist: "Test Artist",
          album: "Album",
        },
        format: { duration: 240 },
      } as any);

      // findDownloadedFile: exact path exists; moveToPlaylistFolder: dest dir doesn't
      vi.mocked(existsSync).mockImplementation((p) => {
        return String(p).includes("slskd-downloads");
      });

      const result = await service.downloadTrack(
        { title: "Test Song", artist: "Test Artist" },
        "My Playlist",
        "db-track-1",
      );

      expect(result.success).toBe(true);
      expect(result.trackId).toBe("db-track-1");
      expect(result.filePath).toBeDefined();
      expect(mock.download).toHaveBeenCalledWith("user1", file.filename, file.size);
      expect(mock.waitForDownload).toHaveBeenCalledWith("user1", file.filename);
    });

    it("returns failure when no results found", async () => {
      const service = makeService();
      const mock = getSoulseekMock();

      vi.mocked(mock.rateLimitedSearch).mockResolvedValueOnce([]);

      const result = await service.downloadTrack(
        { title: "Missing", artist: "Nobody" },
        "Playlist",
        "db-track-2",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("No matching files on Soulseek");
      expect(result.trackId).toBe("db-track-2");
    });

    it("returns failure when validation fails", async () => {
      const service = makeService();
      const mock = getSoulseekMock();

      // Filename matches the expected track well enough to pass score threshold
      const file = makeFile({ filename: "@@user1\\music\\Expected Artist\\Album\\01 - Expected Song.flac" });
      vi.mocked(mock.rateLimitedSearch).mockResolvedValueOnce([file]);

      // findDownloadedFile: exact path exists
      vi.mocked(existsSync).mockImplementation((p) => {
        return String(p).includes("slskd-downloads");
      });

      // Validation fails: completely different metadata
      vi.mocked(parseFile).mockResolvedValueOnce({
        common: {
          title: "Completely Different Song",
          artist: "Wrong Artist",
        },
        format: { duration: 60 },
      } as any);

      const result = await service.downloadTrack(
        { title: "Expected Song", artist: "Expected Artist" },
        "Playlist",
        "db-track-3",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("metadata validation");
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

      // Batch search: startSearchBatch returns query→{searchId, startedAt} map
      vi.mocked(mock.startSearchBatch).mockResolvedValueOnce(
        new Map([
          ["Artist A Song A", { searchId: "s1", startedAt: Date.now() }],
          ["Artist B Song B", { searchId: "s2", startedAt: Date.now() }],
        ]),
      );

      // waitForSearchBatch returns query→files map
      vi.mocked(mock.waitForSearchBatch).mockResolvedValueOnce(
        new Map([
          ["Artist A Song A", [file1]],
          ["Artist B Song B", [file2]],
        ]),
      );

      // Both validations pass
      vi.mocked(parseFile)
        .mockResolvedValueOnce({
          common: { title: "Song A", artist: "Artist A" },
          format: { duration: 200 },
        } as any)
        .mockResolvedValueOnce({
          common: { title: "Song B", artist: "Artist B" },
          format: { duration: 180 },
        } as any);

      // findDownloadedFile: exact path exists; moveToPlaylistFolder: dest dir doesn't
      vi.mocked(existsSync).mockImplementation((p) => {
        return String(p).includes("slskd-downloads");
      });

      const tracks = [
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

      const results = await service.downloadBatch(tracks);

      expect(results.length).toBe(2);
      expect(mock.startSearchBatch).toHaveBeenCalledOnce();
      expect(mock.waitForSearchBatch).toHaveBeenCalledOnce();
    });

    it("calls progress callback for each track", async () => {
      const service = makeService();
      const mock = getSoulseekMock();

      // Batch search returns empty results for both
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

      const tracks = [
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

      await service.downloadBatch(tracks, onProgress);

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
  });

  // -----------------------------------------------------------------------
  // validateDownload
  // -----------------------------------------------------------------------
  describe("validateDownload", () => {
    it("returns true when tags match the expected track", async () => {
      const service = makeService();

      vi.mocked(parseFile).mockResolvedValueOnce({
        common: { title: "My Song", artist: "My Artist", album: "My Album" },
        format: { duration: 200 },
      } as any);

      const valid = await service.validateDownload("/tmp/file.flac", {
        title: "My Song",
        artist: "My Artist",
        durationMs: 200_000,
      });

      expect(valid).toBe(true);
    });

    it("returns false when tags are mismatched", async () => {
      const service = makeService();

      vi.mocked(parseFile).mockResolvedValueOnce({
        common: {
          title: "Totally Different",
          artist: "Someone Else",
        },
        format: { duration: 30 },
      } as any);

      const valid = await service.validateDownload("/tmp/file.flac", {
        title: "Expected Song",
        artist: "Expected Artist",
        durationMs: 300_000,
      });

      expect(valid).toBe(false);
    });

    it("returns false when parseFile throws", async () => {
      const service = makeService();

      vi.mocked(parseFile).mockRejectedValueOnce(new Error("corrupt file"));

      const valid = await service.validateDownload("/tmp/bad.flac", {
        title: "Song",
        artist: "Artist",
      });

      expect(valid).toBe(false);
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

      // Unsafe chars (/:*?"<>|\) should be stripped
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
});
