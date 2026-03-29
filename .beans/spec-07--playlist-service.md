---
# spec-07
title: Playlist service (DB-only operations)
status: todo
type: task
priority: high
parent: spec-E1
depends_on: spec-04
created_at: 2026-03-29T00:00:00Z
updated_at: 2026-03-29T00:00:00Z
---

## Purpose

Provides all playlist and track CRUD operations against the local SQLite database. This is a pure DB service with no network calls -- it owns the `playlists`, `tracks`, and `playlist_tracks` tables via Drizzle ORM. Playlist management features (diffing against Spotify state, renaming, removal, bulk rename with regex, metadata updates) are implemented here. External callers (CLI commands, API routes, sync pipeline, push workflow) use this service as the single point of access for playlist/track persistence.

## Public Interface

### File: `src/services/playlist-service.ts`

### Constructor

```ts
class PlaylistService {
  private db: ReturnType<typeof getDb>;

  constructor(db: ReturnType<typeof getDb>);
}
```

Takes a Drizzle ORM instance returned by `getDb()`. The DB type is `ReturnType<typeof drizzle<typeof schema>>` from `drizzle-orm/better-sqlite3`. The service stores this as a private field and uses it for all queries.

### `getPlaylists(): Playlist[]`

Returns all playlists in the database. Uses `this.db.select().from(playlists).all()`. No filtering, no ordering -- returns raw insertion order.

### `getPlaylist(id: string): Playlist | null`

Flexible lookup that resolves a playlist from multiple identifier types. The input is first normalized through `extractPlaylistId()` which extracts the playlist ID from Spotify URLs (e.g., `https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M` becomes `37i9dQZF1DXcBWIGoYBM5M`). Non-URL inputs pass through unchanged.

Lookup chain (short-circuits on first match):
1. **Local UUID** -- `WHERE id = normalizedId` via `eq(playlists.id, normalizedId)`.
2. **Spotify ID** -- `WHERE spotify_id = normalizedId` via `eq(playlists.spotifyId, normalizedId)`.
3. **Exact name match** -- `WHERE name = normalizedId` via `eq(playlists.name, normalizedId)`.
4. Returns `null` if none matched.

Each step uses `.get()` (returns single row or `undefined`).

### `getPlaylistTracks(playlistId: string): Array<Track & { position: number }>`

Returns all tracks for a playlist, ordered by position. Performs an `INNER JOIN` between `playlist_tracks` and `tracks` on `playlistTracks.trackId = tracks.id`, filtered by `playlistTracks.playlistId`, ordered by `playlistTracks.position`.

The select explicitly picks all `tracks` columns plus `playlistTracks.position`:
```ts
{
  id: tracks.id,
  spotifyId: tracks.spotifyId,
  title: tracks.title,
  artist: tracks.artist,
  album: tracks.album,
  durationMs: tracks.durationMs,
  isrc: tracks.isrc,
  spotifyUri: tracks.spotifyUri,
  createdAt: tracks.createdAt,
  updatedAt: tracks.updatedAt,
  position: playlistTracks.position,
}
```

### `upsertPlaylist(data: { spotifyId: string; name: string; description?: string; snapshotId?: string }): Playlist`

Insert-or-update a playlist keyed by `spotifyId`. Uses Drizzle's `.onConflictDoUpdate()`:

- **Target**: `playlists.spotifyId` (unique constraint).
- **Insert values**: `spotifyId`, `name`, `description`, `snapshotId` (plus schema defaults for `id`, `createdAt`, `updatedAt`).
- **Update set on conflict**: `name`, `description`, `snapshotId`, `updatedAt: Date.now()`.

Returns the upserted row via `.returning().get()`.

### `upsertTrack(data: { spotifyId: string; title: string; artist: string; album?: string; durationMs: number; isrc?: string; spotifyUri?: string }): Track`

Insert-or-update a track keyed by `spotifyId`. Uses `.onConflictDoUpdate()`:

- **Target**: `tracks.spotifyId` (unique constraint).
- **Insert values**: all fields from `data` (plus schema defaults for `id`, `createdAt`, `updatedAt`).
- **Update set on conflict**: `title`, `artist`, `album`, `durationMs`, `isrc`, `spotifyUri`, `updatedAt: Date.now()`.

Returns the upserted row via `.returning().get()`.

### `setPlaylistTracks(playlistId: string, trackIds: string[], addedAt?: number): void`

