import { describe, it, expect, vi, beforeEach } from "vitest";
import { SoulseekService } from "../soulseek-service.js";
import type { SoulseekConfig } from "../../config.js";

// Mock withRetry to execute fn directly (no delays in tests)
vi.mock("../../utils/retry.js", () => ({
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}));

// Silence logger in tests
vi.mock("../../utils/logger.js", () => ({
  createLogger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

const config: SoulseekConfig = {
  slskdUrl: "http://localhost:5030",
  slskdApiKey: "test-api-key",
  searchDelayMs: 100,
  downloadDir: "/tmp/slskd-downloads",
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers({ "content-type": "application/json" }),
  } as unknown as Response;
}

describe("SoulseekService", () => {
  let svc: SoulseekService;

  beforeEach(() => {
    vi.restoreAllMocks();
    svc = new SoulseekService(config);
  });

  // --- ping ---

  it("ping returns true when slskd responds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true })));
    expect(await svc.ping()).toBe(true);
  });

  it("ping returns false when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("connection refused")),
    );
    expect(await svc.ping()).toBe(false);
  });

  it("ping sends X-API-Key header", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchFn);

    await svc.ping();

    const [, opts] = fetchFn.mock.calls[0];
    expect(opts.headers["X-API-Key"]).toBe("test-api-key");
  });

  // --- startSearch ---

  it("startSearch POSTs and returns search ID", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ id: "search-123" }));
    vi.stubGlobal("fetch", fetchFn);

    const id = await svc.startSearch("Aphex Twin - Windowlicker");
    expect(id).toBe("search-123");

    const [url, opts] = fetchFn.mock.calls[0];
    expect(url).toContain("/api/v0/searches");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({
      searchText: "Aphex Twin - Windowlicker",
    });
  });

  // --- getSearchResults ---

  it("getSearchResults flattens multi-user responses", async () => {
    const rawResponse = {
      id: "s1",
      searchText: "test",
      state: "Completed",
      responses: [
        {
          username: "user1",
          files: [
            { filename: "a.mp3", size: 1000, code: "OK" },
            { filename: "b.flac", size: 2000, code: "OK" },
          ],
        },
        {
          username: "user2",
          files: [{ filename: "c.mp3", size: 3000, code: "OK" }],
        },
      ],
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(rawResponse)));

    const result = await svc.getSearchResults("s1");

    expect(result.files).toHaveLength(3);
    expect(result.fileCount).toBe(3);
    expect(result.files[0].username).toBe("user1");
    expect(result.files[0].filename).toBe("a.mp3");
    expect(result.files[2].username).toBe("user2");
    expect(result.state).toBe("Completed");
  });

  it("getSearchResults handles empty responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          id: "s2",
          searchText: "nothing",
          state: "Completed",
          responses: [],
        }),
      ),
    );

    const result = await svc.getSearchResults("s2");
    expect(result.files).toHaveLength(0);
    expect(result.fileCount).toBe(0);
  });

  // --- waitForSearch ---

  it("waitForSearch polls until Completed and stabilized", async () => {
    const pending = {
      id: "s1",
      searchText: "q",
      state: "InProgress",
      responses: [],
    };
    const completed = {
      id: "s1",
      searchText: "q",
      state: "Completed",
      responses: [
        {
          username: "u1",
          files: [{ filename: "f.mp3", size: 100, code: "OK" }],
        },
      ],
    };

    // Poll 1: InProgress, Poll 2: Completed with results, Poll 3: same (stabilized)
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(pending))
      .mockResolvedValueOnce(jsonResponse(completed))
      .mockResolvedValueOnce(jsonResponse(completed));
    vi.stubGlobal("fetch", fetchFn);

    // Advance fake time by 5s on each sleep (past STABILIZE_MS of 4s)
    let fakeTime = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => fakeTime);
    vi.spyOn(svc as never, "sleep").mockImplementation(async () => {
      fakeTime += 5_000;
    });

    const files = await svc.waitForSearch("s1", 60_000);
    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe("f.mp3");
  });

  // --- search timeout ---

  it("waitForSearch returns partial results and cancels on timeout", async () => {
    const inProgress = {
      id: "s1",
      searchText: "q",
      state: "InProgress",
      responses: [
        {
          username: "u1",
          files: [{ filename: "partial.mp3", size: 50, code: "OK" }],
        },
      ],
    };

    // Always return in-progress
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(inProgress));
    vi.stubGlobal("fetch", fetchFn);

    // Make sleep resolve instantly but pretend time has passed
    let callCount = 0;
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockImplementation(() => {
      callCount++;
      // After a few calls, exceed the deadline
      return callCount > 3 ? Number.MAX_SAFE_INTEGER : 0;
    });

    vi.spyOn(svc as never, "sleep").mockResolvedValue(undefined as never);

    const files = await svc.waitForSearch("s1", 100);
    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe("partial.mp3");

    // Should have attempted to DELETE the search (cancel)
    const deleteCall = fetchFn.mock.calls.find(
      ([url, opts]: [string, RequestInit]) =>
        url.includes("/searches/s1") && opts?.method === "DELETE",
    );
    expect(deleteCall).toBeDefined();
  });

  // --- download ---

  it("download sends POST to transfers endpoint", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(undefined, 200));
    vi.stubGlobal("fetch", fetchFn);

    await svc.download("cooluser", "Music/track.mp3", 5000);

    const [url, opts] = fetchFn.mock.calls[0];
    expect(url).toContain("/transfers/downloads/cooluser");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body).toEqual([{ filename: "Music/track.mp3", size: 5000 }]);
  });

  it("download without size omits size from body", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(undefined, 200));
    vi.stubGlobal("fetch", fetchFn);

    await svc.download("user", "file.flac");

    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body).toEqual([{ filename: "file.flac" }]);
  });

  // --- rateLimitedSearch ---

  it("rateLimitedSearch respects delay between searches", async () => {
    const completedResponse = {
      id: "s1",
      searchText: "q",
      state: "Completed",
      responses: [{ username: "u", files: [{ filename: "f.mp3", size: 1, code: "0" }] }],
    };

    const fetchFn = vi.fn()
      // First search: startSearch
      .mockResolvedValueOnce(jsonResponse({ id: "s1" }))
      // First search: poll 1 (results appear)
      .mockResolvedValueOnce(jsonResponse(completedResponse))
      // First search: poll 2 (stabilized after sleep advances time)
      .mockResolvedValueOnce(jsonResponse(completedResponse))
      // Second search: startSearch
      .mockResolvedValueOnce(jsonResponse({ id: "s2" }))
      // Second search: poll 1 (results appear)
      .mockResolvedValueOnce(
        jsonResponse({ ...completedResponse, id: "s2" }),
      )
      // Second search: poll 2 (stabilized)
      .mockResolvedValueOnce(
        jsonResponse({ ...completedResponse, id: "s2" }),
      );
    vi.stubGlobal("fetch", fetchFn);

    let fakeTime = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => fakeTime);
    const sleepSpy = vi.spyOn(svc as never, "sleep").mockImplementation(async () => {
      fakeTime += 5_000;
    });

    await svc.rateLimitedSearch("query1");
    await svc.rateLimitedSearch("query2");

    // The second search should have called sleep for the rate limit delay
    const sleepCalls = sleepSpy.mock.calls;
    const hasDelayCall = sleepCalls.some(
      ([ms]: [number]) => ms > 0,
    );
    expect(hasDelayCall).toBe(true);
  });

  // --- startSearchBatch ---

  it("startSearchBatch POSTs all queries with rate-limit delays", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "s1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "s2" }))
      .mockResolvedValueOnce(jsonResponse({ id: "s3" }));
    vi.stubGlobal("fetch", fetchFn);

    const sleepSpy = vi
      .spyOn(svc as never, "sleep")
      .mockResolvedValue(undefined as never);

    const result = await svc.startSearchBatch(["query1", "query2", "query3"]);

    expect(result.size).toBe(3);
    expect(result.get("query1")!.searchId).toBe("s1");
    expect(result.get("query2")!.searchId).toBe("s2");
    expect(result.get("query3")!.searchId).toBe("s3");
    expect(fetchFn).toHaveBeenCalledTimes(3);

    // Each entry should have a startedAt timestamp
    for (const [, entry] of result) {
      expect(entry.startedAt).toBeGreaterThan(0);
    }

    // Rate-limit delays should have been applied between searches
    const delayCalls = sleepSpy.mock.calls.filter(([ms]: [number]) => ms > 0);
    expect(delayCalls.length).toBeGreaterThanOrEqual(1);
  });

  // --- waitForSearchBatch ---

  it("waitForSearchBatch polls until all searches complete", async () => {
    const completedS1 = {
      id: "s1",
      searchText: "q1",
      state: "Completed",
      responses: [
        { username: "u1", files: [{ filename: "a.mp3", size: 100, code: "OK" }] },
      ],
    };
    const completedS2 = {
      id: "s2",
      searchText: "q2",
      state: "Completed",
      responses: [
        { username: "u2", files: [{ filename: "b.flac", size: 200, code: "OK" }] },
      ],
    };

    // Stabilization needs multiple polls with same count.
    // Poll 1: s1 has results, s2 in progress
    // Poll 2: s1 still same count (stabilized after STABILIZE_MS), s2 has results
    // Poll 3: s2 still same count (stabilized)
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(completedS1))
      .mockResolvedValueOnce(
        jsonResponse({ id: "s2", searchText: "q2", state: "InProgress", responses: [] }),
      )
      .mockResolvedValueOnce(jsonResponse(completedS1))
      .mockResolvedValueOnce(jsonResponse(completedS2))
      .mockResolvedValueOnce(jsonResponse(completedS2));
    vi.stubGlobal("fetch", fetchFn);

    // Advance time enough for stabilization on each sleep call
    let fakeTime = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => fakeTime);
    vi.spyOn(svc as never, "sleep").mockImplementation(async () => {
      fakeTime += 5_000; // jump past STABILIZE_MS
    });

    const now = fakeTime;
    const searchEntries = new Map([
      ["q1", { searchId: "s1", startedAt: now }],
      ["q2", { searchId: "s2", startedAt: now }],
    ]);

    const results = await svc.waitForSearchBatch(searchEntries, 60_000);

    expect(results.size).toBe(2);
    expect(results.get("q1")).toHaveLength(1);
    expect(results.get("q2")).toHaveLength(1);
    expect(results.get("q1")![0].filename).toBe("a.mp3");
    expect(results.get("q2")![0].filename).toBe("b.flac");
  });

  it("waitForSearchBatch returns partial results on timeout", async () => {
    const inProgress = {
      id: "s1",
      searchText: "q1",
      state: "InProgress",
      responses: [
        { username: "u1", files: [{ filename: "partial.mp3", size: 50, code: "OK" }] },
      ],
    };

    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(inProgress));
    vi.stubGlobal("fetch", fetchFn);

    let callCount = 0;
    vi.spyOn(Date, "now").mockImplementation(() => {
      callCount++;
      return callCount > 3 ? Number.MAX_SAFE_INTEGER : 0;
    });
    vi.spyOn(svc as never, "sleep").mockResolvedValue(undefined as never);

    const searchEntries = new Map([
      ["q1", { searchId: "s1", startedAt: 0 }],
    ]);
    const results = await svc.waitForSearchBatch(searchEntries, 100);

    expect(results.size).toBe(1);
    expect(results.get("q1")).toHaveLength(1);

    // Should have attempted DELETE (cancel)
    const deleteCall = fetchFn.mock.calls.find(
      ([url, opts]: [string, RequestInit]) =>
        url.includes("/searches/s1") && opts?.method === "DELETE",
    );
    expect(deleteCall).toBeDefined();
  });

  // --- getTransfers ---

  it("getTransfers flattens per-user directory structure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([
      {
        username: "user1",
        directories: [
          {
            directory: "Music",
            files: [
              { id: "t1", username: "user1", filename: "song.flac", state: "Completed", bytesTransferred: 1000, size: 1000, percentComplete: 100 },
            ],
          },
        ],
      },
      {
        username: "user2",
        directories: [
          {
            directory: "Shared",
            files: [
              { id: "t2", username: "user2", filename: "other.mp3", state: "InProgress", bytesTransferred: 500, size: 2000, percentComplete: 25 },
            ],
          },
        ],
      },
    ])));

    const transfers = await svc.getTransfers();
    expect(transfers).toHaveLength(2);
    expect(transfers[0].username).toBe("user1");
    expect(transfers[0].filename).toBe("song.flac");
    expect(transfers[1].username).toBe("user2");
  });

  // --- getTransfer ---

  it("getTransfer returns matching transfer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      username: "user1",
      directories: [{
        directory: "Music",
        files: [
          { id: "t1", username: "user1", filename: "target.flac", state: "Completed", bytesTransferred: 1000, size: 1000, percentComplete: 100 },
          { id: "t2", username: "user1", filename: "other.mp3", state: "InProgress", bytesTransferred: 0, size: 500, percentComplete: 0 },
        ],
      }],
    })));

    const transfer = await svc.getTransfer("user1", "target.flac");
    expect(transfer).not.toBeNull();
    expect(transfer!.filename).toBe("target.flac");
    expect(transfer!.state).toBe("Completed");
  });

  it("getTransfer returns null when file not found", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      username: "user1",
      directories: [{ directory: "Music", files: [] }],
    })));

    const transfer = await svc.getTransfer("user1", "missing.flac");
    expect(transfer).toBeNull();
  });

  it("getTransfer returns null on API error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 404, statusText: "Not Found",
      text: () => Promise.resolve(""), headers: new Headers(),
    } as unknown as Response));

    const transfer = await svc.getTransfer("user1", "file.flac");
    expect(transfer).toBeNull();
  });

  // --- waitForDownload ---

  it("waitForDownload returns on completed state", async () => {
    const completedTransfer = {
      username: "user1",
      directories: [{
        directory: "Music",
        files: [{ id: "t1", username: "user1", filename: "song.flac", state: "Completed, Succeeded", bytesTransferred: 5000, size: 5000, percentComplete: 100 }],
      }],
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(completedTransfer)));

    const result = await svc.waitForDownload("user1", "song.flac", 5000);
    expect(result.state).toContain("Completed");
  });

  it("waitForDownload throws on errored state", async () => {
    const errorTransfer = {
      username: "user1",
      directories: [{
        directory: "Music",
        files: [{ id: "t1", username: "user1", filename: "song.flac", state: "Errored", bytesTransferred: 0, size: 5000, percentComplete: 0 }],
      }],
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(errorTransfer)));

    await expect(svc.waitForDownload("user1", "song.flac", 5000)).rejects.toThrow(/Download failed/);
  });

  it("waitForDownload throws when transfer not found", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      username: "user1",
      directories: [{ directory: "Music", files: [] }],
    })));

    await expect(svc.waitForDownload("user1", "missing.flac", 5000)).rejects.toThrow(/Transfer not found/);
  });

  it("waitForDownload throws on timeout", async () => {
    const inProgressTransfer = {
      username: "user1",
      directories: [{
        directory: "Music",
        files: [{ id: "t1", username: "user1", filename: "song.flac", state: "InProgress", bytesTransferred: 100, size: 5000, percentComplete: 2 }],
      }],
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(inProgressTransfer)));

    let fakeTime = 0;
    vi.spyOn(Date, "now").mockImplementation(() => {
      fakeTime += 2000;
      return fakeTime;
    });
    vi.spyOn(svc as never, "sleep").mockResolvedValue(undefined as never);

    await expect(svc.waitForDownload("user1", "song.flac", 100)).rejects.toThrow(/timed out/);
  });

  // --- search (convenience) ---

  it("search calls startSearch then waitForSearch", async () => {
    const completed = {
      id: "s1", searchText: "q", state: "Completed",
      responses: [{ username: "u", files: [{ filename: "f.mp3", size: 1, code: "0" }] }],
    };

    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: "s1" }))
      .mockResolvedValueOnce(jsonResponse(completed))
      .mockResolvedValueOnce(jsonResponse(completed));
    vi.stubGlobal("fetch", fetchFn);

    let fakeTime = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => fakeTime);
    vi.spyOn(svc as never, "sleep").mockImplementation(async () => { fakeTime += 5000; });

    const files = await svc.search("query");
    expect(files).toHaveLength(1);
  });

  // --- waitForSearch: 0 results after min wait ---

  it("waitForSearch accepts 0 results after MIN_SEARCH_WAIT_MS", async () => {
    const empty = { id: "s1", searchText: "q", state: "Completed", responses: [] };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(empty)));

    let fakeTime = 0;
    vi.spyOn(Date, "now").mockImplementation(() => fakeTime);
    vi.spyOn(svc as never, "sleep").mockImplementation(async () => { fakeTime += 11_000; }); // past MIN_SEARCH_WAIT_MS (10s)

    const files = await svc.waitForSearch("s1", 60_000);
    expect(files).toHaveLength(0);
  });

  // --- error handling ---

  it("throws on non-2xx from slskd API", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () => Promise.resolve("server error"),
      headers: new Headers(),
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchFn);

    await expect(svc.startSearch("test")).rejects.toThrow(
      /slskd API error: 500/,
    );
  });
});
