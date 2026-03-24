---
# spec-12
title: Playlist service (DB-only operations)
status: todo
type: task
priority: high
parent: spec-E3
depends_on: spec-04, spec-05
created_at: 2026-03-24T00:00:00Z
updated_at: 2026-03-24T00:00:00Z
---

## Purpose

Provides all playlist and track CRUD operations against the local SQLite database. This is a pure DB service with no network calls -- it owns the `playlists`, `tracks`, and `playlist_tracks` tables via Drizzle ORM. All playlist management features (duplicate detection, merging, diffing against Spotify state, renaming, removal) are implemented here. External callers (CLI commands, API routes, sync pipeline) use this service as the single point of access for playlist/track persistence.

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

### `findDuplicatesInPlaylist(playlistId: string): Array<{ track: Track; duplicates: Track[] }>`

Finds duplicate tracks within a single playlist using a two-phase grouping strategy:

**Phase 1 -- Group by `spotifyId`:**
- Iterate all playlist tracks (via `getPlaylistTracks`).
- For each track with a non-null `spotifyId`, group into a `Map<string, Track[]>` keyed by `spotifyId`.
- Tracks without `spotifyId` are collected into a separate `noSpotifyId` array.
- Any group with `length > 1` produces a result entry: `{ track: group[0], duplicates: group.slice(1) }`.

**Phase 2 -- Group remaining tracks by title+artist (case-insensitive):**
- For tracks in `noSpotifyId`, build a `Map<string, Track[]>` keyed by `` `${track.title.toLowerCase()}::${track.artist.toLowerCase()}` ``.
- Any group with `length > 1` produces a result entry.

The `position` field is stripped from each row via destructuring: `const { position: _, ...track } = row`.

### `findDuplicatesAcrossPlaylists(): Array<{ track: Track; playlists: Playlist[] }>`

Finds tracks that appear in 2 or more playlists.

Algorithm:
1. Fetch all `playlist_tracks` rows (just `trackId` and `playlistId`).
2. Build `Map<trackId, Set<playlistId>>` grouping playlist IDs by track ID.
3. For each track appearing in `> 1` playlist:
   - Fetch the full `Track` record by `tracks.id`.
   - Fetch each `Playlist` record by `playlists.id`.
   - Push `{ track, playlists }` to results.
4. Skip entries where the track or any playlist is not found in the DB.

Note: This performs N+M individual queries (one per track, one per playlist) rather than a single join. Acceptable for the expected dataset size.

### `createPlaylist(name: string): Playlist`

Creates a new local-only playlist (no `spotifyId`). Inserts into `playlists` with just the `name` field. The `id`, `createdAt`, and `updatedAt` columns are populated by schema defaults (UUID, `Date.now()`). Uses `.returning().get()` to return the created row.

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

Note: This is not wrapped in an explicit transaction -- the Drizzle operations run sequentially on the synchronous better-sqlite3 driver. A future improvement could wrap this in a transaction for atomicity.

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

### `mergePlaylistTracks(targetPlaylistId: string, sourcePlaylistIds: string[]): { added: number; duplicatesSkipped: number }`

Merges tracks from one or more source playlists into a target playlist, deduplicating by `track.id` (local UUID).

Algorithm:
1. Fetch target playlist tracks. Build a `Set<string>` of seen track IDs from the target.
2. For each source playlist (in order), fetch its tracks. For each track:
   - If `track.id` is already in `seenTrackIds`, increment `duplicatesSkipped`.
   - Otherwise, add to `seenTrackIds` and append `track.id` to `newTrackIds`.
3. Build the final track ID list: `[...targetTracks.map(t => t.id), ...newTrackIds]`.
4. Call `setPlaylistTracks(targetPlaylistId, allTrackIds)` to replace the playlist's tracks.
5. Return `{ added: newTrackIds.length, duplicatesSkipped }`.

Order is preserved: target tracks first (in their original order), then new tracks from each source in order.

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
| `playlist-service.ts` | `drizzle-orm` (`eq`, `and`, `sql`, `count`, `desc`, `like`) | runtime import |
| `playlist-service.ts` | `../db/client.js` (`getDb`) | type-only (for `ReturnType<typeof getDb>`) |
| `playlist-service.ts` | `../db/schema.js` (`playlists`, `tracks`, `playlistTracks`, `Playlist`, `Track`, `PlaylistTrack`) | runtime + type imports |
| `playlist-service.ts` | `../types/spotify.js` (`SpotifyTrack`) | type-only import |
| `playlist-service.ts` | `../utils/spotify-url.js` (`extractPlaylistId`) | runtime import |

