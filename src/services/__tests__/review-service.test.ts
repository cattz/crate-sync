import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";

import * as schema from "../../db/schema.js";
import type { Config } from "../../config.js";
import { ReviewService } from "../review-service.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(currentDir, "../../db/migrations");

function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return { db, sqlite };
}

const TEST_CONFIG: Config = {
  spotify: { clientId: "", clientSecret: "", redirectUri: "" },
  lexicon: {
    url: "http://localhost:48624",
    downloadRoot: "/tmp/test-dl",
    tagCategory: { name: "Spotify Playlists", color: "#1DB954" },
  },
  soulseek: { slskdUrl: "http://localhost:5030", slskdApiKey: "test", searchDelayMs: 0, downloadDir: "/tmp/slskd-downloads" },
  matching: { autoAcceptThreshold: 0.9, reviewThreshold: 0.7 },
  download: { formats: ["flac", "mp3"], minBitrate: 320, concurrency: 2, validationStrictness: "moderate" },
  jobRunner: { pollIntervalMs: 1000 },
};

function seedTrack(db: ReturnType<typeof drizzle<typeof schema>>, title: string, artist: string) {
  const id = crypto.randomUUID();
  const now = Date.now();
  db.insert(schema.tracks)
    .values({
      id,
      spotifyId: `sp-${id.slice(0, 8)}`,
      title,
      artist,
      album: "Test Album",
      durationMs: 200_000,
      isrc: "US1234567890",
      spotifyUri: `spotify:track:${id.slice(0, 8)}`,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

function seedPlaylist(db: ReturnType<typeof drizzle<typeof schema>>, name: string, trackIds: string[]) {
  const id = crypto.randomUUID();
  const now = Date.now();
  db.insert(schema.playlists)
    .values({
      id,
      spotifyId: `sp-pl-${id.slice(0, 8)}`,
      name,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  for (let i = 0; i < trackIds.length; i++) {
    db.insert(schema.playlistTracks)
      .values({
        id: crypto.randomUUID(),
        playlistId: id,
        trackId: trackIds[i],
        position: i,
        addedAt: now,
      })
      .run();
  }

  return id;
}

function seedMatch(
  db: ReturnType<typeof drizzle<typeof schema>>,
  sourceId: string,
  targetId: string,
  status: "pending" | "confirmed" | "rejected",
  opts?: { parkedAt?: number; targetMeta?: string },
) {
  const id = crypto.randomUUID();
  const now = Date.now();
  db.insert(schema.matches)
    .values({
      id,
      sourceType: "spotify",
      sourceId,
      targetType: "lexicon",
      targetId,
      score: 0.82,
      confidence: "review",
      method: "fuzzy",
      status,
      targetMeta: opts?.targetMeta ?? JSON.stringify({ title: "Lex Track", artist: "Lex Artist", album: "Lex Album", durationMs: 200_000 }),
      parkedAt: opts?.parkedAt ?? (status === "pending" ? now : undefined),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

// ===========================================================================
// Tests
// ===========================================================================

describe("ReviewService", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let sqlite: InstanceType<typeof Database>;
  let svc: ReviewService;

  beforeEach(() => {
    const result = createTestDb();
    db = result.db;
    sqlite = result.sqlite;
    svc = new ReviewService(TEST_CONFIG, { db });
  });

  afterEach(() => {
    sqlite.close();
  });

  // =========================================================================
  // getPending
  // =========================================================================
  describe("getPending", () => {
    it("returns only pending matches", async () => {
      const trackId1 = seedTrack(db, "Track 1", "Artist 1");
      const trackId2 = seedTrack(db, "Track 2", "Artist 2");
      const trackId3 = seedTrack(db, "Track 3", "Artist 3");

      seedMatch(db, trackId1, "lex-1", "pending");
      seedMatch(db, trackId2, "lex-2", "confirmed");
      seedMatch(db, trackId3, "lex-3", "rejected");

      const pending = await svc.getPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].spotifyTrack.title).toBe("Track 1");
    });

    it("filters by playlist when playlistId provided", async () => {
      const trackId1 = seedTrack(db, "Track A", "Artist A");
      const trackId2 = seedTrack(db, "Track B", "Artist B");

      const pl1 = seedPlaylist(db, "Playlist 1", [trackId1]);
      seedPlaylist(db, "Playlist 2", [trackId2]);

      seedMatch(db, trackId1, "lex-1", "pending");
      seedMatch(db, trackId2, "lex-2", "pending");

      const pending = await svc.getPending(pl1);
      expect(pending).toHaveLength(1);
      expect(pending[0].spotifyTrack.title).toBe("Track A");
    });

    it("includes track details from stored metadata", async () => {
      const trackId = seedTrack(db, "My Song", "My Artist");
      seedPlaylist(db, "Test PL", [trackId]);
      seedMatch(db, trackId, "lex-1", "pending", {
        targetMeta: JSON.stringify({ title: "Lex Song", artist: "Lex Artist", album: "Lex Album", durationMs: 300_000 }),
      });

      const pending = await svc.getPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].spotifyTrack.title).toBe("My Song");
      expect(pending[0].spotifyTrack.artist).toBe("My Artist");
      expect(pending[0].lexiconTrack.title).toBe("Lex Song");
      expect(pending[0].lexiconTrack.artist).toBe("Lex Artist");
    });

    it("sorts by parkedAt ASC (FIFO)", async () => {
      const trackId1 = seedTrack(db, "First", "A");
      const trackId2 = seedTrack(db, "Second", "B");
      const trackId3 = seedTrack(db, "Third", "C");

      seedMatch(db, trackId3, "lex-3", "pending", { parkedAt: 3000 });
      seedMatch(db, trackId1, "lex-1", "pending", { parkedAt: 1000 });
      seedMatch(db, trackId2, "lex-2", "pending", { parkedAt: 2000 });

      const pending = await svc.getPending();
      expect(pending).toHaveLength(3);
      expect(pending[0].spotifyTrack.title).toBe("First");
      expect(pending[1].spotifyTrack.title).toBe("Second");
      expect(pending[2].spotifyTrack.title).toBe("Third");
    });

    it("returns empty array when no pending matches", async () => {
      const pending = await svc.getPending();
      expect(pending).toEqual([]);
    });

    it("resolves playlist name", async () => {
      const trackId = seedTrack(db, "Song", "Artist");
      seedPlaylist(db, "My Cool Playlist", [trackId]);
      seedMatch(db, trackId, "lex-1", "pending");

      const pending = await svc.getPending();
      expect(pending[0].playlistName).toBe("My Cool Playlist");
    });
  });

  // =========================================================================
  // confirm
  // =========================================================================
  describe("confirm", () => {
    it("confirms a pending match", async () => {
      const trackId = seedTrack(db, "Track", "Artist");
      const matchId = seedMatch(db, trackId, "lex-1", "pending");

      await svc.confirm(matchId);

      const match = await db.query.matches.findFirst({
        where: eq(schema.matches.id, matchId),
      });
      expect(match).toBeDefined();
      expect(match!.status).toBe("confirmed");
    });

    it("is idempotent on already-confirmed matches", async () => {
      const trackId = seedTrack(db, "Track", "Artist");
      const matchId = seedMatch(db, trackId, "lex-1", "confirmed");

      // Should not throw
      await svc.confirm(matchId);

      const match = await db.query.matches.findFirst({
        where: eq(schema.matches.id, matchId),
      });
      expect(match!.status).toBe("confirmed");
    });

    it("throws for non-existent match", async () => {
      await expect(svc.confirm("non-existent")).rejects.toThrow("Match not found");
    });

    it("does not create a download entry", async () => {
      const trackId = seedTrack(db, "Track", "Artist");
      const matchId = seedMatch(db, trackId, "lex-1", "pending");

      await svc.confirm(matchId);

      const downloads = db.select().from(schema.downloads).all();
      expect(downloads).toHaveLength(0);
    });
  });

  // =========================================================================
  // reject
  // =========================================================================
  describe("reject", () => {
    it("rejects a pending match", async () => {
      const trackId = seedTrack(db, "Track", "Artist");
      const matchId = seedMatch(db, trackId, "lex-1", "pending");

      await svc.reject(matchId);

      const match = await db.query.matches.findFirst({
        where: eq(schema.matches.id, matchId),
      });
      expect(match!.status).toBe("rejected");
    });

    it("auto-queues a download on rejection", async () => {
      const trackId = seedTrack(db, "Track", "Artist");
      const matchId = seedMatch(db, trackId, "lex-1", "pending");

      await svc.reject(matchId);

      const downloads = db.select().from(schema.downloads).all();
      expect(downloads).toHaveLength(1);
      expect(downloads[0].trackId).toBe(trackId);
      expect(downloads[0].status).toBe("pending");
      expect(downloads[0].origin).toBe("review_rejected");
    });

    it("is idempotent on already-rejected matches", async () => {
      const trackId = seedTrack(db, "Track", "Artist");
      const matchId = seedMatch(db, trackId, "lex-1", "rejected");

      // Should not throw
      await svc.reject(matchId);

      // Should not create a duplicate download
      const downloads = db.select().from(schema.downloads).all();
      expect(downloads).toHaveLength(0);
    });

    it("throws for non-existent match", async () => {
      await expect(svc.reject("non-existent")).rejects.toThrow("Match not found");
    });
  });

  // =========================================================================
  // bulkConfirm
  // =========================================================================
  describe("bulkConfirm", () => {
    it("confirms multiple pending matches", async () => {
      const t1 = seedTrack(db, "Track 1", "A");
      const t2 = seedTrack(db, "Track 2", "B");
      const t3 = seedTrack(db, "Track 3", "C");

      const m1 = seedMatch(db, t1, "lex-1", "pending");
      const m2 = seedMatch(db, t2, "lex-2", "pending");
      const m3 = seedMatch(db, t3, "lex-3", "pending");

      const result = await svc.bulkConfirm([m1, m2, m3]);
      expect(result.confirmed).toBe(3);
    });

    it("skips already confirmed (counted via idempotent behavior)", async () => {
      const t1 = seedTrack(db, "Track 1", "A");
      const t2 = seedTrack(db, "Track 2", "B");

      const m1 = seedMatch(db, t1, "lex-1", "pending");
      const m2 = seedMatch(db, t2, "lex-2", "confirmed");

      const result = await svc.bulkConfirm([m1, m2]);
      // m1 confirmed, m2 is idempotent (no-op but counted)
      expect(result.confirmed).toBe(2);
    });

    it("returns { confirmed: 0 } for empty array", async () => {
      const result = await svc.bulkConfirm([]);
      expect(result.confirmed).toBe(0);
    });
  });

  // =========================================================================
  // bulkReject
  // =========================================================================
  describe("bulkReject", () => {
    it("rejects multiple with downloads", async () => {
      const t1 = seedTrack(db, "Track 1", "A");
      const t2 = seedTrack(db, "Track 2", "B");
      const t3 = seedTrack(db, "Track 3", "C");

      const m1 = seedMatch(db, t1, "lex-1", "pending");
      const m2 = seedMatch(db, t2, "lex-2", "pending");
      const m3 = seedMatch(db, t3, "lex-3", "pending");

      const result = await svc.bulkReject([m1, m2, m3]);
      expect(result.rejected).toBe(3);
      expect(result.downloadsQueued).toBe(3);

      const downloads = db.select().from(schema.downloads).all();
      expect(downloads).toHaveLength(3);
    });

    it("skips invalid IDs", async () => {
      const t1 = seedTrack(db, "Track 1", "A");
      const m1 = seedMatch(db, t1, "lex-1", "pending");

      const result = await svc.bulkReject([m1, "invalid-id"]);
      expect(result.rejected).toBe(1);
      expect(result.downloadsQueued).toBe(1);
    });

    it("returns zeros for empty array", async () => {
      const result = await svc.bulkReject([]);
      expect(result.rejected).toBe(0);
      expect(result.downloadsQueued).toBe(0);
    });
  });

  // =========================================================================
  // getStats
  // =========================================================================
  describe("getStats", () => {
    it("returns correct counts", async () => {
      const t1 = seedTrack(db, "T1", "A");
      const t2 = seedTrack(db, "T2", "B");
      const t3 = seedTrack(db, "T3", "C");
      const t4 = seedTrack(db, "T4", "D");
      const t5 = seedTrack(db, "T5", "E");

      seedMatch(db, t1, "lex-1", "pending");
      seedMatch(db, t2, "lex-2", "pending");
      seedMatch(db, t3, "lex-3", "confirmed");
      seedMatch(db, t4, "lex-4", "confirmed");
      seedMatch(db, t5, "lex-5", "rejected");

      const stats = await svc.getStats();
      expect(stats.pending).toBe(2);
      expect(stats.confirmed).toBe(2);
      expect(stats.rejected).toBe(1);
    });

    it("returns zeros for empty table", async () => {
      const stats = await svc.getStats();
      expect(stats.pending).toBe(0);
      expect(stats.confirmed).toBe(0);
      expect(stats.rejected).toBe(0);
    });

    it("filters to spotify-lexicon matches only", async () => {
      const t1 = seedTrack(db, "T1", "A");
      seedMatch(db, t1, "lex-1", "pending");

      // Manually insert a non-spotify match
      db.insert(schema.matches)
        .values({
          id: crypto.randomUUID(),
          sourceType: "soulseek",
          sourceId: "slsk-1",
          targetType: "lexicon",
          targetId: "lex-x",
          score: 0.9,
          confidence: "high",
          method: "fuzzy",
          status: "pending",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        .run();

      const stats = await svc.getStats();
      expect(stats.pending).toBe(1); // Only the spotify one
    });
  });
});
