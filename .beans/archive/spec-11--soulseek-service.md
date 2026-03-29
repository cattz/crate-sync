---
# spec-11
title: Soulseek service (slskd client)
status: todo
type: task
priority: critical
parent: spec-E3
depends_on: spec-03, spec-05
created_at: 2026-03-24T00:00:00Z
updated_at: 2026-03-24T00:00:00Z
---

## Purpose

`SoulseekService` is the client for the [slskd](https://github.com/slskd/slskd) REST API (a web-based Soulseek client). It provides search operations (blocking and non-blocking, single and batch), download initiation with polling-based completion tracking, and transfer management. The service handles the inherent challenges of P2P search: results trickle in over time, so the service uses a stabilization algorithm -- it waits for the result count to stop changing before accepting results. Rate limiting between searches is enforced via a configurable delay.

## Public Interface

### Constants

```ts
const DEFAULT_SEARCH_TIMEOUT_MS = 30_000;   // 30 seconds
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 300_000; // 5 minutes
const POLL_INTERVAL_MS = 2_000;              // 2 seconds between polls
const MIN_SEARCH_WAIT_MS = 10_000;           // 10 seconds minimum before accepting 0 results
const STABILIZE_MS = 4_000;                  // 4 seconds of stable result count before accepting
```

### Internal types (within service file)

```ts
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

interface SlskdUserTransfers {
  username: string;
  directories: Array<{
    directory: string;
    files: SlskdTransferFile[];
  }>;
}
```

### SoulseekService class

```ts
class SoulseekService {
  constructor(config: SoulseekConfig)
  // SoulseekConfig = {
  //   slskdUrl: string;       // default "http://localhost:5030"
  //   slskdApiKey: string;
  //   searchDelayMs: number;  // default 5000
  //   downloadDir: string;
  // }
  // baseUrl = config.slskdUrl (trailing slashes stripped)
  // apiKey = config.slskdApiKey
  // searchDelayMs = config.searchDelayMs

  // --- Connectivity ---
  async ping(): Promise<boolean>

  // --- Search (blocking) ---
  async search(query: string): Promise<SlskdFile[]>
  async rateLimitedSearch(query: string): Promise<SlskdFile[]>

  // --- Search (non-blocking) ---
  async startSearch(query: string): Promise<string>
  async getSearchResults(searchId: string): Promise<SlskdSearchResult>
  async waitForSearch(searchId: string, timeoutMs?: number): Promise<SlskdFile[]>

  // --- Batch search ---
  async startSearchBatch(queries: string[]): Promise<Map<string, { searchId: string; startedAt: number }>>
  async waitForSearchBatch(
    searchEntries: Map<string, { searchId: string; startedAt: number }>,
    timeoutMs?: number,
  ): Promise<Map<string, SlskdFile[]>>

  // --- Downloads ---
  async download(username: string, filename: string, size?: number): Promise<void>
  async waitForDownload(username: string, filename: string, timeoutMs?: number): Promise<SlskdTransfer>

  // --- Transfers ---
  async getTransfers(): Promise<SlskdTransfer[]>
  async getTransfer(username: string, filename: string): Promise<SlskdTransfer | null>
}
```

## Dependencies

### Imports

| Import | Source |
|---|---|
| `SoulseekConfig` | `../config.js` |
| `SlskdFile`, `SlskdSearchResult`, `SlskdTransfer` | `../types/soulseek.js` |
| `withRetry` | `../utils/retry.js` |
| `createLogger` | `../utils/logger.js` |

Logger instance: `const log = createLogger("soulseek")` -- used for debug-level logging of poll state, search completion, and batch progress.

### Types

```ts
// SoulseekConfig (from config.ts)
interface SoulseekConfig {
  slskdUrl: string;        // default "http://localhost:5030"
  slskdApiKey: string;
  searchDelayMs: number;   // default 5000
  downloadDir: string;     // host path for slskd completed downloads
}

// SlskdFile (from types/soulseek.ts)
interface SlskdFile {
  filename: string;
  size: number;
  bitRate?: number;
  sampleRate?: number;
  bitDepth?: number;
  length?: number;
  username: string;
  code: string;
}

// SlskdSearchResult (from types/soulseek.ts)
interface SlskdSearchResult {
  id: string;
  searchText: string;
  state: string;
  fileCount: number;
  files: SlskdFile[];
}

// SlskdTransfer (from types/soulseek.ts)
interface SlskdTransfer {
  id: string;
  username: string;
  filename: string;
  state: string;
  bytesTransferred: number;
  size: number;
  percentComplete: number;
}
```

## Behavior

### Base URL and authentication

- `baseUrl = config.slskdUrl` with trailing slashes stripped.
- All API calls go to `{baseUrl}/api/v0{path}`.
- Authentication via `X-API-Key` header on every request.

### Internal request helper

```ts
private async request<T>(method: string, path: string, body?: unknown): Promise<T>
```

- Wrapped in `withRetry()` (3 retries, 1s base delay, 10s max, exponential backoff with jitter).
- Full URL: `{baseUrl}/api/v0{path}`.
- Headers: `X-API-Key: {apiKey}`, `Content-Type: application/json`.
- Body: `JSON.stringify(body)` if provided, `undefined` otherwise.
- Response: checks `Content-Type` for `application/json`; if so, parses JSON. Otherwise returns `undefined as T`.
- Non-OK: throws `"slskd API error: {status} {statusText} -- {method} {path} -- {body}"`.

### API endpoints called

| Method | Path | Used by | Request body |
|---|---|---|---|
| GET | `/application` | `ping()` (via raw fetch, NOT through `request()`) | -- |
| POST | `/searches` | `startSearch()` | `{ searchText: query }` |
| GET | `/searches/{searchId}?includeResponses=true` | `getSearchResults()` | -- |
| DELETE | `/searches/{searchId}` | `cancelSearch()` (private) | -- |
| POST | `/transfers/downloads/{username}` | `download()` | `[{ filename, size? }]` (array of items) |
| GET | `/transfers/downloads` | `getTransfers()` | -- |
| GET | `/transfers/downloads/{username}` | `getTransfer()` | -- |

Note: `ping()` uses raw `fetch()` directly (not the `request()` helper) with only the `X-API-Key` header, hitting `/api/v0/application`.

### ping()

Makes a raw `fetch` GET to `{baseUrl}/api/v0/application` with `X-API-Key` header. Returns `true` if no error thrown, `false` on any catch.

### search() -- blocking search

```ts
async search(query: string): Promise<SlskdFile[]>
```

Convenience method: calls `startSearch(query)` then `waitForSearch(searchId)`. Returns flat file list.

### startSearch() -- non-blocking

```ts
async startSearch(query: string): Promise<string>
```

POSTs to `/searches` with `{ searchText: query }`. Returns the `id` from the response.

### getSearchResults()

```ts
async getSearchResults(searchId: string): Promise<SlskdSearchResult>
```

GETs `/searches/{searchId}?includeResponses=true`. Flattens the response via `flattenSearchResponse()`. Returns `{ id, searchText, state, fileCount, files }`.

### waitForSearch() -- polling with stabilization

```ts
async waitForSearch(searchId: string, timeoutMs: number = 30_000): Promise<SlskdFile[]>
```

Algorithm:
1. Record `startTime = Date.now()`, compute `deadline = startTime + timeoutMs`.
2. Initialize `lastFileCount = 0`, `lastChangeTime = startTime`.
3. Poll loop (while `Date.now() < deadline`):
   a. Call `getSearchResults(searchId)`.
   b. If file count changed from last poll, update `lastFileCount` and `lastChangeTime`.
   c. Check if `state` includes `"completed"` (case-insensitive).
   d. **Accept with results**: if completed AND `files.length > 0` AND `stableMs >= STABILIZE_MS` (4s since last change).
   e. **Accept empty**: if completed AND `files.length === 0` AND `elapsed >= MIN_SEARCH_WAIT_MS` (10s since search start).
   f. Sleep `POLL_INTERVAL_MS` (2s).
4. On timeout: fetch final results, cancel the search via DELETE, return whatever files exist.

Debug logging at each poll: `{ searchId, state, fileCount, elapsedMs }`.

### rateLimitedSearch()

```ts
async rateLimitedSearch(query: string): Promise<SlskdFile[]>
```

Enforces minimum `searchDelayMs` between searches:
1. Computes `elapsed = Date.now() - lastSearchTime`.
2. If `searchDelayMs - elapsed > 0`, sleeps the remaining time.
3. Updates `lastSearchTime = Date.now()`.
4. Calls `search(query)`.

Instance field `lastSearchTime` starts at `0` (first search has no delay).

### startSearchBatch()

```ts
async startSearchBatch(queries: string[]): Promise<Map<string, { searchId: string; startedAt: number }>>
```

Iterates queries sequentially, applying the same rate-limit delay as `rateLimitedSearch()` between each POST:
1. For each query: enforce delay, update `lastSearchTime`, call `startSearch(query)`.
2. Returns a `Map<query, { searchId, startedAt }>` where `startedAt` is the timestamp after the search was posted.

Debug log per search: `{ query, searchId }`.

### waitForSearchBatch()

```ts
async waitForSearchBatch(
  searchEntries: Map<string, { searchId: string; startedAt: number }>,
  timeoutMs: number = 30_000,
): Promise<Map<string, SlskdFile[]>>
```

Polls ALL pending searches in a single loop:
1. `deadline = Date.now() + timeoutMs`. Per-search tracking: `Map<query, { lastFileCount, lastChangeTime }>`.
2. Main loop (while `pending.size > 0` AND `Date.now() < deadline`):
   a. For each pending `(query, { searchId, startedAt })`:
      - Poll `getSearchResults(searchId)`.
      - Track file count changes.
      - Compute `searchElapsed = now - startedAt` (per-search, not batch-level).
      - **Accept with results**: completed + files > 0 + stableMs >= `STABILIZE_MS`.
      - **Accept empty**: completed + files === 0 + `searchElapsed >= MIN_SEARCH_WAIT_MS`.
      - Move accepted searches from `pending` to `results`.
   b. Sleep `POLL_INTERVAL_MS` if any pending remain.
3. On timeout: for each remaining pending search, fetch final results and cancel via DELETE.
4. Returns `Map<query, SlskdFile[]>`.

Key design: per-search elapsed time (not batch-level) ensures later searches in the batch get their full `MIN_SEARCH_WAIT_MS` window.

### Result flattening

```ts
private flattenSearchResponse(raw: SlskdSearchResponse): SlskdFile[]
```

Iterates `raw.responses` (per-user), then each user's `files`. Maps each file to `SlskdFile`:
- `filename`, `size`, `bitRate`, `sampleRate`, `bitDepth`, `length` from the file object.
- `username` from the parent response object.
- `code` from the file object.

### download()

```ts
async download(username: string, filename: string, size?: number): Promise<void>
```

POSTs to `/transfers/downloads/{encodeURIComponent(username)}` with body `[{ filename, size? }]` (array of one item). Size is optional in the request body.

### waitForDownload()

```ts
async waitForDownload(username: string, filename: string, timeoutMs: number = 300_000): Promise<SlskdTransfer>
```

Polling loop:
1. `deadline = Date.now() + timeoutMs`.
2. Each iteration: call `getTransfer(username, filename)`.
3. If transfer not found: throw `"Transfer not found: {username} / {filename}"`.
4. Check `state` (case-insensitive):
   - Contains `"completed"` or `"succeeded"`: return the transfer.
   - Contains `"errored"`, `"cancelled"`, or `"rejected"`: throw `'Download failed with state "{state}": {username} / {filename}'`.
5. Sleep `POLL_INTERVAL_MS` (2s).
6. On timeout: throw `"Download timed out after {timeoutMs}ms: {username} / {filename}"`.

### getTransfers()

```ts
async getTransfers(): Promise<SlskdTransfer[]>
```

GETs `/transfers/downloads`. Response is `SlskdUserTransfers[]` (array of per-user objects). Flattened via `flattenTransfers()`.

### getTransfer()

```ts
async getTransfer(username: string, filename: string): Promise<SlskdTransfer | null>
```

GETs `/transfers/downloads/{encodeURIComponent(username)}`. Response is a single `SlskdUserTransfers` object. Flattened via `flattenUserTransfers()`. Finds the matching file by `filename`. Returns `null` if not found or on any error (catch-all).

### Transfer flattening

```ts
private flattenUserTransfers(raw: SlskdUserTransfers): SlskdTransfer[]
```

Iterates `raw.directories`, then each directory's `files`. Maps each to `SlskdTransfer`:
- `id`, `filename`, `state`, `bytesTransferred`, `size`, `percentComplete` from the file.
- `username`: from `file.username ?? raw.username` (falls back to parent).

```ts
private flattenTransfers(raw: SlskdUserTransfers[]): SlskdTransfer[]
```

Calls `flattenUserTransfers` for each user and flat-maps the results.

### cancelSearch() (private)

```ts
private async cancelSearch(searchId: string): Promise<void>
```

DELETEs `/searches/{searchId}`. Best-effort: catches and ignores all errors.

### sleep() (private)

```ts
private sleep(ms: number): Promise<void>
```

Simple `setTimeout` wrapper.

## Error Handling

| Scenario | Behavior |
|---|---|
| slskd not running (connection refused) | `withRetry()` retries 3 times with exponential backoff; ultimately throws TypeError |
| `ping()` failure | Returns `false` (catch-all) |
| Non-OK API response | Throws `"slskd API error: {status} {statusText} -- {method} {path} -- {body}"` |
| Non-JSON response | Returns `undefined` (checks Content-Type header) |
| Search timeout | Fetches final partial results, cancels search via DELETE, returns whatever files exist |
| Batch search timeout | Same per-search: collects partial results, cancels remaining searches |
| Transfer not found during waitForDownload | Throws `"Transfer not found: {username} / {filename}"` |
| Download enters error state | Throws `'Download failed with state "{state}": {username} / {filename}'` (triggers on "errored", "cancelled", "rejected") |
| Download timeout | Throws `"Download timed out after {timeoutMs}ms: {username} / {filename}"` |
| `getTransfer()` error | Returns `null` (catch-all) |
| `cancelSearch()` error | Silently ignored (best-effort cleanup) |
| Network errors (ECONNRESET, timeout) | Handled by `withRetry()`: 3 retries, exponential backoff (1s base, 10s max, jitter) |

## Tests

### Test approach

- Mock global `fetch` to intercept all HTTP calls.
- Verify API key is sent as `X-API-Key` header on every request.
- Verify `ping()` uses raw fetch to `/api/v0/application`, returns boolean.
- Verify `startSearch()` POSTs to `/searches` with `{ searchText }`.
- Verify `getSearchResults()` GETs with `?includeResponses=true` and flattens responses.
- Verify `waitForSearch()` stabilization: results must be stable for 4s after completion.
- Verify `waitForSearch()` honors `MIN_SEARCH_WAIT_MS` for 0-result searches.
- Verify `waitForSearch()` timeout: cancels search, returns partial results.
- Verify `search()` combines `startSearch` + `waitForSearch`.
- Verify `rateLimitedSearch()` enforces `searchDelayMs` between calls.
- Verify `startSearchBatch()` applies rate-limit delay between each search POST.
- Verify `waitForSearchBatch()` uses per-search elapsed time (not batch start).
- Verify `download()` POSTs array body `[{ filename, size? }]` to correct URL.
- Verify `waitForDownload()` detects completed/succeeded/errored/cancelled/rejected states.
- Verify `waitForDownload()` throws on timeout.
- Verify `getTransfers()` flattens multi-user, multi-directory structure.
- Verify `getTransfer()` returns null on error or missing file.
- Verify `withRetry` integration: connection refused causes retries.

### Key test scenarios

- Happy path: search -> results trickle in -> stabilize -> return
- Search with no results: wait MIN_SEARCH_WAIT_MS before accepting
- Search timeout: partial results returned, search cancelled
- Batch search: 3 queries with staggered start times, all complete
- Batch search partial timeout: some searches complete, others timeout
- Download happy path: initiate -> poll -> completed
- Download failure: poll -> errored state -> throw
- Download timeout: poll -> exceed deadline -> throw
- Rate limiting: two consecutive searches respect searchDelayMs gap
- Result flattening: multiple users, multiple directories, files aggregated correctly

## Acceptance Criteria

- [ ] `SoulseekService` class with constructor taking `SoulseekConfig`
- [ ] Base URL: `config.slskdUrl` (trailing slashes stripped); all API calls to `{baseUrl}/api/v0{path}`
- [ ] `X-API-Key` header on every request
- [ ] `request()` helper with `withRetry()`, Content-Type JSON, non-JSON response handling
- [ ] `ping()` via raw fetch to `/api/v0/application`, returns boolean
- [ ] `search()` blocking: startSearch + waitForSearch
- [ ] `startSearch()` POSTs to `/searches`, returns search ID
- [ ] `getSearchResults()` with `?includeResponses=true`, flattens via `flattenSearchResponse()`
- [ ] `waitForSearch()` with stabilization algorithm: `STABILIZE_MS = 4_000`, `MIN_SEARCH_WAIT_MS = 10_000`, `POLL_INTERVAL_MS = 2_000`, `DEFAULT_SEARCH_TIMEOUT_MS = 30_000`
- [ ] On timeout: fetch final results, cancel search via DELETE, return partial
- [ ] `rateLimitedSearch()` enforces `searchDelayMs` gap between searches via `lastSearchTime` tracking
- [ ] `startSearchBatch()` applies rate-limit delay between sequential search POSTs, returns `Map<query, { searchId, startedAt }>`
- [ ] `waitForSearchBatch()` polls all searches in single loop, uses per-search elapsed time for MIN_SEARCH_WAIT_MS, cancels remaining on batch timeout
- [ ] `download()` POSTs `[{ filename, size? }]` to `/transfers/downloads/{username}`
- [ ] `waitForDownload()` polls with `POLL_INTERVAL_MS`, detects completed/succeeded/errored/cancelled/rejected, timeout at `DEFAULT_DOWNLOAD_TIMEOUT_MS = 300_000`
- [ ] `getTransfers()` GETs all downloads, flattens `SlskdUserTransfers[]`
- [ ] `getTransfer()` GETs per-user downloads, finds by filename, returns null on error
- [ ] `flattenSearchResponse()`: responses -> files with username attached
- [ ] `flattenUserTransfers()`: directories -> files with username fallback (`file.username ?? raw.username`)
- [ ] `cancelSearch()` best-effort DELETE, errors silently ignored
- [ ] Debug logging via `createLogger("soulseek")` at each poll step
- [ ] All error scenarios handled per Error Handling table
- [ ] Unit tests with mocked fetch covering stabilization, timeouts, batching, rate limiting, download states
