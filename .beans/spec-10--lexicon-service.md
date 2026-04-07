---
# spec-10
title: "Lexicon service"
status: completed
type: task
priority: critical
parent: spec-E2
depends_on: spec-03, spec-05
created_at: 2026-03-29T00:00:00Z
updated_at: 2026-03-29T00:00:00Z
---

## Purpose

`LexiconService` is the client for the Lexicon DJ desktop application's HTTP API. Lexicon exposes a REST-ish API at a configurable base URL (default `http://localhost:48624`). The service handles response unwrapping (Lexicon wraps responses inconsistently in `data`, `content`, or keyed objects), normalizes integer/string IDs, converts duration from seconds to milliseconds, and provides client-side track searching (no server-side search endpoint exists). It manages the tag system: categories, tags, and track-tag assignments with category-scoped operations that preserve tags from other categories.

No playlist methods. Lexicon playlists are not used in this architecture -- tracks are tagged instead.

## Public Interface

### LexiconService class

```ts
class LexiconService {
  constructor(config: LexiconConfig)
  // LexiconConfig = { url: string; downloadRoot: string; tagCategory: { name: string; color: string } }
  // baseUrl is set to config.url (trailing slashes stripped) + "/v1"

  // --- Connectivity ---
  async ping(): Promise<boolean>

  // --- Tracks ---
  async getTracks(): Promise<LexiconTrack[]>
  async searchTracks(query: { artist?: string; title?: string }): Promise<LexiconTrack[]>
  async getTrack(id: string): Promise<LexiconTrack | null>

  // --- Tag system (low-level) ---
  async getTags(): Promise<{ categories: LexiconTagCategory[]; tags: LexiconTag[] }>
  async createTagCategory(label: string, color: string): Promise<LexiconTagCategory>
  async createTag(categoryId: string, label: string): Promise<LexiconTag>
  async getTrackTags(trackId: string): Promise<string[]>
  async updateTrackTags(trackId: string, tagIds: string[]): Promise<void>

  // --- Tag system (high-level, category-scoped) ---
  async ensureTagCategory(label: string, color?: string): Promise<LexiconTagCategory>
  async ensureTag(categoryId: string, label: string): Promise<LexiconTag>
  async getTrackTagsInCategory(trackId: string, categoryId: string): Promise<LexiconTag[]>
  async setTrackCategoryTags(trackId: string, categoryId: string, tagIds: string[]): Promise<void>
}
```

### Helper functions (module-level, not exported)

```ts
function normalizeId(id: unknown): string           // String(id)
function unwrapResponse<T>(body: unknown, key: string): T
function normalizeLexiconTrack(raw: Record<string, unknown>): LexiconTrack
```

## Dependencies

### Imports

| Import | Source |
|---|---|
| `LexiconTrack`, `LexiconTagCategory`, `LexiconTag` | `../types/lexicon.js` |
| `LexiconConfig` | `../config.js` |
| `withRetry` | `../utils/retry.js` |

### Types

