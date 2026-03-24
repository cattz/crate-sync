---
# spec-22
title: Web interactive pages
status: todo
type: task
priority: high
parent: spec-E5
depends_on: spec-20
created_at: 2026-03-24T00:00:00Z
updated_at: 2026-03-24T00:00:00Z
---

# Web Interactive Pages

## Purpose

Define the interactive web pages and shared components that involve real-time data, user decisions, and configuration editing: Review page, Queue page, JobDetail page, Settings page, the BulkToolbar component, and the useMultiSelect hook.

---

## UI Description

### Review Page (`web/src/pages/Review.tsx`)

**Route:** `/review`

**Data fetched:**
- `useMatches("pending")` -- all pending matches.
- `useUpdateMatch()` -- mutation for confirm/reject.

**Loading state:** `"Loading pending matches..."` in muted text.

**Layout:**

1. **Page header:**
   - `<h2>Review ({N})</h2>` where N is the count of pending matches.
   - Bulk action buttons (only shown when `matches.length > 0`):
     - "Confirm All" button -- iterates all matches and calls `updateMatch.mutate({ id, status: "confirmed" })` for each.
     - "Reject All" danger button -- iterates all matches and calls `updateMatch.mutate({ id, status: "rejected" })` for each.
     - Both disabled while `updateMatch.isPending`.

2. **Empty state:** Card with muted "No pending matches to review."

3. **Match table** (`.card`, when matches exist):
   - Columns: Score, Method, Spotify Track, Dur., Lexicon Track, Dur., Actions.
   - Each row rendered by `MatchRow` component:
     - **Score:** badge colored by confidence (high=badge-green, review=badge-yellow, low=badge-red), shows `{N}%`.
     - **Method:** badge-gray with method name.
     - **Spotify Track (source):** if `sourceTrack` exists, shows title as Link to `/tracks/{id}`, artist in `.artist` span, album in brackets (if present). Otherwise shows raw `sourceId` in muted monospace.
     - **Spotify Duration:** monospace, formatted `M:SS`. Dash if no source track.
     - **Lexicon Track (target):** if `targetTrack` exists, shows title + artist + album in `.inline-track`. Otherwise shows raw `targetId` in muted monospace.
     - **Lexicon Duration:** monospace, formatted `M:SS`. Dash if no target track.
     - **Actions:** "Confirm" button + "Reject" danger button. Both call `useUpdateMatch()` and are disabled while pending.

**Side-by-side comparison:** The table layout provides a direct visual comparison between the Spotify track (source) and the Lexicon track (target) with their respective durations, enabling quick assessment of match quality.

---

### Queue Page (`web/src/pages/Queue.tsx`)

**Route:** `/queue`

**Data fetched:**
- `useJobs({ status: statusFilter, type: typeFilter, limit: 50 })` -- with 3s refetch interval (from hook).
- `useJobStats()` -- with 5s refetch interval (from hook).
- `useRetryJob()`, `useCancelJob()`, `useRetryAllJobs()` -- mutations.

**Loading state:** `"Loading jobs..."` in muted text.

**State:**
- `statusFilter` (string, initially empty).
- `typeFilter` (string, initially empty).

**Type label mapping:**
```
spotify_sync -> "Spotify Sync"
match        -> "Match"
search       -> "Search"
download     -> "Download"
validate     -> "Validate"
lexicon_sync -> "Lexicon Sync"
wishlist_scan -> "Wishlist"
```

**Layout:**

1. **Page header:**
   - `<h2>Job Queue</h2>`
   - Filters row:
     - Status `<select>`: All Status, Queued, Running, Done, Failed.
     - Type `<select>`: All Types, Spotify Sync, Match, Search, Download, Validate, Lexicon Sync, Wishlist.
     - "Retry All" button (only visible when `statusFilter === "failed"`): calls `retryAll.mutate(typeFilter || undefined)`. Shows retried count in parentheses after success. Disabled while pending.

