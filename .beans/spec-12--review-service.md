---
# spec-12
title: "Review service"
status: todo
type: task
priority: critical
parent: spec-E2
depends_on: spec-04
created_at: 2026-03-29T00:00:00Z
updated_at: 2026-03-29T00:00:00Z
---

## Purpose

`ReviewService` manages the async review queue for pending Lexicon matches. When the sync pipeline parks a match (score 0.7-0.9), it sits in the `matches` table with status `"pending"` and a `parked_at` timestamp. ReviewService provides methods to list, confirm, and reject those matches at any time -- decoupled from the sync session. Rejecting a match auto-queues a download entry for the track. The review queue is accessible from both the web UI and CLI.

## Public Interface

### Types

```ts
export interface PendingReview {
  matchId: string;
  spotifyTrack: TrackInfo;
  lexiconTrack: TrackInfo;
  score: number;
  confidence: string;
  method: string;
  playlistName: string;
  parkedAt: number;         // Unix ms timestamp
}

export interface ReviewStats {
  pending: number;
  confirmed: number;
  rejected: number;
}
```

### Dependency injection

```ts
export interface ReviewServiceDeps {
  db?: ReturnType<typeof getDb>;
}
```

### ReviewService class

```ts
class ReviewService {
  constructor(config: Config, deps?: ReviewServiceDeps)

  async getPending(playlistId?: string): Promise<PendingReview[]>
  async confirm(matchId: string): Promise<void>
  async reject(matchId: string): Promise<void>
  async bulkConfirm(matchIds: string[]): Promise<{ confirmed: number }>
  async bulkReject(matchIds: string[]): Promise<{ rejected: number; downloadsQueued: number }>
  async getStats(): Promise<ReviewStats>
}
```

## Dependencies

| Import | Source |
|---|---|
| `eq`, `and`, `sql`, `inArray` | `drizzle-orm` |
| `Config` | `../config.js` |
| `TrackInfo` | `../types/common.js` |
| `getDb` | `../db/client.js` |
| `matches`, `tracks`, `playlists`, `playlistTracks`, `downloads` (via `* as schema`) | `../db/schema.js` |

No external service dependencies. ReviewService is pure DB operations.

## Behavior

### Constructor

Accepts `Config` and optional `ReviewServiceDeps`. Private getter:
- `getDb()` -- returns `deps.db ?? getDb()`

### getPending(playlistId?)

Lists all pending matches, optionally filtered by playlist.

**Algorithm:**

1. Query `matches` table where `status = "pending"` and `sourceType = "spotify"` and `targetType = "lexicon"`.

2. If `playlistId` is provided:
   - Join with `playlistTracks` on `matches.sourceId = playlistTracks.trackId` where `playlistTracks.playlistId = playlistId`.
   - This filters to matches for tracks that belong to the specified playlist.

3. For each match row:
   - Load the Spotify track from `tracks` table using `matches.sourceId`.
   - Build `spotifyTrack: TrackInfo` from the track row (title, artist, album, durationMs, isrc).
   - Build `lexiconTrack: TrackInfo` from `matches.targetMeta` (JSON stored at match creation time with candidate title, artist, album, durationMs).
   - Resolve `playlistName` by joining `playlistTracks` -> `playlists` to find which playlist(s) this track belongs to. Use the first playlist name found.

4. Sort by `parkedAt` ascending (oldest first -- FIFO review).

5. Return `PendingReview[]`.

**SQL pattern (conceptual):**

```sql
SELECT m.*, t.title, t.artist, t.album, t.durationMs, t.isrc
FROM matches m
JOIN tracks t ON t.id = m.sourceId
WHERE m.status = 'pending'
  AND m.sourceType = 'spotify'
  AND m.targetType = 'lexicon'
ORDER BY m.parked_at ASC
```

With optional playlist filter:

```sql
  AND m.sourceId IN (
    SELECT trackId FROM playlist_tracks WHERE playlistId = ?
  )
```

### confirm(matchId)

Confirms a single pending match.

**Algorithm:**

1. Fetch the match row by `id = matchId`. Throw if not found.
2. Verify `status === "pending"`. Throw if already confirmed or rejected (idempotent confirms are allowed -- if status is already "confirmed", no-op and return).
3. Update match: `status = "confirmed"`, `updatedAt = Date.now()`.
4. The track will be tagged on the **next sync run** when `matchPlaylist()` finds it as a confirmed match and calls `syncTags()`.

### reject(matchId)

Rejects a single pending match and auto-queues a download.

**Algorithm:**

1. Fetch the match row by `id = matchId`. Throw if not found.
2. Verify `status === "pending"`. If already rejected, no-op and return.
3. Update match: `status = "rejected"`, `updatedAt = Date.now()`.
4. **Auto-queue download**: insert a row into `downloads` table:
   - `trackId`: `match.sourceId` (the Spotify track that needs downloading)
   - `status`: `"pending"`
   - `origin`: `"review_rejected"`
   - `createdAt`: `Date.now()`

This ensures that rejecting a match automatically feeds the track into the download pipeline (spec-15) for Soulseek search.

### bulkConfirm(matchIds)

Confirms multiple matches in a single operation.

**Algorithm:**

1. For each matchId in `matchIds`, call `confirm(matchId)` (reuses single-item logic including validation).
2. Count successful confirmations (skip already-confirmed matches without error).
3. Return `{ confirmed: count }`.

**Optimization note:** Could be implemented as a single `UPDATE ... WHERE id IN (...)` for performance, but the per-item validation provides better error messages. For MVP, iterate; optimize later if review queues grow large.

### bulkReject(matchIds)

Rejects multiple matches and auto-queues downloads for each.

**Algorithm:**