```ts
// LexiconConfig (from config.ts)
interface LexiconConfig {
  url: string;          // default "http://localhost:48624"
  downloadRoot: string;
  tagCategory: {
    name: string;       // default "Spotify Playlists"
    color: string;      // default "#1DB954"
  };
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
- Default header: `Content-Type: application/json`.
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
| `durationMs` | `raw.duration` (seconds * 1000, rounded), or `raw.durationMs`, or `raw.duration_ms` |

### ID normalization

All IDs are converted from integer (API native) to string for internal use. When sending IDs back to the API, they are converted to `Number()`.

### API endpoints called

| Method | Path | Used by | Request body | Response handling |
|---|---|---|---|---|
| GET | `/tracks?limit=1` | `ping()` | -- | Success = true, catch = false |
| GET | `/tracks?limit=1000&offset={n}` | `getTracks()` | -- | `unwrapResponse(raw, "tracks")` |
| GET | `/track?id={id}` | `getTrack()`, `getTrackTags()` | -- | `unwrapResponse(raw, "track")` |
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
- Both fields optional; if neither provided, returns all tracks.
- Deliberate design: Lexicon has no server-side search endpoint.

### getTags() -- special unwrap

The response shape is `{ data: { categories: [...], tags: [...] } }`. Custom logic:
1. Checks if raw response has a `data` key; if so, uses `raw.data` as source.
2. Otherwise uses `raw` directly as source.
3. Extracts `source.categories` and `source.tags` arrays.
4. Maps categories to `{ id, label, color? }`.
5. Maps tags to `{ id, categoryId, label }`.

### createTagCategory() and createTag()

Both return responses NOT wrapped in `data`. Fields read directly from response object.

### updateTrackTags()

PATCHes `/track` with `{ id: Number(trackId), edits: { tags: tagIds.map(Number) } }`. This **replaces ALL tags** on the track.

### getTrackTags()

GETs `/track?id={trackId}`, unwraps, reads `track.tags` array, normalizes each to string.

### ensureTagCategory(label, color?)

1. Fetch `getTags()` to get all categories.
2. Find existing category where `category.label === label` (case-sensitive).
3. If found, return it.
4. If not found, call `createTagCategory(label, color ?? "#808080")` and return the result.

### ensureTag(categoryId, label)

1. Fetch `getTags()` to get all tags.
2. Find existing tag where `tag.categoryId === categoryId && tag.label === label` (case-sensitive).
3. If found, return it.
4. If not found, call `createTag(categoryId, label)` and return the result.

### getTrackTagsInCategory(trackId, categoryId)

1. Fetch `getTrackTags(trackId)` to get tag IDs currently on the track.
2. Fetch `getTags()` to get all tag definitions.
3. Filter to tags that:
   - Have an ID present in the track's current tag list
   - Belong to the specified `categoryId`
4. Return the matching `LexiconTag[]` objects.

### setTrackCategoryTags(trackId, categoryId, tagIds) -- CRITICAL

This is the core category-scoped tagging operation. It must **only** modify tags in the target category while preserving all tags from other categories.

**Algorithm (read-filter-merge-write):**

1. **Read** track's current tags (all categories) via `getTrackTags(trackId)` -- returns `string[]` of tag IDs.
2. **Get** all tag definitions via `getTags()` to determine which tags belong to which category.
3. **Filter** out tags from the target category: iterate current tag IDs, keep only those whose tag definition has `categoryId !== targetCategoryId`.
4. **Add** the new `tagIds` (which all belong to the target category).
5. **Write** the full merged set via `updateTrackTags(trackId, [...filteredOtherTags, ...tagIds])`.

This pattern is necessary because the Lexicon API's `updateTrackTags()` replaces ALL tags on a track. Without this read-filter-merge-write approach, tags from other categories (e.g., genre tags, energy tags) would be destroyed.

**Example:**
- Track has tags: `["10", "20", "30"]` (where 10 and 20 are genre tags, 30 is a "Spotify Playlists" tag)
- We want to set Spotify Playlists tags to `["31", "32"]`
- Step 1: read -> `["10", "20", "30"]`
- Step 2: get definitions -> tag 10 is genre, tag 20 is genre, tag 30 is Spotify Playlists
- Step 3: filter out Spotify Playlists -> `["10", "20"]`
- Step 4: add new -> `["10", "20", "31", "32"]`
- Step 5: write `["10", "20", "31", "32"]`

## Error Handling

| Scenario | Behavior |
|---|---|
| Connection refused (Lexicon not running) | `withRetry()` retries 3 times with exponential backoff; ultimately throws TypeError (fetch failure) |
| `ping()` failure | Returns `false` (catch-all) |
| Non-OK response | Throws `"Lexicon API error: {status} {statusText} -- {body}"` |
| 404 in `getTrack()` | Returns `null` (checks `err.message.includes("404")`) |
| 204 No Content | Returns `undefined` |
| Malformed response (unexpected shape) | `unwrapResponse` falls through to return raw body as-is; normalizer functions use `String()` / `Number()` with fallbacks |
| Missing fields in track | Defaults: `filePath = ""`, `title = ""`, `artist = ""`, `album = undefined`, `durationMs = undefined` |
| Integer/string ID mismatch | All IDs normalized to string via `normalizeId()`; converted back to Number for API calls |
| Network errors (ECONNRESET, timeout) | Handled by `withRetry()`: 3 retries, exponential backoff (1s base, 10s max, jitter) |
| `ensureTagCategory` race condition | Two concurrent calls may both try to create; second `createTagCategory` will fail but is acceptable -- caller can retry |
| `setTrackCategoryTags` with empty tagIds | Removes all tags from the target category, preserves other categories |

## Tests

### Test approach

- Mock global `fetch` to intercept all HTTP calls.
- Verify base URL construction (trailing slash handling).
- Verify response unwrapping for all shapes.
- Verify track normalization: duration seconds-to-ms conversion, field fallback chains.
- Verify ID normalization: integer input -> string output -> integer on API calls.
- Verify pagination, client-side search, tag operations.

### Key test scenarios

#### Existing behavior (kept)
- **ping**: returns true on success, false on failure
- **getTracks pagination**: multiple pages, stops when `page.length < 1000`
- **searchTracks**: case-insensitive filtering on artist and title
- **getTrack**: returns null on 404
- **getTags**: custom unwrap handles `{ data: { categories, tags } }` shape
- **createTagCategory / createTag**: handle non-data-wrapped responses
- **updateTrackTags**: sends `{ id: Number, edits: { tags: Number[] } }`
- **getTrackTags**: returns string array of tag IDs
- **Empty library**: getTracks returns empty, searchTracks returns empty
- **Malformed response**: missing fields handled gracefully
- **withRetry integration**: connection refused causes retries

#### New tag methods
- **ensureTagCategory -- existing**: category "Spotify Playlists" already exists, returns existing without creating
- **ensureTagCategory -- new**: category does not exist, creates and returns new
- **ensureTag -- existing**: tag "House" under category exists, returns existing
- **ensureTag -- new**: tag does not exist, creates and returns new
- **getTrackTagsInCategory**: track has tags from 3 categories, returns only tags from the requested category
- **getTrackTagsInCategory -- empty**: track has no tags in the requested category, returns empty array
- **setTrackCategoryTags -- preserves other categories**: track has genre tags + old Spotify tags. After setting new Spotify tags, genre tags are preserved, old Spotify tags removed, new Spotify tags added.
- **setTrackCategoryTags -- track with no existing tags**: writes only the new tagIds
- **setTrackCategoryTags -- empty tagIds**: removes all tags from target category, preserves other categories
- **setTrackCategoryTags -- API call verification**: verify that `updateTrackTags` is called with the correct merged tag ID list

## Acceptance Criteria

- [ ] `LexiconService` class with constructor taking `LexiconConfig`
- [ ] Base URL: `config.url` (trailing slashes stripped) + `/v1`
- [ ] `request()` helper with `withRetry()`, `Content-Type: application/json`, 204 handling
- [ ] `unwrapResponse()` handles `data`, `content`, keyed, and direct array shapes (up to 2 layers)
- [ ] `normalizeLexiconTrack()` with duration seconds-to-ms conversion and field fallback chains
- [ ] `normalizeId()` converts integer/string to string
- [ ] `ping()` returns boolean, never throws
- [ ] `getTracks()` with offset-based pagination (1000/page)
- [ ] `searchTracks()` with client-side case-insensitive filtering
- [ ] `getTrack()` returns null on 404
- [ ] `getTags()` returns `{ categories, tags }` with custom unwrap
- [ ] `createTagCategory()` and `createTag()` handle non-data-wrapped responses
- [ ] `getTrackTags()` returns string array of tag IDs
- [ ] `updateTrackTags()` sends `{ id: Number, edits: { tags: Number[] } }` via PATCH -- replaces ALL tags
- [ ] `ensureTagCategory()` finds existing or creates new category
- [ ] `ensureTag()` finds existing or creates new tag within a category
- [ ] `getTrackTagsInCategory()` returns only tags belonging to specified category
- [ ] `setTrackCategoryTags()` implements read-filter-merge-write pattern: preserves tags from other categories, replaces only tags from target category
- [ ] No playlist methods (`getPlaylists`, `getPlaylistByName`, `createPlaylist`, `addTracksToPlaylist`, `setPlaylistTracks` are absent)
- [ ] No `LexiconPlaylist` type references
- [ ] No `normalizeLexiconPlaylist` or `findPlaylistInTree` helpers
- [ ] All IDs: string internally, converted to Number for API calls
- [ ] Error handling per Error Handling table
- [ ] Unit tests with mocked fetch covering all methods including new tag operations
