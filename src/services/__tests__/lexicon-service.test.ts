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
  tagCategory: {
    name: "Spotify Playlists",
    color: "#1DB954",
  },
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

  // =========================================================================
  // New tag methods
  // =========================================================================

  describe("ensureTagCategory", () => {
    it("returns existing category when found", async () => {
      mockFetch({
        data: {
          categories: [{ id: 1, label: "Spotify Playlists", color: "#1DB954" }],
          tags: [],
        },
      });

      const cat = await svc.ensureTagCategory("Spotify Playlists");
      expect(cat.id).toBe("1");
      expect(cat.label).toBe("Spotify Playlists");
    });

    it("creates new category when not found", async () => {
      // First call: getTags returns empty
      // Second call: createTagCategory
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: () => Promise.resolve({ data: { categories: [], tags: [] } }),
          text: () => Promise.resolve(""),
          headers: new Headers({ "content-type": "application/json" }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: () => Promise.resolve({ id: 5, label: "Spotify Playlists", color: "#1DB954" }),
          text: () => Promise.resolve(""),
          headers: new Headers({ "content-type": "application/json" }),
        } as unknown as Response);
      vi.stubGlobal("fetch", fetchFn);

      const cat = await svc.ensureTagCategory("Spotify Playlists", "#1DB954");
      expect(cat.id).toBe("5");
      expect(cat.label).toBe("Spotify Playlists");

      // Verify createTagCategory was called
      const [url, opts] = fetchFn.mock.calls[1];
      expect(url).toContain("/tag-category");
      expect(opts.method).toBe("POST");
    });

    it("uses default color #808080 when not provided", async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: () => Promise.resolve({ data: { categories: [], tags: [] } }),
          text: () => Promise.resolve(""),
          headers: new Headers({ "content-type": "application/json" }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: () => Promise.resolve({ id: 5, label: "Test", color: "#808080" }),
          text: () => Promise.resolve(""),
          headers: new Headers({ "content-type": "application/json" }),
        } as unknown as Response);
      vi.stubGlobal("fetch", fetchFn);

      await svc.ensureTagCategory("Test");

      const [, opts] = fetchFn.mock.calls[1];
      expect(JSON.parse(opts.body).color).toBe("#808080");
    });
  });

  describe("ensureTag", () => {
    it("returns existing tag when found", async () => {
      mockFetch({
        data: {
          categories: [{ id: 1, label: "Spotify" }],
          tags: [{ id: 10, categoryId: 1, label: "House" }],
        },
      });

      const tag = await svc.ensureTag("1", "House");
      expect(tag.id).toBe("10");
      expect(tag.label).toBe("House");
    });

    it("creates new tag when not found", async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: () => Promise.resolve({ data: { categories: [], tags: [] } }),
          text: () => Promise.resolve(""),
          headers: new Headers({ "content-type": "application/json" }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: () => Promise.resolve({ id: 20, categoryId: 1, label: "Techno" }),
          text: () => Promise.resolve(""),
          headers: new Headers({ "content-type": "application/json" }),
        } as unknown as Response);
      vi.stubGlobal("fetch", fetchFn);

      const tag = await svc.ensureTag("1", "Techno");
      expect(tag.id).toBe("20");
      expect(tag.label).toBe("Techno");
    });
  });

  describe("getTrackTagsInCategory", () => {
    it("returns only tags from the requested category", async () => {
      // getTrackTags returns tag IDs on the track
      // getTags returns all definitions
      const fetchFn = vi.fn()
        // First call: getTrackTags -> GET /track?id=42
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: () => Promise.resolve({ data: { track: { id: 42, tags: [10, 20, 30] } } }),
          text: () => Promise.resolve(""),
          headers: new Headers({ "content-type": "application/json" }),
        } as unknown as Response)
        // Second call: getTags -> GET /tags
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: () => Promise.resolve({
            data: {
              categories: [
                { id: 1, label: "Genre" },
                { id: 2, label: "Spotify" },
              ],
              tags: [
                { id: 10, categoryId: 1, label: "House" },
                { id: 20, categoryId: 2, label: "DJP" },
                { id: 30, categoryId: 1, label: "Techno" },
              ],
            },
          }),
          text: () => Promise.resolve(""),
          headers: new Headers({ "content-type": "application/json" }),
        } as unknown as Response);
      vi.stubGlobal("fetch", fetchFn);

      const tags = await svc.getTrackTagsInCategory("42", "2");
      expect(tags).toHaveLength(1);
      expect(tags[0].id).toBe("20");
      expect(tags[0].label).toBe("DJP");
    });

    it("returns empty array when track has no tags in the category", async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: () => Promise.resolve({ data: { track: { id: 42, tags: [10] } } }),
          text: () => Promise.resolve(""),
          headers: new Headers({ "content-type": "application/json" }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: () => Promise.resolve({
            data: {
              categories: [{ id: 1, label: "Genre" }, { id: 2, label: "Spotify" }],
              tags: [{ id: 10, categoryId: 1, label: "House" }],
            },
          }),
          text: () => Promise.resolve(""),
          headers: new Headers({ "content-type": "application/json" }),
        } as unknown as Response);
      vi.stubGlobal("fetch", fetchFn);

      const tags = await svc.getTrackTagsInCategory("42", "2");
      expect(tags).toHaveLength(0);
    });
  });

  describe("setTrackCategoryTags", () => {
    it("preserves other categories, replaces target category tags", async () => {
      const fetchFn = vi.fn()
        // getTrackTags -> GET /track?id=42 (current tags: genre 10, 20 + spotify 30)
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: () => Promise.resolve({ data: { track: { id: 42, tags: [10, 20, 30] } } }),
          text: () => Promise.resolve(""),
          headers: new Headers({ "content-type": "application/json" }),
        } as unknown as Response)
        // getTags -> GET /tags
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: () => Promise.resolve({
            data: {
              categories: [{ id: 1, label: "Genre" }, { id: 2, label: "Spotify" }],
              tags: [
                { id: 10, categoryId: 1, label: "House" },
                { id: 20, categoryId: 1, label: "Techno" },
                { id: 30, categoryId: 2, label: "OldPlaylist" },
              ],
            },
          }),
          text: () => Promise.resolve(""),
          headers: new Headers({ "content-type": "application/json" }),
        } as unknown as Response)
        // updateTrackTags -> PATCH /track
        .mockResolvedValueOnce({
          ok: true, status: 204,
          json: () => Promise.resolve(undefined),
          text: () => Promise.resolve(""),
          headers: new Headers(),
        } as unknown as Response);
      vi.stubGlobal("fetch", fetchFn);

      await svc.setTrackCategoryTags("42", "2", ["31", "32"]);

      // Verify the PATCH call has merged tags: genre (10, 20) + new spotify (31, 32)
      const [, opts] = fetchFn.mock.calls[2];
      const body = JSON.parse(opts.body);
      expect(body.id).toBe(42);
      expect(body.edits.tags).toEqual(expect.arrayContaining([10, 20, 31, 32]));
      expect(body.edits.tags).not.toContain(30); // Old spotify tag removed
    });

    it("works on track with no existing tags", async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: () => Promise.resolve({ data: { track: { id: 42, tags: [] } } }),
          text: () => Promise.resolve(""),
          headers: new Headers({ "content-type": "application/json" }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: () => Promise.resolve({ data: { categories: [], tags: [] } }),
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

      await svc.setTrackCategoryTags("42", "2", ["31"]);

      const [, opts] = fetchFn.mock.calls[2];
      const body = JSON.parse(opts.body);
      expect(body.edits.tags).toEqual([31]);
    });

    it("removes category tags when tagIds is empty", async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: () => Promise.resolve({ data: { track: { id: 42, tags: [10, 30] } } }),
          text: () => Promise.resolve(""),
          headers: new Headers({ "content-type": "application/json" }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: () => Promise.resolve({
            data: {
              categories: [{ id: 1, label: "Genre" }, { id: 2, label: "Spotify" }],
              tags: [
                { id: 10, categoryId: 1, label: "House" },
                { id: 30, categoryId: 2, label: "OldPlaylist" },
              ],
            },
          }),
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

      await svc.setTrackCategoryTags("42", "2", []);

      const [, opts] = fetchFn.mock.calls[2];
      const body = JSON.parse(opts.body);
      // Only genre tag preserved, spotify tag removed
      expect(body.edits.tags).toEqual([10]);
    });
  });
});
