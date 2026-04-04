import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TrackInfo } from "../../types/common.js";
import type { TrackSource, SourceCandidate } from "../../sources/types.js";
import type { IRejectionRepository } from "../../ports/repositories.js";
import type { MatchingConfig, DownloadConfig, LexiconConfig } from "../../config.js";
import { AcquisitionService } from "../acquisition-service.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTrack(overrides: Partial<TrackInfo> = {}): TrackInfo {
  return {
    title: "Bohemian Rhapsody",
    artist: "Queen",
    album: "A Night at the Opera",
    durationMs: 354_000,
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<SourceCandidate> = {}): SourceCandidate {
  return {
    sourceKey: "local:test:/path/song.flac",
    sourceId: "local:test",
    trackInfo: {
      title: "Bohemian Rhapsody",
      artist: "Queen",
      album: "A Night at the Opera",
      durationMs: 354_000,
    },
    localPath: "/path/song.flac",
    meta: {},
    quality: { format: "flac", bitRate: 1411 },
    ...overrides,
  };
}

function makeSource(id: string, overrides: Partial<TrackSource> = {}): TrackSource {
  return {
    id,
    name: id,
    isAvailable: vi.fn().mockResolvedValue(true),
    search: vi.fn().mockResolvedValue([]),
    acquire: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function makeRejections(rejected: Set<string> = new Set()): IRejectionRepository {
  return {
    findFileKeysByTrackAndContext: vi.fn().mockReturnValue(rejected),
    findReason: vi.fn().mockReturnValue(null),
    insert: vi.fn(),
  };
}

const matchingConfig: MatchingConfig = {
  autoAcceptThreshold: 0.9,
  reviewThreshold: 0.7,
  notFoundThreshold: 0.65,
  lexiconWeights: { title: 0.3, artist: 0.3, album: 0.15, duration: 0.25 },
  soulseekWeights: { title: 0.3, artist: 0.25, album: 0.1, duration: 0.35 },
};

const downloadConfig: DownloadConfig = {
  formats: ["flac", "mp3"],
  minBitrate: 320,
  concurrency: 3,
  validationStrictness: "moderate",
};

const lexiconConfig: LexiconConfig = {
  url: "http://localhost:48624",
  downloadRoot: "/tmp/test-downloads",
  tagCategory: { name: "Spotify Playlists", color: "#1DB954" },
};

// ===========================================================================
// Tests
// ===========================================================================

describe("AcquisitionService", () => {
  let rejections: IRejectionRepository;

  beforeEach(() => {
    rejections = makeRejections();
  });

  // -------------------------------------------------------------------------
  // searchAllSources
  // -------------------------------------------------------------------------
  describe("searchAllSources", () => {
    it("queries sources in priority order and stops at first good match", async () => {
      const track = makeTrack();
      const candidate = makeCandidate();

      const source1 = makeSource("source-1", {
        search: vi.fn().mockResolvedValue([candidate]),
      });
      const source2 = makeSource("source-2", {
        search: vi.fn().mockResolvedValue([candidate]),
      });

      const svc = new AcquisitionService(
        [source1, source2],
        rejections,
        matchingConfig,
        downloadConfig,
        lexiconConfig,
      );

      const result = await svc.searchAllSources(track, "track-1");

      expect(result).not.toBeNull();
      expect(result!.sourceId).toBe("source-1");
      expect(result!.candidates.length).toBeGreaterThanOrEqual(1);
      // source2 should never be searched
      expect(source2.search).not.toHaveBeenCalled();
    });

    it("skips unavailable sources", async () => {
      const track = makeTrack();
      const candidate = makeCandidate({ sourceId: "source-2" });

      const source1 = makeSource("source-1", {
        isAvailable: vi.fn().mockResolvedValue(false),
        search: vi.fn().mockResolvedValue([candidate]),
      });
      const source2 = makeSource("source-2", {
        search: vi.fn().mockResolvedValue([candidate]),
      });

      const svc = new AcquisitionService(
        [source1, source2],
        rejections,
        matchingConfig,
        downloadConfig,
        lexiconConfig,
      );

      const result = await svc.searchAllSources(track, "track-1");

      expect(source1.search).not.toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result!.sourceId).toBe("source-2");
    });

    it("filters rejected candidates", async () => {
      const track = makeTrack();
      const goodCandidate = makeCandidate({ sourceKey: "good-key" });
      const rejectedCandidate = makeCandidate({ sourceKey: "bad-key" });

      rejections = makeRejections(new Set(["bad-key"]));

      const source = makeSource("source-1", {
        search: vi.fn().mockResolvedValue([goodCandidate, rejectedCandidate]),
      });

      const svc = new AcquisitionService(
        [source],
        rejections,
        matchingConfig,
        downloadConfig,
        lexiconConfig,
      );

      const result = await svc.searchAllSources(track, "track-1");

      expect(result).not.toBeNull();
      // Only the good candidate should appear in ranked results
      const sourceKeys = result!.candidates.map((c) => c.candidate.sourceKey);
      expect(sourceKeys).not.toContain("bad-key");
    });

    it("returns null when no source has matches", async () => {
      const track = makeTrack();

      const source1 = makeSource("source-1", {
        search: vi.fn().mockResolvedValue([]),
      });
      const source2 = makeSource("source-2", {
        search: vi.fn().mockResolvedValue([]),
      });

      const svc = new AcquisitionService(
        [source1, source2],
        rejections,
        matchingConfig,
        downloadConfig,
        lexiconConfig,
      );

      const result = await svc.searchAllSources(track, "track-1");
      expect(result).toBeNull();
    });

    it("skips candidates filtered by format", async () => {
      const track = makeTrack();
      // Only wav format — not in allowed formats (flac, mp3)
      const wavCandidate = makeCandidate({
        quality: { format: "wav", bitRate: 1411 },
      });

      const source = makeSource("source-1", {
        search: vi.fn().mockResolvedValue([wavCandidate]),
      });

      const svc = new AcquisitionService(
        [source],
        rejections,
        matchingConfig,
        downloadConfig,
        lexiconConfig,
      );

      const result = await svc.searchAllSources(track, "track-1");
      expect(result).toBeNull();
    });

    it("skips candidates below minimum bitrate", async () => {
      const track = makeTrack();
      const lowBitrate = makeCandidate({
        quality: { format: "mp3", bitRate: 128 },
      });

      const source = makeSource("source-1", {
        search: vi.fn().mockResolvedValue([lowBitrate]),
      });

      const svc = new AcquisitionService(
        [source],
        rejections,
        matchingConfig,
        downloadConfig,
        lexiconConfig,
      );

      const result = await svc.searchAllSources(track, "track-1");
      expect(result).toBeNull();
    });

    it("keeps candidates without quality info (no format/bitrate)", async () => {
      const track = makeTrack();
      const noQuality = makeCandidate({ quality: undefined });

      const source = makeSource("source-1", {
        search: vi.fn().mockResolvedValue([noQuality]),
      });

      const svc = new AcquisitionService(
        [source],
        rejections,
        matchingConfig,
        downloadConfig,
        lexiconConfig,
      );

      const result = await svc.searchAllSources(track, "track-1");
      // Should not be filtered out — no quality info means keep it
      expect(result).not.toBeNull();
    });

    it("continues to next source when all candidates are rejected", async () => {
      const track = makeTrack();
      const candidate = makeCandidate({ sourceKey: "rejected-key" });

      rejections = makeRejections(new Set(["rejected-key"]));

      const source1 = makeSource("source-1", {
        search: vi.fn().mockResolvedValue([candidate]),
      });
      const goodCandidate = makeCandidate({
        sourceKey: "good-key",
        sourceId: "source-2",
      });
      const source2 = makeSource("source-2", {
        search: vi.fn().mockResolvedValue([goodCandidate]),
      });

      const svc = new AcquisitionService(
        [source1, source2],
        rejections,
        matchingConfig,
        downloadConfig,
        lexiconConfig,
      );

      const result = await svc.searchAllSources(track, "track-1");
      expect(result).not.toBeNull();
      expect(result!.sourceId).toBe("source-2");
    });

    it("returns diagnostics string with source info", async () => {
      const track = makeTrack();
      const candidate = makeCandidate();

      const source = makeSource("local:lossless", {
        search: vi.fn().mockResolvedValue([candidate]),
      });

      const svc = new AcquisitionService(
        [source],
        rejections,
        matchingConfig,
        downloadConfig,
        lexiconConfig,
      );

      const result = await svc.searchAllSources(track, "track-1");
      expect(result).not.toBeNull();
      expect(result!.diagnostics).toContain("local:lossless");
      expect(result!.diagnostics).toContain("raw candidates");
    });
  });

  // -------------------------------------------------------------------------
  // rankCandidates (tested indirectly through searchAllSources)
  // -------------------------------------------------------------------------
  describe("ranking", () => {
    it("ranks by fuzzy score — best match first", async () => {
      const track = makeTrack({ title: "Bohemian Rhapsody", artist: "Queen" });

      const exactMatch = makeCandidate({
        sourceKey: "exact",
        trackInfo: { title: "Bohemian Rhapsody", artist: "Queen", durationMs: 354_000 },
      });
      const partialMatch = makeCandidate({
        sourceKey: "partial",
        trackInfo: { title: "Bohemian", artist: "Queen", durationMs: 200_000 },
      });

      const source = makeSource("source-1", {
        search: vi.fn().mockResolvedValue([partialMatch, exactMatch]),
      });

      const svc = new AcquisitionService(
        [source],
        rejections,
        matchingConfig,
        downloadConfig,
        lexiconConfig,
      );

      const result = await svc.searchAllSources(track, "track-1");
      expect(result).not.toBeNull();
      expect(result!.candidates.length).toBeGreaterThanOrEqual(1);
      // Best match should be first
      expect(result!.candidates[0].candidate.sourceKey).toBe("exact");
      expect(result!.candidates[0].score).toBeGreaterThan(0);
    });

    it("filters candidates below match threshold", async () => {
      const track = makeTrack({ title: "Bohemian Rhapsody", artist: "Queen" });

      // Completely unrelated track — should score below threshold
      const badMatch = makeCandidate({
        sourceKey: "bad",
        trackInfo: { title: "Stairway to Heaven", artist: "Led Zeppelin", durationMs: 480_000 },
        quality: { format: "flac", bitRate: 1411 },
      });

      const source = makeSource("source-1", {
        search: vi.fn().mockResolvedValue([badMatch]),
      });

      const svc = new AcquisitionService(
        [source],
        rejections,
        matchingConfig,
        downloadConfig,
        lexiconConfig,
      );

      const result = await svc.searchAllSources(track, "track-1");
      // Bad match should be filtered by the fuzzy matcher
      expect(result).toBeNull();
    });
  });
});
