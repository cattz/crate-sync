---
# spec-21
title: Web browsing pages
status: todo
type: task
priority: high
parent: spec-E5
depends_on: spec-20
created_at: 2026-03-24T00:00:00Z
updated_at: 2026-03-24T00:00:00Z
---

# Web Browsing Pages

## Purpose

Define the read-oriented web pages that let users browse their library: Dashboard, Playlists listing, Playlist detail, Track detail, Matches browser, and Downloads browser. These pages fetch data, display it in tables and stat cards, and provide filtering/sorting/searching controls.

---

## UI Description

### Dashboard (`web/src/pages/Dashboard.tsx`)

**Route:** `/` (index)

**Data fetched:**
- `useStatus()` -- service health
- `usePlaylists()` -- playlist list (for fallback count)
- `usePlaylistStats()` -- library stats (totalPlaylists, totalTracks, totalDurationMs)
- `useMatches("pending")` -- pending match count
- `useDownloads()` -- total download count
- `useJobStats()` -- job status counts

**Loading state:** Renders `"Loading..."` in muted text while `statusLoading` is true.

**Layout:**

1. **Heading:** `<h2>Dashboard</h2>`

2. **Stat cards grid** (`.grid-stats`):
   - **Playlists:** shows `libraryStats.totalPlaylists` (fallback: `playlists.length`).
   - **Total Tracks:** shows `libraryStats.totalTracks` (fallback: `status.database.tracks`; dash if unavailable).
   - **Total Duration:** shows formatted `libraryStats.totalDurationMs` as `{H}h {M}m` (dash if unavailable). Helper: `formatLibraryDuration(ms)`.
   - **Pending Matches:** count from `pendingMatches.length`.
   - **Downloads:** count from `recentDownloads.length`.
   - **Jobs Running** (conditional, only if jobStats present): `jobStats.byStatus.running`.
   - **Jobs Failed** (conditional): `jobStats.byStatus.failed`.

3. **Service Status card** (`.card`):
   - `<h3>Service Status</h3>`
   - Table with columns: Service, Status, Details.
   - Rows:
     - **SpotifyRow** (custom component): badge-green "Connected" / badge-red "Error". Details column shows:
       - If connected: "Logout" danger button (calls `useSpotifyLogout`).
       - If not connected and not polling: "Login" primary button. Clicking calls `useStartSpotifyLogin().mutateAsync()`. On success, opens `authUrl` in new tab (`window.open`), starts polling via `useSpotifyAuthStatus(polling=true)` with 2s interval. When `authStatus.authenticated` becomes true, stops polling.
       - If polling: "Waiting for authorization..." text.
       - Error display in danger color if login fails.
     - **Lexicon:** generic ServiceRow -- badge-green/red, shows error message if any.
     - **SoulseekRow** (custom component): badge-green/red. Details column shows:
       - If connected: "Disconnect" danger button (calls `useDisconnectSoulseek`).
       - If not connected: "Connect" primary button toggles a form row.
       - Form row (shown below the Soulseek row, spanning all 3 columns): two inputs (slskd URL, default `http://localhost:5030`; API Key, password type) and "Connect" primary button. Calls `useConnectSoulseek().mutateAsync({ slskdUrl, slskdApiKey })`. On success, hides form and clears API key. On error, shows error message.
     - **Database:** generic ServiceRow -- shows `"{N} playlists, {N} tracks"` when ok.

---

### Playlists (`web/src/pages/Playlists.tsx`)

**Route:** `/playlists`

**Data fetched:**
- `usePlaylists()` -- all playlists.
- `useSyncPlaylists()` -- mutation for syncing from Spotify.
- `useCrossPlaylistDuplicates(showCrossDupes)` -- conditional.
- `useSimilarPlaylists(0.7, showSimilar)` -- conditional, threshold 0.7.
- `useRenamePlaylist()`, `useDeletePlaylist()`, `useMergePlaylists()`, `useBulkRename()` -- mutations.
- `useMultiSelect()` -- selection state.

**Loading state:** `"Loading playlists..."` in muted text.

**State management:**
- URL search params persist filter/sort state: `q` (search), `sort` (key), `dir` (direction), `owner` (ownership filter), `tag` (tag filter).
- Types: `SortKey = "name" | "trackCount" | "ownerName" | "lastSynced"`, `SortDir = "asc" | "desc"`, `OwnershipFilter = "all" | "own" | "followed"`.
- `allTags` computed via `useMemo`: scans all playlists, extracts tags from JSON-stored `tags` field, deduplicates and sorts.

**Layout:**