2. **Stat cards grid** (conditional, when stats present):
   - **Queued:** `stats.byStatus.queued ?? 0`
   - **Running:** `stats.byStatus.running ?? 0`
   - **Done:** `stats.byStatus.done ?? 0`
   - **Failed:** `stats.byStatus.failed ?? 0`

3. **Job table** (`.card`):
   - Columns: ID, Type, Status, Details, Error, Created, Actions.
   - Each row rendered by `JobRow` component:
     - **ID:** Link to `/queue/{id}`, monospace small, first 8 chars.
     - **Type:** badge-gray with human-readable label from `typeLabel` mapping.
     - **Status:** colored badge (queued=badge-blue, running=badge-yellow, done=badge-green, failed=badge-red).
     - **Details:** if payload contains `title` or `artist`, shows `"{artist} -- {title}"` in `.inline-track`. Also shows attempt counter `{N}/{max}` in muted text (only when attempt > 0).
     - **Error:** danger-colored, truncated to 60 chars, max-width 200px with overflow ellipsis.
     - **Created:** muted formatted date.
     - **Actions:**
       - "Retry" button (only when `status === "failed"`): calls `retryJob.mutate(id)`.
       - "Cancel" danger button (only when `status === "queued"`): calls `cancelJob.mutate(id)`.
       - Both disabled while their respective mutations are pending.
   - **Empty state:** "No jobs found." spanning all 7 columns.

4. **Pagination notice:** When `data.total > jobs.length`, shows muted small text: `"Showing {N} of {total} jobs."`.

**Live updates:** The 3s refetch interval on `useJobs` provides near-realtime job status updates without SSE on this page.

---

### Job Detail Page (`web/src/pages/JobDetail.tsx`)

**Route:** `/queue/:id`

**Data fetched:**
- `useJob(id)` -- with 3s refetch interval (from hook).
- `useRetryJob()` -- mutation.

**Loading state:** `"Loading job..."` or `"Job not found."`.

**Layout:**

1. **Page header:**
   - `<h2>Job {shortId} {status badge}</h2>` -- shortId is first 8 chars.
   - Actions: "Retry" button (only when `status === "failed"`), "Back to Queue" Link.

2. **Overview card:**
   - Table with rows:
     - **Type:** badge-gray with human label.
     - **Priority:** numeric value.
     - **Attempt:** `{attempt} / {maxAttempts}`.
     - **Created:** full formatted date (toLocaleString).
     - **Started:** full formatted date or dash.
     - **Completed:** full formatted date or dash.
     - **Parent** (conditional, only if `parentJobId` present): Link to `/queue/{parentJobId}`, monospace small, first 8 chars.

3. **Error card** (conditional, only if `job.error`):
   - Styled with `borderLeft: 3px solid var(--danger)`.
   - `<h3>Error</h3>` in danger color.
   - `<pre>` with white-space pre-wrap for the full error message.

4. **Payload card** (conditional, only if `job.payload`):
   - `<h3>Payload</h3>`
   - `<pre>` monospace, JSON.stringify with 2-space indent.

5. **Result card** (conditional, only if `job.result`):
   - `<h3>Result</h3>`
   - `<pre>` monospace, JSON.stringify with 2-space indent.

6. **Child Jobs card** (conditional, only if `job.children.length > 0`):
   - `<h3>Child Jobs ({N})</h3>`
   - Table: ID (linked to child detail page), Type (badge-gray), Status (colored badge), Created (muted date).

---

### Settings Page (`web/src/pages/Settings.tsx`)

**Route:** `/settings`

**Data fetched:**
- `useConfig()` -- current configuration.
- `useUpdateConfig()` -- mutation.

**Loading state:** `"Loading settings..."`.

**State:**
- `autoAccept` (number, default 0.9)
- `review` (number, default 0.7)
- `formats` (string, default "flac, mp3")
- `minBitrate` (number, default 320)
- `concurrency` (number, default 3)
- `saved` (boolean, false) -- transient "Saved!" indicator

