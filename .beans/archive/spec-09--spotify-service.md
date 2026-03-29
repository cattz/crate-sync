---
# spec-09
title: Spotify service
status: todo
type: task
priority: critical
parent: spec-E3
depends_on: spec-03, spec-04, spec-05
created_at: 2026-03-24T00:00:00Z
updated_at: 2026-03-24T00:00:00Z
---

## Purpose

`SpotifyService` is the sole interface to the Spotify Web API. It owns the full OAuth 2.0 Authorization Code flow (auth URL generation, code exchange, token refresh with automatic persistence), provides an internal `fetchApi()` helper that handles Bearer auth / 401 retry / 429 rate-limit back-off, and exposes paginated reads for playlists and tracks plus mutation methods (create, rename, add/remove/replace tracks, delete). A companion `syncToDb()` method upserts Spotify playlists into the local SQLite database, and `syncPlaylistTracks()` does the same for a single playlist's track list (upserting the junction table and pruning removed tracks).

A separate `waitForAuthCallback()` function (in `spotify-auth-server.ts`) spins up a one-shot HTTP server to receive the OAuth redirect and extract the authorization code.

## Public Interface

### Constants

```ts
const API_BASE = "https://api.spotify.com/v1";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const AUTH_URL = "https://accounts.spotify.com/authorize";

const DEFAULT_SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-public",
  "playlist-modify-private",
  "user-library-read",
];
```

### Types (internal to service file)

```ts
interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}
```

Token file path: `~/.config/crate-sync/spotify-tokens.json` (returned by `getTokenPath()`).

### SpotifyService class

```ts
class SpotifyService {
  constructor(config: SpotifyConfig)
  // SpotifyConfig = { clientId: string; clientSecret: string; redirectUri: string }

  // --- Auth ---
  getAuthUrl(state: string): string
  async exchangeCode(code: string): Promise<void>
  async isAuthenticated(): Promise<boolean>
  setTokens(accessToken: string, refreshToken: string, expiresAt: number): void
  async refreshAccessToken(): Promise<void>

  // --- Playlists (API reads) ---
  async getPlaylists(): Promise<SpotifyPlaylist[]>
  async getPlaylistTracks(playlistId: string): Promise<SpotifyTrack[]>

  // --- User ---
  async getCurrentUserId(): Promise<string>

  // --- DB sync ---
  async syncToDb(): Promise<{ added: number; updated: number; unchanged: number }>
  async syncPlaylistTracks(spotifyPlaylistId: string): Promise<{ added: number; updated: number }>

  // --- Playlist mutations (API writes) ---
  async renamePlaylist(playlistId: string, name: string): Promise<void>
  async updatePlaylistDetails(playlistId: string, details: { name?: string; description?: string }): Promise<void>
  async addTracksToPlaylist(playlistId: string, trackUris: string[]): Promise<void>
  async removeTracksFromPlaylist(playlistId: string, trackUris: string[]): Promise<void>
  async replacePlaylistTracks(playlistId: string, trackUris: string[]): Promise<void>
  async deletePlaylist(playlistId: string): Promise<void>
  async createPlaylist(name: string, description?: string, isPublic?: boolean): Promise<SpotifyPlaylist>

  // --- Description helpers (static) ---
  static composeDescription(notes: string | null, tags: string | null): string
  static parseDescription(description: string | undefined | null): { notes: string; tags: string[] }
}
```

### SpotifyAuthServer (`spotify-auth-server.ts`)

```ts
function waitForAuthCallback(port: number): Promise<string>
```

Starts a one-shot `node:http` server on `port`. Returns the `code` query parameter from the first valid GET request. Responds with HTML success/error pages. Rejects the promise if the callback includes an `?error=` parameter. Auto-closes the server after the first valid or error request.

## Dependencies

### Imports used by `spotify-service.ts`

| Import | Source |
|---|---|
| `readFileSync`, `writeFileSync`, `mkdirSync`, `existsSync` | `node:fs` |
| `join`, `dirname` | `node:path` |
| `homedir` | `node:os` |
| `eq`, `sql` | `drizzle-orm` |
| `SpotifyConfig` | `../config.js` |
| `SpotifyPlaylist`, `SpotifyTrack` | `../types/spotify.js` |
| `getDb` | `../db/client.js` |
| `playlists`, `tracks`, `playlistTracks` | `../db/schema.js` |
| `isShutdownRequested` | `../utils/shutdown.js` |
| `withRetry` | `../utils/retry.js` |

