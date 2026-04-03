import type { SoulseekConfig } from "../config.js";
import type {
  SlskdFile,
  SlskdSearchResult,
  SlskdTransfer,
} from "../types/soulseek.js";
import { withRetry } from "../utils/retry.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("soulseek");

const DEFAULT_SEARCH_TIMEOUT_MS = 30_000;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 2_000;
const MIN_SEARCH_WAIT_MS = 10_000;
/** After results appear, wait for count to stabilize for this long. */
const STABILIZE_MS = 4_000;

interface SlskdSearchResponse {
  id: string;
  searchText: string;
  state: string;
  responses: Array<{
    username: string;
    files: Array<{
      filename: string;
      size: number;
      bitRate?: number;
      sampleRate?: number;
      bitDepth?: number;
      length?: number;
      code: string;
    }>;
  }>;
}

interface SlskdTransferFile {
  id: string;
  username: string;
  filename: string;
  state: string;
  bytesTransferred: number;
  size: number;
  percentComplete: number;
}

/** Per-user response: { username, directories: [{ directory, files: [...] }] } */
interface SlskdUserTransfers {
  username: string;
  directories: Array<{
    directory: string;
    files: SlskdTransferFile[];
  }>;
}

// Global search mutex — ensures only one search fires at a time across
// all SoulseekService instances, preventing slskd concurrency errors
let globalLastSearchTime = 0;
let searchLock: Promise<void> = Promise.resolve();

function acquireSearchLock(delayMs: number): Promise<void> {
  const prev = searchLock;
  let resolve: () => void;
  searchLock = new Promise<void>((r) => { resolve = r; });
  return prev.then(async () => {
    const now = Date.now();
    const remaining = delayMs - (now - globalLastSearchTime);
    if (remaining > 0) {
      await new Promise<void>((r) => setTimeout(r, remaining));
    }
    globalLastSearchTime = Date.now();
    resolve!();
  });
}

export class SoulseekService {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly searchDelayMs: number;