Note: The imports `and`, `sql`, `count`, `desc`, `like` from `drizzle-orm` are imported but **not currently used** in the source. They may be leftover from a prior iteration or reserved for future methods.

### Database Tables Used

- **`playlists`**: `id` (text PK, UUID), `spotify_id` (text, unique), `name` (text, NOT NULL), `description` (text), `snapshot_id` (text), `is_owned` (integer), `owner_id` (text), `owner_name` (text), `tags` (text/JSON), `notes` (text), `pinned` (integer, default 0), `last_synced` (integer), `created_at` (integer, NOT NULL), `updated_at` (integer, NOT NULL).
- **`tracks`**: `id` (text PK, UUID), `spotify_id` (text, unique), `title` (text, NOT NULL), `artist` (text, NOT NULL), `album` (text), `duration_ms` (integer, NOT NULL), `isrc` (text), `spotify_uri` (text), `created_at` (integer), `updated_at` (integer).
- **`playlist_tracks`**: `id` (text PK, UUID), `playlist_id` (text FK -> playlists.id, NOT NULL), `track_id` (text FK -> tracks.id, NOT NULL), `position` (integer, NOT NULL), `added_at` (integer). Has a unique index on `(playlist_id, track_id)`.

## Behavior

### Lookup Resolution Order (`getPlaylist`)

The three-step lookup chain ensures maximum flexibility for callers. CLI commands can pass a Spotify URL, a Spotify ID, a local UUID, or a playlist name -- the service resolves it transparently. The `extractPlaylistId` utility handles URL parsing and returns the raw string for non-URL inputs.

### Duplicate Detection Philosophy

Two separate methods cover two distinct use cases:
- **Within-playlist duplicates** (`findDuplicatesInPlaylist`): Identifies tracks that appear more than once in the same playlist, which can happen during manual track additions or import bugs. The two-phase approach (spotifyId first, then title+artist) handles both Spotify-sourced tracks and locally-added tracks without Spotify IDs.
- **Cross-playlist duplicates** (`findDuplicatesAcrossPlaylists`): Identifies tracks shared between playlists, useful for curating non-overlapping sets.

### Merge Semantics

`mergePlaylistTracks` performs a **union merge** -- it adds tracks from sources that aren't already in the target. It does **not** remove any tracks from the target. The deduplication is by `track.id` (local UUID), not by `spotifyId` or title+artist. This means the same song imported twice (different local UUIDs) would not be detected as a duplicate by this method.

### Diff Semantics

`getPlaylistDiff` compares by `spotifyUri`, which is the canonical Spotify identifier (e.g., `spotify:track:abc123`). Tracks without a `spotifyUri` in the local DB are silently excluded from the comparison. The `renamed` field is hardcoded to `false` because the method does not receive the Spotify playlist name -- the caller must compare names separately.

## Error Handling

- `getPlaylistDiff` throws `Error("Playlist not found: ${playlistId}")` if the playlist does not exist. This is the only method that throws.
- All other methods return empty arrays or `null` for missing data -- they do not throw.
- `removePlaylist` is safe to call on a non-existent playlist (delete is a no-op).
- `renamePlaylist` and `updateSnapshotId` silently do nothing if the playlist ID doesn't match any row.
- `setPlaylistTracks` does not validate that the provided `trackIds` exist in the `tracks` table. Inserting a non-existent `trackId` will fail at the database level due to the foreign key constraint on `playlist_tracks.track_id`.
- `upsertPlaylist` and `upsertTrack` rely on the unique constraint on `spotify_id` for conflict detection. If called with a `spotifyId` that matches an existing row, the row is updated. If the `spotifyId` is new, a new row is inserted.

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

9. **`findDuplicatesInPlaylist` groups by spotifyId**: Insert a playlist with 3 tracks: track A (spotifyId "s1"), track B (spotifyId "s1", different local UUID via separate insert), track C (spotifyId "s2"). Add all 3 to playlist. Expect 1 duplicate group: track A as primary, track B as duplicate.

10. **`findDuplicatesInPlaylist` groups by title+artist for tracks without spotifyId**: Insert tracks without spotifyId but matching title+artist (case-insensitive). Expect them grouped as duplicates.

11. **`findDuplicatesInPlaylist` returns empty for no duplicates**: Playlist with 3 unique tracks. Expect `[]`.

12. **`findDuplicatesAcrossPlaylists` detects shared tracks**: Create 2 playlists. Add track A to both. Expect result containing track A with both playlists.

13. **`findDuplicatesAcrossPlaylists` ignores single-playlist tracks**: Track appearing in only 1 playlist should not appear in results.