Replaces all tracks for a playlist. Two-step operation:
1. **Delete** all existing `playlist_tracks` rows where `playlistId` matches.
2. **Insert** new rows in a loop: for each `trackId` at index `i`, insert `{ playlistId, trackId: trackIds[i], position: i, addedAt: addedAt ?? null }`.

Position is zero-indexed. If `addedAt` is not provided, it defaults to `null`.

### `renamePlaylist(playlistId: string, newName: string): void`

Updates the playlist's `name` and `updatedAt` fields:
```ts
this.db
  .update(playlists)
  .set({ name: newName, updatedAt: Date.now() })
  .where(eq(playlists.id, playlistId))
  .run();
```

Uses the local DB `id`, not `spotifyId`.

### `bulkRename(pattern: string | RegExp, replacement: string, options?: { dryRun?: boolean }): Array<{ id: string; oldName: string; newName: string }>`

Renames multiple playlists whose names match `pattern`. Full regex support.

Algorithm:
1. Fetch all playlists via `getPlaylists()`.
2. For each playlist, test `playlist.name` against `pattern`:
   - If `pattern` is a string, convert to `new RegExp(pattern)` first.
   - Call `playlist.name.replace(regex, replacement)`.
   - If the result differs from `playlist.name`, include in results.
3. If `options?.dryRun` is `true` (default: `false`), return the results without writing to DB.
4. Otherwise, for each match, call `renamePlaylist(playlist.id, newName)` to persist the change.
5. Return the array of `{ id, oldName, newName }` for all matched playlists.

The regex is applied with its original flags. Callers control global vs first-match via the `g` flag on the provided `RegExp`.

### `updateMetadata(playlistId: string, data: { tags?: string; notes?: string; pinned?: number }): void`

Updates local playlist metadata fields. Only the provided fields are updated (partial update). Always updates `updatedAt`.

```ts
this.db
  .update(playlists)
  .set({ ...data, updatedAt: Date.now() })
  .where(eq(playlists.id, playlistId))
  .run();
```

- `tags`: JSON-stringified array of tag strings (e.g., `'["Techno","Dark"]'`).
- `notes`: free-text string.
- `pinned`: `1` for pinned, `0` for unpinned.

### `composeDescription(playlistId: string): string`

Serializes a playlist's tags and notes into a single string suitable for the Spotify description field.

Algorithm:
1. Fetch the playlist via `getPlaylist(playlistId)`. Throws if not found.
2. Read `playlist.tags` (JSON string or null) and `playlist.notes` (string or null).
3. Delegate to `SpotifyService.composeDescription(playlist.notes, playlist.tags)` (static helper from spec-06).
4. Return the composed string.

This is a read-only convenience method. The actual push to Spotify is handled by spec-08.

### `removePlaylist(playlistId: string): void`

Deletes a playlist and its junction entries. Two-step:
1. Delete all `playlist_tracks` rows where `playlistId` matches (foreign key cleanup).
2. Delete the `playlists` row where `id` matches.

Note: Track records in `tracks` table are **not** deleted. Tracks may be shared across playlists.

### `getPlaylistDiff(playlistId: string, spotifyTracks: SpotifyTrack[]): { toAdd: string[]; toRemove: string[]; renamed: boolean }`

Compares the local DB state of a playlist with the current Spotify state (provided as an array of `SpotifyTrack` objects).

Algorithm:
1. Fetch the playlist via `getPlaylist(playlistId)`. Throws `Error("Playlist not found: ${playlistId}")` if not found.
2. Fetch local tracks via `getPlaylistTracks(playlistId)`.
3. Build `localUris: Set<string>` from local tracks' `spotifyUri` values, filtering out nulls.
4. Build `spotifyUris: Set<string>` from `spotifyTracks.map(t => t.uri)`.
5. `toAdd`: URIs in `localUris` but not in `spotifyUris` (local tracks missing from Spotify).
6. `toRemove`: URIs in `spotifyUris` but not in `localUris` (Spotify tracks not in local DB).
7. `renamed`: always `false` -- name comparison is delegated to the caller.

The `SpotifyTrack` type has: `{ id, title, artist, artists, album, durationMs, isrc?, uri }`.

### `updateSnapshotId(playlistId: string, snapshotId: string): void`