  constructor(private config: SoulseekConfig) {
    this.baseUrl = config.slskdUrl.replace(/\/+$/, "");
    this.apiKey = config.slskdApiKey;
    this.searchDelayMs = config.searchDelayMs;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    return withRetry(async () => {
      const url = `${this.baseUrl}/api/v0${path}`;
      const headers: Record<string, string> = {
        "X-API-Key": this.apiKey,
        "Content-Type": "application/json",
      };

      const response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `slskd API error: ${response.status} ${response.statusText} — ${method} ${path}${text ? ` — ${text}` : ""}`,
        );
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        return (await response.json()) as T;
      }

      return undefined as T;
    });
  }

  /** Test connection to slskd. */
  async ping(): Promise<boolean> {
    try {
      await fetch(`${this.baseUrl}/api/v0/application`, {
        headers: { "X-API-Key": this.apiKey },
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Check if slskd is connected and logged into the Soulseek network. */
  async isConnected(): Promise<boolean> {
    try {
      const data = await this.request<{ state?: string; isLoggedIn?: boolean }>("GET", "/server");
      return data.isLoggedIn === true;
    } catch {
      return false;
    }
  }

  /** Wait for slskd to be connected, checking every 5s up to maxWaitMs. */
  async waitForConnection(maxWaitMs = 60_000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (await this.isConnected()) return true;
      await this.sleep(5000);
    }
    return false;
  }

  /**
   * Search for a track. Waits for search to complete (polls).
   * Returns flat list of files from all users.
   */
  async search(query: string): Promise<SlskdFile[]> {
    const searchId = await this.startSearch(query);
    return this.waitForSearch(searchId);
  }

  /** Start a search without waiting. Returns the search ID. */
  async startSearch(query: string): Promise<string> {
    const result = await this.request<{ id: string }>("POST", "/searches", {
      searchText: query,
    });
    return result.id;
  }

  /** Poll search results. */
  async getSearchResults(searchId: string): Promise<SlskdSearchResult> {
    const raw = await this.request<SlskdSearchResponse>(
      "GET",
      `/searches/${searchId}?includeResponses=true`,
    );
    const files = this.flattenSearchResponse(raw);
    return {
      id: raw.id,
      searchText: raw.searchText,
      state: raw.state,
      fileCount: files.length,
      files,
    };
  }

  /**
   * Wait for a search to complete by polling.
   * Uses result stabilization: after results appear, waits for the file count
   * to stop changing before accepting. Never accepts 0 results before MIN_SEARCH_WAIT_MS.
   */
  async waitForSearch(
    searchId: string,
    timeoutMs: number = DEFAULT_SEARCH_TIMEOUT_MS,
  ): Promise<SlskdFile[]> {
    const startTime = Date.now();
    const deadline = startTime + timeoutMs;
    let lastFileCount = 0;
    let lastChangeTime = startTime;

    while (Date.now() < deadline) {
      const result = await this.getSearchResults(searchId);
      const now = Date.now();
      const elapsed = now - startTime;

      log.debug(`Poll search`, {
        searchId,
        state: result.state,
        fileCount: result.files.length,
        elapsedMs: elapsed,
      });

      // Track when file count last changed
      if (result.files.length !== lastFileCount) {
        lastFileCount = result.files.length;
        lastChangeTime = now;
      }

      const isCompleted = (result.state ?? "")
        .toLowerCase()
        .includes("completed");
      const stableMs = now - lastChangeTime;

      // Accept when: completed AND has results AND results have stabilized
      if (isCompleted && result.files.length > 0 && stableMs >= STABILIZE_MS) {
        log.debug(`Search done (stabilized)`, {
          searchId,
          fileCount: result.files.length,
          stableMs,
        });
        return result.files;
      }

      // Accept 0 results only after MIN_SEARCH_WAIT_MS (P2P results trickle in)
      if (isCompleted && result.files.length === 0 && elapsed >= MIN_SEARCH_WAIT_MS) {
        log.debug(`Search done (no results after min wait)`, {
          searchId,
          elapsedMs: elapsed,
        });
        return result.files;
      }

      await this.sleep(POLL_INTERVAL_MS);
    }

    // Timeout — clean up and return whatever we have
    const finalResult = await this.getSearchResults(searchId);
    log.debug(`Search timeout`, {
      searchId,
      fileCount: finalResult.files.length,
    });
    await this.cancelSearch(searchId);
    return finalResult.files;
  }

  /** Initiate a download from a specific user. Optionally specify destination path. */
  async download(
    username: string,
    filename: string,
    size?: number,
    destination?: string,
  ): Promise<void> {
    const item: Record<string, unknown> = { filename };
    if (size !== undefined) {
      item.size = size;
    }
    if (destination) {
      item.destination = destination;
    }
    log.info("Initiating slskd download", { username, filename: filename.slice(-60), destination: destination ?? "(none)" });
    await this.request(
      "POST",
      `/transfers/downloads/${encodeURIComponent(username)}`,
      [item],
    );
  }

  /** Get all current transfers. */
  async getTransfers(): Promise<SlskdTransfer[]> {
    const raw = await this.request<SlskdUserTransfers[]>(
      "GET",
      "/transfers/downloads",
    );
    return this.flattenTransfers(raw);
  }

  /** Get transfer status for a specific file. Returns null if not found. */
  async getTransfer(
    username: string,
    filename: string,
  ): Promise<SlskdTransfer | null> {
    try {
      const raw = await this.request<SlskdUserTransfers>(
        "GET",
        `/transfers/downloads/${encodeURIComponent(username)}`,
      );
      const files = this.flattenUserTransfers(raw);
      const match = files.find((t) => t.filename === filename);
      return match ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Wait for a download to complete by polling.
   * Throws if the download enters an error state or times out.
   */
  async waitForDownload(
    username: string,
    filename: string,
    timeoutMs: number = DEFAULT_DOWNLOAD_TIMEOUT_MS,
  ): Promise<SlskdTransfer> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const transfer = await this.getTransfer(username, filename);

      if (!transfer) {
        throw new Error(
          `Transfer not found: ${username} / ${filename}`,
        );
      }

      const state = transfer.state.toLowerCase();

      if (state.includes("completed") || state.includes("succeeded")) {
        return transfer;
      }

      if (
        state.includes("errored") ||
        state.includes("cancelled") ||
        state.includes("rejected")
      ) {
        throw new Error(
          `Download failed with state "${transfer.state}": ${username} / ${filename}`,
        );
      }

      await this.sleep(POLL_INTERVAL_MS);
    }

    throw new Error(
      `Download timed out after ${timeoutMs}ms: ${username} / ${filename}`,
    );
  }

  /**
   * Rate-limited search — ensures minimum delay between searches.
   * Uses the searchDelayMs from config.
   */
  async rateLimitedSearch(query: string): Promise<SlskdFile[]> {
    await acquireSearchLock(this.searchDelayMs);
    return this.search(query);
  }

  /**
   * Start multiple searches with rate-limit delays between POSTs.
   * Returns a map of query → { searchId, startedAt } so the batch poller
   * can track per-search elapsed time.
   */
  async startSearchBatch(
    queries: string[],
  ): Promise<Map<string, { searchId: string; startedAt: number }>> {
    const result = new Map<string, { searchId: string; startedAt: number }>();

    for (const query of queries) {
      await acquireSearchLock(this.searchDelayMs);
      const searchId = await this.startSearch(query);
      log.debug(`Batch: posted search`, { query, searchId });
      result.set(query, { searchId, startedAt: Date.now() });
    }

    return result;
  }

  /**
   * Poll all searches in a single loop until all are done or timeout.
   * Uses per-search elapsed time (not batch-level) so later searches
   * get their full MIN_SEARCH_WAIT_MS. Also uses result stabilization.
   */
  async waitForSearchBatch(
    searchEntries: Map<string, { searchId: string; startedAt: number }>,
    timeoutMs: number = DEFAULT_SEARCH_TIMEOUT_MS,
  ): Promise<Map<string, SlskdFile[]>> {
    const batchStart = Date.now();
    const deadline = batchStart + timeoutMs;
    const results = new Map<string, SlskdFile[]>();

    // Per-search tracking: last known file count and when it last changed
    const tracking = new Map<
      string,
      { lastFileCount: number; lastChangeTime: number }
    >();
    const pending = new Map(searchEntries);

    for (const [query] of pending) {
      tracking.set(query, { lastFileCount: 0, lastChangeTime: Date.now() });
    }

    while (pending.size > 0 && Date.now() < deadline) {
      for (const [query, { searchId, startedAt }] of pending) {
        const result = await this.getSearchResults(searchId);
        const now = Date.now();
        const searchElapsed = now - startedAt;
        const track = tracking.get(query)!;

        log.debug(`Batch poll`, {
          query,
          searchId,
          state: result.state,
          fileCount: result.files.length,
          searchElapsedMs: searchElapsed,
        });

        // Track file count changes
        if (result.files.length !== track.lastFileCount) {
          track.lastFileCount = result.files.length;
          track.lastChangeTime = now;
        }

        const isCompleted = (result.state ?? "")
          .toLowerCase()
          .includes("completed");
        const stableMs = now - track.lastChangeTime;

        // Accept: completed + has results + stabilized
        if (isCompleted && result.files.length > 0 && stableMs >= STABILIZE_MS) {
          log.debug(`Batch search done (stabilized)`, {
            query,
            fileCount: result.files.length,
          });
          results.set(query, result.files);
          pending.delete(query);
          continue;
        }

        // Accept 0 results only after per-search MIN_SEARCH_WAIT_MS
        if (
          isCompleted &&
          result.files.length === 0 &&
          searchElapsed >= MIN_SEARCH_WAIT_MS
        ) {
          log.debug(`Batch search done (no results after min wait)`, {
            query,
            searchElapsedMs: searchElapsed,
          });
          results.set(query, result.files);
          pending.delete(query);
        }
      }

      if (pending.size > 0 && Date.now() < deadline) {
        await this.sleep(POLL_INTERVAL_MS);
      }
    }

    // Timeout: collect partial results and cancel remaining
    for (const [query, { searchId }] of pending) {
      const finalResult = await this.getSearchResults(searchId);
      log.debug(`Batch search timeout`, {
        query,
        fileCount: finalResult.files.length,
      });
      results.set(query, finalResult.files);
      await this.cancelSearch(searchId);
    }

    return results;
  }

  // --- Private helpers ---

  private async cancelSearch(searchId: string): Promise<void> {
    try {
      await this.request("DELETE", `/searches/${searchId}`);
    } catch {
      // Best-effort cleanup
    }
  }

  private flattenSearchResponse(raw: SlskdSearchResponse): SlskdFile[] {
    const files: SlskdFile[] = [];
    for (const response of raw.responses ?? []) {
      for (const file of response.files ?? []) {
        files.push({
          filename: file.filename,
          size: file.size,
          bitRate: file.bitRate,
          sampleRate: file.sampleRate,
          bitDepth: file.bitDepth,
          length: file.length,
          username: response.username,
          code: file.code,
        });
      }
    }
    return files;
  }

  private flattenUserTransfers(raw: SlskdUserTransfers): SlskdTransfer[] {
    const result: SlskdTransfer[] = [];
    for (const dir of raw.directories ?? []) {
      for (const file of dir.files ?? []) {
        result.push({
          id: file.id,
          username: file.username ?? raw.username,
          filename: file.filename,
          state: file.state,
          bytesTransferred: file.bytesTransferred,
          size: file.size,
          percentComplete: file.percentComplete,
        });
      }
    }
    return result;
  }

  private flattenTransfers(raw: SlskdUserTransfers[]): SlskdTransfer[] {
    return raw.flatMap((u) => this.flattenUserTransfers(u));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