### Imports used by `spotify-auth-server.ts`

| Import | Source |
|---|---|
| `createServer`, `IncomingMessage`, `ServerResponse` | `node:http` |

### Types

```ts
// SpotifyPlaylist (from types/spotify.ts)
interface SpotifyPlaylist {
  id: string;
  name: string;
  description?: string;
  snapshotId: string;
  trackCount: number;
  uri: string;
  ownerId: string;
  ownerName: string;
}

// SpotifyTrack (from types/spotify.ts)
interface SpotifyTrack {
  id: string;
  title: string;
  artist: string;
  artists: string[];
  album: string;
  durationMs: number;
  isrc?: string;
  uri: string;
}

// SpotifyConfig (from config.ts)
interface SpotifyConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string; // default "http://127.0.0.1:8888/callback"
}
```

## Behavior

### Token persistence

- Tokens stored at `~/.config/crate-sync/spotify-tokens.json`.
- Format: `{ accessToken, refreshToken, expiresAt }` (JSON, 2-space indent, trailing newline).
- `loadTokens()` reads once (guarded by `tokensLoaded` flag). Silently ignores corrupt/missing files.
- `saveTokens()` creates the directory recursively if missing. Only writes when both `accessToken` and `refreshToken` are set.
- Called by `exchangeCode()`, `refreshAccessToken()`, and `setTokens()`.

### OAuth flow

1. **getAuthUrl(state)** — builds `https://accounts.spotify.com/authorize?response_type=code&client_id=...&redirect_uri=...&scope=...&state=...`. Scopes joined by space.
2. **exchangeCode(code)** — POSTs to `TOKEN_URL` with `grant_type=authorization_code`, Basic auth header (`base64(clientId:clientSecret)`), body as `application/x-www-form-urlencoded`. Sets `accessToken`, `refreshToken`, `tokenExpiry = Date.now() + expires_in * 1000`. Saves tokens. Sets `tokensLoaded = true`.
3. **isAuthenticated()** — loads tokens, checks `Date.now() < tokenExpiry - 60_000`. If expired, attempts `refreshAccessToken()`. Returns false if no refresh token or refresh fails.
4. **refreshAccessToken()** — POSTs to `TOKEN_URL` with `grant_type=refresh_token`. Spotify may issue a new `refresh_token` in the response (optional field). Saves tokens after refresh.
5. **ensureToken()** (private) — loads tokens, returns `accessToken` if still valid (60-second buffer before expiry). Otherwise calls `refreshAccessToken()`. Throws if no token obtained.

### fetchApi() internal helper

```ts
private async fetchApi(path: string, options: RequestInit = {}): Promise<unknown>
```