1. **Page header** (`.page-header`):
   - `<h2>Playlists</h2>`
   - Actions row:
     - "Sync from Spotify" primary button (calls `sync.mutate()`; disabled while pending; shows "Syncing...").
     - "Bulk Rename" button (opens BulkRenameModal).
     - "Cross-Playlist Dupes" toggle button.
     - "Similar Names" toggle button.
     - Ownership filter: 3 buttons (All/Own/Followed), active one gets `.primary` class.
     - Tag filter `<select>`: "All Tags" + all discovered tags.
     - Search input: `placeholder="Search playlists..."`, width 220px.

2. **Sync result feedback:** Green text showing added/updated/unchanged counts, or danger-colored error.

3. **Cross-Playlist Duplicates section** (conditional):
   - Loading: muted "Scanning..." text.
   - Empty: green "No cross-playlist duplicates found."
   - Results: card with `<h3>Cross-Playlist Duplicates ({N} tracks)</h3>`, table: Track, Artist, In Playlists.

4. **Similar Playlist Names section** (conditional):
   - Same loading/empty/results pattern.
   - Results table: Playlist A (linked), Playlist B (linked), Similarity (percentage), Merge button.
   - Clicking Merge opens `MergeConfirmModal` for the pair.

5. **Playlist table** (inside `.card`):
   - **Header row:** Checkbox (select all / indeterminate), sortable headers (Name, Tracks, Owner [hidden when `ownership === "own"`], Last Synced), empty actions column.
   - Sorting: click header toggles direction; `SortHeader` component adds triangle indicator.
   - **Filtering logic** (`useMemo`):
     - Ownership filter: `isOwned === 1` for own, `isOwned === 0` for followed.
     - Search: case-insensitive name includes.
     - Tag filter: checks parsed JSON tags array.
     - Sort: pinned playlists always float to top. Then by active sort key/direction.
   - **Row content:**
     - Checkbox for selection.
     - Name cell: optional "pinned" badge (badge-green), Link to `/playlists/{id}`, tag badges (badge-blue) from parsed tags.
     - Track count.
     - Owner (if visible): "You" for owned, ownerName otherwise.
     - Last Synced: formatted date or dash.
     - Actions: View (Link), Rename (disabled for followed), Delete danger (disabled for followed).
   - **Empty state:** "No playlists match your filters." or instruction to run `crate-sync db sync`.

6. **Modals:**
   - **RenameModal:** input pre-filled with current name, "Cancel"/"Rename" buttons. Uses `useRenamePlaylist()`.
   - **DeleteModal:** confirmation text with name and track count, note that it doesn't delete from Spotify. "Cancel"/"Delete" danger button. Uses `useDeletePlaylist()`.
   - **MergeConfirmModal** (from Similar Names): shows merge source/target with a toggle to swap A/B as target. "Cancel"/"Merge" primary button.
   - **BulkDeleteModal:** lists all selected playlists, has progress counter during deletion. Uses `useDeletePlaylist()` in a loop.
   - **BulkMergeModal:** radio list of selected playlists to choose target. Shows track counts. "Merge into {name}" primary button.
   - **BulkRenameModal:** Mode selector (Find & Replace, Prefix, Suffix). Find & Replace: find/replace inputs. Prefix/Suffix: add/remove toggle + value input. "Preview" button triggers dryRun, shows before/after table. "Apply" button commits. Uses `useBulkRename()`.

7. **Bulk Toolbar** (`.bulk-toolbar`): Shows when `selection.count > 0`. Contains "Delete Selected" danger button and "Merge Selected" primary button (disabled when count < 2).

---

### Playlist Detail (`web/src/pages/PlaylistDetail.tsx`)

**Route:** `/playlists/:id`

**Data fetched:**
- `usePlaylist(id)` -- playlist metadata.
- `usePlaylistTracks(id)` -- track list.
- `usePlaylists()` -- all playlists (for merge modal and tag suggestions).
- `useStartSync()` -- sync mutation.
- `useRenamePlaylist()`, `useDeletePlaylist()`, `usePushPlaylist()`, `useRepairPlaylist()`, `useMergePlaylists()`, `useUpdatePlaylistMeta()`, `usePlaylistDuplicates(id, showDupes)`.

**State management:**
- `syncId`, `syncEvents[]`, `syncPhase` -- for live sync progress.
- `reviewItems[]` -- from SSE `review-needed` events.
- Track filtering: `trackSearch` (text), `trackSortKey`, `trackSortDir`.
- `notesValue` -- local textarea state, saves on blur.
- `tagInput` + `showTagSuggestions` -- for tag autocomplete.
- Computed: `totalDurationMs`, `uniqueArtists`, `topArtist`, `currentTags`, `allExistingTags`, `tagSuggestions`.

**Loading state:** `"Loading..."` or `"Playlist not found"`.

**Layout:**

1. **Page header:**
   - Back link `<- Playlists` to `/playlists`.
   - `<h2>{playlist.name}</h2>` + muted track count.
   - Action buttons: Pin/Unpin, Start Sync (primary, disabled during sync, shows phase), Push to Spotify (disabled for followed or no spotifyId), Repair, Find Dupes, Merge Into, Rename (disabled for followed), Delete danger (disabled for followed).

