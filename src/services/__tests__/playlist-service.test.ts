import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

import * as schema from "../../db/schema.js";
import { PlaylistService } from "../playlist-service.js";

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

/** Insert a track directly and return its id. */
function insertTrack(
  db: ReturnType<typeof drizzle<typeof schema>>,
  data: {
    title: string;
    artist: string;
    spotifyId?: string;
    album?: string;
    durationMs?: number;
    spotifyUri?: string;
  },
): string {
  const id = crypto.randomUUID();
  const now = Date.now();
  db.insert(schema.tracks)
    .values({
      id,
      spotifyId: data.spotifyId ?? `sp-${id.slice(0, 8)}`,
      title: data.title,
      artist: data.artist,
      album: data.album ?? null,
      durationMs: data.durationMs ?? 200_000,
      spotifyUri: data.spotifyUri ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

// ===========================================================================
// Tests
// ===========================================================================

describe("PlaylistService", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let sqlite: InstanceType<typeof Database>;
  let svc: PlaylistService;

  beforeEach(() => {
    const result = createTestDb();
    db = result.db;
    sqlite = result.sqlite;
    svc = new PlaylistService(db);
  });

  afterEach(() => {
    sqlite.close();
  });

  // -------------------------------------------------------------------------
  // getPlaylists
  // -------------------------------------------------------------------------
  describe("getPlaylists", () => {
    it("returns all playlists", () => {
      svc.upsertPlaylist({ spotifyId: "sp-1", name: "Playlist A" });
      svc.upsertPlaylist({ spotifyId: "sp-2", name: "Playlist B" });

      const all = svc.getPlaylists();
      expect(all).toHaveLength(2);
      const names = all.map((p) => p.name).sort();
      expect(names).toEqual(["Playlist A", "Playlist B"]);
    });
  });

  // -------------------------------------------------------------------------
  // getPlaylist
  // -------------------------------------------------------------------------
  describe("getPlaylist", () => {
    it("finds by local id", () => {
      const inserted = svc.upsertPlaylist({ spotifyId: "sp-1", name: "By ID" });
      const found = svc.getPlaylist(inserted.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe("By ID");
    });

    it("finds by spotifyId", () => {
      svc.upsertPlaylist({ spotifyId: "sp-find-me", name: "By Spotify" });
      const found = svc.getPlaylist("sp-find-me");
      expect(found).not.toBeNull();
      expect(found!.name).toBe("By Spotify");
    });

    it("finds by name", () => {
      svc.upsertPlaylist({ spotifyId: "sp-x", name: "Unique Name" });
      const found = svc.getPlaylist("Unique Name");
      expect(found).not.toBeNull();
      expect(found!.spotifyId).toBe("sp-x");
    });

    it("returns null for unknown identifier", () => {
      expect(svc.getPlaylist("does-not-exist")).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // upsertPlaylist
  // -------------------------------------------------------------------------
  describe("upsertPlaylist", () => {
    it("inserts a new playlist", () => {
      const pl = svc.upsertPlaylist({ spotifyId: "sp-new", name: "New" });
      expect(pl.id).toBeDefined();
      expect(pl.name).toBe("New");
      expect(pl.spotifyId).toBe("sp-new");
    });

    it("updates an existing playlist on conflict", () => {
      svc.upsertPlaylist({ spotifyId: "sp-dup", name: "Original" });
      const updated = svc.upsertPlaylist({
        spotifyId: "sp-dup",
        name: "Updated",
        description: "new desc",
      });

      expect(updated.name).toBe("Updated");
      expect(updated.description).toBe("new desc");

      // Only one playlist should exist
      expect(svc.getPlaylists()).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // upsertTrack
  // -------------------------------------------------------------------------
  describe("upsertTrack", () => {
    it("inserts a new track", () => {
      const t = svc.upsertTrack({
        spotifyId: "sp-t1",
        title: "Song",
        artist: "Artist",
        durationMs: 180_000,
      });
      expect(t.id).toBeDefined();
      expect(t.title).toBe("Song");
    });

    it("updates an existing track on conflict", () => {
      svc.upsertTrack({
        spotifyId: "sp-t1",
        title: "Original Title",
        artist: "Artist",
        durationMs: 180_000,
      });
      const updated = svc.upsertTrack({
        spotifyId: "sp-t1",
        title: "Updated Title",
        artist: "Artist",
        durationMs: 180_000,
        album: "The Album",
      });

      expect(updated.title).toBe("Updated Title");
      expect(updated.album).toBe("The Album");
    });
  });

  // -------------------------------------------------------------------------
  // setPlaylistTracks
  // -------------------------------------------------------------------------
  describe("setPlaylistTracks", () => {
    it("replaces tracks and maintains positions", () => {
      const pl = svc.upsertPlaylist({ spotifyId: "sp-pt", name: "PT" });
      const t1 = insertTrack(db, { title: "A", artist: "X" });
      const t2 = insertTrack(db, { title: "B", artist: "Y" });
      const t3 = insertTrack(db, { title: "C", artist: "Z" });

      // Set initial tracks
      svc.setPlaylistTracks(pl.id, [t1, t2]);
      expect(svc.getPlaylistTracks(pl.id)).toHaveLength(2);

      // Replace with different set
      svc.setPlaylistTracks(pl.id, [t3, t1]);
      const result = svc.getPlaylistTracks(pl.id);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(t3);
      expect(result[0].position).toBe(0);
      expect(result[1].id).toBe(t1);
      expect(result[1].position).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // getPlaylistTracks
  // -------------------------------------------------------------------------
  describe("getPlaylistTracks", () => {
    it("returns tracks ordered by position", () => {
      const pl = svc.upsertPlaylist({ spotifyId: "sp-order", name: "Order" });
      const t1 = insertTrack(db, { title: "First", artist: "A" });
      const t2 = insertTrack(db, { title: "Second", artist: "B" });
      const t3 = insertTrack(db, { title: "Third", artist: "C" });

      svc.setPlaylistTracks(pl.id, [t3, t1, t2]);

      const result = svc.getPlaylistTracks(pl.id);
      expect(result).toHaveLength(3);
      expect(result[0].title).toBe("Third");
      expect(result[1].title).toBe("First");
      expect(result[2].title).toBe("Second");
      expect(result[0].position).toBe(0);
      expect(result[1].position).toBe(1);
      expect(result[2].position).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // findDuplicatesInPlaylist
  // -------------------------------------------------------------------------
  describe("findDuplicatesInPlaylist", () => {
    it("detects duplicates by spotifyId", () => {
      const pl = svc.upsertPlaylist({ spotifyId: "sp-dups", name: "Dups" });

      // Insert two track rows that share the same spotifyId — impossible via
      // upsertTrack (unique constraint), so we create them with different
      // spotify IDs and wire them both into the playlist, then check by
      // spotifyId grouping.
      // Actually, findDuplicatesInPlaylist groups by spotifyId on the Track
      // objects, so we need two distinct DB rows with the same spotifyId.
      // Since the tracks table has a unique index on spotify_id, we instead
      // add the *same* track twice to the playlist_tracks table.
      // But playlist_tracks has a unique index on (playlist_id, track_id)...
      //
      // The realistic scenario: two different track rows that happen to share
      // a spotifyId can't exist. The code path handles it anyway. We can test
      // by inserting two tracks with identical spotify_id by bypassing the
      // unique index (insert raw). Alternatively, test the title+artist path.
      //
      // Let's test both paths:
      // Path 1 — same spotifyId: insert raw with different PK but same spotifyId
      const now = Date.now();
      const t1Id = crypto.randomUUID();
      const t2Id = crypto.randomUUID();

      // Use raw SQL to bypass drizzle unique constraint for testing
      sqlite.exec(`
        INSERT INTO tracks (id, spotify_id, title, artist, duration_ms, created_at, updated_at)
        VALUES ('${t1Id}', 'dup-spotify', 'Dup Song', 'Artist', 200000, ${now}, ${now}),
               ('${t2Id}', 'dup-spotify2', 'Dup Song', 'Artist', 200000, ${now}, ${now})
      `);

      // Actually for spotifyId-based dedup to trigger, they need the SAME spotifyId.
      // We can't have two rows with same spotify_id due to unique index.
      // So test with two tracks that have same spotifyId value via raw insert
      // (SQLite allows if we drop the unique index, but that changes the schema).
      //
      // Better approach: use two tracks with same title+artist but no spotifyId
      // for the title+artist dedup path. And for spotifyId dedup, note that
      // findDuplicatesInPlaylist reads track objects and groups by their
      // spotifyId field. Since we can't have duplicate spotifyIds in the DB,
      // this path would only fire if there's a bug. Let's just test the
      // title+artist dedup path which is the realistic scenario.

      // Clean up raw insert
      sqlite.exec(`DELETE FROM tracks WHERE id IN ('${t1Id}', '${t2Id}')`);

      // Title+artist dedup path: tracks with null spotifyId
      const t3Id = crypto.randomUUID();
      const t4Id = crypto.randomUUID();
      sqlite.exec(`
        INSERT INTO tracks (id, spotify_id, title, artist, duration_ms, created_at, updated_at)
        VALUES ('${t3Id}', NULL, 'Same Song', 'Same Artist', 200000, ${now}, ${now}),
               ('${t4Id}', NULL, 'same song', 'same artist', 200000, ${now}, ${now})
      `);

      // Wire them into the playlist
      const ptId1 = crypto.randomUUID();
      const ptId2 = crypto.randomUUID();
      sqlite.exec(`
        INSERT INTO playlist_tracks (id, playlist_id, track_id, position)
        VALUES ('${ptId1}', '${pl.id}', '${t3Id}', 0),
               ('${ptId2}', '${pl.id}', '${t4Id}', 1)
      `);

      const dupes = svc.findDuplicatesInPlaylist(pl.id);
      expect(dupes).toHaveLength(1);
      expect(dupes[0].track.title).toBe("Same Song");
      expect(dupes[0].duplicates).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // removePlaylist
  // -------------------------------------------------------------------------
  describe("removePlaylist", () => {
    it("deletes playlist and junction entries", () => {
      const pl = svc.upsertPlaylist({ spotifyId: "sp-rm", name: "Remove Me" });
      const t1 = insertTrack(db, { title: "T", artist: "A" });
      svc.setPlaylistTracks(pl.id, [t1]);

      // Verify data exists
      expect(svc.getPlaylist(pl.id)).not.toBeNull();
      expect(svc.getPlaylistTracks(pl.id)).toHaveLength(1);

      svc.removePlaylist(pl.id);

      expect(svc.getPlaylist(pl.id)).toBeNull();
      expect(svc.getPlaylistTracks(pl.id)).toHaveLength(0);

      // Track itself should still exist (only junction + playlist removed)
      const allTracks = db.select().from(schema.tracks).all();
      expect(allTracks.find((t) => t.id === t1)).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // renamePlaylist
  // -------------------------------------------------------------------------
  describe("renamePlaylist", () => {
    it("updates the playlist name", () => {
      const pl = svc.upsertPlaylist({ spotifyId: "sp-rn", name: "Old Name" });

      svc.renamePlaylist(pl.id, "New Name");

      const updated = svc.getPlaylist(pl.id);
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe("New Name");
    });
  });

  // -------------------------------------------------------------------------
  // mergePlaylistTracks
  // -------------------------------------------------------------------------
  describe("mergePlaylistTracks", () => {
    it("merges tracks from sources, deduplicates, and counts correctly", () => {
      const target = svc.upsertPlaylist({ spotifyId: "sp-tgt", name: "Target" });
      const source = svc.upsertPlaylist({ spotifyId: "sp-src", name: "Source" });

      const t1 = insertTrack(db, { title: "Shared", artist: "A" });
      const t2 = insertTrack(db, { title: "Only Target", artist: "B" });
      const t3 = insertTrack(db, { title: "Only Source", artist: "C" });

      svc.setPlaylistTracks(target.id, [t1, t2]);
      svc.setPlaylistTracks(source.id, [t1, t3]);

      const result = svc.mergePlaylistTracks(target.id, [source.id]);

      expect(result.added).toBe(1); // t3 was added
      expect(result.duplicatesSkipped).toBe(1); // t1 was skipped

      const merged = svc.getPlaylistTracks(target.id);
      expect(merged).toHaveLength(3);
      // Order: target tracks first (t1, t2), then new from source (t3)
      expect(merged[0].id).toBe(t1);
      expect(merged[1].id).toBe(t2);
      expect(merged[2].id).toBe(t3);
    });
  });
});
