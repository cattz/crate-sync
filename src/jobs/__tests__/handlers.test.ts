import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, and } from "drizzle-orm";
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

// Mock external services
vi.mock("../../services/spotify-service.js", () => ({
  SpotifyService: vi.fn().mockImplementation(() => ({
    syncPlaylistTracks: vi.fn().mockResolvedValue({ added: 0, updated: 0 }),
  })),
}));

vi.mock("../../services/lexicon-service.js", () => ({
  LexiconService: vi.fn().mockImplementation(function () {
    return {
      getTracks: vi.fn().mockResolvedValue([]),
      getPlaylistByName: vi.fn().mockResolvedValue(null),
      createPlaylist: vi.fn().mockResolvedValue({ id: "lp1", name: "Test", trackIds: [] }),
      setPlaylistTracks: vi.fn().mockResolvedValue(undefined),
      getTags: vi.fn().mockResolvedValue({ categories: [], tags: [] }),
    };
  }),
}));

vi.mock("../../services/soulseek-service.js", () => ({
  SoulseekService: vi.fn().mockImplementation(() => ({
    rateLimitedSearch: vi.fn().mockResolvedValue([]),
    startSearchBatch: vi.fn().mockResolvedValue(new Map()),
    waitForSearchBatch: vi.fn().mockResolvedValue(new Map()),
  })),
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
  statSync: vi.fn().mockReturnValue({ mtimeMs: 0 }),
}));

import { handleMatch } from "../handlers/match.js";
import { handleWishlistScan } from "../handlers/wishlist-scan.js";
import { handleLexiconSync } from "../handlers/lexicon-sync.js";

const TEST_CONFIG: Config = {
  spotify: { clientId: "", clientSecret: "", redirectUri: "" },
  lexicon: { url: "http://localhost:48624", downloadRoot: "/tmp/test-dl" },
  soulseek: { slskdUrl: "http://localhost:5030", slskdApiKey: "test", searchDelayMs: 0, downloadDir: "/tmp/slskd" },
  matching: { autoAcceptThreshold: 0.9, reviewThreshold: 0.7 },
  download: { formats: ["flac", "mp3"], minBitrate: 320, concurrency: 2 },
  jobRunner: { pollIntervalMs: 1000, wishlistIntervalMs: 6 * 60 * 60 * 1000 },
};

function freshDb() {
  sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  testDb = drizzle(sqlite, { schema });
  migrate(testDb, { migrationsFolder });
}

function seedPlaylist(name: string, trackData: Array<{ title: string; artist: string; durationMs?: number }>) {
  const playlistId = crypto.randomUUID();
  const now = Date.now();

  testDb.insert(schema.playlists).values({
    id: playlistId,
    spotifyId: `sp-${playlistId.slice(0, 8)}`,
    name,
    createdAt: now,
    updatedAt: now,
  }).run();

  const trackIds: string[] = [];
  for (let i = 0; i < trackData.length; i++) {
    const t = trackData[i];
    const trackId = crypto.randomUUID();
    trackIds.push(trackId);

    testDb.insert(schema.tracks).values({
      id: trackId,
      spotifyId: `sp-track-${trackId.slice(0, 8)}`,
      title: t.title,
      artist: t.artist,
      durationMs: t.durationMs ?? 200_000,
      createdAt: now,
      updatedAt: now,
    }).run();

    testDb.insert(schema.playlistTracks).values({
      id: crypto.randomUUID(),
      playlistId,
      trackId,
      position: i,
      addedAt: now,
    }).run();
  }

  return { playlistId, trackIds };
}

function makeJob(overrides: Partial<schema.NewJob> & { type: schema.JobType }): schema.Job {
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

describe("Job Handlers", () => {
  beforeEach(() => {
    freshDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    sqlite.close();
  });

  describe("handleMatch", () => {
    it("creates search jobs for unmatched tracks", async () => {
      const { playlistId, trackIds } = seedPlaylist("Test Playlist", [
        { title: "Song A", artist: "Artist A" },
        { title: "Song B", artist: "Artist B" },
      ]);

      const job = makeJob({
        type: "match",
        payload: JSON.stringify({ playlistId }),
      });

      await handleMatch(job, TEST_CONFIG);

      // Should have created search jobs for tracks not found in Lexicon (which is empty)
      const searchJobs = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.type, "search"))
        .all();

      expect(searchJobs.length).toBe(2);
      expect(searchJobs[0].parentJobId).toBe(job.id);

      // Original job should be completed
      const updated = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, job.id))
        .get();

      expect(updated!.status).toBe("done");
      const result = JSON.parse(updated!.result!);
      expect(result.notFound).toBe(2);
    });

    it("does not create search jobs for matched tracks", async () => {
      const { playlistId, trackIds } = seedPlaylist("Test", [
        { title: "Already Matched", artist: "Known" },
      ]);

      // Pre-insert a confirmed match
      testDb.insert(schema.matches).values({
        id: crypto.randomUUID(),
        sourceType: "spotify",
        sourceId: trackIds[0],
        targetType: "lexicon",
        targetId: "lex-123",
        score: 0.95,
        confidence: "high",
        method: "fuzzy",
        status: "confirmed",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }).run();

      const job = makeJob({
        type: "match",
        payload: JSON.stringify({ playlistId }),
      });

      await handleMatch(job, TEST_CONFIG);

      const searchJobs = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.type, "search"))
        .all();

      expect(searchJobs.length).toBe(0);

      const result = JSON.parse(
        testDb.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get()!.result!,
      );
      expect(result.found).toBe(1);
      expect(result.notFound).toBe(0);
    });
  });

  describe("handleWishlistScan", () => {
    it("re-queues failed jobs past cooldown", async () => {
      // Create a failed search job completed 2 hours ago (past 1h cooldown for attempt 1)
      const failedJob = makeJob({
        type: "search",
        status: "failed" as any,
        attempt: 1,
        maxAttempts: 3,
        payload: JSON.stringify({ trackId: "t1" }),
      });

      testDb.update(schema.jobs)
        .set({
          status: "failed",
          completedAt: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
        })
        .where(eq(schema.jobs.id, failedJob.id))
        .run();

      const scanJob = makeJob({ type: "wishlist_scan" });
      await handleWishlistScan(scanJob, TEST_CONFIG);

      // The failed job should be re-queued
      const updated = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, failedJob.id))
        .get();

      expect(updated!.status).toBe("queued");
    });

    it("skips failed jobs still in cooldown", async () => {
      const failedJob = makeJob({
        type: "search",
        status: "failed" as any,
        attempt: 1,
        maxAttempts: 3,
      });

      // Completed just now — still in cooldown
      testDb.update(schema.jobs)
        .set({ status: "failed", completedAt: Date.now() })
        .where(eq(schema.jobs.id, failedJob.id))
        .run();

      const scanJob = makeJob({ type: "wishlist_scan" });
      await handleWishlistScan(scanJob, TEST_CONFIG);

      const updated = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, failedJob.id))
        .get();

      expect(updated!.status).toBe("failed"); // still failed
    });
  });

  describe("handleLexiconSync", () => {
    it("completes with 0 synced when no confirmed matches", async () => {
      const { playlistId } = seedPlaylist("Empty", [
        { title: "Unmatched", artist: "Nobody" },
      ]);

      const job = makeJob({
        type: "lexicon_sync",
        payload: JSON.stringify({ playlistId }),
      });

      await handleLexiconSync(job, TEST_CONFIG);

      const updated = testDb
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, job.id))
        .get();

      expect(updated!.status).toBe("done");
      expect(JSON.parse(updated!.result!).synced).toBe(0);
    });
  });
});