2. **Stat cards grid:** Tracks, Duration (short format), Artists (unique count), Top Artist.

3. **Push/Repair/Merge result feedback:** Green success text or danger error text, conditionally shown.

4. **Tags card:** Displays current tags as badge-blue with `x` to remove (click). Tag input with autocomplete dropdown (filtered from all existing tags across all playlists). Enter key adds new tag.

5. **Notes card:** Textarea with auto-save on blur. Calls `updatePlaylistMeta` with notes value.

6. **Duplicates section** (conditional): Toggled by "Find Dupes" button. Shows groups with track name, artist, and `{N}x` badge.

7. **Sync progress card** (conditional, when syncEvents non-empty): Shows each SSE event as a badge with type + monospace JSON data.

8. **Review matches card** (conditional, when reviewItems non-empty): `ReviewPanel` component -- per item shows title, artist, score badge. Accept/Reject buttons per item. "Submit Decisions" primary button calls `handleSubmitReview` which POSTs to `api.submitReview(syncId, decisions)`.

9. **SSE integration:**
   - When `syncId` is set, creates `EventSource` via `api.syncEvents(syncId)`.
   - Listens for: `phase`, `match-complete`, `review-needed`, `download-progress`, `sync-complete`, `error`.
   - Cleanup: closes EventSource on unmount or syncId change.

10. **Track list** (`.card`):
    - Filter input: `placeholder="Filter by title or artist..."`, width 220px.
    - Duration summary: `"Xh Ym across N tracks"`.
    - Sortable table: #, Title, Artist, Album, Duration. `ThSort` component.
    - Track sort options: position, title, artist, album, durationMs.
    - Row click navigates to `/tracks/{trackId}` via `useNavigate()`.
    - Empty filter state: "No tracks match your filter."

11. **Rename modal:** Same pattern as Playlists page RenameModal.

12. **Merge modal** (`MergeModal`): Lists all other playlists with checkboxes. Search filter. Shows track counts. "Merge {N} playlists" primary button.

13. **Delete modal:** Same pattern. On delete, navigates to `/playlists`.

---

### Track Detail (`web/src/pages/TrackDetail.tsx`)

**Route:** `/tracks/:id`

**Data fetched:**
- `useTrackLifecycle(id)` -- returns `{ track, playlists, matches, downloads, jobs }`.

**Loading state:** `"Loading track..."` or `"Track not found."`.

**Layout:**

1. **Page header:** `<h2>{track.title}</h2>`.

2. **Spotify Metadata card:** Table with rows: Artist, Album (or dash), Duration (formatted M:SS), ISRC (monospace, or dash), Spotify URI (monospace, small), Imported (formatted date).

3. **Playlists card:** `"Playlists ({N})"`. Table: Playlist (linked to `/playlists/{id}`), Position (1-indexed). Empty state: "Not in any playlist."

4. **Matches card:** `"Matches ({N})"`. Table: Target (type prefix + truncated ID), Score (monospace percentage), Method (badge-gray), Status (colored badge). Empty state: "No matches found."

   Badge mapping for match status: pending=badge-yellow, confirmed=badge-green, rejected=badge-red.

5. **Downloads card:** `"Downloads ({N})"`. Table: Status (colored badge), File (monospace, truncated, shows filePath or soulseekPath), Error (danger color), When (formatted date). Empty state: "No downloads."

   Badge mapping for download status: pending=badge-gray, searching=badge-blue, downloading=badge-blue, validating=badge-yellow, moving=badge-yellow, done=badge-green, failed=badge-red.

6. **Jobs card** (conditional, only if jobs.length > 0): `"Jobs ({N})"`. Table: ID (linked to `/queue/{id}`, monospace, first 8 chars), Type (badge-gray with human label), Status (colored badge), Created (formatted date).

   Badge mapping for job status: queued=badge-blue, running=badge-yellow, done=badge-green, failed=badge-red.

---

### Matches (`web/src/pages/Matches.tsx`)

**Route:** `/matches`

**Data fetched:**
- `useMatches(filter || undefined)` -- matches, optionally filtered.
- `useUpdateMatch()` -- mutation for confirm/reject.

**Loading state:** `"Loading matches..."`.

**State:** `filter` (string, initially empty).

**Layout:**

1. **Page header:** `<h2>Matches</h2>` + status filter `<select>`: All, Pending, Confirmed, Rejected.

