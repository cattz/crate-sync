---
# spec-10
title: Lexicon service
status: todo
type: task
priority: critical
parent: spec-E3
depends_on: spec-03, spec-05
created_at: 2026-03-24T00:00:00Z
updated_at: 2026-03-24T00:00:00Z
---

## Purpose

`LexiconService` is the client for the Lexicon DJ desktop application's HTTP API. Lexicon exposes a REST-ish API at a configurable base URL (default `http://localhost:48624`). The service handles response unwrapping (Lexicon wraps responses inconsistently in `data`, `content`, or keyed objects), normalizes integer/string IDs, converts duration from seconds to milliseconds, and provides client-side track searching (no server-side search endpoint exists). It also manages the full tag system (categories, tags, track-tag assignments) and playlist CRUD including a tree-traversal lookup by name.

## Public Interface

### LexiconService class

```ts
class LexiconService {
  constructor(config: LexiconConfig)
  // LexiconConfig = { url: string; downloadRoot: string }
  // baseUrl is set to config.url (trailing slashes stripped) + "/v1"

  // --- Connectivity ---
  async ping(): Promise<boolean>

  // --- Tracks ---
  async getTracks(): Promise<LexiconTrack[]>
  async searchTracks(query: { artist?: string; title?: string }): Promise<LexiconTrack[]>
  async getTrack(id: string): Promise<LexiconTrack | null>

  // --- Playlists ---
  async getPlaylists(): Promise<LexiconPlaylist[]>
  async getPlaylistByName(name: string): Promise<LexiconPlaylist | null>
  async createPlaylist(name: string, trackIds: string[]): Promise<LexiconPlaylist>
  async addTracksToPlaylist(playlistId: string, trackIds: string[]): Promise<void>
  async setPlaylistTracks(playlistId: string, trackIds: string[]): Promise<void>

  // --- Tags ---
  async getTags(): Promise<{ categories: LexiconTagCategory[]; tags: LexiconTag[] }>
  async createTagCategory(label: string, color: string): Promise<LexiconTagCategory>
  async createTag(categoryId: string, label: string): Promise<LexiconTag>
  async getTrackTags(trackId: string): Promise<string[]>
  async updateTrackTags(trackId: string, tagIds: string[]): Promise<void>
}
```

### Helper functions (module-level, not exported)

```ts
function normalizeId(id: unknown): string           // String(id)
function unwrapResponse<T>(body: unknown, key: string): T
function normalizeLexiconTrack(raw: Record<string, unknown>): LexiconTrack
function normalizeLexiconPlaylist(raw: Record<string, unknown>): LexiconPlaylist
function findPlaylistInTree(nodes: Record<string, unknown>[], name: string): Record<string, unknown> | null
```

## Dependencies

### Imports

| Import | Source |
|---|---|
| `LexiconTrack`, `LexiconPlaylist`, `LexiconTagCategory`, `LexiconTag` | `../types/lexicon.js` |
| `LexiconConfig` | `../config.js` |
| `withRetry` | `../utils/retry.js` |

### Types

```ts
// LexiconConfig (from config.ts)
interface LexiconConfig {
  url: string;          // default "http://localhost:48624"
  downloadRoot: string;
}

// LexiconTrack (from types/lexicon.ts)
interface LexiconTrack {
  id: string;
  filePath: string;
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  tags?: string[];
}

// LexiconPlaylist (from types/lexicon.ts)
interface LexiconPlaylist {
  id: string;
  name: string;
  trackIds: string[];
}

// LexiconTagCategory (from types/lexicon.ts)
interface LexiconTagCategory {
  id: string;
  label: string;
  color?: string;
}

// LexiconTag (from types/lexicon.ts)
interface LexiconTag {
  id: string;
  categoryId: string;
  label: string;
}
```

## Behavior

### Base URL construction

Constructor strips trailing slashes from `config.url` and appends `/v1`:
```ts
this.baseUrl = config.url.replace(/\/+$/, "") + "/v1";
```
All API requests go to `{baseUrl}{path}`.

