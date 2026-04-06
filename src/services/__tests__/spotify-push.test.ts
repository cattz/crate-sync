import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pushPlaylist } from "../spotify-push.js";
import type { SpotifyService } from "../spotify-service.js";
import type { PlaylistService } from "../playlist-service.js";
import type { Playlist, Track } from "../../db/schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlaylist(overrides: Partial<Playlist> = {}): Playlist {
  return {
    id: "local-1",
    spotifyId: "sp-1",
    name: "My Playlist",
    description: null,
    snapshotId: "snap-1",
    isOwned: 1,
    ownerId: "user-1",
    ownerName: "User",
    tags: null,
    notes: null,
    pinned: 0,
    lastSynced: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

type TrackRow = Track & { position: number };

function makeTrack(overrides: Partial<TrackRow> = {}): TrackRow {
  return {
    id: `track-${Math.random().toString(36).slice(2, 8)}`,
    spotifyId: `sp-track-${Math.random().toString(36).slice(2, 8)}`,
    title: "Some Track",
    artist: "Some Artist",
    album: "Some Album",
    durationMs: 200_000,
    isrc: null,
    spotifyUri: `spotify:track:${Math.random().toString(36).slice(2, 14)}`,
    isLocal: 0,
    position: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function createMockSpotifyService(overrides: Partial<SpotifyService> = {}) {
  return {
    getPlaylistDetails: vi.fn().mockResolvedValue({
      name: "My Playlist",
      description: "",
      tracks: { total: 10 },
    }),
    getPlaylistTracks: vi.fn().mockResolvedValue([]),
    renamePlaylist: vi.fn().mockResolvedValue(undefined),
    updatePlaylistDescription: vi.fn().mockResolvedValue(undefined),
    addTracksToPlaylist: vi.fn().mockResolvedValue(undefined),
    removeTracksFromPlaylist: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as SpotifyService;
}

function createMockPlaylistService(overrides: Partial<PlaylistService> = {}) {
  return {
    getPlaylist: vi.fn().mockReturnValue(makePlaylist()),
    getPlaylistTracks: vi.fn().mockReturnValue([]),
    getPlaylistDiff: vi.fn().mockReturnValue({ toAdd: [], toRemove: [], renamed: false }),
    composeDescription: vi.fn().mockReturnValue(""),
    ...overrides,
  } as unknown as PlaylistService;
}

// ===========================================================================
// Tests
// ===========================================================================

describe("pushPlaylist", () => {
  let spotifySvc: ReturnType<typeof createMockSpotifyService>;
  let playlistSvc: ReturnType<typeof createMockPlaylistService>;

  beforeEach(() => {
    spotifySvc = createMockSpotifyService();
    playlistSvc = createMockPlaylistService();
  });

  // =========================================================================
  // Basic operation
  // =========================================================================

  it("happy path — all changes", async () => {
    const playlist = makePlaylist({ name: "New Name" });
    playlistSvc = createMockPlaylistService({
      getPlaylist: vi.fn().mockReturnValue(playlist),
      getPlaylistTracks: vi.fn().mockReturnValue([
        makeTrack({ spotifyUri: "spotify:track:add1" }),
      ]),
      getPlaylistDiff: vi.fn().mockReturnValue({
        toAdd: ["spotify:track:add1"],
        toRemove: ["spotify:track:rm1"],
        renamed: false,
      }),
      composeDescription: vi.fn().mockReturnValue("Updated desc"),
    });
    spotifySvc = createMockSpotifyService({
      getPlaylistDetails: vi.fn().mockResolvedValue({
        name: "Old Name",
        description: "Old desc",
        tracks: { total: 5 },
      }),
    });

    const summary = await pushPlaylist("local-1", spotifySvc, playlistSvc);

    expect(summary.renamed).toEqual({ from: "Old Name", to: "New Name" });
    expect(summary.descriptionUpdated).toBe(true);
    expect(summary.tracksAdded).toBe(1);
    expect(summary.tracksRemoved).toBe(1);
    expect(summary.dryRun).toBe(false);

    expect(spotifySvc.renamePlaylist).toHaveBeenCalledWith("sp-1", "New Name");
    expect(spotifySvc.updatePlaylistDescription).toHaveBeenCalledWith("sp-1", "Updated desc");
    expect(spotifySvc.removeTracksFromPlaylist).toHaveBeenCalledWith("sp-1", ["spotify:track:rm1"]);
    expect(spotifySvc.addTracksToPlaylist).toHaveBeenCalledWith("sp-1", ["spotify:track:add1"]);
  });

  it("no changes detected", async () => {
    const summary = await pushPlaylist("local-1", spotifySvc, playlistSvc);

    expect(summary.renamed).toBeNull();
    expect(summary.descriptionUpdated).toBe(false);
    expect(summary.tracksAdded).toBe(0);
    expect(summary.tracksRemoved).toBe(0);

    expect(spotifySvc.renamePlaylist).not.toHaveBeenCalled();
    expect(spotifySvc.updatePlaylistDescription).not.toHaveBeenCalled();
    expect(spotifySvc.addTracksToPlaylist).not.toHaveBeenCalled();
    expect(spotifySvc.removeTracksFromPlaylist).not.toHaveBeenCalled();
  });

  it("dry run skips writes", async () => {
    const playlist = makePlaylist({ name: "New Name" });
    playlistSvc = createMockPlaylistService({
      getPlaylist: vi.fn().mockReturnValue(playlist),
      getPlaylistTracks: vi.fn().mockReturnValue([
        makeTrack({ spotifyUri: "spotify:track:add1" }),
      ]),
      getPlaylistDiff: vi.fn().mockReturnValue({
        toAdd: ["spotify:track:add1"],
        toRemove: [],
        renamed: false,
      }),
      composeDescription: vi.fn().mockReturnValue("New desc"),
    });
    spotifySvc = createMockSpotifyService({
      getPlaylistDetails: vi.fn().mockResolvedValue({
        name: "Old Name",
        description: "Old desc",
      }),
    });

    const summary = await pushPlaylist("local-1", spotifySvc, playlistSvc, {
      dryRun: true,
    });

    expect(summary.dryRun).toBe(true);
    expect(summary.renamed).toEqual({ from: "Old Name", to: "New Name" });
    expect(summary.descriptionUpdated).toBe(false); // not executed
    expect(summary.tracksAdded).toBe(1);

    expect(spotifySvc.renamePlaylist).not.toHaveBeenCalled();
    expect(spotifySvc.updatePlaylistDescription).not.toHaveBeenCalled();
    expect(spotifySvc.addTracksToPlaylist).not.toHaveBeenCalled();
  });

  it("throws for missing playlist", async () => {
    playlistSvc = createMockPlaylistService({
      getPlaylist: vi.fn().mockReturnValue(null),
    });

    await expect(
      pushPlaylist("nonexistent", spotifySvc, playlistSvc),
    ).rejects.toThrow("Playlist not found: nonexistent");
  });

  it("throws for local-only playlist (no spotifyId)", async () => {
    playlistSvc = createMockPlaylistService({
      getPlaylist: vi.fn().mockReturnValue(makePlaylist({ spotifyId: null })),
      getPlaylistTracks: vi.fn().mockReturnValue([]),
    });

    await expect(
      pushPlaylist("local-only", spotifySvc, playlistSvc),
    ).rejects.toThrow("Playlist has no Spotify ID: local-only");
  });

  // =========================================================================
  // Safety: never empty a Spotify playlist (local/broken tracks)
  // =========================================================================

  describe("safety: never push when all tracks are local/broken", () => {
    it("throws when all local tracks are spotify:local: URIs", async () => {
      const playlist = makePlaylist({ name: "Broken Playlist" });
      playlistSvc = createMockPlaylistService({
        getPlaylist: vi.fn().mockReturnValue(playlist),
        getPlaylistTracks: vi.fn().mockReturnValue([
          makeTrack({ spotifyUri: "spotify:local:Artist:Album:Song:180" }),
          makeTrack({ spotifyUri: "spotify:local:Artist2:Album2:Song2:200" }),
        ]),
      });

      await expect(
        pushPlaylist("local-1", spotifySvc, playlistSvc),
      ).rejects.toThrow("Safety: playlist \"Broken Playlist\" contains only local/broken tracks");

      // Must NEVER call Spotify API write methods
      expect(spotifySvc.removeTracksFromPlaylist).not.toHaveBeenCalled();
      expect(spotifySvc.addTracksToPlaylist).not.toHaveBeenCalled();
      expect(spotifySvc.renamePlaylist).not.toHaveBeenCalled();
    });

    it("proceeds when mix of real + local tracks", async () => {
      const playlist = makePlaylist();
      playlistSvc = createMockPlaylistService({
        getPlaylist: vi.fn().mockReturnValue(playlist),
        getPlaylistTracks: vi.fn().mockReturnValue([
          makeTrack({ spotifyUri: "spotify:track:real1" }),
          makeTrack({ spotifyUri: "spotify:local:Artist:Album:Song:180" }),
          makeTrack({ spotifyUri: "spotify:track:real2" }),
        ]),
        getPlaylistDiff: vi.fn().mockReturnValue({ toAdd: [], toRemove: [], renamed: false }),
        composeDescription: vi.fn().mockReturnValue(""),
      });

      // Should NOT throw
      const summary = await pushPlaylist("local-1", spotifySvc, playlistSvc);
      expect(summary.playlistName).toBe("My Playlist");
    });

    it("does not remove Spotify tracks when local playlist is empty", async () => {
      const playlist = makePlaylist();
      playlistSvc = createMockPlaylistService({
        getPlaylist: vi.fn().mockReturnValue(playlist),
        getPlaylistTracks: vi.fn().mockReturnValue([]),
        getPlaylistDiff: vi.fn().mockReturnValue({ toAdd: [], toRemove: [], renamed: false }),
        composeDescription: vi.fn().mockReturnValue(""),
      });
      spotifySvc = createMockSpotifyService({
        getPlaylistDetails: vi.fn().mockResolvedValue({
          name: "My Playlist",
          description: "",
          tracks: { total: 15 },
        }),
        getPlaylistTracks: vi.fn().mockResolvedValue([
          { id: "t1", title: "A", artist: "X", artists: ["X"], album: "A", durationMs: 200000, uri: "spotify:track:aaa" },
          { id: "t2", title: "B", artist: "Y", artists: ["Y"], album: "B", durationMs: 200000, uri: "spotify:track:bbb" },
        ]),
      });

      const summary = await pushPlaylist("local-1", spotifySvc, playlistSvc);

      // The diff returned no toRemove, so remove should not be called
      expect(spotifySvc.removeTracksFromPlaylist).not.toHaveBeenCalled();
      expect(summary.tracksRemoved).toBe(0);
    });

    it("throws when tracks have null spotifyUri (treated as broken)", async () => {
      const playlist = makePlaylist({ name: "Null URIs" });
      playlistSvc = createMockPlaylistService({
        getPlaylist: vi.fn().mockReturnValue(playlist),
        getPlaylistTracks: vi.fn().mockReturnValue([
          makeTrack({ spotifyUri: null }),
          makeTrack({ spotifyUri: null }),
        ]),
      });

      await expect(
        pushPlaylist("local-1", spotifySvc, playlistSvc),
      ).rejects.toThrow("Safety: playlist \"Null URIs\" contains only local/broken tracks");

      expect(spotifySvc.removeTracksFromPlaylist).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Safety: confirmation for large removals
  // =========================================================================

  describe("safety: confirmation for large removals", () => {
    it("returns requiresConfirmation when removing >3 tracks without confirmed=true", async () => {
      const playlist = makePlaylist();
      playlistSvc = createMockPlaylistService({
        getPlaylist: vi.fn().mockReturnValue(playlist),
        getPlaylistTracks: vi.fn().mockReturnValue([
          makeTrack({ spotifyUri: "spotify:track:keep1" }),
        ]),
        getPlaylistDiff: vi.fn().mockReturnValue({
          toAdd: [],
          toRemove: [
            "spotify:track:rm1",
            "spotify:track:rm2",
            "spotify:track:rm3",
            "spotify:track:rm4",
          ],
          renamed: false,
        }),
        composeDescription: vi.fn().mockReturnValue(""),
      });
      spotifySvc = createMockSpotifyService({
        getPlaylistDetails: vi.fn().mockResolvedValue({
          name: "My Playlist",
          description: "",
          tracks: { total: 10 },
        }),
      });

      const summary = await pushPlaylist("local-1", spotifySvc, playlistSvc);

      expect(summary.requiresConfirmation).toBe(true);
      expect(summary.confirmationMessage).toContain("4 tracks");
      expect(summary.tracksRemoved).toBe(4);

      // Must NOT have called remove
      expect(spotifySvc.removeTracksFromPlaylist).not.toHaveBeenCalled();
    });

    it("proceeds when removing >3 tracks with confirmed=true", async () => {
      const playlist = makePlaylist();
      playlistSvc = createMockPlaylistService({
        getPlaylist: vi.fn().mockReturnValue(playlist),
        getPlaylistTracks: vi.fn().mockReturnValue([
          makeTrack({ spotifyUri: "spotify:track:keep1" }),
        ]),
        getPlaylistDiff: vi.fn().mockReturnValue({
          toAdd: [],
          toRemove: [
            "spotify:track:rm1",
            "spotify:track:rm2",
            "spotify:track:rm3",
            "spotify:track:rm4",
          ],
          renamed: false,
        }),
        composeDescription: vi.fn().mockReturnValue(""),
      });
      spotifySvc = createMockSpotifyService({
        getPlaylistDetails: vi.fn().mockResolvedValue({
          name: "My Playlist",
          description: "",
          tracks: { total: 10 },
        }),
      });

      const summary = await pushPlaylist("local-1", spotifySvc, playlistSvc, {
        confirmed: true,
      });

      expect(summary.requiresConfirmation).toBeUndefined();
      expect(spotifySvc.removeTracksFromPlaylist).toHaveBeenCalledWith("sp-1", [
        "spotify:track:rm1",
        "spotify:track:rm2",
        "spotify:track:rm3",
        "spotify:track:rm4",
      ]);
    });

    it("proceeds without confirmation when removing exactly 3 tracks", async () => {
      const playlist = makePlaylist();
      playlistSvc = createMockPlaylistService({
        getPlaylist: vi.fn().mockReturnValue(playlist),
        getPlaylistTracks: vi.fn().mockReturnValue([
          makeTrack({ spotifyUri: "spotify:track:keep1" }),
        ]),
        getPlaylistDiff: vi.fn().mockReturnValue({
          toAdd: [],
          toRemove: [
            "spotify:track:rm1",
            "spotify:track:rm2",
            "spotify:track:rm3",
          ],
          renamed: false,
        }),
        composeDescription: vi.fn().mockReturnValue(""),
      });
      spotifySvc = createMockSpotifyService({
        getPlaylistDetails: vi.fn().mockResolvedValue({
          name: "My Playlist",
          description: "",
          tracks: { total: 10 },
        }),
      });

      const summary = await pushPlaylist("local-1", spotifySvc, playlistSvc);

      expect(summary.requiresConfirmation).toBeUndefined();
      expect(spotifySvc.removeTracksFromPlaylist).toHaveBeenCalledWith("sp-1", [
        "spotify:track:rm1",
        "spotify:track:rm2",
        "spotify:track:rm3",
      ]);
    });

    it("proceeds without confirmation when removing 0 tracks", async () => {
      const playlist = makePlaylist();
      playlistSvc = createMockPlaylistService({
        getPlaylist: vi.fn().mockReturnValue(playlist),
        getPlaylistTracks: vi.fn().mockReturnValue([
          makeTrack({ spotifyUri: "spotify:track:keep1" }),
        ]),
        getPlaylistDiff: vi.fn().mockReturnValue({
          toAdd: ["spotify:track:new1"],
          toRemove: [],
          renamed: false,
        }),
        composeDescription: vi.fn().mockReturnValue(""),
      });

      const summary = await pushPlaylist("local-1", spotifySvc, playlistSvc);

      expect(summary.requiresConfirmation).toBeUndefined();
      expect(spotifySvc.removeTracksFromPlaylist).not.toHaveBeenCalled();
      expect(spotifySvc.addTracksToPlaylist).toHaveBeenCalled();
    });

    it("returns requiresConfirmation with descriptive message", async () => {
      const playlist = makePlaylist({ name: "Techno Mix" });
      playlistSvc = createMockPlaylistService({
        getPlaylist: vi.fn().mockReturnValue(playlist),
        getPlaylistTracks: vi.fn().mockReturnValue([
          makeTrack({ spotifyUri: "spotify:track:keep1" }),
        ]),
        getPlaylistDiff: vi.fn().mockReturnValue({
          toAdd: [],
          toRemove: Array.from({ length: 15 }, (_, i) => `spotify:track:rm${i}`),
          renamed: false,
        }),
        composeDescription: vi.fn().mockReturnValue(""),
      });
      spotifySvc = createMockSpotifyService({
        getPlaylistDetails: vi.fn().mockResolvedValue({
          name: "Techno Mix",
          description: "",
          tracks: { total: 20 },
        }),
      });

      const summary = await pushPlaylist("local-1", spotifySvc, playlistSvc);

      expect(summary.requiresConfirmation).toBe(true);
      expect(summary.confirmationMessage).toContain("15 tracks");
      expect(summary.confirmationMessage).toContain("Techno Mix");
    });
  });

  // =========================================================================
  // Safety: refuse to remove all tracks from Spotify
  // =========================================================================

  describe("safety: refuse to remove all tracks from Spotify", () => {
    it("throws when push would remove all Spotify tracks with nothing to add", async () => {
      const playlist = makePlaylist();
      playlistSvc = createMockPlaylistService({
        getPlaylist: vi.fn().mockReturnValue(playlist),
        getPlaylistTracks: vi.fn().mockReturnValue([
          makeTrack({ spotifyUri: "spotify:track:only-local" }),
        ]),
        getPlaylistDiff: vi.fn().mockReturnValue({
          toAdd: [],
          toRemove: [
            "spotify:track:sp1",
            "spotify:track:sp2",
            "spotify:track:sp3",
            "spotify:track:sp4",
            "spotify:track:sp5",
          ],
          renamed: false,
        }),
        composeDescription: vi.fn().mockReturnValue(""),
      });
      spotifySvc = createMockSpotifyService({
        getPlaylistDetails: vi.fn().mockResolvedValue({
          name: "My Playlist",
          description: "",
          tracks: { total: 5 },
        }),
      });

      await expect(
        pushPlaylist("local-1", spotifySvc, playlistSvc, { confirmed: true }),
      ).rejects.toThrow("Safety: push would remove all 5 tracks");

      expect(spotifySvc.removeTracksFromPlaylist).not.toHaveBeenCalled();
    });

    it("allows removing all tracks if there are new tracks to add", async () => {
      const playlist = makePlaylist();
      playlistSvc = createMockPlaylistService({
        getPlaylist: vi.fn().mockReturnValue(playlist),
        getPlaylistTracks: vi.fn().mockReturnValue([
          makeTrack({ spotifyUri: "spotify:track:new1" }),
        ]),
        getPlaylistDiff: vi.fn().mockReturnValue({
          toAdd: ["spotify:track:new1"],
          toRemove: ["spotify:track:old1", "spotify:track:old2"],
          renamed: false,
        }),
        composeDescription: vi.fn().mockReturnValue(""),
      });
      spotifySvc = createMockSpotifyService({
        getPlaylistDetails: vi.fn().mockResolvedValue({
          name: "My Playlist",
          description: "",
          tracks: { total: 2 },
        }),
      });

      // Should NOT throw — we have tracks to add
      const summary = await pushPlaylist("local-1", spotifySvc, playlistSvc, {
        confirmed: true,
      });

      expect(spotifySvc.removeTracksFromPlaylist).toHaveBeenCalled();
      expect(spotifySvc.addTracksToPlaylist).toHaveBeenCalled();
      expect(summary.tracksRemoved).toBe(2);
      expect(summary.tracksAdded).toBe(1);
    });
  });

  // =========================================================================
  // Execution order
  // =========================================================================

  it("execution order: rename -> description -> remove -> add", async () => {
    const callOrder: string[] = [];
    const playlist = makePlaylist({ name: "New" });

    playlistSvc = createMockPlaylistService({
      getPlaylist: vi.fn().mockReturnValue(playlist),
      getPlaylistTracks: vi.fn().mockReturnValue([
        makeTrack({ spotifyUri: "spotify:track:a" }),
      ]),
      getPlaylistDiff: vi.fn().mockReturnValue({
        toAdd: ["spotify:track:a"],
        toRemove: ["spotify:track:r"],
        renamed: false,
      }),
      composeDescription: vi.fn().mockReturnValue("New desc"),
    });
    spotifySvc = createMockSpotifyService({
      getPlaylistDetails: vi.fn().mockResolvedValue({
        name: "Old",
        description: "Old desc",
        tracks: { total: 5 },
      }),
      renamePlaylist: vi.fn().mockImplementation(async () => { callOrder.push("rename"); }),
      updatePlaylistDescription: vi.fn().mockImplementation(async () => { callOrder.push("description"); }),
      removeTracksFromPlaylist: vi.fn().mockImplementation(async () => { callOrder.push("remove"); }),
      addTracksToPlaylist: vi.fn().mockImplementation(async () => { callOrder.push("add"); }),
    });

    await pushPlaylist("local-1", spotifySvc, playlistSvc);

    expect(callOrder).toEqual(["rename", "description", "remove", "add"]);
  });

  it("Spotify API error propagation", async () => {
    const playlist = makePlaylist({ name: "New" });
    playlistSvc = createMockPlaylistService({
      getPlaylist: vi.fn().mockReturnValue(playlist),
      getPlaylistTracks: vi.fn().mockReturnValue([
        makeTrack({ spotifyUri: "spotify:track:a" }),
      ]),
      getPlaylistDiff: vi.fn().mockReturnValue({
        toAdd: ["spotify:track:a"],
        toRemove: [],
        renamed: false,
      }),
      composeDescription: vi.fn().mockReturnValue(""),
    });
    spotifySvc = createMockSpotifyService({
      getPlaylistDetails: vi.fn().mockResolvedValue({ name: "Old", description: "" }),
      renamePlaylist: vi.fn().mockResolvedValue(undefined),
      addTracksToPlaylist: vi.fn().mockRejectedValue(new Error("Spotify API error: 500")),
    });

    await expect(
      pushPlaylist("local-1", spotifySvc, playlistSvc),
    ).rejects.toThrow("Spotify API error: 500");

    // rename was still called before the failure
    expect(spotifySvc.renamePlaylist).toHaveBeenCalled();
  });
});

// ===========================================================================
// getPlaylistDiff — safety around spotify:local: URIs
// ===========================================================================

describe("getPlaylistDiff safety", () => {
  // We test getPlaylistDiff by using real in-memory DB via PlaylistService,
  // matching the pattern from playlist-service.test.ts.

  // We need the real imports for in-memory DB
  let db: ReturnType<typeof import("drizzle-orm/better-sqlite3").drizzle>;
  let sqlite: InstanceType<typeof import("better-sqlite3").default>;
  let svc: import("../playlist-service.js").PlaylistService;

  beforeEach(async () => {
    const Database = (await import("better-sqlite3")).default;
    const { drizzle } = await import("drizzle-orm/better-sqlite3");
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const { PlaylistService } = await import("../playlist-service.js");
    const schema = await import("../../db/schema.js");

    const currentDir = dirname(fileURLToPath(import.meta.url));
    const migrationsFolder = resolve(currentDir, "../../db/migrations");

    const rawSqlite = new Database(":memory:");
    rawSqlite.pragma("journal_mode = WAL");
    const rawDb = drizzle(rawSqlite, { schema });
    migrate(rawDb, { migrationsFolder });

    sqlite = rawSqlite;
    db = rawDb;
    svc = PlaylistService.fromDb(rawDb);
  });

  afterEach(() => {
    sqlite?.close();
  });

  /** Helper to insert a track with a specific URI into the DB. */
  async function insertTrackWithUri(
    spotifyUri: string | null,
    title = "Track",
    artist = "Artist",
  ): Promise<string> {
    const schema = await import("../../db/schema.js");
    const crypto = await import("node:crypto");
    const id = crypto.randomUUID();
    const now = Date.now();
    db.insert(schema.tracks)
      .values({
        id,
        spotifyId: `sp-${id.slice(0, 8)}`,
        title,
        artist,
        album: null,
        durationMs: 200_000,
        spotifyUri,
        isLocal: spotifyUri?.startsWith("spotify:local:") ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return id;
  }

  it("excludes spotify:local: URIs from toAdd", async () => {
    const pl = svc.upsertPlaylist({ spotifyId: "sp-diff1", name: "Diff 1" });

    const realTrackId = await insertTrackWithUri("spotify:track:real1", "Real", "Artist");
    const localTrackId = await insertTrackWithUri("spotify:local:Artist:Album:Song:180", "Local", "Artist");
    svc.setPlaylistTracks(pl.id, [realTrackId, localTrackId]);

    // Spotify already has the real track
    const spotifyTracks = [
      { id: "t1", title: "Real", artist: "Artist", artists: ["Artist"], album: "A", durationMs: 200000, uri: "spotify:track:real1" },
    ];

    const diff = svc.getPlaylistDiff(pl.id, spotifyTracks);

    // spotify:local: should NOT appear in toAdd
    expect(diff.toAdd).toEqual([]);
    // No removals either since real tracks match
    expect(diff.toRemove).toEqual([]);
  });

  it("excludes spotify:local: URIs from localUris — does not cause false toRemove", async () => {
    const pl = svc.upsertPlaylist({ spotifyId: "sp-diff2", name: "Diff 2" });

    const realTrackId = await insertTrackWithUri("spotify:track:real1", "Real", "Artist");
    const localTrackId = await insertTrackWithUri("spotify:local:Artist:Album:BrokenSong:180", "Broken", "Artist");
    svc.setPlaylistTracks(pl.id, [realTrackId, localTrackId]);

    // Spotify has the real track AND an extra track
    const spotifyTracks = [
      { id: "t1", title: "Real", artist: "Artist", artists: ["Artist"], album: "A", durationMs: 200000, uri: "spotify:track:real1" },
      { id: "t2", title: "Extra", artist: "Artist2", artists: ["Artist2"], album: "B", durationMs: 200000, uri: "spotify:track:extra1" },
    ];

    const diff = svc.getPlaylistDiff(pl.id, spotifyTracks);

    // The spotify:local: track should NOT have caused real1 to be missing from localUris
    expect(diff.toAdd).toEqual([]);
    // extra1 is in Spotify but not local => should be in toRemove
    expect(diff.toRemove).toEqual(["spotify:track:extra1"]);
  });

  it("when all local tracks are spotify:local:, toRemove is empty", async () => {
    const pl = svc.upsertPlaylist({ spotifyId: "sp-diff3", name: "Diff 3" });

    const local1 = await insertTrackWithUri("spotify:local:A:B:C:180", "Local1", "A");
    const local2 = await insertTrackWithUri("spotify:local:D:E:F:200", "Local2", "D");
    svc.setPlaylistTracks(pl.id, [local1, local2]);

    // Spotify has real tracks that we should NOT remove
    const spotifyTracks = [
      { id: "t1", title: "SpTrack1", artist: "X", artists: ["X"], album: "A", durationMs: 200000, uri: "spotify:track:sp1" },
      { id: "t2", title: "SpTrack2", artist: "Y", artists: ["Y"], album: "B", durationMs: 200000, uri: "spotify:track:sp2" },
    ];

    const diff = svc.getPlaylistDiff(pl.id, spotifyTracks);

    // No real local URIs => localUris is empty => toRemove should be empty
    expect(diff.toRemove).toEqual([]);
    // Also no toAdd since local URIs are all broken
    expect(diff.toAdd).toEqual([]);
  });

  it("when some local are real and some spotify:local:, only real URIs compared", async () => {
    const pl = svc.upsertPlaylist({ spotifyId: "sp-diff4", name: "Diff 4" });

    const real1 = await insertTrackWithUri("spotify:track:real1", "Real1", "A");
    const real2 = await insertTrackWithUri("spotify:track:real2", "Real2", "B");
    const broken1 = await insertTrackWithUri("spotify:local:C:D:E:180", "Broken1", "C");
    svc.setPlaylistTracks(pl.id, [real1, real2, broken1]);

    // Spotify has real1 but not real2, plus an extra track
    const spotifyTracks = [
      { id: "t1", title: "Real1", artist: "A", artists: ["A"], album: "A", durationMs: 200000, uri: "spotify:track:real1" },
      { id: "t3", title: "Extra", artist: "Z", artists: ["Z"], album: "Z", durationMs: 200000, uri: "spotify:track:extra1" },
    ];

    const diff = svc.getPlaylistDiff(pl.id, spotifyTracks);

    // real2 is local but not in Spotify => toAdd
    expect(diff.toAdd).toEqual(["spotify:track:real2"]);
    // extra1 is in Spotify but not local => toRemove
    expect(diff.toRemove).toEqual(["spotify:track:extra1"]);
    // Broken spotify:local: track should appear in neither
    expect(diff.toAdd).not.toContain("spotify:local:C:D:E:180");
    expect(diff.toRemove).not.toContain("spotify:local:C:D:E:180");
  });

  it("normal case — real local URIs correctly diffed against Spotify", async () => {
    const pl = svc.upsertPlaylist({ spotifyId: "sp-diff5", name: "Diff 5" });

    const track1 = await insertTrackWithUri("spotify:track:shared", "Shared", "A");
    const track2 = await insertTrackWithUri("spotify:track:local-only", "LocalOnly", "B");
    svc.setPlaylistTracks(pl.id, [track1, track2]);

    const spotifyTracks = [
      { id: "t1", title: "Shared", artist: "A", artists: ["A"], album: "A", durationMs: 200000, uri: "spotify:track:shared" },
      { id: "t2", title: "SpOnly", artist: "C", artists: ["C"], album: "C", durationMs: 200000, uri: "spotify:track:sp-only" },
    ];

    const diff = svc.getPlaylistDiff(pl.id, spotifyTracks);

    expect(diff.toAdd).toEqual(["spotify:track:local-only"]);
    expect(diff.toRemove).toEqual(["spotify:track:sp-only"]);
  });

  it("tracks with null spotifyUri are excluded from diff (like spotify:local:)", async () => {
    const pl = svc.upsertPlaylist({ spotifyId: "sp-diff6", name: "Diff 6" });

    const nullTrack = await insertTrackWithUri(null, "NoUri", "A");
    const realTrack = await insertTrackWithUri("spotify:track:real1", "Real", "B");
    svc.setPlaylistTracks(pl.id, [nullTrack, realTrack]);

    const spotifyTracks = [
      { id: "t1", title: "Real", artist: "B", artists: ["B"], album: "B", durationMs: 200000, uri: "spotify:track:real1" },
    ];

    const diff = svc.getPlaylistDiff(pl.id, spotifyTracks);

    // null URI should not appear in toAdd
    expect(diff.toAdd).toEqual([]);
    expect(diff.toRemove).toEqual([]);
  });
});

// ===========================================================================
// Repair + Push flow (integration-style with mocks)
// ===========================================================================

describe("repair + push flow", () => {
  it("push after repair does not remove repaired tracks from Spotify", async () => {
    // Scenario: A playlist had broken tracks. After repair, they have real URIs.
    // Pushing should NOT remove the repaired tracks from Spotify.
    const playlist = makePlaylist({ name: "Repaired Playlist" });

    const repairedTracks = [
      makeTrack({ spotifyUri: "spotify:track:repaired1", title: "Was Broken 1" }),
      makeTrack({ spotifyUri: "spotify:track:repaired2", title: "Was Broken 2" }),
      makeTrack({ spotifyUri: "spotify:track:existing1", title: "Already There" }),
    ];

    const playlistSvc = createMockPlaylistService({
      getPlaylist: vi.fn().mockReturnValue(playlist),
      getPlaylistTracks: vi.fn().mockReturnValue(repairedTracks),
      // After repair: local has repaired1, repaired2, existing1
      // Spotify has existing1, repaired1, repaired2 (already there from repair)
      // => no diff
      getPlaylistDiff: vi.fn().mockReturnValue({
        toAdd: [],
        toRemove: [],
        renamed: false,
      }),
      composeDescription: vi.fn().mockReturnValue(""),
    });

    const spotifySvc = createMockSpotifyService({
      getPlaylistDetails: vi.fn().mockResolvedValue({
        name: "Repaired Playlist",
        description: "",
        tracks: { total: 3 },
      }),
      getPlaylistTracks: vi.fn().mockResolvedValue([
        { id: "t1", title: "Already There", artist: "A", artists: ["A"], album: "A", durationMs: 200000, uri: "spotify:track:existing1" },
        { id: "t2", title: "Was Broken 1", artist: "B", artists: ["B"], album: "B", durationMs: 200000, uri: "spotify:track:repaired1" },
        { id: "t3", title: "Was Broken 2", artist: "C", artists: ["C"], album: "C", durationMs: 200000, uri: "spotify:track:repaired2" },
      ]),
    });

    const summary = await pushPlaylist("local-1", spotifySvc, playlistSvc);

    expect(spotifySvc.removeTracksFromPlaylist).not.toHaveBeenCalled();
    expect(summary.tracksRemoved).toBe(0);
    expect(summary.tracksAdded).toBe(0);
  });

  it("push after repair with new tracks to add works correctly", async () => {
    // Scenario: After repair, local DB has repaired tracks + a new track not on Spotify.
    const playlist = makePlaylist({ name: "Repaired + New" });

    const playlistSvc = createMockPlaylistService({
      getPlaylist: vi.fn().mockReturnValue(playlist),
      getPlaylistTracks: vi.fn().mockReturnValue([
        makeTrack({ spotifyUri: "spotify:track:repaired1" }),
        makeTrack({ spotifyUri: "spotify:track:brand-new" }),
      ]),
      getPlaylistDiff: vi.fn().mockReturnValue({
        toAdd: ["spotify:track:brand-new"],
        toRemove: [],
        renamed: false,
      }),
      composeDescription: vi.fn().mockReturnValue(""),
    });

    const spotifySvc = createMockSpotifyService({
      getPlaylistDetails: vi.fn().mockResolvedValue({
        name: "Repaired + New",
        description: "",
        tracks: { total: 1 },
      }),
    });

    const summary = await pushPlaylist("local-1", spotifySvc, playlistSvc);

    expect(spotifySvc.removeTracksFromPlaylist).not.toHaveBeenCalled();
    expect(spotifySvc.addTracksToPlaylist).toHaveBeenCalledWith("sp-1", ["spotify:track:brand-new"]);
    expect(summary.tracksAdded).toBe(1);
    expect(summary.tracksRemoved).toBe(0);
  });
});