All state fields are synced from server config via `useEffect` when `config` data loads.

**Layout:**

1. **Heading:** `<h2>Settings</h2>`

2. **Matching Thresholds card:**
   - 2-column grid (max-width 500px):
     - **Auto-Accept Threshold:** `<label>` + number input (min 0, max 1, step 0.05).
     - **Review Threshold:** `<label>` + number input (min 0, max 1, step 0.05).

3. **Download Settings card:**
   - 3-column grid (max-width 700px):
     - **Formats:** text input, comma-separated list (e.g., "flac, mp3").
     - **Min Bitrate (kbps):** number input (min 0).
     - **Concurrency:** number input (min 1, max 10).

4. **Save button section:**
   - "Save Settings" primary button: calls `handleSave()` which constructs the config object and calls `updateConfig.mutateAsync(...)`. On success, sets `saved = true` for 2 seconds (via `setTimeout`). Disabled while pending.
   - "Saved!" feedback text in accent color, shown for 2 seconds after save.

**Save behavior:**
- Formats string is split by comma, trimmed, and filtered for empty strings before sending.
- Both matching and download sections are sent in a single `updateConfig` call.

---

## Shared Components

### BulkToolbar (`web/src/components/BulkToolbar.tsx`)

**Props:**
```typescript
interface BulkToolbarProps {
  count: number;
  onClear: () => void;
  children?: ReactNode;
}
```

**Behavior:**
- Returns `null` when `count === 0` (component is completely hidden).
- When visible, renders a fixed-position toolbar (`.bulk-toolbar` CSS class) containing:
  - Bold `"{count} selected"` text in small size.
  - "Clear" button calling `onClear`.
  - Any `children` passed through (action buttons from parent).

**Visibility logic:** The component controls its own visibility based on the `count` prop. Parent components only need to ensure they pass the correct count; they do not need to conditionally render the toolbar.

**CSS:** Uses `.bulk-toolbar` class: fixed bottom center, dark card background, border, rounded, shadow, z-index 50.

### useMultiSelect Hook (`web/src/hooks/useMultiSelect.ts`)

**Full interface:**

```typescript
function useMultiSelect(): {
  selected: Set<string>;       // The current set of selected IDs
  toggle: (id: string) => void;     // Add if absent, remove if present
  selectAll: (ids: string[]) => void; // Replace selection with given IDs
  clear: () => void;                  // Empty the selection
  isSelected: (id: string) => boolean; // Check membership
  count: number;                       // selected.size (memoized)
}
```

**Implementation details:**
- `selected` is `useState<Set<string>>(new Set())`.
- `toggle` is `useCallback`: creates new Set, adds or deletes, sets state.
- `selectAll` is `useCallback`: creates new Set from ids array.
- `clear` is `useCallback`: creates empty Set.
- `isSelected` is `useCallback`: `selected.has(id)`, depends on `[selected]`.
- `count` is `useMemo`: `selected.size`, depends on `[selected]`.

**Usage pattern (from Playlists page):**
1. Call `const selection = useMultiSelect()`.
2. Bind checkboxes: `checked={selection.isSelected(id)}`, `onChange={() => selection.toggle(id)}`.
3. Header checkbox: select all filtered IDs or clear based on current count.
4. Pass `selection.count` and `selection.clear` to `BulkToolbar`.
5. Use `selection.selected` Set to filter the full playlist list for bulk operations.

---

## Dependencies

- `react`: useState, useMemo, useCallback, useEffect.
- `react-router`: Link, useParams.
- `@tanstack/react-query` (via hooks).
- `web/src/api/hooks.ts`: useMatches, useUpdateMatch, useJobs, useJobStats, useRetryJob, useCancelJob, useRetryAllJobs, useJob, useConfig, useUpdateConfig.
- `web/src/api/client.ts`: MatchWithTrack, JobItem, types.
- `web/src/styles/globals.css`: badge classes, card, table, button variants, stat-card, bulk-toolbar, modal-overlay, page-header, grid-stats.
- `web/src/components/BulkToolbar.tsx`: BulkToolbar component.
- `web/src/hooks/useMultiSelect.ts`: useMultiSelect hook.

