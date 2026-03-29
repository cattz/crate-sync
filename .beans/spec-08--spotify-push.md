---
# spec-08
title: Spotify push (local to Spotify sync)
status: todo
type: task
priority: high
parent: spec-E1
depends_on: spec-06, spec-07
created_at: 2026-03-29T00:00:00Z
updated_at: 2026-03-29T00:00:00Z
---

## Purpose

Thin orchestration layer that pushes local playlist state to Spotify. Composes `PlaylistService` (spec-07) for local data reads and diff computation with `SpotifyService` (spec-06) for Spotify API writes. This is intentionally minimal (~50 lines of logic) -- all heavy lifting lives in the two underlying services.

The push workflow handles three concerns:
1. **Renames** -- push local playlist name to Spotify if it differs.
2. **Description sync** -- serialize local tags + notes and push as the Spotify playlist description.
3. **Track changes** -- add/remove tracks to match local state.

## Public Interface

### File: `src/services/spotify-push.ts`

```ts
interface PushOptions {
  dryRun?: boolean;           // default: false -- preview changes without writing
  includeDescription?: boolean; // default: true -- whether to push description
}

interface PushSummary {
  playlistId: string;
  playlistName: string;
  renamed: { from: string; to: string } | null;
  descriptionUpdated: boolean;
  tracksAdded: number;
  tracksRemoved: number;
  dryRun: boolean;
}

async function pushPlaylist(
  playlistId: string,
  spotifyService: SpotifyService,
  playlistService: PlaylistService,
  options?: PushOptions,
): Promise<PushSummary>
```

Exported as a standalone async function (not a class). Dependencies are injected as parameters for testability.

## Dependencies

| Import | Source | Kind |
|---|---|---|
| `SpotifyService` | `./spotify-service.js` | runtime |
| `PlaylistService` | `./playlist-service.js` | runtime |
| `PushOptions`, `PushSummary` | local (same file or `../types/push.js`) | type export |

## Behavior

### `pushPlaylist()` flow

1. **Resolve playlist**: Call `playlistService.getPlaylist(playlistId)`. Throws `Error("Playlist not found: ${playlistId}")` if `null`.

2. **Validate Spotify link**: Check that `playlist.spotifyId` is non-null. Throws `Error("Playlist has no Spotify ID: ${playlistId}")` if missing (local-only playlists cannot be pushed).

3. **Fetch Spotify state**: Call `spotifyService.getPlaylistTracks(playlist.spotifyId)` to get current Spotify tracks.

4. **Detect diff**: Call `playlistService.getPlaylistDiff(playlistId, spotifyTracks)` to get `{ toAdd, toRemove }`.

5. **Detect rename**: Call `spotifyService.getPlaylists()` is too expensive. Instead, call `spotifyService.getPlaylistTracks()` already done. For the name, we use the Spotify playlist data already synced in the DB. Compare `playlist.name` (local) with the name stored in DB from last sync. If they differ from what Spotify has, we compare: the local name is the source of truth. To detect a rename, fetch the Spotify playlist metadata via the API. If `spotifyName !== playlist.name`, a rename is needed.

   Simplified: use a lightweight Spotify API call inside the push to get the current Spotify name:
   - Internally, `spotifyService.fetchApi(`/playlists/${spotifyId}?fields=name,description`)` (or expose a dedicated `getPlaylistDetails()` method).
   - Compare Spotify name with local `playlist.name`.

6. **Compose description**: If `options.includeDescription !== false`:
   - Call `playlistService.composeDescription(playlistId)` to serialize tags + notes.
   - Compare with the current Spotify description (from the lightweight fetch in step 5).
   - Flag `descriptionChanged = true` if they differ.

7. **Execute changes** (skip if `options.dryRun`):

   a. **Rename**: If local name differs from Spotify name, call `spotifyService.renamePlaylist(playlist.spotifyId, playlist.name)`.

   b. **Description**: If `descriptionChanged`, call `spotifyService.updatePlaylistDescription(playlist.spotifyId, composedDescription)`.

   c. **Remove tracks**: If `toRemove.length > 0`, call `spotifyService.removeTracksFromPlaylist(playlist.spotifyId, toRemove)`.

   d. **Add tracks**: If `toAdd.length > 0`, call `spotifyService.addTracksToPlaylist(playlist.spotifyId, toAdd)`.

8. **Return summary**:
   ```ts
   {
     playlistId: playlist.id,
     playlistName: playlist.name,
     renamed: nameChanged ? { from: spotifyName, to: playlist.name } : null,
     descriptionUpdated: descriptionChanged && !dryRun,
     tracksAdded: toAdd.length,
     tracksRemoved: toRemove.length,
     dryRun: options?.dryRun ?? false,
   }
   ```

