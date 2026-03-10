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

  it("createPlaylist sends POST and returns normalized playlist", async () => {
    const fetchFn = mockFetch({
      id: 7,
      name: "My Playlist",
      trackIds: [1, 2, 3],
    });

    const playlist = await svc.createPlaylist("My Playlist", ["1", "2", "3"]);
    expect(playlist.id).toBe("7");
    expect(playlist.name).toBe("My Playlist");
    expect(playlist.trackIds).toEqual(["1", "2", "3"]);

    const [, opts] = fetchFn.mock.calls[0];
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({
      name: "My Playlist",
      trackIds: ["1", "2", "3"],
    });
  });

  // --- addTracksToPlaylist ---

  it("addTracksToPlaylist fetches current, merges, and PUTs", async () => {
    // First call: GET current playlist
    // Second call: PUT merged list
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: "1",
            name: "PL",
            trackIds: ["a", "b"],
          }),
        text: () => Promise.resolve(""),
        headers: new Headers({ "content-type": "application/json" }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: () => Promise.resolve(undefined),
        text: () => Promise.resolve(""),
        headers: new Headers(),
      } as unknown as Response);

    vi.stubGlobal("fetch", fetchFn);

    await svc.addTracksToPlaylist("1", ["c", "d"]);

    // Second call should be the PUT
    const [putUrl, putOpts] = fetchFn.mock.calls[1];
    expect(putUrl).toContain("/playlists/1");
    expect(putOpts.method).toBe("PUT");
    const putBody = JSON.parse(putOpts.body);
    expect(putBody.trackIds).toEqual(["a", "b", "c", "d"]);
  });

  it("addTracksToPlaylist does not duplicate existing track IDs", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: "1",
            name: "PL",
            trackIds: ["a", "b"],
          }),
        text: () => Promise.resolve(""),
        headers: new Headers({ "content-type": "application/json" }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: () => Promise.resolve(undefined),
        text: () => Promise.resolve(""),
        headers: new Headers(),
      } as unknown as Response);

    vi.stubGlobal("fetch", fetchFn);

    await svc.addTracksToPlaylist("1", ["a", "c"]);

    const putBody = JSON.parse(fetchFn.mock.calls[1][1].body);
    expect(putBody.trackIds).toEqual(["a", "b", "c"]);
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
