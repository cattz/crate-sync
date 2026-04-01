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
    soulseek: { slskdUrl: "http://localhost:5030", slskdApiKey: "test", searchDelayMs: 0, downloadDir: "/tmp" },
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
    cleanupEmptyDirs: vi.fn().mockReturnValue(0),
    deleteDownloadFile: vi.fn().mockReturnValue(false),
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

function insertPlaylistTrack(playlistId: string, trackId: string) {
  return testDb.insert(schema.playlistTracks).values({
    id: crypto.randomUUID(),
    playlistId,
    trackId,
    position: 0,
  }).returning().get();
}

function insertMatch(overrides?: Partial<schema.NewMatch>) {
  const id = crypto.randomUUID();
  return testDb.insert(schema.matches).values({
    id,
    sourceType: "spotify",
    sourceId: crypto.randomUUID(),
    targetType: "lexicon",
    targetId: crypto.randomUUID(),
    score: 0.75,
    confidence: "review",
    method: "fuzzy",
    status: "pending",
    targetMeta: JSON.stringify({ title: "Lexicon Track", artist: "Lexicon Artist" }),
    parkedAt: Date.now(),
    ...overrides,
  }).returning().get();
}

describe("Review API", () => {
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

  async function post(path: string, body?: unknown) {
    const res = await app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  }

  describe("GET /api/review", () => {
    it("returns empty list when no pending reviews", async () => {
      const { status, body } = await get("/api/review");
      expect(status).toBe(200);
      expect(body).toEqual([]);
    });

    it("returns pending reviews with enriched data", async () => {
      const track = insertTrack({ title: "My Song", artist: "My Artist" });
      const playlist = insertPlaylist({ name: "Chill Vibes" });
      insertPlaylistTrack(playlist.id, track.id);

      insertMatch({
        sourceId: track.id,
        status: "pending",
        score: 0.8,
        confidence: "review",
        targetMeta: JSON.stringify({ title: "Lex Song", artist: "Lex Artist" }),
      });

      const { status, body } = await get("/api/review");
      expect(status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].spotifyTrack.title).toBe("My Song");
      expect(body[0].lexiconTrack.title).toBe("Lex Song");
      expect(body[0].playlistName).toBe("Chill Vibes");
      expect(body[0].score).toBe(0.8);
    });

    it("does not return confirmed or rejected matches", async () => {
      const track = insertTrack();
      insertMatch({ sourceId: track.id, status: "confirmed" });
      insertMatch({ sourceId: track.id, status: "rejected" });

      const { body } = await get("/api/review");
      expect(body).toEqual([]);
    });
  });

  describe("GET /api/review/stats", () => {
    it("returns zeroes when no matches", async () => {
      const { status, body } = await get("/api/review/stats");
      expect(status).toBe(200);
      expect(body.pending).toBe(0);
      expect(body.confirmed).toBe(0);
      expect(body.rejected).toBe(0);
    });

    it("returns counts by status", async () => {
      insertMatch({ status: "pending" });
      insertMatch({ status: "pending" });
      insertMatch({ status: "confirmed" });
      insertMatch({ status: "rejected" });

      const { body } = await get("/api/review/stats");
      expect(body.pending).toBe(2);
      expect(body.confirmed).toBe(1);
      expect(body.rejected).toBe(1);
    });
  });

  describe("POST /api/review/:id/confirm", () => {
    it("confirms a pending match", async () => {
      const match = insertMatch({ status: "pending" });

      const { status, body } = await post(`/api/review/${match.id}/confirm`);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);

      const updated = testDb.select().from(schema.matches).where(eq(schema.matches.id, match.id)).get();
      expect(updated!.status).toBe("confirmed");
    });

    it("returns 500 for non-existent match", async () => {
      const { status } = await post("/api/review/nonexistent/confirm");
      expect(status).toBe(500);
    });
  });

  describe("POST /api/review/:id/reject", () => {
    it("rejects a pending match and queues download", async () => {
      const track = insertTrack();
      const match = insertMatch({ sourceId: track.id, status: "pending" });

      const { status, body } = await post(`/api/review/${match.id}/reject`);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);

      const updated = testDb.select().from(schema.matches).where(eq(schema.matches.id, match.id)).get();
      expect(updated!.status).toBe("rejected");

      // Download should be auto-queued
      const dls = testDb.select().from(schema.downloads).where(eq(schema.downloads.trackId, track.id)).all();
      expect(dls).toHaveLength(1);
      expect(dls[0].origin).toBe("review_rejected");
    });

    it("returns 500 for non-existent match", async () => {
      const { status } = await post("/api/review/nonexistent/reject");
      expect(status).toBe(500);
    });
  });

  describe("POST /api/review/bulk", () => {
    it("bulk confirms multiple matches", async () => {
      const m1 = insertMatch({ status: "pending" });
      const m2 = insertMatch({ status: "pending" });

      const { status, body } = await post("/api/review/bulk", {
        matchIds: [m1.id, m2.id],
        action: "confirm",
      });

      expect(status).toBe(200);
      expect(body.confirmed).toBe(2);
    });

    it("bulk rejects multiple matches", async () => {
      const t1 = insertTrack();
      const t2 = insertTrack();
      const m1 = insertMatch({ sourceId: t1.id, status: "pending" });
      const m2 = insertMatch({ sourceId: t2.id, status: "pending" });

      const { status, body } = await post("/api/review/bulk", {
        matchIds: [m1.id, m2.id],
        action: "reject",
      });

      expect(status).toBe(200);
      expect(body.rejected).toBe(2);
      expect(body.downloadsQueued).toBe(2);
    });

    it("returns 400 when matchIds is missing", async () => {
      const { status, body } = await post("/api/review/bulk", { action: "confirm" });
      expect(status).toBe(400);
      expect(body.error).toBeDefined();
    });

    it("returns 400 when action is invalid", async () => {
      const { status, body } = await post("/api/review/bulk", {
        matchIds: ["abc"],
        action: "invalid",
      });
      expect(status).toBe(400);
      expect(body.error).toBeDefined();
    });
  });
});
