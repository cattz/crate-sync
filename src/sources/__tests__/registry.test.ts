import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Config } from "../../config.js";
import { LocalFilesystemSource } from "../local-source.js";

// Mock existsSync at the module level
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
  };
});

// Import after mock setup
import { existsSync } from "node:fs";
import { buildSources } from "../registry.js";

const mockedExistsSync = vi.mocked(existsSync);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<Config["sources"]> = {}): Config {
  return {
    spotify: { clientId: "", clientSecret: "", redirectUri: "" },
    lexicon: {
      url: "http://localhost:48624",
      downloadRoot: "/tmp/test-dl",
      tagCategory: { name: "Spotify Playlists", color: "#1DB954" },
    },
    soulseek: {
      slskdUrl: "http://localhost:5030",
      slskdApiKey: "test",
      searchDelayMs: 0,
      downloadDir: "/tmp/slskd-downloads",
      downloadTimeoutMs: 1_800_000,
      fileScanIntervalMs: 15_000,
    },
    matching: {
      autoAcceptThreshold: 0.9,
      reviewThreshold: 0.7,
      notFoundThreshold: 0.65,
      lexiconWeights: { title: 0.3, artist: 0.3, album: 0.15, duration: 0.25 },
      soulseekWeights: { title: 0.3, artist: 0.25, album: 0.1, duration: 0.35 },
    },
    download: { formats: ["flac", "mp3"], minBitrate: 320, concurrency: 3, validationStrictness: "moderate" },
    jobRunner: { pollIntervalMs: 1000, concurrency: 3, retentionDays: 7 },
    wishlist: { retryIntervalHours: 24, maxRetries: 5 },
    logging: { level: "info", file: true },
    sources: {
      priority: ["soulseek"],
      local: {},
      ...overrides,
    },
  } as Config;
}

// ===========================================================================
// Tests
// ===========================================================================

describe("buildSources", () => {
  beforeEach(() => {
    mockedExistsSync.mockReset();
    mockedExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty array with default config (only soulseek)", () => {
    const config = makeConfig({ priority: ["soulseek"] });
    const sources = buildSources(config);
    expect(sources).toEqual([]);
  });

  it("creates LocalFilesystemSource for configured local sources", () => {
    mockedExistsSync.mockReturnValue(true);

    const config = makeConfig({
      priority: ["local:lossless"],
      local: {
        lossless: {
          path: "/music/lossless",
          structure: "artist-album",
          formats: ["flac"],
          fileOp: "copy",
        },
      },
    });

    const sources = buildSources(config);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toBeInstanceOf(LocalFilesystemSource);
    expect(sources[0].id).toBe("local:lossless");
  });

  it("skips sources with non-existent paths", () => {
    mockedExistsSync.mockReturnValue(false);

    const config = makeConfig({
      priority: ["local:missing"],
      local: {
        missing: {
          path: "/does/not/exist",
          structure: "flat",
          formats: ["flac"],
          fileOp: "copy",
        },
      },
    });

    const sources = buildSources(config);
    expect(sources).toHaveLength(0);
  });

  it("respects priority order", () => {
    mockedExistsSync.mockReturnValue(true);

    const config = makeConfig({
      priority: ["local:lossless", "soulseek", "local:lossy"],
      local: {
        lossless: {
          path: "/music/lossless",
          structure: "artist-album",
          formats: ["flac"],
          fileOp: "copy",
        },
        lossy: {
          path: "/music/lossy",
          structure: "flat",
          formats: ["mp3"],
          fileOp: "copy",
        },
      },
    });

    const sources = buildSources(config);
    expect(sources).toHaveLength(2);
    // soulseek is skipped (handled separately), locals maintain order
    expect(sources[0].id).toBe("local:lossless");
    expect(sources[1].id).toBe("local:lossy");
  });

  it("skips local sources without matching config entry", () => {
    mockedExistsSync.mockReturnValue(true);

    const config = makeConfig({
      priority: ["local:unconfigured"],
      local: {},
    });

    const sources = buildSources(config);
    expect(sources).toHaveLength(0);
  });

  it("handles mixed valid and invalid local sources", () => {
    mockedExistsSync.mockImplementation((p) => {
      return p === "/music/valid";
    });

    const config = makeConfig({
      priority: ["local:valid", "local:invalid"],
      local: {
        valid: {
          path: "/music/valid",
          structure: "flat",
          formats: ["flac"],
          fileOp: "copy",
        },
        invalid: {
          path: "/music/nope",
          structure: "flat",
          formats: ["flac"],
          fileOp: "copy",
        },
      },
    });

    const sources = buildSources(config);
    expect(sources).toHaveLength(1);
    expect(sources[0].id).toBe("local:valid");
  });
});
