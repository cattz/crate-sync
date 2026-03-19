import { describe, it, expect, vi, beforeEach } from "vitest";
import { LexiconService } from "../lexicon-service.js";
import type { LexiconConfig } from "../../config.js";

// Mock withRetry to execute fn directly (no delays in tests)
vi.mock("../../utils/retry.js", () => ({
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}));

const config: LexiconConfig = {
  url: "http://localhost:48624",
  downloadRoot: "/music",
};

function mockFetch(
  body: unknown,
  init: Partial<Response> = {},
): ReturnType<typeof vi.fn> {
  const response = {
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers({ "content-type": "application/json" }),
    ...init,
  } as Response;
  const fn = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

function mockFetchError(status: number, statusText: string, body = "") {
  const response = {
    ok: false,
    status,
    statusText,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(body),
    headers: new Headers(),
  } as unknown as Response;
  const fn = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("LexiconService", () => {
  let svc: LexiconService;

  beforeEach(() => {
    vi.restoreAllMocks();
    svc = new LexiconService(config);
  });

  // --- ping ---

  it("ping returns true when API responds", async () => {
    mockFetch([{ id: 1, title: "t", artist: "a", filePath: "/f" }]);
    expect(await svc.ping()).toBe(true);
  });

  it("ping returns false when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("connection refused")),
    );
    expect(await svc.ping()).toBe(false);
  });

  // --- getTracks ---

  it("getTracks normalizes numeric IDs to strings", async () => {
    mockFetch([
      { id: 42, title: "Song", artist: "Artist", filePath: "/song.mp3" },
    ]);
    const tracks = await svc.getTracks();
    expect(tracks).toHaveLength(1);
    expect(tracks[0].id).toBe("42");
    expect(tracks[0].title).toBe("Song");
  });

  it("getTracks unwraps { data: [...] } wrapper", async () => {
    mockFetch({
      data: [
        { id: "1", title: "A", artist: "B", filePath: "/a.mp3" },
      ],
    });
    const tracks = await svc.getTracks();
    expect(tracks).toHaveLength(1);
    expect(tracks[0].title).toBe("A");
  });

  it("getTracks unwraps { tracks: [...] } wrapper", async () => {
    mockFetch({
      tracks: [
        { id: "2", title: "C", artist: "D", file_path: "/c.flac" },
      ],
    });
    const tracks = await svc.getTracks();
    expect(tracks).toHaveLength(1);
    expect(tracks[0].filePath).toBe("/c.flac");
  });

  it("getTracks handles snake_case fields", async () => {
    mockFetch([
      {
        id: 5,
        title: "T",
        artist: "A",
        file_path: "/t.wav",
        duration_ms: 180000,
      },
    ]);
    const tracks = await svc.getTracks();
    expect(tracks[0].filePath).toBe("/t.wav");
    expect(tracks[0].durationMs).toBe(180000);
  });

  // --- searchTracks ---

  it("searchTracks filters client-side by artist and title", async () => {
    mockFetch([
      { id: 1, title: "Porcelain", artist: "Moby", filePath: "/a.mp3" },
      { id: 2, title: "Honey", artist: "Moby", filePath: "/b.mp3" },
      { id: 3, title: "Porcelain", artist: "Other", filePath: "/c.mp3" },
    ]);
    const tracks = await svc.searchTracks({ artist: "Moby", title: "Porcelain" });
    expect(tracks).toHaveLength(1);
    expect(tracks[0].id).toBe("1");
  });

  it("searchTracks with no params returns all tracks", async () => {
    mockFetch([
      { id: 1, title: "A", artist: "B", filePath: "/a.mp3" },
      { id: 2, title: "C", artist: "D", filePath: "/b.mp3" },
    ]);
    const tracks = await svc.searchTracks({});
    expect(tracks).toHaveLength(2);
  });

  // --- getTrack ---

  it("getTrack returns a track on 200", async () => {
    mockFetch({ id: "10", title: "X", artist: "Y", filePath: "/x.mp3" });
    const track = await svc.getTrack("10");
    expect(track).not.toBeNull();
    expect(track!.id).toBe("10");
  });

  it("getTrack returns null on 404", async () => {
    mockFetchError(404, "Not Found");
    const track = await svc.getTrack("999");
    expect(track).toBeNull();
  });

  // --- createPlaylist ---

  it("createPlaylist sends POST then PATCH /playlist-tracks", async () => {
    // First call: POST /playlist (create)
    // Second call: PATCH /playlist-tracks (add tracks)
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: () => Promise.resolve({ id: 7, name: "My Playlist" }),
        text: () => Promise.resolve(""),
        headers: new Headers({ "content-type": "application/json" }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true, status: 204,
        json: () => Promise.resolve(undefined),
        text: () => Promise.resolve(""),
        headers: new Headers(),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchFn);

    const playlist = await svc.createPlaylist("My Playlist", ["1", "2", "3"]);
    expect(playlist.id).toBe("7");
    expect(playlist.name).toBe("My Playlist");

    // POST should not include trackIds
    const [, postOpts] = fetchFn.mock.calls[0];
    expect(postOpts.method).toBe("POST");
    expect(JSON.parse(postOpts.body)).toEqual({ name: "My Playlist" });

    // PATCH should add tracks
    const [patchUrl, patchOpts] = fetchFn.mock.calls[1];
    expect(patchUrl).toContain("/playlist-tracks");
    expect(patchOpts.method).toBe("PATCH");
    expect(JSON.parse(patchOpts.body)).toEqual({ id: 7, trackIds: [1, 2, 3] });
  });

  // --- addTracksToPlaylist ---

  it("addTracksToPlaylist sends PATCH /playlist-tracks directly", async () => {
    const fetchFn = mockFetch(undefined, { status: 204 });

    await svc.addTracksToPlaylist("1", ["30", "40"]);

    const [url, opts] = fetchFn.mock.calls[0];
    expect(url).toContain("/playlist-tracks");
    expect(opts.method).toBe("PATCH");
    const body = JSON.parse(opts.body);
    expect(body.id).toBe(1);
    expect(body.trackIds).toEqual([30, 40]);
  });

  it("addTracksToPlaylist does nothing for empty trackIds", async () => {
    const fetchFn = mockFetch(undefined);

    await svc.addTracksToPlaylist("1", []);

    expect(fetchFn).not.toHaveBeenCalled();
  });

  // --- getTags ---

  it("getTags unwraps categories and tags from data wrapper", async () => {
    mockFetch({
      data: {
        categories: [{ id: 1, label: "Spotify", color: "#1DB954", tags: [1, 2] }],
        tags: [
          { id: 1, categoryId: 1, label: "House" },
          { id: 2, categoryId: 1, label: "Techno" },
        ],
      },
    });

    const result = await svc.getTags();
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0].id).toBe("1");
    expect(result.categories[0].label).toBe("Spotify");
    expect(result.tags).toHaveLength(2);
    expect(result.tags[0].id).toBe("1");
    expect(result.tags[0].categoryId).toBe("1");
    expect(result.tags[0].label).toBe("House");
  });

  // --- createTagCategory ---

  it("createTagCategory sends POST and returns category (not wrapped)", async () => {
    const fetchFn = mockFetch({ id: 5, label: "Spotify", position: 0, color: "#1DB954", tags: [] });

    const category = await svc.createTagCategory("Spotify", "#1DB954");
    expect(category.id).toBe("5");
    expect(category.label).toBe("Spotify");
    expect(category.color).toBe("#1DB954");

    const [url, opts] = fetchFn.mock.calls[0];
    expect(url).toContain("/tag-category");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({ label: "Spotify", color: "#1DB954" });
  });

  // --- createTag ---

  it("createTag sends POST and returns tag (not wrapped)", async () => {
    const fetchFn = mockFetch({ id: 10, categoryId: 5, label: "House", position: 0 });

    const tag = await svc.createTag("5", "House");
    expect(tag.id).toBe("10");
    expect(tag.categoryId).toBe("5");
    expect(tag.label).toBe("House");

    const [url, opts] = fetchFn.mock.calls[0];
    expect(url).toContain("/tag");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({ categoryId: 5, label: "House" });
  });

  // --- updateTrackTags ---

  it("updateTrackTags sends PATCH /track with tag IDs as integers", async () => {
    const fetchFn = mockFetch(undefined, { status: 204 });

    await svc.updateTrackTags("42", ["1", "2", "3"]);

    const [url, opts] = fetchFn.mock.calls[0];
    expect(url).toContain("/track");
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body)).toEqual({
      id: 42,
      edits: { tags: [1, 2, 3] },
    });
  });

  // --- getTrackTags ---

  it("getTrackTags returns tag IDs as strings", async () => {
    mockFetch({ data: { track: { id: 42, title: "Song", artist: "A", tags: [1, 5, 10] } } });

    const tags = await svc.getTrackTags("42");
    expect(tags).toEqual(["1", "5", "10"]);
  });

  it("getTrackTags returns empty array when track has no tags", async () => {
    mockFetch({ data: { track: { id: 42, title: "Song", artist: "A" } } });

    const tags = await svc.getTrackTags("42");
    expect(tags).toEqual([]);
  });

  // --- getTracks pagination ---

  it("getTracks paginates until a partial page", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({
      id: i, title: `T${i}`, artist: "A", filePath: `/f${i}.mp3`,
    }));
    const page2 = [{ id: 2000, title: "Last", artist: "B", filePath: "/last.mp3" }];

    const fetchFn = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: () => Promise.resolve(page1),
        text: () => Promise.resolve(""),
        headers: new Headers({ "content-type": "application/json" }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: () => Promise.resolve(page2),
        text: () => Promise.resolve(""),
        headers: new Headers({ "content-type": "application/json" }),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchFn);

    const tracks = await svc.getTracks();
    expect(tracks).toHaveLength(1001);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  // --- getTracks duration conversion ---

  it("getTracks converts duration in seconds to milliseconds", async () => {
    mockFetch([{ id: 1, title: "T", artist: "A", location: "/t.mp3", duration: 245.5 }]);
    const tracks = await svc.getTracks();
    expect(tracks[0].durationMs).toBe(245500);
  });

  it("getTracks reads location field as filePath", async () => {
    mockFetch([{ id: 1, title: "T", artist: "A", location: "/music/track.flac" }]);
    const tracks = await svc.getTracks();
    expect(tracks[0].filePath).toBe("/music/track.flac");
  });

  it("getTracks reads albumTitle field as album", async () => {
    mockFetch([{ id: 1, title: "T", artist: "A", filePath: "/t.mp3", albumTitle: "My Album" }]);
    const tracks = await svc.getTracks();
    expect(tracks[0].album).toBe("My Album");
  });

  // --- getPlaylists ---

  it("getPlaylists returns normalized playlists", async () => {
    mockFetch({
      playlists: [
        { id: 1, name: "Chill", trackIds: [10, 20] },
        { id: 2, name: "Party", trackIds: [30] },
      ],
    });
    const playlists = await svc.getPlaylists();
    expect(playlists).toHaveLength(2);
    expect(playlists[0].id).toBe("1");
    expect(playlists[0].name).toBe("Chill");
    expect(playlists[0].trackIds).toEqual(["10", "20"]);
  });

  // --- getPlaylistByName ---

  it("getPlaylistByName finds top-level playlist", async () => {
    mockFetch({
      playlists: [
        { id: 1, name: "Chill", trackIds: [] },
        { id: 2, name: "Party", trackIds: [10, 20] },
      ],
    });
    const pl = await svc.getPlaylistByName("Party");
    expect(pl).not.toBeNull();
    expect(pl!.id).toBe("2");
  });

  it("getPlaylistByName finds nested playlist", async () => {
    mockFetch({
      playlists: [
        {
          id: 1, name: "Folder",
          playlists: [
            { id: 3, name: "Deep/House", trackIds: [100] },
          ],
        },
      ],
    });
    const pl = await svc.getPlaylistByName("Deep/House");
    expect(pl).not.toBeNull();
    expect(pl!.id).toBe("3");
  });

  it("getPlaylistByName returns null when not found", async () => {
    mockFetch({ playlists: [{ id: 1, name: "Other", trackIds: [] }] });
    const pl = await svc.getPlaylistByName("Missing");
    expect(pl).toBeNull();
  });

  // --- setPlaylistTracks ---

  it("setPlaylistTracks deletes existing then adds new tracks", async () => {
    // First call: GET /playlist?id=5 (returns existing tracks)
    // Second call: DELETE /playlist-tracks (remove existing)
    // Third call: PATCH /playlist-tracks (add new)
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: () => Promise.resolve({ id: 5, name: "PL", trackIds: [1, 2] }),
        text: () => Promise.resolve(""),
        headers: new Headers({ "content-type": "application/json" }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true, status: 204,
        json: () => Promise.resolve(undefined),
        text: () => Promise.resolve(""),
        headers: new Headers(),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true, status: 204,
        json: () => Promise.resolve(undefined),
        text: () => Promise.resolve(""),
        headers: new Headers(),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchFn);

    await svc.setPlaylistTracks("5", ["10", "20", "30"]);

    expect(fetchFn).toHaveBeenCalledTimes(3);

    // DELETE call
    const [, delOpts] = fetchFn.mock.calls[1];
    expect(delOpts.method).toBe("DELETE");
    expect(JSON.parse(delOpts.body).trackIds).toEqual([1, 2]);

    // PATCH call
    const [, patchOpts] = fetchFn.mock.calls[2];
    expect(patchOpts.method).toBe("PATCH");
    expect(JSON.parse(patchOpts.body).trackIds).toEqual([10, 20, 30]);
  });

  it("setPlaylistTracks skips delete when playlist is empty", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: () => Promise.resolve({ id: 5, name: "PL", trackIds: [] }),
        text: () => Promise.resolve(""),
        headers: new Headers({ "content-type": "application/json" }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true, status: 204,
        json: () => Promise.resolve(undefined),
        text: () => Promise.resolve(""),
        headers: new Headers(),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchFn);

    await svc.setPlaylistTracks("5", ["10"]);

    // Should only be GET + PATCH (no DELETE)
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const [, patchOpts] = fetchFn.mock.calls[1];
    expect(patchOpts.method).toBe("PATCH");
  });

  // --- createPlaylist with no tracks ---

  it("createPlaylist with empty trackIds skips PATCH", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: () => Promise.resolve({ id: 7, name: "Empty" }),
        text: () => Promise.resolve(""),
        headers: new Headers({ "content-type": "application/json" }),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchFn);

    const pl = await svc.createPlaylist("Empty", []);
    expect(pl.id).toBe("7");
    // Only POST, no PATCH
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  // --- error handling ---

  it("throws on non-2xx response", async () => {
    mockFetchError(500, "Internal Server Error", "oops");
    await expect(svc.getTracks()).rejects.toThrow(
      /Lexicon API error: 500/,
    );
  });

  it("throws on non-2xx for non-404 in getTrack", async () => {
    mockFetchError(500, "Internal Server Error", "fail");
    await expect(svc.getTrack("1")).rejects.toThrow(/500/);
  });
});