---

## Error Handling

- **Review page:** Mutation errors are not explicitly shown in the UI (confirm/reject are fire-and-forget via `mutate`, not `mutateAsync`). The mutation's `isPending` disables buttons to prevent double-clicks. React Query will refetch the matches list which updates the UI.
- **Queue page:** Same pattern -- retry/cancel mutations disable buttons while pending. The 3s refetch interval ensures the table updates quickly.
- **Job Detail:** Retry mutation disables the button. Error section is always visible when the job has an error.
- **Settings page:** The save button is disabled during the mutation. No explicit error display is implemented -- the `updateConfig` mutation would throw and React Query would handle it, but no `isError` check exists in the component.

---

## Manual Test Scenarios

### Review Page
1. Verify the page shows the correct count of pending matches in the heading.
2. Click "Confirm" on a single match, verify it disappears from the list.
3. Click "Reject" on a single match, verify it disappears.
4. Click "Confirm All", verify all matches are confirmed and list becomes empty.
5. Click "Reject All", verify same behavior.
6. Verify the side-by-side display shows Spotify track on the left and Lexicon track on the right with their durations.
7. Verify matches with missing source/target track data show raw IDs instead.

### Queue Page
1. Verify stat cards update in near-realtime (3-5s delay).
2. Filter by status "failed", verify "Retry All" button appears.
3. Click "Retry All", verify failed count drops to 0 and queued count increases.
4. Filter by type "download", verify only download jobs are shown.
5. Click a job ID to navigate to job detail.
6. Verify "Cancel" button appears for queued jobs and "Retry" for failed jobs.
7. Verify pagination notice shows when there are more than 50 jobs.

### Job Detail Page
1. Verify overview shows type, priority, attempt count, timestamps.
2. Verify parent link navigates to parent job when present.
3. Verify error card shows with red left border and full error text.
4. Verify payload/result cards show formatted JSON.
5. Verify child jobs table with links to each child.
6. Click "Retry" on a failed job, verify status changes.

### Settings Page
1. Load page, verify form fields populate from server config.
2. Change auto-accept threshold, click Save, verify "Saved!" flash appears.
3. Reload page, verify persisted values.
4. Change formats to "flac, wav", save, verify.
5. Change concurrency to 5, save, verify.

### BulkToolbar
1. On Playlists page, select one playlist, verify toolbar appears with "1 selected".
2. Select more, verify count updates.
3. Click "Clear", verify toolbar disappears.
4. Verify "Delete Selected" and "Merge Selected" buttons are present in toolbar.

### useMultiSelect
1. Call `toggle("a")` twice, verify it's added then removed.
2. Call `selectAll(["a","b","c"])`, verify count is 3.
3. Call `clear()`, verify count is 0.
4. Call `isSelected("a")` after selecting "a", verify returns true.

---

## Acceptance Criteria

1. Review page shows all pending matches in a side-by-side comparison table with score, method, Spotify track, Lexicon track, and durations.
2. Review page supports individual confirm/reject and bulk confirm-all/reject-all operations.
3. Queue page shows stat cards (queued/running/done/failed counts) with near-realtime updates.
4. Queue page supports filtering by status and type, with a "Retry All" button that appears when filtering by failed status.
5. Queue page shows job details inline (track info from payload, attempt counter, truncated error) and provides retry/cancel per job.
6. Job Detail page shows overview, error (with distinct styling), payload, result, parent link, and child jobs table.
7. Settings page loads current config values into form fields and saves them back via a single API call.
8. Settings page shows a transient "Saved!" indicator for 2 seconds after successful save.
9. BulkToolbar is hidden when count is 0 and visible with correct count and action buttons otherwise.
10. useMultiSelect hook provides a complete set/selection interface: toggle, selectAll, clear, isSelected, count, and the raw Set.
