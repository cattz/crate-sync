import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

import * as schema from "../../db/schema.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(currentDir, "../../db/migrations");

let testDb: ReturnType<typeof drizzle<typeof schema>>;
let sqlite: InstanceType<typeof Database>;
let mockSaveConfig: ReturnType<typeof vi.fn>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));

vi.mock("../../config.js", () => {
  const mockSave = vi.fn();
  return {
    loadConfig: () => ({
      spotify: { clientId: "cid", clientSecret: "csecret", redirectUri: "http://127.0.0.1:8888/callback" },
      lexicon: { url: "http://localhost:48624", downloadRoot: "/tmp" },
      soulseek: {
        slskdUrl: "http://localhost:5030",
        slskdApiKey: "test-key",
        searchDelayMs: 5000,
        downloadDir: "/tmp",
        downloadTimeoutMs: 1800000,
      },
      matching: {
        autoAcceptThreshold: 0.9,
        reviewThreshold: 0.7,
        notFoundThreshold: 0.65,
        lexiconWeights: { title: 0.3, artist: 0.3, album: 0.15, duration: 0.25 },
        soulseekWeights: { title: 0.3, artist: 0.25, album: 0.1, duration: 0.35 },
      },
      download: { formats: ["flac", "mp3"], minBitrate: 320, concurrency: 2, validationStrictness: "moderate" },
      jobRunner: { pollIntervalMs: 1000, concurrency: 3, retentionDays: 7 },
      logging: { level: "info", file: true },
    }),
    saveConfig: mockSave,
    __mockSaveConfig: mockSave,
  };
});

// Capture the mock for assertions
import * as configModule from "../../config.js";
mockSaveConfig = (configModule as any).__mockSaveConfig;

vi.mock("../../utils/health.js", () => ({
  checkHealth: vi.fn().mockResolvedValue({
    spotify: { ok: true },
    lexicon: { ok: true },
    soulseek: { ok: false, error: "Not reachable" },
  }),
}));

// Mock services used by other routes
vi.mock("../../services/playlist-service.js", () => ({
  PlaylistService: vi.fn().mockImplementation(() => ({
    getPlaylist: vi.fn().mockReturnValue(null),
    getPlaylists: vi.fn().mockReturnValue([]),
  })),
}));

vi.mock("../../services/lexicon-service.js", () => ({
  LexiconService: vi.fn().mockImplementation(() => ({
    getTracks: vi.fn().mockResolvedValue([]),
    getPlaylistByName: vi.fn().mockResolvedValue(null),
    ping: vi.fn().mockResolvedValue(true),
  })),
}));

vi.mock("../../services/download-service.js", () => ({
  DownloadService: vi.fn().mockImplementation(() => ({
    cleanupEmptyDirs: vi.fn().mockReturnValue(0),
    deleteDownloadFile: vi.fn().mockReturnValue(false),
  })),
}));

vi.mock("../../services/spotify-service.js", () => ({
  SpotifyService: vi.fn().mockImplementation(() => ({
    isAuthenticated: vi.fn().mockResolvedValue(false),
    getAuthUrl: vi.fn().mockReturnValue("https://accounts.spotify.com/authorize"),
  })),
}));

vi.mock("../../services/spotify-auth-server.js", () => ({
  waitForAuthCallback: vi.fn().mockResolvedValue("mock-code"),
}));

vi.mock("../../services/soulseek-service.js", () => ({
  SoulseekService: vi.fn().mockImplementation(() => ({
    ping: vi.fn().mockResolvedValue(true),
  })),
}));

import { createApp } from "../server.js";

function freshDb() {
  sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  testDb = drizzle(sqlite, { schema });
  migrate(testDb, { migrationsFolder });
}

function insertTrack() {
  const id = crypto.randomUUID();
  return testDb.insert(schema.tracks).values({
    id,
    spotifyId: `sp-${id.slice(0, 8)}`,
    title: "Track",
    artist: "Artist",
    durationMs: 200000,
  }).returning().get();
}

function insertPlaylist() {
  const id = crypto.randomUUID();
  return testDb.insert(schema.playlists).values({
    id,
    name: "Playlist",
  }).returning().get();
}

describe("Status API", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    freshDb();
    app = createApp();
    mockSaveConfig.mockClear();
  });

  afterEach(() => {
    sqlite.close();
  });

  async function get(path: string) {
    const res = await app.request(path);
    return { status: res.status, body: await res.json() };
  }

  async function put(path: string, body: unknown) {
    const res = await app.request(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }

  describe("GET /api/status", () => {
    it("returns service health and db stats", async () => {
      insertPlaylist();
      insertPlaylist();
      insertTrack();

      const { status, body } = await get("/api/status");
      expect(status).toBe(200);

      // Health checks from mock
      expect(body.spotify).toEqual({ ok: true });
      expect(body.lexicon).toEqual({ ok: true });
      expect(body.soulseek).toEqual({ ok: false, error: "Not reachable", signalr: false });

      // Database stats
      expect(body.database).toBeDefined();
      expect(body.database.ok).toBe(true);
      expect(body.database.playlists).toBe(2);
      expect(body.database.tracks).toBe(1);
    });

    it("includes match and download counts", async () => {
      const { body } = await get("/api/status");
      expect(body.database.matches).toBe(0);
      expect(body.database.downloads).toBe(0);
    });
  });

  describe("GET /api/config", () => {
    it("returns non-sensitive config", async () => {
      const { status, body } = await get("/api/status/config");
      expect(status).toBe(200);

      // Should include these sections
      expect(body.lexicon).toBeDefined();
      expect(body.soulseek).toBeDefined();
      expect(body.matching).toBeDefined();
      expect(body.download).toBeDefined();
      expect(body.jobRunner).toBeDefined();

      // Should NOT include spotify secrets
      expect(body.spotify).toBeUndefined();

      // Should expose the right values
      expect(body.lexicon.url).toBe("http://localhost:48624");
      expect(body.matching.autoAcceptThreshold).toBe(0.9);
    });
  });

  describe("PUT /api/config", () => {
    it("updates matching config", async () => {
      const { status, body } = await put("/api/status/config", {
        matching: { autoAcceptThreshold: 0.85 },
      });

      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(mockSaveConfig).toHaveBeenCalledTimes(1);

      // Verify the config passed to saveConfig has the updated value
      const savedConfig = mockSaveConfig.mock.calls[0][0];
      expect(savedConfig.matching.autoAcceptThreshold).toBe(0.85);
    });

    it("updates download config", async () => {
      const { status, body } = await put("/api/status/config", {
        download: { concurrency: 5 },
      });

      expect(status).toBe(200);
      expect(body.ok).toBe(true);

      const savedConfig = mockSaveConfig.mock.calls[0][0];
      expect(savedConfig.download.concurrency).toBe(5);
    });

    it("updates jobRunner config", async () => {
      const { status, body } = await put("/api/status/config", {
        jobRunner: { retentionDays: 14 },
      });

      expect(status).toBe(200);
      expect(body.ok).toBe(true);

      const savedConfig = mockSaveConfig.mock.calls[0][0];
      expect(savedConfig.jobRunner.retentionDays).toBe(14);
    });

    it("updates logging config", async () => {
      const { status, body } = await put("/api/status/config", {
        logging: { level: "debug" },
      });

      expect(status).toBe(200);
      expect(body.ok).toBe(true);

      const savedConfig = mockSaveConfig.mock.calls[0][0];
      expect(savedConfig.logging.level).toBe("debug");
    });

    it("ignores empty body gracefully", async () => {
      const { status, body } = await put("/api/status/config", {});
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
    });
  });
});
