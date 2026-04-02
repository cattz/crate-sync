import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all three service modules before importing checkHealth.
// Use function() (not arrow) so the mock can be called with `new`.
vi.mock("../../services/spotify-service.js", () => ({
  SpotifyService: vi.fn(function () {}),
}));
vi.mock("../../services/lexicon-service.js", () => ({
  LexiconService: vi.fn(function () {}),
}));
vi.mock("../../services/soulseek-service.js", () => ({
  SoulseekService: vi.fn(function () {}),
}));

import { checkHealth } from "../health.js";
import type { Config } from "../../config.js";
import { SpotifyService } from "../../services/spotify-service.js";
import { LexiconService } from "../../services/lexicon-service.js";
import { SoulseekService } from "../../services/soulseek-service.js";

function makeConfig(overrides: Partial<{
  spotifyClientId: string;
  spotifyClientSecret: string;
  lexiconUrl: string;
  slskdApiKey: string;
  slskdUrl: string;
}> = {}): Config {
  return {
    spotify: {
      clientId: overrides.spotifyClientId ?? "id",
      clientSecret: overrides.spotifyClientSecret ?? "secret",
      redirectUri: "http://localhost:8888/callback",
    },
    lexicon: {
      url: overrides.lexiconUrl ?? "http://localhost:48624",
      downloadRoot: "/downloads",
      tagCategory: { name: "Spotify Playlists", color: "#1DB954" },
    },
    soulseek: {
      slskdUrl: overrides.slskdUrl ?? "http://localhost:5030",
      slskdApiKey: overrides.slskdApiKey ?? "apikey",
      searchDelayMs: 5000,
      downloadDir: "/downloads",
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
    download: {
      formats: ["flac", "mp3"],
      minBitrate: 320,
      concurrency: 3,
      validationStrictness: "moderate",
    },
    jobRunner: {
      pollIntervalMs: 1000,
      concurrency: 3,
      retentionDays: 7,
    },
    logging: {
      level: "info",
      file: true,
    },
    wishlist: {
      retryIntervalHours: 24,
      maxRetries: 5,
    },
    sources: {
      priority: ["soulseek"],
      local: {},
    },
  };
}

/** Helper to set up constructor mocks that produce instances with the given methods. */
function mockSpotify(overrides: Record<string, unknown> = {}) {
  vi.mocked(SpotifyService).mockImplementation(function (this: any) {
    Object.assign(this, {
      isAuthenticated: vi.fn().mockResolvedValue(true),
      ...overrides,
    });
  } as any);
}

function mockLexicon(overrides: Record<string, unknown> = {}) {
  vi.mocked(LexiconService).mockImplementation(function (this: any) {
    Object.assign(this, {
      ping: vi.fn().mockResolvedValue(true),
      ...overrides,
    });
  } as any);
}

function mockSoulseek(overrides: Record<string, unknown> = {}) {
  vi.mocked(SoulseekService).mockImplementation(function (this: any) {
    Object.assign(this, {
      ping: vi.fn().mockResolvedValue(true),
      ...overrides,
    });
  } as any);
}

describe("checkHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all ok when every service is reachable", async () => {
    mockSpotify();
    mockLexicon();
    mockSoulseek();

    const health = await checkHealth(makeConfig());

    expect(health.spotify.ok).toBe(true);
    expect(health.lexicon.ok).toBe(true);
    expect(health.soulseek.ok).toBe(true);
  });

  it("reports spotify not ok when not authenticated", async () => {
    mockSpotify({ isAuthenticated: vi.fn().mockResolvedValue(false) });
    mockLexicon();
    mockSoulseek();

    const health = await checkHealth(makeConfig());

    expect(health.spotify.ok).toBe(false);
    expect(health.spotify.error).toContain("Not authenticated");
  });

  it("reports spotify not ok when credentials are missing", async () => {
    // No need to mock SpotifyService — it returns early before constructing
    mockLexicon();
    mockSoulseek();

    const health = await checkHealth(makeConfig({
      spotifyClientId: "",
      spotifyClientSecret: "",
    }));

    expect(health.spotify.ok).toBe(false);
    expect(health.spotify.error).toContain("Missing client credentials");
  });

  it("reports lexicon not ok when URL is empty", async () => {
    mockSpotify();
    mockSoulseek();

    const health = await checkHealth(makeConfig({ lexiconUrl: "" }));

    expect(health.lexicon.ok).toBe(false);
    expect(health.lexicon.error).toContain("No URL configured");
  });

  it("reports lexicon not ok when ping fails", async () => {
    mockSpotify();
    mockLexicon({ ping: vi.fn().mockResolvedValue(false) });
    mockSoulseek();

    const health = await checkHealth(makeConfig());

    expect(health.lexicon.ok).toBe(false);
    expect(health.lexicon.error).toContain("Not reachable");
  });

  it("reports soulseek not ok when API key is missing", async () => {
    mockSpotify();
    mockLexicon();

    const health = await checkHealth(makeConfig({ slskdApiKey: "" }));

    expect(health.soulseek.ok).toBe(false);
    expect(health.soulseek.error).toContain("Missing API key");
  });

  it("reports soulseek not ok when ping fails", async () => {
    mockSpotify();
    mockLexicon();
    mockSoulseek({ ping: vi.fn().mockResolvedValue(false) });

    const health = await checkHealth(makeConfig());

    expect(health.soulseek.ok).toBe(false);
    expect(health.soulseek.error).toContain("Not reachable");
  });

  it("catches exceptions and returns error messages", async () => {
    mockSpotify({ isAuthenticated: vi.fn().mockRejectedValue(new Error("Network down")) });
    mockLexicon({ ping: vi.fn().mockRejectedValue(new Error("Connection refused")) });
    mockSoulseek({ ping: vi.fn().mockRejectedValue(new Error("Timeout")) });

    const health = await checkHealth(makeConfig());

    expect(health.spotify.ok).toBe(false);
    expect(health.spotify.error).toBe("Network down");
    expect(health.lexicon.ok).toBe(false);
    expect(health.lexicon.error).toBe("Connection refused");
    expect(health.soulseek.ok).toBe(false);
    expect(health.soulseek.error).toBe("Timeout");
  });
});
