import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";

import * as schema from "../../db/schema.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(currentDir, "../../db/migrations");

let testDb: ReturnType<typeof drizzle<typeof schema>>;
let sqlite: InstanceType<typeof Database>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));

vi.mock("../../config.js", () => ({
  loadConfig: () => ({
    spotify: { clientId: "", clientSecret: "", redirectUri: "" },
    lexicon: { url: "http://localhost:48624", downloadRoot: "/tmp" },
    soulseek: { slskdUrl: "http://localhost:5030", slskdApiKey: "test", searchDelayMs: 0, downloadDir: "/tmp/slskd" },
    matching: { autoAcceptThreshold: 0.9, reviewThreshold: 0.7 },
    download: { formats: ["flac", "mp3"], minBitrate: 320, concurrency: 2 },
    jobRunner: { pollIntervalMs: 1000, wishlistIntervalMs: 21600000 },
  }),
  saveConfig: vi.fn(),
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
    cleanupEmptyDirs: vi.fn().mockReturnValue(2),
    deleteDownloadFile: vi.fn().mockReturnValue(true),
  })),
}));

vi.mock("../../utils/health.js", () => ({
  checkHealth: vi.fn().mockResolvedValue({
    spotify: { ok: true },
    lexicon: { ok: true },
    soulseek: { ok: true },
  }),
}));

vi.mock("../../services/spotify-service.js", () => ({
  SpotifyService: vi.fn().mockImplementation(() => ({
    isAuthenticated: vi.fn().mockResolvedValue(false),
  })),
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

function insertTrack(overrides?: Partial<schema.NewTrack>) {
  const id = crypto.randomUUID();
  return testDb.insert(schema.tracks).values({
    id,
    spotifyId: `sp-${id.slice(0, 8)}`,
    title: "Test Track",
    artist: "Test Artist",
    durationMs: 240000,
    ...overrides,
  }).returning().get();
}

function insertPlaylist(overrides?: Partial<schema.NewPlaylist>) {
  const id = crypto.randomUUID();
  return testDb.insert(schema.playlists).values({
    id,
    name: "Test Playlist",
    ...overrides,
  }).returning().get();
}

function insertDownload(trackId: string, overrides?: Partial<schema.NewDownload>) {
  const id = crypto.randomUUID();
  return testDb.insert(schema.downloads).values({
    id,
    trackId,
    status: "pending",
    origin: "not_found",
    createdAt: Date.now(),
    ...overrides,
  }).returning().get();
}

describe("Downloads API", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    freshDb();
    app = createApp();
  });

  afterEach(() => {
    sqlite.close();
  });

  async function get(path: string) {
    const res = await app.request(path);
    return { status: res.status, body: await res.json() };
  }

  async function del(path: string) {
    const res = await app.request(path, { method: "DELETE" });
    return { status: res.status, body: await res.json() };
  }

  describe("GET /api/downloads", () => {
    it("returns empty list when no downloads", async () => {
      const { status, body } = await get("/api/downloads");
      expect(status).toBe(200);
      expect(body).toEqual([]);
    });

    it("returns downloads with track info", async () => {
      const track = insertTrack({ title: "My Song", artist: "Artist A" });
      insertDownload(track.id, { status: "pending" });

      const { status, body } = await get("/api/downloads");
      expect(status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].trackId).toBe(track.id);
      expect(body[0].track).toBeDefined();
      expect(body[0].track.title).toBe("My Song");
    });

    it("filters by status", async () => {
      const track = insertTrack();
      insertDownload(track.id, { status: "pending" });
      insertDownload(track.id, { status: "done" });

      const { body } = await get("/api/downloads?status=pending");
      expect(body).toHaveLength(1);
      expect(body[0].status).toBe("pending");
    });
  });

  describe("GET /api/downloads/recent", () => {
    it("returns empty list when no completed downloads", async () => {
      const { status, body } = await get("/api/downloads/recent");
      expect(status).toBe(200);
      expect(body).toEqual([]);
    });

    it("returns completed downloads with track and playlist info", async () => {
      const playlist = insertPlaylist({ name: "Deep House" });
      const track = insertTrack({ title: "Sunset", artist: "DJ Flow" });
      insertDownload(track.id, {
        status: "done",
        playlistId: playlist.id,
        completedAt: Date.now(),
      });

      const { status, body } = await get("/api/downloads/recent");
      expect(status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].trackTitle).toBe("Sunset");
      expect(body[0].trackArtist).toBe("DJ Flow");
      expect(body[0].playlistName).toBe("Deep House");
    });
  });

  describe("DELETE /api/downloads?status=done", () => {
    it("clears completed downloads", async () => {
      const track = insertTrack();
      insertDownload(track.id, { status: "done" });
      insertDownload(track.id, { status: "done" });
      insertDownload(track.id, { status: "pending" });

      const { status, body } = await del("/api/downloads?status=done");
      expect(status).toBe(200);
      expect(body.deleted).toBe(2);

      // Pending download remains
      const remaining = testDb.select().from(schema.downloads).all();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].status).toBe("pending");
    });
  });

  describe("DELETE /api/downloads?status=failed", () => {
    it("clears failed downloads", async () => {
      const track = insertTrack();
      insertDownload(track.id, { status: "failed" });
      insertDownload(track.id, { status: "done" });

      const { status, body } = await del("/api/downloads?status=failed");
      expect(status).toBe(200);
      expect(body.deleted).toBe(1);
    });
  });

  describe("DELETE /api/downloads without valid status", () => {
    it("returns 400 when status is missing", async () => {
      const { status, body } = await del("/api/downloads");
      expect(status).toBe(400);
      expect(body.error).toBeDefined();
    });

    it("returns 400 when status is invalid", async () => {
      const { status, body } = await del("/api/downloads?status=pending");
      expect(status).toBe(400);
      expect(body.error).toBeDefined();
    });
  });

  describe("DELETE /api/downloads/:id/file", () => {
    it("returns 404 for unknown download", async () => {
      const { status, body } = await del("/api/downloads/nonexistent/file");
      expect(status).toBe(404);
      expect(body.error).toBe("Download not found");
    });

    it("returns deleted:false when no file path recorded", async () => {
      const track = insertTrack();
      const dl = insertDownload(track.id, { status: "done" });

      const { status, body } = await del(`/api/downloads/${dl.id}/file`);
      expect(status).toBe(200);
      expect(body.deleted).toBe(false);
      expect(body.reason).toBe("No file path recorded");
    });
  });
});
