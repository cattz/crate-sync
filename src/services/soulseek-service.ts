import type { SoulseekConfig } from "../config.js";
import type {
  SlskdFile,
  SlskdSearchResult,
  SlskdTransfer,
} from "../types/soulseek.js";

const DEFAULT_SEARCH_TIMEOUT_MS = 30_000;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 2_000;

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

interface SlskdTransferResponse {
  id: string;
  username: string;
  filename: string;
  state: string;
  bytesTransferred: number;
  size: number;
  percentComplete: number;
}

export class SoulseekService {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly searchDelayMs: number;
  private lastSearchTime = 0;

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
      `/searches/${searchId}`,
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
   * Returns the flat list of files once the search reaches "Completed" state.
   */
  async waitForSearch(
    searchId: string,
    timeoutMs: number = DEFAULT_SEARCH_TIMEOUT_MS,
  ): Promise<SlskdFile[]> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const result = await this.getSearchResults(searchId);

      if (
        result.state === "Completed" ||
        result.state.toLowerCase().includes("completed")
      ) {
        return result.files;
      }

      await this.sleep(POLL_INTERVAL_MS);
    }

    // Timeout — clean up and return whatever we have
    const finalResult = await this.getSearchResults(searchId);
    await this.cancelSearch(searchId);
    return finalResult.files;
  }

  /** Initiate a download from a specific user. */
  async download(
    username: string,
    filename: string,
    size?: number,
  ): Promise<void> {
    const body: Record<string, unknown> = { filename };
    if (size !== undefined) {
      body.size = size;
    }
    await this.request(
      "POST",
      `/transfers/downloads/${encodeURIComponent(username)}`,
      body,
    );
  }

  /** Get all current transfers. */
  async getTransfers(): Promise<SlskdTransfer[]> {
    const raw =
      await this.request<SlskdTransferResponse[]>(
        "GET",
        "/transfers/downloads",
      );
    return raw.map((t) => this.mapTransfer(t));
  }

  /** Get transfer status for a specific file. Returns null if not found. */
  async getTransfer(
    username: string,
    filename: string,
  ): Promise<SlskdTransfer | null> {
    try {
      const raw = await this.request<SlskdTransferResponse[]>(
        "GET",
        `/transfers/downloads/${encodeURIComponent(username)}`,
      );
      const match = raw.find((t) => t.filename === filename);
      return match ? this.mapTransfer(match) : null;
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
    const now = Date.now();
    const elapsed = now - this.lastSearchTime;
    const remaining = this.searchDelayMs - elapsed;

    if (remaining > 0) {
      await this.sleep(remaining);
    }

    this.lastSearchTime = Date.now();
    return this.search(query);
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

  private mapTransfer(raw: SlskdTransferResponse): SlskdTransfer {
    return {
      id: raw.id,
      username: raw.username,
      filename: raw.filename,
      state: raw.state,
      bytesTransferred: raw.bytesTransferred,
      size: raw.size,
      percentComplete: raw.percentComplete,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