Updates the `snapshotId` and `updatedAt` for a playlist:
```ts
this.db
  .update(playlists)
  .set({ snapshotId, updatedAt: Date.now() })
  .where(eq(playlists.id, playlistId))
  .run();
```

## Dependencies

| Module | Dependency | Kind |
|---|---|---|
| `playlist-service.ts` | `drizzle-orm` (`eq`) | runtime import |
| `playlist-service.ts` | `../db/client.js` (`getDb`) | type-only (for `ReturnType<typeof getDb>`) |
| `playlist-service.ts` | `../db/schema.js` (`playlists`, `tracks`, `playlistTracks`, `Playlist`, `Track`, `PlaylistTrack`) | runtime + type imports |
| `playlist-service.ts` | `../types/spotify.js` (`SpotifyTrack`) | type-only import |
| `playlist-service.ts` | `../utils/spotify-url.js` (`extractPlaylistId`) | runtime import |
| `playlist-service.ts` | `./spotify-service.js` (`SpotifyService`) | runtime import (for `composeDescription` static method) |

### Database Tables Used

- **`playlists`**: `id` (text PK, UUID), `spotify_id` (text, unique), `name` (text, NOT NULL), `description` (text), `snapshot_id` (text), `is_owned` (integer), `owner_id` (text), `owner_name` (text), `tags` (text/JSON), `notes` (text), `pinned` (integer, default 0), `last_synced` (integer), `created_at` (integer, NOT NULL), `updated_at` (integer, NOT NULL).
- **`tracks`**: `id` (text PK, UUID), `spotify_id` (text, unique), `title` (text, NOT NULL), `artist` (text, NOT NULL), `album` (text), `duration_ms` (integer, NOT NULL), `isrc` (text), `spotify_uri` (text), `created_at` (integer), `updated_at` (integer).
- **`playlist_tracks`**: `id` (text PK, UUID), `playlist_id` (text FK -> playlists.id, NOT NULL), `track_id` (text FK -> tracks.id, NOT NULL), `position` (integer, NOT NULL), `added_at` (integer). Has a unique index on `(playlist_id, track_id)`.

## Behavior

### Lookup Resolution Order (`getPlaylist`)

The three-step lookup chain ensures maximum flexibility for callers. CLI commands can pass a Spotify URL, a Spotify ID, a local UUID, or a playlist name -- the service resolves it transparently. The `extractPlaylistId` utility handles URL parsing and returns the raw string for non-URL inputs.

### Bulk Rename Semantics

`bulkRename` applies a regex replacement across all playlist names. This supports workflows like:
- Normalizing prefixes: `bulkRename(/^WIP - /, "")` removes "WIP - " prefix from all matching playlists.
- Restructuring hierarchy: `bulkRename(/^Old Category\//, "New Category/")` moves playlists between categories.
- Dry-run preview: `bulkRename(pattern, replacement, { dryRun: true })` returns what would change without writing.

The method always returns the full list of affected playlists regardless of `dryRun`, so callers can present a preview before confirming.

### Metadata Updates

`updateMetadata` is a partial-update method. Callers can update any combination of `tags`, `notes`, and `pinned` in a single call. Fields not provided are left unchanged. The `tags` field stores a JSON-stringified array; callers must serialize before passing and deserialize after reading.

### Description Composition

`composeDescription` is a read-only method that serializes the playlist's local metadata (tags + notes) into the format used by Spotify descriptions. The format is defined by `SpotifyService.composeDescription()` (spec-06):
- Notes text first (if non-empty).
- Followed by `"\n\nTags: tag1, tag2"` (if tags exist).
- Empty string if neither exists.

### Diff Semantics

`getPlaylistDiff` compares by `spotifyUri`, which is the canonical Spotify identifier (e.g., `spotify:track:abc123`). Tracks without a `spotifyUri` in the local DB are silently excluded from the comparison. The `renamed` field is hardcoded to `false` because the method does not receive the Spotify playlist name -- the caller must compare names separately.

## Error Handling

