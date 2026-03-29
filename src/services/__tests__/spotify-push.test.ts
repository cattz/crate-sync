import { describe, it, expect, vi, beforeEach } from "vitest";
import { pushPlaylist } from "../spotify-push.js";
import type { SpotifyService } from "../spotify-service.js";
import type { PlaylistService } from "../playlist-service.js";
import type { Playlist } from "../../db/schema.js";

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

function createMockSpotifyService(overrides: Partial<SpotifyService> = {}) {
  return {
    getPlaylistDetails: vi.fn().mockResolvedValue({ name: "My Playlist", description: "" }),
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
    getPlaylistDiff: vi.fn().mockReturnValue({ toAdd: [], toRemove: [], renamed: false }),
    composeDescription: vi.fn().mockReturnValue(""),
    ...overrides,
  } as unknown as PlaylistService;
}

describe("pushPlaylist", () => {
  let spotifySvc: ReturnType<typeof createMockSpotifyService>;
  let playlistSvc: ReturnType<typeof createMockPlaylistService>;

  beforeEach(() => {
    spotifySvc = createMockSpotifyService();
    playlistSvc = createMockPlaylistService();
  });

  it("happy path — all changes", async () => {
    const playlist = makePlaylist({ name: "New Name" });
    playlistSvc = createMockPlaylistService({
      getPlaylist: vi.fn().mockReturnValue(playlist),
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
      }),
    });

    const summary = await pushPlaylist("local-1", spotifySvc, playlistSvc);

    expect(summary.renamed).toEqual({ from: "Old Name", to: "New Name" });
    expect(summary.descriptionUpdated).toBe(true);
    expect(summary.tracksAdded).toBe(1);
    expect(summary.tracksRemoved).toBe(1);
    expect(summary.dryRun).toBe(false);

    expect((spotifySvc.renamePlaylist as any)).toHaveBeenCalledWith("sp-1", "New Name");
    expect((spotifySvc.updatePlaylistDescription as any)).toHaveBeenCalledWith("sp-1", "Updated desc");
    expect((spotifySvc.removeTracksFromPlaylist as any)).toHaveBeenCalledWith("sp-1", ["spotify:track:rm1"]);
    expect((spotifySvc.addTracksToPlaylist as any)).toHaveBeenCalledWith("sp-1", ["spotify:track:add1"]);
  });

  it("no changes detected", async () => {
    const summary = await pushPlaylist("local-1", spotifySvc, playlistSvc);

    expect(summary.renamed).toBeNull();
    expect(summary.descriptionUpdated).toBe(false);
    expect(summary.tracksAdded).toBe(0);
    expect(summary.tracksRemoved).toBe(0);

    expect((spotifySvc.renamePlaylist as any)).not.toHaveBeenCalled();
    expect((spotifySvc.updatePlaylistDescription as any)).not.toHaveBeenCalled();
    expect((spotifySvc.addTracksToPlaylist as any)).not.toHaveBeenCalled();
    expect((spotifySvc.removeTracksFromPlaylist as any)).not.toHaveBeenCalled();
  });

  it("dry run skips writes", async () => {
    const playlist = makePlaylist({ name: "New Name" });
    playlistSvc = createMockPlaylistService({
      getPlaylist: vi.fn().mockReturnValue(playlist),
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

    expect((spotifySvc.renamePlaylist as any)).not.toHaveBeenCalled();
    expect((spotifySvc.updatePlaylistDescription as any)).not.toHaveBeenCalled();
    expect((spotifySvc.addTracksToPlaylist as any)).not.toHaveBeenCalled();
  });

  it("includeDescription: false skips description", async () => {
    playlistSvc = createMockPlaylistService({
      getPlaylist: vi.fn().mockReturnValue(makePlaylist()),
      composeDescription: vi.fn().mockReturnValue("Some desc"),
    });
    spotifySvc = createMockSpotifyService({
      getPlaylistDetails: vi.fn().mockResolvedValue({
        name: "My Playlist",
        description: "Different desc",
      }),
    });

    const summary = await pushPlaylist("local-1", spotifySvc, playlistSvc, {
      includeDescription: false,
    });

    expect(summary.descriptionUpdated).toBe(false);
    expect((spotifySvc.updatePlaylistDescription as any)).not.toHaveBeenCalled();
    expect((playlistSvc.composeDescription as any)).not.toHaveBeenCalled();
  });

  it("only rename needed", async () => {
    const playlist = makePlaylist({ name: "New Name" });
    playlistSvc = createMockPlaylistService({
      getPlaylist: vi.fn().mockReturnValue(playlist),
      composeDescription: vi.fn().mockReturnValue(""),
    });
    spotifySvc = createMockSpotifyService({
      getPlaylistDetails: vi.fn().mockResolvedValue({
        name: "Old Name",
        description: "",
      }),
    });

    const summary = await pushPlaylist("local-1", spotifySvc, playlistSvc);

    expect(summary.renamed).toEqual({ from: "Old Name", to: "New Name" });
    expect((spotifySvc.renamePlaylist as any)).toHaveBeenCalled();
    expect((spotifySvc.updatePlaylistDescription as any)).not.toHaveBeenCalled();
    expect((spotifySvc.addTracksToPlaylist as any)).not.toHaveBeenCalled();
    expect((spotifySvc.removeTracksFromPlaylist as any)).not.toHaveBeenCalled();
  });

  it("only tracks changed", async () => {
    playlistSvc = createMockPlaylistService({
      getPlaylist: vi.fn().mockReturnValue(makePlaylist()),
      getPlaylistDiff: vi.fn().mockReturnValue({
        toAdd: ["spotify:track:new1"],
        toRemove: ["spotify:track:old1"],
        renamed: false,
      }),
      composeDescription: vi.fn().mockReturnValue(""),
    });

    const summary = await pushPlaylist("local-1", spotifySvc, playlistSvc);

    expect(summary.renamed).toBeNull();
    expect(summary.descriptionUpdated).toBe(false);
    expect(summary.tracksAdded).toBe(1);
    expect(summary.tracksRemoved).toBe(1);
    expect((spotifySvc.renamePlaylist as any)).not.toHaveBeenCalled();
    expect((spotifySvc.removeTracksFromPlaylist as any)).toHaveBeenCalled();
    expect((spotifySvc.addTracksToPlaylist as any)).toHaveBeenCalled();
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
    });

    await expect(
      pushPlaylist("local-only", spotifySvc, playlistSvc),
    ).rejects.toThrow("Playlist has no Spotify ID: local-only");
  });

  it("execution order: rename -> description -> remove -> add", async () => {
    const callOrder: string[] = [];
    const playlist = makePlaylist({ name: "New" });

    playlistSvc = createMockPlaylistService({
      getPlaylist: vi.fn().mockReturnValue(playlist),
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
    expect((spotifySvc.renamePlaylist as any)).toHaveBeenCalled();
  });
});
