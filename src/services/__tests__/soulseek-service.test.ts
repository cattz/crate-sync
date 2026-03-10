import { describe, it, expect, vi, beforeEach } from "vitest";
import { SoulseekService } from "../soulseek-service.js";
import type { SoulseekConfig } from "../../config.js";

// Mock withRetry to execute fn directly (no delays in tests)
vi.mock("../../utils/retry.js", () => ({
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}));

const config: SoulseekConfig = {
  slskdUrl: "http://localhost:5030",
  slskdApiKey: "test-api-key",
  searchDelayMs: 100,
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

  it("waitForSearch polls until Completed", async () => {
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

    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(pending))
      .mockResolvedValueOnce(jsonResponse(completed));
    vi.stubGlobal("fetch", fetchFn);

    // Override sleep to be instant
    vi.spyOn(svc as never, "sleep").mockResolvedValue(undefined as never);

    const files = await svc.waitForSearch("s1", 10_000);
    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe("f.mp3");
    expect(fetchFn).toHaveBeenCalledTimes(2);
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
    expect(body.filename).toBe("Music/track.mp3");
    expect(body.size).toBe(5000);
  });

  it("download without size omits size from body", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(undefined, 200));
    vi.stubGlobal("fetch", fetchFn);

    await svc.download("user", "file.flac");

    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body).toEqual({ filename: "file.flac" });
  });

  // --- rateLimitedSearch ---

  it("rateLimitedSearch respects delay between searches", async () => {
    // First search: start + getResults(pending) + getResults(completed)
    // Second search: start + getResults(completed)
    const completedResponse = {
      id: "s1",
      searchText: "q",
      state: "Completed",
      responses: [],
    };

    const fetchFn = vi.fn()
      // First search: startSearch
      .mockResolvedValueOnce(jsonResponse({ id: "s1" }))
      // First search: getSearchResults (completed immediately)
      .mockResolvedValueOnce(jsonResponse(completedResponse))
      // Second search: startSearch
      .mockResolvedValueOnce(jsonResponse({ id: "s2" }))
      // Second search: getSearchResults
      .mockResolvedValueOnce(
        jsonResponse({ ...completedResponse, id: "s2" }),
      );
    vi.stubGlobal("fetch", fetchFn);

    const sleepSpy = vi
      .spyOn(svc as never, "sleep")
      .mockResolvedValue(undefined as never);

    await svc.rateLimitedSearch("query1");
    await svc.rateLimitedSearch("query2");

    // The second search should have called sleep for the rate limit delay
    const sleepCalls = sleepSpy.mock.calls;
    const hasDelayCall = sleepCalls.some(
      ([ms]: [number]) => ms > 0,
    );
    expect(hasDelayCall).toBe(true);
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