- `getPlaylistDiff` throws `Error("Playlist not found: ${playlistId}")` if the playlist does not exist.
- `composeDescription` throws `Error("Playlist not found: ${playlistId}")` if the playlist does not exist.
- All other methods return empty arrays or `null` for missing data -- they do not throw.
- `removePlaylist` is safe to call on a non-existent playlist (delete is a no-op).
- `renamePlaylist`, `updateMetadata`, and `updateSnapshotId` silently do nothing if the playlist ID doesn't match any row.
- `bulkRename` returns an empty array if no playlists match the pattern.
- `setPlaylistTracks` does not validate that the provided `trackIds` exist in the `tracks` table. Inserting a non-existent `trackId` will fail at the database level due to the foreign key constraint on `playlist_tracks.track_id`.
- `upsertPlaylist` and `upsertTrack` rely on the unique constraint on `spotify_id` for conflict detection.

## Tests

Test framework: Vitest. Tests at `src/services/__tests__/playlist-service.test.ts`.

Each test should use an in-memory SQLite database (`:memory:` path to `getDb`) with migrations applied. Tests should be isolated -- each test creates its own DB state.

### Test Cases

1. **`getPlaylists` returns all playlists**: Insert 3 playlists via `upsertPlaylist`. Call `getPlaylists()`. Expect length 3. Verify names match.

2. **`getPlaylist` by local UUID**: Upsert a playlist, capture the returned `id`. Call `getPlaylist(id)`. Expect non-null, matching `spotifyId`.

3. **`getPlaylist` by spotifyId**: Upsert a playlist with `spotifyId: "sp123"`. Call `getPlaylist("sp123")`. Expect the correct playlist.

4. **`getPlaylist` by Spotify URL**: Upsert a playlist with `spotifyId: "37i9dQZF1DXcBWIGoYBM5M"`. Call `getPlaylist("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M")`. Expect the correct playlist.

5. **`getPlaylist` by exact name**: Create a playlist with name `"My Techno Mix"`. Call `getPlaylist("My Techno Mix")`. Expect the correct playlist.

6. **`getPlaylist` returns null for unknown ID**: Call `getPlaylist("nonexistent")`. Expect `null`.

7. **`getPlaylistTracks` returns tracks ordered by position**: Upsert 3 tracks, call `setPlaylistTracks` with IDs in specific order. Call `getPlaylistTracks`. Verify positions are 0, 1, 2 and track order matches.

8. **`getPlaylistTracks` returns empty array for playlist with no tracks**: Create a playlist, don't add tracks. Call `getPlaylistTracks`. Expect `[]`.

9. **`upsertPlaylist` inserts new playlist**: Call with `spotifyId: "sp1", name: "Test"`. Expect returned row with matching fields.

10. **`upsertPlaylist` updates existing playlist**: Upsert with `spotifyId: "sp1", name: "Old"`. Upsert again with `spotifyId: "sp1", name: "New"`. Fetch by spotifyId. Expect `name: "New"` and `updatedAt` changed.

11. **`upsertTrack` inserts new track**: Call with full data. Expect returned row with matching fields and generated UUID.

12. **`upsertTrack` updates existing track**: Upsert twice with same `spotifyId`, different `title`. Expect updated title on second fetch.

13. **`setPlaylistTracks` replaces all tracks**: Set tracks [A, B], then set tracks [C]. Expect only C in the playlist.

14. **`setPlaylistTracks` with addedAt**: Set tracks with `addedAt: 1000`. Verify the `added_at` value in `playlist_tracks`.

15. **`renamePlaylist` updates name**: Create playlist, rename it. Fetch and verify new name. Verify `updatedAt` changed.

16. **`bulkRename` renames matching playlists**: Create playlists "WIP - A", "WIP - B", "Final C". Call `bulkRename(/^WIP - /, "")`. Expect 2 results: `{ oldName: "WIP - A", newName: "A" }` and `{ oldName: "WIP - B", newName: "B" }`. Verify DB names updated.

17. **`bulkRename` with dryRun does not persist**: Create playlists as above. Call `bulkRename(/^WIP - /, "", { dryRun: true })`. Expect 2 results. Verify DB names unchanged.

18. **`bulkRename` with string pattern**: Call `bulkRename("WIP", "DONE")`. Verify string is converted to regex and replacement applied.

19. **`bulkRename` returns empty for no matches**: Call `bulkRename(/^ZZZZZ/, "X")`. Expect `[]`.

20. **`bulkRename` with global flag replaces all occurrences**: Create playlist "a/b/a". Call `bulkRename(/a/g, "x")`. Expect `newName: "x/b/x"`.

21. **`updateMetadata` updates tags only**: Create playlist. Call `updateMetadata(id, { tags: '["Techno"]' })`. Fetch and verify `tags` updated, `notes` and `pinned` unchanged.