### Internal request helper

```ts
private async request<T>(path: string, options: RequestInit = {}): Promise<T>
```

- Wrapped in `withRetry()` (3 retries, 1s base delay, 10s max, exponential backoff with jitter).
- Full URL: `{baseUrl}{path}`.
- Default header: `Content-Type: application/json` (merged with caller's headers).
- No authentication required (Lexicon runs locally).
- **204 No Content**: returns `undefined as T`.
- **Non-OK**: throws `"Lexicon API error: {status} {statusText} -- {body}"`.

### Response unwrapping

```ts
function unwrapResponse<T>(body: unknown, key: string): T
```

Peels up to 2 layers of wrapping. At each layer:
1. If `body` is null, non-object, or an array, stop and return as `T`.
2. If `key` exists in `body`, return `body[key] as T`.
3. If `"content"` exists and is an array, return `body.content as T`.
4. If `"data"` exists, set `body = body.data` and continue to next layer.
5. Otherwise stop and return `body as T`.

This handles Lexicon's inconsistent response shapes:
- `{ tracks: [...] }` -- keyed directly
- `{ data: { tracks: [...] } }` -- nested in data
- `{ content: [...] }` -- wrapped in content
- Direct array `[...]`

### Track normalization

```ts
function normalizeLexiconTrack(raw: Record<string, unknown>): LexiconTrack
```

Field mapping:
| Output field | Source fields (priority order) |
|---|---|
| `id` | `normalizeId(raw.id)` |
| `filePath` | `raw.location ?? raw.filePath ?? raw.file_path ?? ""` |
| `title` | `raw.title ?? ""` |
| `artist` | `raw.artist ?? ""` |
| `album` | `raw.albumTitle` (first), then `raw.album`, else `undefined` |
| `durationMs` | `raw.duration` (seconds, multiplied by 1000 and rounded), or `raw.durationMs`, or `raw.duration_ms` |

Duration conversion: API returns seconds in `duration` field; service converts to milliseconds via `Math.round(Number(raw.duration) * 1000)`.

### Playlist normalization

```ts
function normalizeLexiconPlaylist(raw: Record<string, unknown>): LexiconPlaylist
```

Field mapping:
| Output field | Source fields |
|---|---|
| `id` | `normalizeId(raw.id)` |
| `name` | `raw.name ?? ""` |
| `trackIds` | `(raw.trackIds ?? raw.track_ids)` as array, each element through `normalizeId` |

### ID normalization

All IDs are converted from integer (API native) to string for internal use. When sending IDs back to the API, they are converted to `Number()` (e.g., `Number(playlistId)`, `trackIds.map(Number)`).

### API endpoints called

| Method | Path | Used by | Request body | Response handling |
|---|---|---|---|---|
| GET | `/tracks?limit=1` | `ping()` | -- | Success = true, catch = false |
| GET | `/tracks?limit=1000&offset={n}` | `getTracks()` | -- | `unwrapResponse(raw, "tracks")` |
| GET | `/track?id={id}` | `getTrack()`, `getTrackTags()` | -- | `unwrapResponse(raw, "track")` |
| GET | `/playlists` | `getPlaylists()`, `getPlaylistByName()` | -- | `unwrapResponse(raw, "playlists")` |
| GET | `/playlist?id={id}` | `setPlaylistTracks()` | -- | `unwrapResponse(raw, "playlist")` |
| POST | `/playlist` | `createPlaylist()` | `{ name }` | `unwrapResponse(raw, "playlist")` |
| PATCH | `/playlist-tracks` | `createPlaylist()`, `addTracksToPlaylist()`, `setPlaylistTracks()` | `{ id: Number, trackIds: Number[] }` | -- |
| DELETE | `/playlist-tracks` | `setPlaylistTracks()` | `{ id: Number, trackIds: Number[] }` | -- |
| GET | `/tags` | `getTags()` | -- | Custom unwrap (see below) |
| POST | `/tag-category` | `createTagCategory()` | `{ label, color }` | Direct (NOT wrapped in data) |
| POST | `/tag` | `createTag()` | `{ categoryId: Number, label }` | Direct (NOT wrapped in data) |
| PATCH | `/track` | `updateTrackTags()` | `{ id: Number, edits: { tags: Number[] } }` | -- |

### getTracks() pagination

- Page size: `1000` (constant `PAGE_SIZE`).
- Offset-based: starts at `offset=0`, increments by `PAGE_SIZE`.
- Breaks when `page.length < PAGE_SIZE`.
- Each page unwrapped via `unwrapResponse(raw, "tracks")`, mapped through `normalizeLexiconTrack`.

### searchTracks() -- client-side filtering

```ts
async searchTracks(query: { artist?: string; title?: string }): Promise<LexiconTrack[]>
```

- Fetches ALL tracks via `getTracks()` (full library load).
- Filters in-memory: case-insensitive `includes()` match on both `artist` and `title`.
- Both fields are optional; if neither provided, returns all tracks.
- This is a deliberate design choice: Lexicon has no server-side search endpoint.

### getPlaylistByName() -- tree traversal

1. Fetches `/playlists` and unwraps as array.
2. Calls `findPlaylistInTree(tree, name)`:
   - Iterates each node. If `node.name === name`, returns the node.
   - If node has a `playlists` array (children), recurses into it.
   - Returns `null` if not found anywhere in the tree.
3. Normalizes the found node via `normalizeLexiconPlaylist`.

Lexicon organizes playlists in a hierarchical tree structure (folders containing playlists and sub-folders).

### createPlaylist()

1. POSTs to `/playlist` with `{ name }`. Unwraps response.
2. If `trackIds` is non-empty, PATCHes `/playlist-tracks` with `{ id: Number(result.id), trackIds: trackIds.map(Number) }`.
3. Returns the normalized playlist (without the tracks, since they were added in a separate call).

### setPlaylistTracks()

Full replacement of a playlist's track list:
1. GETs `/playlist?id={playlistId}` to fetch current track list.
2. If existing tracks, DELETEs via `/playlist-tracks` with `{ id: Number, trackIds: existing.trackIds.map(Number) }`.
3. If new trackIds non-empty, PATCHes `/playlist-tracks` with `{ id: Number, trackIds: trackIds.map(Number) }`.

### getTags() -- special unwrap

The response shape is `{ data: { categories: [...], tags: [...] } }`. The method uses custom logic rather than relying solely on `unwrapResponse`:
1. Checks if raw response has a `data` key; if so, uses `raw.data` as source.
2. Otherwise uses `raw` directly as source.
3. Extracts `source.categories` and `source.tags` arrays.
4. Maps categories to `{ id, label, color? }`.
5. Maps tags to `{ id, categoryId, label }`.

### createTagCategory() and createTag()

Both return responses that are NOT wrapped in `data`. The request types generic is `Record<string, unknown>` and fields are read directly from the response object.

### updateTrackTags()

PATCHes `/track` with `{ id: Number(trackId), edits: { tags: tagIds.map(Number) } }`. This replaces ALL tags on the track.

### getTrackTags()

GETs `/track?id={trackId}`, unwraps, reads `track.tags` array, normalizes each to string.

## Error Handling

| Scenario | Behavior |
|---|---|
| Connection refused (Lexicon not running) | `withRetry()` retries 3 times with exponential backoff; ultimately throws TypeError (fetch failure) |
| `ping()` failure | Returns `false` (catch-all) |
| Non-OK response | Throws `"Lexicon API error: {status} {statusText} -- {body}"` |
| 404 in `getTrack()` | Returns `null` (checks `err.message.includes("404")`) |
| 204 No Content | Returns `undefined` |
| Malformed response (unexpected shape) | `unwrapResponse` falls through to return raw body as-is; normalizer functions use `String()` / `Number()` with fallbacks to `""` / `undefined` |
| Missing fields in track | Defaults: `filePath = ""`, `title = ""`, `artist = ""`, `album = undefined`, `durationMs = undefined` |
| Missing trackIds in playlist | Falls back to empty array |
| Integer/string ID mismatch | All IDs normalized to string via `normalizeId()`; converted back to Number for API calls |
| Network errors (ECONNRESET, timeout) | Handled by `withRetry()`: 3 retries, exponential backoff (1s base, 10s max, jitter) |

## Tests

### Test approach

- Mock global `fetch` to intercept all HTTP calls.
- Verify base URL construction (trailing slash handling).
- Verify response unwrapping for all shapes: `{ tracks: [...] }`, `{ data: { tracks: [...] } }`, `{ content: [...] }`, direct array.
- Verify track normalization: duration seconds-to-ms conversion, field fallback chains.
- Verify playlist normalization: trackIds from both `trackIds` and `track_ids` fields.
- Verify ID normalization: integer input -> string output -> integer on API calls.
- Verify `getTracks()` pagination: multiple pages, stops when `page.length < 1000`.
- Verify `searchTracks()` filters case-insensitively on artist and title.
- Verify `getPlaylistByName()` traverses nested tree structure.
- Verify `createPlaylist()` posts playlist then patches tracks (two API calls).
- Verify `setPlaylistTracks()` flow: get current -> delete existing -> add new.
- Verify `getTags()` custom unwrap handles `{ data: { categories, tags } }` shape.
- Verify `createTagCategory()` and `createTag()` handle non-wrapped responses.
- Verify `updateTrackTags()` sends integer IDs in edits.
- Verify `getTrack()` returns null on 404.
- Verify `ping()` returns true/false without throwing.
- Verify `withRetry` integration: connection refused causes retries.

### Key test scenarios

- Happy path: ping -> getTracks (multi-page) -> searchTracks -> createPlaylist with tracks
- Tree traversal: deeply nested playlist found by name
- Empty library: getTracks returns empty, searchTracks returns empty
- Malformed response: missing fields handled gracefully
- setPlaylistTracks with empty existing list (skips DELETE)
- setPlaylistTracks with empty new list (only DELETEs)

## Acceptance Criteria

- [ ] `LexiconService` class with constructor taking `LexiconConfig`
- [ ] Base URL: `config.url` (trailing slashes stripped) + `/v1`
- [ ] `request()` helper with `withRetry()`, `Content-Type: application/json`, 204 handling
- [ ] `unwrapResponse()` handles `data`, `content`, keyed, and direct array shapes (up to 2 layers)
- [ ] `normalizeLexiconTrack()` with duration seconds-to-ms conversion and field fallback chains
- [ ] `normalizeLexiconPlaylist()` with `trackIds` / `track_ids` fallback
- [ ] `normalizeId()` converts integer/string to string
- [ ] `ping()` returns boolean, never throws
- [ ] `getTracks()` with offset-based pagination (1000/page)
- [ ] `searchTracks()` with client-side case-insensitive filtering on artist and title
- [ ] `getTrack()` returns null on 404
- [ ] `getPlaylists()` unwraps and normalizes playlist array
- [ ] `getPlaylistByName()` recursively searches the playlist tree (handles nested folders via `playlists` children)
- [ ] `createPlaylist()` creates playlist then patches tracks in separate call
- [ ] `addTracksToPlaylist()` PATCHes `/playlist-tracks` (no-op for empty array)
- [ ] `setPlaylistTracks()` deletes existing tracks then adds new ones
- [ ] `getTags()` returns `{ categories, tags }` with custom unwrap for `{ data: { categories, tags } }` shape
- [ ] `createTagCategory()` and `createTag()` handle non-data-wrapped responses
- [ ] `getTrackTags()` returns string array of tag IDs
- [ ] `updateTrackTags()` sends `{ id: Number, edits: { tags: Number[] } }` via PATCH
- [ ] All IDs: string internally, converted to Number for API calls
- [ ] Error handling per Error Handling table
- [ ] Unit tests with mocked fetch covering pagination, tree traversal, normalization, tag system