2. **Matches table** (`.card`):
   - Columns: Source Track, Score, Method, Confidence, Status, Actions.
   - **Source Track:** if `sourceTrack` exists, shows title + artist (in `.inline-track`). Otherwise shows raw `sourceId` in muted text.
   - **Score:** monospace, formatted as `{N}%`.
   - **Method:** badge-gray.
   - **Confidence:** badge-green (high), badge-yellow (review), badge-red (low).
   - **Status:** badge-green (confirmed), badge-red (rejected), badge-yellow (pending).
   - **Actions:** Only for pending matches: "Confirm" button + "Reject" danger button. Both disabled while mutation pending.
   - **Empty state:** "No matches found."

---

### Downloads (`web/src/pages/Downloads.tsx`)

**Route:** `/downloads`

**Data fetched:**
- `useDownloads(filter || undefined)` -- with 5s refetch interval (inherited from hook).

**Loading state:** `"Loading downloads..."`.

**State:** `filter` (string, initially empty).

**Layout:**

1. **Page header:** `<h2>Downloads</h2>` + status filter `<select>`: All, Pending, Downloading, Done, Failed.

2. **Downloads table** (`.card`):
   - Columns: Track, Status, File, Error, Completed.
   - **Track:** if `track` exists, shows title + artist (in `.inline-track`). Otherwise shows raw `trackId`.
   - **Status:** colored badge using mapping: pending=badge-gray, searching=badge-blue, downloading=badge-blue, validating=badge-yellow, moving=badge-yellow, done=badge-green, failed=badge-red.
   - **File:** monospace, muted, small, truncated (max-width 350px), shows `filePath` or dash.
   - **Error:** small, danger-colored.
   - **Completed:** muted formatted date or dash.
   - **Empty state:** "No downloads."

---

## Dependencies

All pages depend on:
- `react` (useState, useMemo, useCallback, useEffect)
- `react-router` (Link, useParams, useSearchParams, useNavigate, NavLink)
- `@tanstack/react-query` (via hooks)
- `web/src/api/hooks.ts` (all custom hooks)
- `web/src/api/client.ts` (types and direct api calls for SSE)
- `web/src/styles/globals.css` (all CSS classes)

Additional per-page:
- **Playlists:** `useMultiSelect` hook, `BulkToolbar` component.
- **PlaylistDetail:** `api.syncEvents()` for SSE, `api.submitReview()` direct call.

---

## Error Handling

- All mutations expose `isError` and `error.message` which are displayed inline in the UI (typically in danger-colored text below the relevant button or form).
- Loading states show muted placeholder text.
- Missing data (playlist/track not found) shows muted "not found" text.
- Service connection errors in Dashboard are shown via the status badge system.
- The Spotify login flow handles errors via local `error` state displayed below the form.
- The Soulseek connect flow handles errors via local `error` state.

---

## Manual Test Scenarios

1. **Dashboard:** Verify all stat cards populate correctly. Login to Spotify via the Dashboard button, verify polling stops when authenticated. Connect to Soulseek via the form, verify it hides on success.
2. **Playlists:** Search by name, filter by ownership, filter by tag, sort by each column. Sync from Spotify and verify added/updated counts. Rename a playlist. Delete a playlist with confirmation. Select multiple and bulk delete. Select multiple and bulk merge. Run bulk rename with preview.
3. **Playlists - Cross Dupes:** Click "Cross-Playlist Dupes", verify duplicates show. Click "Similar Names", verify pairs show with merge buttons.
4. **Playlist Detail:** Verify stat cards (tracks, duration, artists, top artist). Add/remove tags. Edit notes (auto-saves on blur). Start sync and observe SSE events. Push to Spotify. Find duplicates. Merge another playlist in. Sort/filter tracks. Click a track to navigate to track detail.
5. **Track Detail:** Verify all metadata fields. Verify playlist memberships are linked. Verify matches, downloads, and jobs sections show correct data.
6. **Matches:** Filter by status. Confirm and reject individual matches. Verify badge colors.
7. **Downloads:** Filter by status. Verify auto-refresh (5s interval). Verify file paths and error messages display correctly.

---

## Acceptance Criteria

1. Dashboard shows stat cards for playlists, tracks, duration, pending matches, downloads, and job stats.
2. Dashboard service status table supports Spotify login/logout, Soulseek connect/disconnect with inline forms.
3. Playlists page supports search, sort (4 columns), ownership filter, tag filter, and persists state in URL params.
4. Playlists page supports bulk operations: select all/some, bulk delete, bulk merge, bulk rename with preview.
5. Playlists page shows cross-playlist duplicates and similar playlist names on demand.
6. Playlist detail shows metadata, stat cards, tags (add/remove), notes (auto-save), and full track list with sort/filter.
7. Playlist detail integrates SSE for live sync progress and in-page review of matches.
8. Track detail shows the complete lifecycle: metadata, playlists, matches, downloads, and related jobs.
9. Matches page lists all matches with status filter and confirm/reject actions for pending matches.
10. Downloads page lists all downloads with status filter and 5-second auto-refresh.
11. All empty states, loading states, and error states are handled as documented.
