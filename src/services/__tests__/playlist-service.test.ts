import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

import * as schema from "../../db/schema.js";
import { PlaylistService } from "../playlist-service.js";
import type { TrackStatus } from "../playlist-service.js";

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
    svc = PlaylistService.fromDb(db);
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
  // bulkRename
  // -------------------------------------------------------------------------
  describe("bulkRename", () => {
    it("renames matching playlists", () => {
      svc.upsertPlaylist({ spotifyId: "sp-a", name: "WIP - A" });
      svc.upsertPlaylist({ spotifyId: "sp-b", name: "WIP - B" });
      svc.upsertPlaylist({ spotifyId: "sp-c", name: "Final C" });

      const results = svc.bulkRename(/^WIP - /, "");
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.newName).sort()).toEqual(["A", "B"]);

      // Verify DB updated
      expect(svc.getPlaylist("sp-a")!.name).toBe("A");
      expect(svc.getPlaylist("sp-b")!.name).toBe("B");
      expect(svc.getPlaylist("sp-c")!.name).toBe("Final C");
    });

    it("dryRun does not persist", () => {
      svc.upsertPlaylist({ spotifyId: "sp-dry", name: "WIP - Dry" });

      const results = svc.bulkRename(/^WIP - /, "", { dryRun: true });
      expect(results).toHaveLength(1);
      expect(results[0].newName).toBe("Dry");

      // DB unchanged
      expect(svc.getPlaylist("sp-dry")!.name).toBe("WIP - Dry");
    });

    it("accepts string pattern", () => {
      svc.upsertPlaylist({ spotifyId: "sp-str", name: "WIP done" });

      const results = svc.bulkRename("WIP", "DONE");
      expect(results).toHaveLength(1);
      expect(results[0].newName).toBe("DONE done");
    });

    it("returns empty for no matches", () => {
      svc.upsertPlaylist({ spotifyId: "sp-none", name: "Hello" });
      expect(svc.bulkRename(/^ZZZZZ/, "X")).toEqual([]);
    });

    it("global flag replaces all occurrences", () => {
      svc.upsertPlaylist({ spotifyId: "sp-g", name: "a/b/a" });

      const results = svc.bulkRename(/a/g, "x");
      expect(results).toHaveLength(1);
      expect(results[0].newName).toBe("x/b/x");
    });
  });

  // -------------------------------------------------------------------------
  // updateMetadata
  // -------------------------------------------------------------------------
  describe("updateMetadata", () => {
    it("updates tags only", () => {
      const pl = svc.upsertPlaylist({ spotifyId: "sp-meta", name: "Meta" });
      svc.updateMetadata(pl.id, { tags: '["Techno"]' });

      const updated = svc.getPlaylist(pl.id)!;
      expect(updated.tags).toBe('["Techno"]');
      expect(updated.notes).toBeNull();
    });

    it("updates notes only", () => {
      const pl = svc.upsertPlaylist({ spotifyId: "sp-notes", name: "Notes" });
      svc.updateMetadata(pl.id, { notes: "Great set" });

      const updated = svc.getPlaylist(pl.id)!;
      expect(updated.notes).toBe("Great set");
    });

    it("updates pinned", () => {
      const pl = svc.upsertPlaylist({ spotifyId: "sp-pin", name: "Pin" });
      svc.updateMetadata(pl.id, { pinned: 1 });

      expect(svc.getPlaylist(pl.id)!.pinned).toBe(1);
    });

    it("updates multiple fields at once", () => {
      const pl = svc.upsertPlaylist({ spotifyId: "sp-multi", name: "Multi" });
      svc.updateMetadata(pl.id, {
        tags: '["House"]',
        notes: "Club mix",
        pinned: 1,
      });

      const updated = svc.getPlaylist(pl.id)!;
      expect(updated.tags).toBe('["House"]');
      expect(updated.notes).toBe("Club mix");
      expect(updated.pinned).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // composeDescription
  // -------------------------------------------------------------------------
  describe("composeDescription", () => {
    it("serializes tags and notes", () => {
      const pl = svc.upsertPlaylist({ spotifyId: "sp-desc", name: "Desc" });
      svc.updateMetadata(pl.id, {
        tags: '["Techno","Dark"]',
        notes: "Late night vibes",
      });

      const desc = svc.composeDescription(pl.id);
      expect(desc).toBe("Late night vibes\n\nTags: Techno, Dark");
    });

    it("handles notes only", () => {
      const pl = svc.upsertPlaylist({ spotifyId: "sp-nonly", name: "NOnly" });
      svc.updateMetadata(pl.id, { notes: "Just notes" });

      expect(svc.composeDescription(pl.id)).toBe("Just notes");
    });

    it("handles tags only", () => {
      const pl = svc.upsertPlaylist({ spotifyId: "sp-tonly", name: "TOnly" });
      svc.updateMetadata(pl.id, { tags: '["House","Minimal"]' });

      expect(svc.composeDescription(pl.id)).toBe("Tags: House, Minimal");
    });

    it("throws for missing playlist", () => {
      expect(() => svc.composeDescription("nonexistent")).toThrow(
        "Playlist not found: nonexistent",
      );
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
  // deriveTrackStatus (private, tested via getPlaylistTracks with enriched)
  // -------------------------------------------------------------------------
  describe("deriveTrackStatus", () => {
    function seedMatch(
      trackId: string,
      status: "pending" | "confirmed" | "rejected",
    ): void {
      const now = Date.now();
      db.insert(schema.matches)
        .values({
          id: crypto.randomUUID(),
          sourceType: "spotify",
          sourceId: trackId,
          targetType: "lexicon",
          targetId: `lex-${crypto.randomUUID().slice(0, 8)}`,
          score: 0.95,
          confidence: "high",
          method: "fuzzy",
          status,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    function seedDownload(
      trackId: string,
      status: "pending" | "searching" | "downloading" | "validating" | "moving" | "done" | "failed" | "wishlisted",
    ): void {
      const now = Date.now();
      db.insert(schema.downloads)
        .values({
          id: crypto.randomUUID(),
          trackId,
          status,
          origin: "not_found",
          createdAt: now,
        })
        .run();
    }

    function seedJob(
      trackId: string,
      status: "queued" | "running" | "done" | "failed",
    ): void {
      const now = Date.now();
      db.insert(schema.jobs)
        .values({
          id: crypto.randomUUID(),
          type: "search",
          status,
          priority: 0,
          payload: JSON.stringify({ trackId }),
          createdAt: now,
        })
        .run();
    }

    function getTrackStatus(trackId: string): TrackStatus {
      const pl = svc.upsertPlaylist({ spotifyId: `sp-status-${trackId.slice(0, 8)}`, name: `Status ${trackId.slice(0, 8)}` });
      svc.setPlaylistTracks(pl.id, [trackId]);
      const rows = svc.getPlaylistTracks(pl.id, { enriched: true });
      return rows[0].trackStatus!;
    }

    it('returns "in_lexicon" for confirmed match', () => {
      const trackId = insertTrack(db, { title: "Confirmed", artist: "Artist" });
      seedMatch(trackId, "confirmed");
      expect(getTrackStatus(trackId)).toBe("in_lexicon");
    });

    it('returns "pending_review" for pending match', () => {
      const trackId = insertTrack(db, { title: "Pending", artist: "Artist" });
      seedMatch(trackId, "pending");
      expect(getTrackStatus(trackId)).toBe("pending_review");
    });

    it('returns "downloading" for active download', () => {
      const trackId = insertTrack(db, { title: "Downloading", artist: "Artist" });
      seedDownload(trackId, "downloading");
      expect(getTrackStatus(trackId)).toBe("downloading");
    });

    it('returns "downloading" for pending download', () => {
      const trackId = insertTrack(db, { title: "DlPending", artist: "Artist" });
      seedDownload(trackId, "pending");
      expect(getTrackStatus(trackId)).toBe("downloading");
    });

    it('returns "downloading" for searching download', () => {
      const trackId = insertTrack(db, { title: "Searching", artist: "Artist" });
      seedDownload(trackId, "searching");
      expect(getTrackStatus(trackId)).toBe("downloading");
    });

    it('returns "downloading" for validating download', () => {
      const trackId = insertTrack(db, { title: "Validating", artist: "Artist" });
      seedDownload(trackId, "validating");
      expect(getTrackStatus(trackId)).toBe("downloading");
    });

    it('returns "downloading" for moving download', () => {
      const trackId = insertTrack(db, { title: "Moving", artist: "Artist" });
      seedDownload(trackId, "moving");
      expect(getTrackStatus(trackId)).toBe("downloading");
    });

    it('returns "downloaded" for done download', () => {
      const trackId = insertTrack(db, { title: "Done", artist: "Artist" });
      seedDownload(trackId, "done");
      expect(getTrackStatus(trackId)).toBe("downloaded");
    });

    it('returns "download_failed" for failed download', () => {
      const trackId = insertTrack(db, { title: "Failed", artist: "Artist" });
      seedDownload(trackId, "failed");
      expect(getTrackStatus(trackId)).toBe("download_failed");
    });

    it('returns "wishlisted" for wishlisted download', () => {
      const trackId = insertTrack(db, { title: "Wishlisted", artist: "Artist" });
      seedDownload(trackId, "wishlisted");
      expect(getTrackStatus(trackId)).toBe("wishlisted");
    });

    it('returns "search_failed" for failed search job (no download)', () => {
      const trackId = insertTrack(db, { title: "SearchFail", artist: "Artist" });
      seedJob(trackId, "failed");
      expect(getTrackStatus(trackId)).toBe("search_failed");
    });

    it('returns "not_matched" when no match/download/job exists', () => {
      const trackId = insertTrack(db, { title: "Nothing", artist: "Artist" });
      expect(getTrackStatus(trackId)).toBe("not_matched");
    });

    it("match takes priority over download", () => {
      const trackId = insertTrack(db, { title: "MatchWins", artist: "Artist" });
      seedMatch(trackId, "confirmed");
      seedDownload(trackId, "downloading");
      expect(getTrackStatus(trackId)).toBe("in_lexicon");
    });

    it("rejected match falls through to download status", () => {
      const trackId = insertTrack(db, { title: "Rejected", artist: "Artist" });
      seedMatch(trackId, "rejected");
      seedDownload(trackId, "done");
      expect(getTrackStatus(trackId)).toBe("downloaded");
    });
  });

  // -------------------------------------------------------------------------
  // bulkRename — regex pattern
  // -------------------------------------------------------------------------
  describe("bulkRename (regex)", () => {
    it("renames with capture groups", () => {
      svc.upsertPlaylist({ spotifyId: "sp-cap", name: "2024 - Summer Mix" });
      svc.upsertPlaylist({ spotifyId: "sp-cap2", name: "2023 - Winter Mix" });

      const results = svc.bulkRename(/^(\d{4}) - /, "$1: ");
      expect(results).toHaveLength(2);
      const names = results.map((r) => r.newName).sort();
      expect(names).toEqual(["2023: Winter Mix", "2024: Summer Mix"]);
    });

    it("scopes rename to specific playlist IDs", () => {
      const a = svc.upsertPlaylist({ spotifyId: "sp-scope-a", name: "WIP Alpha" });
      svc.upsertPlaylist({ spotifyId: "sp-scope-b", name: "WIP Beta" });

      const results = svc.bulkRename(/^WIP /, "", { playlistIds: [a.id] });
      expect(results).toHaveLength(1);
      expect(results[0].newName).toBe("Alpha");
      // Beta should be untouched
      expect(svc.getPlaylist("sp-scope-b")!.name).toBe("WIP Beta");
    });
  });

  // -------------------------------------------------------------------------
  // composeDescription (additional edge cases)
  // -------------------------------------------------------------------------
  describe("composeDescription (extra)", () => {
    it("returns empty string when no tags or notes", () => {
      const pl = svc.upsertPlaylist({ spotifyId: "sp-empty-desc", name: "Empty" });
      expect(svc.composeDescription(pl.id)).toBe("");
    });
  });

});
