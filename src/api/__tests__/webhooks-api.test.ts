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
    lexicon: { url: "http://localhost:48624", downloadRoot: "/tmp/lexicon" },
    soulseek: {
      slskdUrl: "http://localhost:5030",
      slskdApiKey: "test",
      searchDelayMs: 0,
      downloadDir: "/tmp/slskd",
      downloadTimeoutMs: 1800000,
      fileScanIntervalMs: 15000,
    },
    matching: {
      autoAcceptThreshold: 0.9,
      reviewThreshold: 0.7,
      notFoundThreshold: 0.65,
      soulseekWeights: { title: 0.3, artist: 0.25, album: 0.1, duration: 0.35 },
    },
    download: { formats: ["flac", "mp3"], minBitrate: 320, concurrency: 2, validationStrictness: "lenient" },
    jobRunner: { pollIntervalMs: 1000, concurrency: 3, retentionDays: 7 },
    logging: { level: "info", file: false },
    sources: { priority: ["soulseek"], local: {} },
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

vi.mock("../../services/download-service.js", () => {
  const instance = {
    findDownloadedFile: vi.fn().mockReturnValue(null),
    checkFileStable: vi.fn().mockResolvedValue(true),
    validateDownload: vi.fn().mockResolvedValue(true),
    moveToPlaylistFolder: vi.fn().mockReturnValue("/tmp/lexicon/Test Playlist/Artist - Title.flac"),
    cleanupEmptyDirs: vi.fn().mockReturnValue(0),
    deleteDownloadFile: vi.fn().mockReturnValue(true),
  };
  return {
    DownloadService: Object.assign(
      vi.fn().mockImplementation(() => instance),
      { fromDb: vi.fn().mockReturnValue(instance) },
    ),
    __mockInstance: instance,
  };
});

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

// Mock node:fs existsSync for localPath check
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: (p: string) => {
      // For webhook test localPath, pretend it exists
      if (p === "/tmp/slskd/downloads/test-file.flac") return true;
      return actual.existsSync(p);
    },
  };
});

import { createApp } from "../server.js";
import { __mockInstance as downloadMock } from "../../services/download-service.js";

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

describe("Webhooks API", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    freshDb();
    app = createApp();
    vi.clearAllMocks();
  });

  afterEach(() => {
    sqlite.close();
  });

  async function post(path: string, body: unknown) {
    const res = await app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }

  describe("POST /api/webhooks/slskd/download-complete", () => {
    it("returns 400 when required fields are missing", async () => {
      const { status, body } = await post("/api/webhooks/slskd/download-complete", {});
      expect(status).toBe(400);
      expect(body.ok).toBe(false);
      expect(body.reason).toContain("Missing required fields");
    });

    it("returns 400 when username is missing", async () => {
      const { status, body } = await post("/api/webhooks/slskd/download-complete", {
        filename: "test.flac",
      });
      expect(status).toBe(400);
      expect(body.ok).toBe(false);
    });

    it("returns 404 when no matching download is found", async () => {
      const { status, body } = await post("/api/webhooks/slskd/download-complete", {
        username: "some-user",
        filename: "some-file.flac",
      });
      expect(status).toBe(404);
      expect(body.ok).toBe(false);
      expect(body.reason).toContain("No matching download");
    });

    it("completes a valid download and updates status to done", async () => {
      const playlist = insertPlaylist({ name: "Deep House" });
      const track = insertTrack({ title: "Sunset", artist: "DJ Flow" });
      const dl = insertDownload(track.id, {
        status: "downloading",
        playlistId: playlist.id,
        slskdUsername: "test-user",
        slskdFilename: "@@share\\music\\DJ Flow\\Sunset.flac",
        startedAt: Date.now(),
      });

      // Mock: file is found via localPath
      const mock = downloadMock as any;
      mock.findDownloadedFile.mockReturnValue("/tmp/slskd/downloads/test-file.flac");
      mock.checkFileStable.mockResolvedValue(true);
      mock.validateDownload.mockResolvedValue(true);
      mock.moveToPlaylistFolder.mockReturnValue("/tmp/lexicon/Deep House/DJ Flow - Sunset.flac");

      const { status, body } = await post("/api/webhooks/slskd/download-complete", {
        username: "test-user",
        filename: "@@share\\music\\DJ Flow\\Sunset.flac",
        localPath: "/tmp/slskd/downloads/test-file.flac",
      });

      expect(status).toBe(200);
      expect(body.ok).toBe(true);

      // Verify download status was updated
      const updated = testDb
        .select()
        .from(schema.downloads)
        .where(eq(schema.downloads.id, dl.id))
        .get();
      expect(updated?.status).toBe("done");
      expect(updated?.filePath).toBe("/tmp/lexicon/Deep House/DJ Flow - Sunset.flac");
      expect(updated?.completedAt).toBeDefined();
    });

    it("does not match downloads in non-downloading state", async () => {
      const track = insertTrack();
      insertDownload(track.id, {
        status: "pending",
        slskdUsername: "test-user",
        slskdFilename: "test.flac",
      });

      const { status, body } = await post("/api/webhooks/slskd/download-complete", {
        username: "test-user",
        filename: "test.flac",
      });

      expect(status).toBe(404);
      expect(body.ok).toBe(false);
    });
  });
});