- Wrapped in `withRetry()` (3 retries, 1s base delay, 10s max, exponential backoff with jitter, retries on network errors / 429 / 500-504).
- Calls `ensureToken()` for the Bearer token.
- URL: if `path` starts with `"http"`, use as-is (for pagination `next` URLs); otherwise prefix with `API_BASE`.
- Headers: `Authorization: Bearer <token>`, `Content-Type: application/json` (merged with caller's headers).
- **429 handling**: reads `Retry-After` header (defaults to `"1"` second), sleeps, then recursively calls `fetchApi()` again.
- **401 handling**: calls `refreshAccessToken()`, then recursively calls `fetchApi()` again (single retry).
- **204 No Content**: returns `undefined`.
- **Other errors**: throws with status, statusText, and response body.

### Spotify API endpoints called

| Method | Path | Used by |
|---|---|---|
| GET | `/me` | `getCurrentUserId()`, `createPlaylist()` |
| GET | `/me/playlists?limit=50` | `getPlaylists()` (pagination via `next` URL) |
| GET | `/playlists/{id}/tracks?limit=100` | `getPlaylistTracks()` (pagination via `next` URL) |
| PUT | `/playlists/{id}` | `renamePlaylist()` (body: `{ name }`), `updatePlaylistDetails()` (body: `{ name?, description? }`) |
| POST | `/playlists/{id}/tracks` | `addTracksToPlaylist()` (body: `{ uris: string[] }`) |
| DELETE | `/playlists/{id}/tracks` | `removeTracksFromPlaylist()` (body: `{ tracks: [{uri}] }`) |
| PUT | `/playlists/{id}/tracks` | `replacePlaylistTracks()` (body: `{ uris: string[] }`) |
| DELETE | `/playlists/{id}/followers` | `deletePlaylist()` |
| POST | `/users/{userId}/playlists` | `createPlaylist()` (body: `{ name, description, public }`) |
| POST | `https://accounts.spotify.com/api/token` | `exchangeCode()`, `refreshAccessToken()` |

### Response mappers (private)

**mapPlaylist(raw)** maps: `id`, `name`, `description`, `snapshot_id` -> `snapshotId`, `tracks.total` -> `trackCount`, `uri`, `owner.id` -> `ownerId`, `owner.display_name ?? owner.id` -> `ownerName`.

**mapTrack(raw)** maps: `id`, `name` -> `title`, `artists[].name` joined with `", "` -> `artist`, `artists[].name` as array -> `artists`, `album.name` -> `album`, `duration_ms` -> `durationMs`, `external_ids.isrc` -> `isrc`, `uri`.

### getPlaylists() pagination

- Starts at `/me/playlists?limit=50`.
- Loops while `data.next` is non-null (Spotify returns full absolute URL for next page).
- Passes `next` URL directly to `fetchApi()` (handles absolute URLs).

### getPlaylistTracks() pagination

- Starts at `/playlists/{id}/tracks?limit=100`.
- Loops while `data.next` is non-null.
- Skips items where `item.track` is null (deleted/unavailable tracks).

### syncToDb()

1. Calls `getPlaylists()` to fetch all playlists from API.
2. Calls `getCurrentUserId()` to determine ownership.
3. For each playlist (breaks early if `isShutdownRequested()`):
   - Computes `isOwned = pl.ownerId === currentUserId ? 1 : 0`.
   - Queries `playlists` table by `spotify_id`.
   - **Not found**: parses description via `parseDescription()` to extract `notes` and `tags`. Inserts new row with all fields including `notes`, `tags` (JSON-stringified array), `lastSynced = Date.now()`. Increments `added`.
   - **Found but changed** (snapshotId, name, or isOwned differ): updates `name`, `description`, `snapshotId`, `isOwned`, `ownerId`, `ownerName`, `lastSynced`. Increments `updated`. Does NOT re-parse notes/tags on update (preserves local edits).
   - **Unchanged**: increments `unchanged`.
4. Returns `{ added, updated, unchanged }`.

### syncPlaylistTracks()

1. Resolves internal playlist ID from `playlists` table by `spotify_id`. Throws if not found.
2. Calls `getPlaylistTracks()` for the Spotify playlist ID.
3. For each track (with positional index):
   - Queries `tracks` table by `spotify_id`.
   - **Not found**: inserts track (`spotifyId`, `title`, `artist`, `album`, `durationMs`, `isrc`, `spotifyUri`), gets back inserted `id`. Increments `added`.
   - **Found but metadata changed** (title, artist, or album differ): updates all metadata fields. Increments `updated`.
   - **Unchanged**: uses existing `id`.
   - Upserts into `playlist_tracks` junction table with `onConflictDoUpdate` on `(playlistId, trackId)`, updating `position`.
4. Prunes removed tracks: queries all current junction rows for the playlist, resolves Spotify IDs to internal IDs, deletes junction rows whose `trackId` is not in the API response.
5. Updates `playlists.lastSynced = Date.now()`.
6. Returns `{ added, updated }`.

### Playlist mutation batching

- `addTracksToPlaylist()`: loops in batches of 100 URIs, POSTing each batch.
- `removeTracksFromPlaylist()`: loops in batches of 100 URIs, DELETEing each batch. Body format: `{ tracks: [{uri}, ...] }`.
- `replacePlaylistTracks()`: first PUT with first 100 URIs (replaces all), then appends remaining via `addTracksToPlaylist()`.

### Description / notes+tags helpers (static)

**composeDescription(notes, tags)**:
- Joins non-empty notes and `"Tags: tag1, tag2"` with `"\n\n"`.
- `tags` param is a JSON string (array); parsed with try/catch.

**parseDescription(description)**:
- Returns `{ notes: "", tags: [] }` for null/empty.
- Matches `/\n\n\s*Tags:\s*(.+)$/i` at end of text.
- Splits matched tag string by comma, trims, filters empty.
- Everything before the match is `notes`.

## Error Handling

| Scenario | Behavior |
|---|---|
| Token file missing/corrupt | Silently ignored; user must re-authenticate |
| Token exchange fails (non-200) | Throws `"Spotify token exchange failed: {status} {statusText} -- {body}"` |
| Token refresh fails (non-200) | Throws `"Spotify token refresh failed: {status} {statusText} -- {body}"` |
| No refresh token available | Throws `"No refresh token available"` |
| Failed to obtain access token | Throws `"Failed to obtain access token"` |
| API error (non-200, non-401, non-429) | Throws `"Spotify API error: {status} {statusText} -- {body}"` |
| 401 Unauthorized | Attempts token refresh, retries request once (recursive) |
| 429 Rate Limited | Reads `Retry-After` header (default 1s), sleeps, retries (recursive) |
| Network errors (ECONNREFUSED, etc.) | Handled by `withRetry()`: 3 retries, exponential backoff (1s base, 10s max, jitter) |
| Playlist not in DB for syncPlaylistTracks | Throws `'Playlist with spotify_id "{id}" not found in DB. Run syncToDb() first.'` |
| Graceful shutdown during syncToDb | Breaks loop early via `isShutdownRequested()` |
| OAuth callback error param | `waitForAuthCallback` rejects with `"Spotify authorization denied: {error}"` |
| OAuth callback missing code | Returns 400 HTML but does NOT close server (waits for valid request) |

## Tests

### Test approach

- Mock global `fetch` to intercept all HTTP calls.
- Verify token refresh is triggered when `Date.now() >= tokenExpiry - 60_000`.
- Verify 401 triggers one refresh + retry cycle.
- Verify 429 sleeps for `Retry-After` seconds then retries.
- Verify `getPlaylists()` follows `next` links until `null`.
- Verify `getPlaylistTracks()` follows `next` links, skips null tracks.
- Verify `syncToDb()` inserts new, updates changed (snapshotId/name/isOwned), skips unchanged; verify description parsing on insert only.
- Verify `syncPlaylistTracks()` upserts tracks, upserts junction rows, prunes removed tracks.
- Verify all mutation methods batch at 100 items.
- Verify `replacePlaylistTracks()` uses PUT for first 100, then POST for remainder.
- Verify `createPlaylist()` calls `/me` then `/users/{id}/playlists`.
- Verify `deletePlaylist()` calls DELETE on `/playlists/{id}/followers`.
- Verify `waitForAuthCallback()` resolves with code, rejects on error param.
- Verify `withRetry` integration: network errors cause retries with backoff.

### Key test scenarios

- Happy path: full auth flow -> getPlaylists -> syncToDb -> syncPlaylistTracks
- Token expiry during paginated fetch (401 mid-pagination)
- Rate limit during batch track add (429 on second batch)
- Shutdown mid-sync (verify partial results returned)
- Corrupt token file (verify graceful fallback)

## Acceptance Criteria

- [ ] `SpotifyService` class with constructor taking `SpotifyConfig`
- [ ] OAuth flow: `getAuthUrl()`, `exchangeCode()`, `isAuthenticated()`, `setTokens()`, `refreshAccessToken()`
- [ ] Token persistence to `~/.config/crate-sync/spotify-tokens.json` with auto-refresh (60s buffer)
- [ ] `fetchApi()` handles Bearer auth, 401 retry (single), 429 back-off (Retry-After header), wrapped in `withRetry()`
- [ ] `getPlaylists()` with offset-based pagination (limit 50), following absolute `next` URLs
- [ ] `getPlaylistTracks()` with pagination (limit 100), null track filtering
- [ ] `getCurrentUserId()` via `GET /me`
- [ ] `syncToDb()` upserts playlists with ownership, description parsing on insert, returns `{added, updated, unchanged}`
- [ ] `syncPlaylistTracks()` upserts tracks + junction table, prunes removed tracks, updates lastSynced
- [ ] `renamePlaylist()` and `updatePlaylistDetails()` via PUT
- [ ] `addTracksToPlaylist()` with 100-item batching via POST
- [ ] `removeTracksFromPlaylist()` with 100-item batching via DELETE
- [ ] `replacePlaylistTracks()` via PUT (first 100) + POST (remainder)
- [ ] `deletePlaylist()` via DELETE on `/playlists/{id}/followers`
- [ ] `createPlaylist()` via POST to `/users/{userId}/playlists`
- [ ] Static `composeDescription()` and `parseDescription()` helpers
- [ ] `waitForAuthCallback(port)` one-shot HTTP server for OAuth code exchange
- [ ] All error scenarios handled per Error Handling table
- [ ] Unit tests with mocked fetch covering pagination, token refresh, batching, shutdown