### Execution order

Changes are applied in this order: rename -> description -> remove tracks -> add tracks. Remove before add avoids temporary URI conflicts in edge cases (e.g., a track moved between playlists).

### Dry run

When `dryRun: true`, the function performs all reads and diff computations but skips all Spotify API writes (steps 7a-7d). The returned `PushSummary` still reflects what *would* change, with `dryRun: true` and `descriptionUpdated: false` (since the write did not happen).

### Description toggle

When `includeDescription: false`, the description diff/push is skipped entirely. `descriptionUpdated` will be `false` in the summary. This is useful when the caller only wants to sync tracks and name.

## Error Handling

| Scenario | Behavior |
|---|---|
| Playlist not found in local DB | Throws `Error("Playlist not found: ${playlistId}")` |
| Playlist has no `spotifyId` | Throws `Error("Playlist has no Spotify ID: ${playlistId}")` |
| Spotify API errors (rename, description, add, remove) | Propagated from `SpotifyService` (401/429/network errors handled by its `fetchApi` and `withRetry`) |
| Partial failure (e.g., rename succeeds, add tracks fails) | Error propagates; caller sees which step failed from the error. Already-applied changes (rename) are NOT rolled back -- Spotify API has no transactions |
| No changes detected | Returns summary with all zero counts and `renamed: null`, `descriptionUpdated: false`. No API calls made (besides the initial reads). |

## Tests

Test framework: Vitest. Tests at `src/services/__tests__/spotify-push.test.ts`.

Use mock/stub implementations of `SpotifyService` and `PlaylistService` -- inject them as parameters.

### Test Cases

1. **Happy path -- all changes**: Local playlist with different name, different description, tracks to add and remove. Call `pushPlaylist()`. Verify: `renamePlaylist()` called with correct args, `updatePlaylistDescription()` called, `removeTracksFromPlaylist()` called with `toRemove`, `addTracksToPlaylist()` called with `toAdd`. Summary reflects all changes.

2. **No changes detected**: Spotify state matches local state exactly (same name, same description, same tracks). Verify no write methods called. Summary has zero counts and `renamed: null`.

3. **Dry run skips writes**: Same setup as test 1. Call with `{ dryRun: true }`. Verify no write methods called. Summary still shows the counts of what would change, with `dryRun: true`.

4. **includeDescription: false skips description**: Local description differs from Spotify. Call with `{ includeDescription: false }`. Verify `updatePlaylistDescription()` NOT called. `descriptionUpdated` is `false`.

5. **Only rename needed**: Name differs, tracks and description match. Verify only `renamePlaylist()` called.

6. **Only tracks changed**: Name and description match. Tracks differ. Verify only `addTracksToPlaylist()` and/or `removeTracksFromPlaylist()` called.

7. **Only description changed**: Name and tracks match. Description differs. Verify only `updatePlaylistDescription()` called.

8. **Throws for missing playlist**: Call with non-existent playlistId. Expect `Error("Playlist not found: ...")`.

9. **Throws for local-only playlist**: Playlist exists but `spotifyId` is null. Expect `Error("Playlist has no Spotify ID: ...")`.

10. **Execution order**: Verify calls happen in order: rename -> description -> remove -> add. Use ordered spy assertions.

11. **Spotify API error propagation**: Mock `addTracksToPlaylist()` to throw. Verify error propagates to caller. Verify `renamePlaylist()` was still called before the failure (partial execution).

## Acceptance Criteria

- [ ] `pushPlaylist()` function exported from `src/services/spotify-push.ts`
- [ ] `PushOptions` and `PushSummary` types exported
- [ ] Dependencies injected as parameters (no module-level singletons)
- [ ] Detects rename by comparing local name with current Spotify name
- [ ] Composes description via `PlaylistService.composeDescription()` and compares with Spotify
- [ ] Detects track diff via `PlaylistService.getPlaylistDiff()`
- [ ] Pushes rename via `SpotifyService.renamePlaylist()`
- [ ] Pushes description via `SpotifyService.updatePlaylistDescription()`
- [ ] Pushes track adds/removes via `SpotifyService.addTracksToPlaylist()` / `removeTracksFromPlaylist()`
- [ ] `dryRun` option prevents all Spotify writes while still computing the full diff
- [ ] `includeDescription: false` skips description comparison and push
- [ ] Returns `PushSummary` with accurate change counts
- [ ] Execution order: rename -> description -> remove tracks -> add tracks
- [ ] Throws for missing playlist or missing `spotifyId`
- [ ] ~50 lines of orchestration logic (no business logic duplication)
- [ ] All 11 test cases pass in Vitest