1. For each matchId in `matchIds`, call `reject(matchId)` (reuses single-item logic including download queueing).
2. Count successful rejections and downloads queued.
3. Return `{ rejected: count, downloadsQueued: count }`.

`downloadsQueued` should equal `rejected` in normal operation (one download per rejection).

### getStats()

Returns aggregate counts of matches by status.

**SQL pattern:**

```sql
SELECT
  SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
  SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
  SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
FROM matches
WHERE sourceType = 'spotify' AND targetType = 'lexicon'
```

Returns `{ pending: number, confirmed: number, rejected: number }`.

## Error Handling

| Scenario | Behavior |
|---|---|
| Match not found | `confirm()` and `reject()` throw `Error("Match not found: {matchId}")` |
| Already confirmed | `confirm()` is a no-op (idempotent). Returns without error. |
| Already rejected | `reject()` is a no-op (idempotent). Returns without error. Does NOT create a duplicate download entry. |
| Invalid match status (not pending, confirmed, or rejected) | Treated as an error: throw `Error("Unexpected match status: {status}")` |
| Bulk operation with invalid IDs | Each item is processed independently. Invalid IDs throw; the error is caught and the item is skipped. Counts reflect only successful operations. |
| Download insert conflict | If a download entry already exists for this track with origin "review_rejected", skip insertion (use `INSERT OR IGNORE` or conflict check). |
| Empty matchIds array | `bulkConfirm([])` returns `{ confirmed: 0 }`. `bulkReject([])` returns `{ rejected: 0, downloadsQueued: 0 }`. |
| DB connection error | Propagated to caller. |

## Tests

### Test approach

- **db**: in-memory Drizzle SQLite instance with schema applied.
- Pre-seed test data: tracks, playlists, playlistTracks, matches with various statuses.
- No external service mocks needed (ReviewService is DB-only).

### Key test scenarios

#### getPending

1. **Returns only pending matches**: seed 3 matches (1 pending, 1 confirmed, 1 rejected). Verify only 1 returned.

2. **Filtered by playlist**: seed 2 pending matches for different playlists. Filter by playlistId. Verify only matching playlist's matches returned.

3. **Includes track details**: verify `spotifyTrack` has title, artist, album from the tracks table. Verify `lexiconTrack` has details from match metadata.

4. **Sorted by parkedAt ASC**: seed 3 pending matches with different `parked_at` values. Verify FIFO order.

5. **Empty result**: no pending matches. Returns `[]`.

6. **Playlist name resolution**: track belongs to 2 playlists. Verify `playlistName` is populated (first found).

#### confirm

7. **Confirms pending match**: status changes to "confirmed", `updatedAt` updated.

8. **Idempotent on confirmed**: confirm an already-confirmed match. No error, no state change.

9. **Match not found**: throws error.

10. **Does not create download entry**: verify no row added to downloads table.

#### reject

11. **Rejects pending match**: status changes to "rejected", `updatedAt` updated.

12. **Auto-queues download**: verify a download row inserted with `origin = "review_rejected"`, `status = "pending"`, correct `trackId`.

13. **Idempotent on rejected**: reject an already-rejected match. No error, no duplicate download entry.

14. **Match not found**: throws error.

#### bulkConfirm

15. **Confirms multiple**: 3 pending matches. Verify all confirmed. Returns `{ confirmed: 3 }`.

16. **Skips already confirmed**: 2 pending + 1 already confirmed. Returns `{ confirmed: 2 }` (the confirmed one is a no-op, counted or not based on implementation).

17. **Empty array**: returns `{ confirmed: 0 }`.

#### bulkReject

18. **Rejects multiple with downloads**: 3 pending matches. All rejected. Returns `{ rejected: 3, downloadsQueued: 3 }`.

19. **Mixed validity**: 2 valid pending + 1 invalid ID. Valid ones rejected, invalid skipped. Returns `{ rejected: 2, downloadsQueued: 2 }`.

20. **Empty array**: returns `{ rejected: 0, downloadsQueued: 0 }`.

#### getStats

21. **Correct counts**: seed 5 pending, 3 confirmed, 2 rejected. Verify `{ pending: 5, confirmed: 3, rejected: 2 }`.

22. **Empty table**: returns `{ pending: 0, confirmed: 0, rejected: 0 }`.

23. **Filters to spotify-lexicon matches only**: seed a "soulseek" match. Verify it is not counted.

## Acceptance Criteria

- [ ] `ReviewService` class with constructor taking `Config` and optional `ReviewServiceDeps`
- [ ] `getPending()` returns pending matches sorted by `parked_at` ASC (FIFO)
- [ ] `getPending(playlistId)` filters to tracks belonging to the specified playlist
- [ ] `PendingReview` includes `matchId`, `spotifyTrack`, `lexiconTrack`, `score`, `confidence`, `method`, `playlistName`, `parkedAt`
- [ ] `confirm()` sets match status to "confirmed"
- [ ] `confirm()` is idempotent on already-confirmed matches
- [ ] `reject()` sets match status to "rejected"
- [ ] `reject()` auto-creates a download entry with `origin = "review_rejected"` and `status = "pending"`
- [ ] `reject()` is idempotent on already-rejected matches (no duplicate download)
- [ ] `bulkConfirm()` confirms multiple matches, returns `{ confirmed: number }`
- [ ] `bulkReject()` rejects multiple matches, returns `{ rejected: number, downloadsQueued: number }`
- [ ] `getStats()` returns `{ pending, confirmed, rejected }` counts for spotify-lexicon matches
- [ ] Review is fully decoupled from sync sessions -- no reference to SyncPipeline
- [ ] Confirmed matches are tagged on **next sync run** (not by ReviewService)
- [ ] All errors handled per Error Handling table
- [ ] Unit tests with in-memory DB covering all scenarios