22. **`updateMetadata` updates notes only**: Call `updateMetadata(id, { notes: "Great set" })`. Verify only `notes` changed.

23. **`updateMetadata` updates pinned**: Call `updateMetadata(id, { pinned: 1 })`. Verify `pinned` is `1`.

24. **`updateMetadata` updates multiple fields**: Call `updateMetadata(id, { tags: '["House"]', notes: "Club mix", pinned: 1 })`. Verify all three fields updated.

25. **`composeDescription` serializes tags and notes**: Create playlist with tags and notes. Call `composeDescription(id)`. Expect format: `"notes text\n\nTags: tag1, tag2"`.

26. **`composeDescription` handles notes only**: Playlist with notes, no tags. Expect just the notes text.

27. **`composeDescription` handles tags only**: Playlist with tags, no notes. Expect just `"Tags: tag1, tag2"`.

28. **`composeDescription` throws for missing playlist**: Call with non-existent id. Expect error.

29. **`removePlaylist` deletes playlist and junction**: Create playlist with tracks. Call `removePlaylist`. Verify playlist gone. Verify `playlist_tracks` rows gone. Verify track records still exist in `tracks` table.

30. **`getPlaylistDiff` identifies toAdd and toRemove**: Local has tracks with URIs [u1, u2]. Spotify has [u2, u3]. Expect: `toAdd: ["u1"]`, `toRemove: ["u3"]`.

31. **`getPlaylistDiff` throws for missing playlist**: Call with non-existent playlistId. Expect `Error("Playlist not found: ...")`.

32. **`getPlaylistDiff` excludes tracks without spotifyUri**: Local has track with `spotifyUri: null`. Spotify has no matching URI. The null-URI track should not appear in `toAdd`.

33. **`getPlaylistDiff` returns renamed as false**: Regardless of input, `renamed` is always `false`.

34. **`updateSnapshotId` updates snapshot**: Upsert playlist. Call `updateSnapshotId` with a new value. Fetch playlist. Verify `snapshotId` updated and `updatedAt` changed.

35. **`getPlaylist` lookup priority**: Create a playlist where the name equals a different playlist's spotifyId. Verify that `getPlaylist` with that string returns the spotifyId match (priority 2) not the name match (priority 3).

## Acceptance Criteria

- [ ] All 12 public methods implemented with the exact TypeScript signatures documented above: `getPlaylists`, `getPlaylist`, `getPlaylistTracks`, `upsertPlaylist`, `upsertTrack`, `setPlaylistTracks`, `renamePlaylist`, `bulkRename`, `updateMetadata`, `composeDescription`, `removePlaylist`, `getPlaylistDiff`, `updateSnapshotId`.
- [ ] `getPlaylist` resolves identifiers in order: local UUID, spotifyId, exact name. Short-circuits on first match.
- [ ] `getPlaylist` normalizes input through `extractPlaylistId` before any lookups, correctly handling Spotify URLs.
- [ ] `bulkRename` supports both `string` and `RegExp` patterns, applies `String.replace()`, and respects `dryRun` option.
- [ ] `updateMetadata` performs partial updates -- only provided fields are written, `updatedAt` always updated.
- [ ] `composeDescription` delegates to `SpotifyService.composeDescription()` and throws for missing playlist.
- [ ] `upsertPlaylist` uses `onConflictDoUpdate` targeting `playlists.spotifyId` and updates `name`, `description`, `snapshotId`, `updatedAt`.
- [ ] `upsertTrack` uses `onConflictDoUpdate` targeting `tracks.spotifyId` and updates `title`, `artist`, `album`, `durationMs`, `isrc`, `spotifyUri`, `updatedAt`.
- [ ] `setPlaylistTracks` deletes all existing entries for the playlist before inserting, uses zero-indexed positions.
- [ ] `removePlaylist` deletes `playlist_tracks` rows before the `playlists` row (foreign key order).
- [ ] `getPlaylistDiff` compares by `spotifyUri`, filters null URIs from local tracks, and always returns `renamed: false`.
- [ ] `getPlaylistDiff` and `composeDescription` throw for non-existent playlist. All other methods return `null`/empty/no-op for missing data.
- [ ] No merge, duplicate detection, or similarity methods exist in this service.
- [ ] All 35 test cases pass in Vitest.