14. **`createPlaylist` creates a local playlist**: Call `createPlaylist("New List")`. Expect returned playlist has a UUID `id`, `name: "New List"`, `spotifyId: null`.

15. **`upsertPlaylist` inserts new playlist**: Call with `spotifyId: "sp1", name: "Test"`. Expect returned row with matching fields.

16. **`upsertPlaylist` updates existing playlist**: Upsert with `spotifyId: "sp1", name: "Old"`. Upsert again with `spotifyId: "sp1", name: "New"`. Fetch by spotifyId. Expect `name: "New"` and `updatedAt` changed.

17. **`upsertTrack` inserts new track**: Call with full data. Expect returned row with matching fields and generated UUID.

18. **`upsertTrack` updates existing track**: Upsert twice with same `spotifyId`, different `title`. Expect updated title on second fetch.

19. **`setPlaylistTracks` replaces all tracks**: Set tracks [A, B], then set tracks [C]. Expect only C in the playlist.

20. **`setPlaylistTracks` with addedAt**: Set tracks with `addedAt: 1000`. Verify the `added_at` value in `playlist_tracks`.

21. **`renamePlaylist` updates name**: Create playlist, rename it. Fetch and verify new name. Verify `updatedAt` changed.

22. **`mergePlaylistTracks` adds non-duplicate tracks**: Target has [A, B]. Source has [B, C]. Expect result: `{ added: 1, duplicatesSkipped: 1 }`. Final track list: [A, B, C].

23. **`mergePlaylistTracks` with multiple sources**: Target [A]. Source1 [B, C]. Source2 [C, D]. Expect: `{ added: 3, duplicatesSkipped: 1 }`. Final: [A, B, C, D].

24. **`removePlaylist` deletes playlist and junction**: Create playlist with tracks. Call `removePlaylist`. Verify playlist gone. Verify `playlist_tracks` rows gone. Verify track records still exist in `tracks` table.

25. **`getPlaylistDiff` identifies toAdd and toRemove**: Local has tracks with URIs [u1, u2]. Spotify has [u2, u3]. Expect: `toAdd: ["u1"]`, `toRemove: ["u3"]`.

26. **`getPlaylistDiff` throws for missing playlist**: Call with non-existent playlistId. Expect `Error("Playlist not found: ...")`.

27. **`getPlaylistDiff` excludes tracks without spotifyUri**: Local has track with `spotifyUri: null`. Spotify has no matching URI. The null-URI track should not appear in `toAdd`.

28. **`getPlaylistDiff` returns renamed as false**: Regardless of input, `renamed` is always `false`.

29. **`updateSnapshotId` updates snapshot**: Upsert playlist. Call `updateSnapshotId` with a new value. Fetch playlist. Verify `snapshotId` updated and `updatedAt` changed.

30. **`getPlaylist` lookup priority**: Create a playlist where the name equals a different playlist's spotifyId. Verify that `getPlaylist` with that string returns the spotifyId match (priority 2) not the name match (priority 3).

## Acceptance Criteria

1. All 15 public methods are implemented with the exact TypeScript signatures documented above.
2. `getPlaylist` resolves identifiers in order: local UUID, spotifyId, exact name. Short-circuits on first match.
3. `getPlaylist` normalizes input through `extractPlaylistId` before any lookups, correctly handling Spotify URLs.
4. `findDuplicatesInPlaylist` uses two-phase grouping: `spotifyId` first (for Spotify-sourced tracks), then `title.toLowerCase() + "::" + artist.toLowerCase()` (for tracks without `spotifyId`).
5. `findDuplicatesAcrossPlaylists` returns only tracks appearing in 2 or more playlists.
6. `upsertPlaylist` uses `onConflictDoUpdate` targeting `playlists.spotifyId` and updates `name`, `description`, `snapshotId`, `updatedAt`.
7. `upsertTrack` uses `onConflictDoUpdate` targeting `tracks.spotifyId` and updates `title`, `artist`, `album`, `durationMs`, `isrc`, `spotifyUri`, `updatedAt`.
8. `setPlaylistTracks` deletes all existing entries for the playlist before inserting, uses zero-indexed positions.
9. `mergePlaylistTracks` deduplicates by `track.id` (local UUID), preserves target order first then source order.
10. `removePlaylist` deletes `playlist_tracks` rows before the `playlists` row (foreign key order).
11. `getPlaylistDiff` compares by `spotifyUri`, filters null URIs from local tracks, and always returns `renamed: false`.
12. `getPlaylistDiff` throws for non-existent playlist. All other methods return `null`/empty/no-op for missing data.
13. All 30 test cases pass in Vitest.
