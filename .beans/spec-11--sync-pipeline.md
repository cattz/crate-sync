---
# spec-11
title: "Sync pipeline"
status: todo
type: task
priority: critical
parent: spec-E2
depends_on: spec-09, spec-10, spec-04
created_at: 2026-03-29T00:00:00Z
updated_at: 2026-03-29T00:00:00Z
---

## Purpose

`SyncPipeline` orchestrates the match-and-tag lifecycle for a single playlist. It matches Spotify tracks against the Lexicon library, tags confirmed matches immediately, parks pending matches for async review, and returns not-found tracks for the caller to queue for download. The pipeline is **non-blocking** -- it never waits for review. It composes lower-level services (DB, LexiconService, matching engine) without implementing business logic itself. All external dependencies are injectable via `SyncPipelineDeps`.

Key behavioral changes from old design:
- **No Lexicon playlists** -- only tags. No `syncToLexicon()`.
- **No blocking review phase** -- no `applyReviewDecisions()`. Review is handled by ReviewService (spec-12).
- **No download orchestration** -- no `downloadMissing()`. Download is handled by the download pipeline (spec-15).
- **Category-scoped tagging** -- only touches the configured tag category, preserves all others.
- **Rejection memory** -- consults matches table for rejected pairs, skips and tries next-best candidate.

## Public Interface

### Dependency injection

```ts
export interface SyncPipelineDeps {
  db?: ReturnType<typeof getDb>;
  lexiconService?: LexiconService;
}
```

### Types

```ts
export interface MatchedTrack {
  dbTrackId: string;
  track: TrackInfo;
  lexiconTrackId?: string;
  lexiconTrack?: TrackInfo;
  score: number;
  confidence: "high" | "review" | "low";
  method: string;
}

export interface MatchPlaylistResult {
  playlistName: string;
  confirmed: MatchedTrack[];
  pending: MatchedTrack[];
  notFound: Array<{ dbTrackId: string; track: TrackInfo }>;
  total: number;
  tagged: number;
}

export interface TagResult {
  tagged: number;
  skipped: number;
}
```

### SyncPipeline class

```ts
class SyncPipeline {
  constructor(config: Config, deps?: SyncPipelineDeps)

  async matchPlaylist(playlistId: string): Promise<MatchPlaylistResult>

  async syncTags(
    playlistName: string,
    confirmedTracks: MatchedTrack[],
    manualTags?: string[]
  ): Promise<TagResult>

  async dryRun(playlistId: string): Promise<MatchPlaylistResult>
}
```

## Dependencies

| Import | Source |
|---|---|
| `eq`, `and`, `sql` | `drizzle-orm` |
| `Config` | `../config.js` |
| `TrackInfo` | `../types/common.js` |
| `getDb` | `../db/client.js` |
| `playlists`, `playlistTracks`, `tracks`, `matches` (via `* as schema`) | `../db/schema.js` |
| `createMatcher` | `../matching/index.js` |
| `LexiconService` | `./lexicon-service.js` |

## Behavior

### Constructor

Accepts `Config` and optional `SyncPipelineDeps`. Stores deps (defaults to `{}`). Two private getters lazily resolve dependencies:

- `getDb()` -- returns `deps.db ?? getDb()` (global singleton fallback)
- `getLexiconService()` -- returns `deps.lexiconService ?? new LexiconService(config.lexicon)`

### matchPlaylist(playlistId)

The main entry point. Matches, persists results, tags confirmed tracks, returns summary.

**Algorithm:**

1. **Fetch playlist metadata** from DB via `db.query.playlists.findFirst()` where `id = playlistId`. Throws if not found.

2. **Fetch playlist tracks** from `playlistTracks` table, ordered by `position`. Extract track IDs.

3. **Load all track rows** from `tracks` table in one query. Build `Map<id, row>` for O(1) lookup.

4. **Get all Lexicon tracks** via `lexiconService.getTracks()`. Convert to `TrackInfo[]` candidates. Build `Map<lexiconId, TrackInfo>` for enrichment.

5. **Create matcher** via `createMatcher(config.matching, "lexicon")` -- produces an ISRC + Fuzzy composite matcher.

6. **Load existing matches** from `matches` table where `sourceType = "spotify"` and `targetType = "lexicon"`:
   - **Confirmed matches**: index by `sourceId`, keeping the most recent (by `updatedAt`) per source. These are reused directly (skip re-matching).
   - **Rejected pairs**: collect as `Set<"sourceId:targetId">`. Only that specific pair is blocked, not all future matching for the source track.

7. **Categorize each playlist track**:
   - If `trackMap` has no row for this ID, silently skip (`continue`).
   - If a confirmed match exists for this `dbTrackId`, push directly to `confirmed` array with stored match data. Skip matcher.
   - Otherwise, run `matcher.match(trackInfo, lexiconCandidates)` (returns results sorted by score descending).
   - Iterate results to find the best candidate whose `sourceId:targetId` pair is NOT in the rejected set.
   - If no viable match found: push to `notFound`.
   - If best match score >= `config.matching.autoAcceptThreshold` (0.9): push to `confirmed`.
   - If best match score >= `config.matching.reviewThreshold` (0.7): push to `pending` with `parked_at = Date.now()`.
   - Otherwise (< 0.7): push to `notFound`.

8. **Persist new matches** via upsert into `matches` table:
   - Conflict target: `(sourceType, sourceId, targetType, targetId)`.
   - Status derived from categorization: confirmed -> `"confirmed"`, pending -> `"pending"`, notFound -> `"rejected"`.
   - On conflict, update `score`, `confidence`, `method`, `updatedAt`.
   - **Never downgrade a confirmed match**: status uses SQL CASE: `CASE WHEN matches.status = 'confirmed' THEN 'confirmed' ELSE excluded.status END`.
   - For pending matches, persist `parked_at` timestamp.

9. **Tag confirmed tracks** by calling `syncTags(playlistName, confirmed, manualTags)` where `manualTags` comes from the playlist's local metadata (tags field). This tags immediately, no waiting.

10. **Return** `MatchPlaylistResult` with `playlistName`, `confirmed`, `pending`, `notFound`, `total`, and `tagged` count from syncTags.

### syncTags(playlistName, confirmedTracks, manualTags?)

Tags confirmed tracks in Lexicon under the configured tag category.

**Algorithm:**

1. **Extract tag labels from playlist name**: split `playlistName` by `"/"`, trim each segment, filter empty strings. Example: `"Electronic/House/Deep"` -> `["Electronic", "House", "Deep"]`.

2. **Merge manual tags**: if `manualTags` is provided, append them to the segment list. Deduplicate by value (case-sensitive).

3. If no tags to apply (empty after dedup), return `{ tagged: 0, skipped: 0 }`.

4. **Get LexiconService**. Read tag category config from `config.lexicon.tagCategory` (default: `{ name: "Spotify Playlists", color: "#1DB954" }`).

5. **Ensure tag category exists** via `lexiconService.ensureTagCategory(categoryName, categoryColor)`. Get `categoryId`.

6. **Ensure each tag exists** under the category via `lexiconService.ensureTag(categoryId, label)` for each tag label. Collect tag IDs.

7. **For each confirmed track with a `lexiconTrackId`**:
   - Call `lexiconService.setTrackCategoryTags(lexiconTrackId, categoryId, tagIds)`.
   - This is category-scoped: only modifies tags in our category, preserves all other categories.
   - Increment `tagged`.

8. Tracks without `lexiconTrackId` are skipped (increment `skipped`).

9. Return `{ tagged, skipped }`.

### dryRun(playlistId)

Performs matching only without tagging.

1. Runs the same algorithm as `matchPlaylist` steps 1-8 (match + persist).
2. **Does NOT call `syncTags()`** -- no Lexicon tags are written.
3. Returns `MatchPlaylistResult` with `tagged: 0`.

Match persistence still occurs so repeated dry runs benefit from the match cache and rejection memory.

## Error Handling

| Scenario | Behavior |
|---|---|
| Playlist not found in DB | `matchPlaylist` throws `Error("Playlist not found: {playlistId}")` |
| Lexicon unreachable | `getTracks()` throws; propagated to caller. No partial state stored. |
| No Lexicon match found | Track categorized as `notFound`. No match row written for that track (no target ID). |
| DB conflict on match upsert | Handled by `onConflictDoUpdate`. Never downgrades confirmed status. |
| Missing track row in `trackMap` | Silently skipped via `if (!row) continue`. |
| `syncTags` with no segments and no manual tags | Returns `{ tagged: 0, skipped: 0 }` immediately. |
| `syncTags` Lexicon API error | Individual track tagging errors caught and logged. Continues with remaining tracks. Returns partial `tagged` count. |
| All tracks already confirmed | No re-matching performed. `pending` and `notFound` are empty. Tags re-applied (idempotent). |
| Rejected pair encountered | Skipped; next-best candidate tried. If no viable candidates remain, track goes to `notFound`. |

## Tests

### Test approach

Mock all external dependencies via `SyncPipelineDeps`:
- **db**: in-memory Drizzle SQLite instance with schema applied
- **lexiconService**: mock `LexiconService` with stubbed `getTracks()`, `getTags()`, `ensureTagCategory()`, `ensureTag()`, `setTrackCategoryTags()`, `getTrackTags()`, `updateTrackTags()`

### Key test scenarios

#### matchPlaylist

1. **Correct categorization**: 3 tracks -- one high-confidence match (confirmed), one mid-confidence match (pending), one no match (notFound). Verify arrays and counts.

2. **Confirmed matches reused**: pre-insert a confirmed match in DB. Verify matcher is NOT called for that track and it appears in `confirmed`.

3. **Rejected pairs skipped, next-best used**: pre-insert a rejected match. Matcher returns the rejected candidate as best, plus a second candidate. Verify the rejected candidate is skipped and the second candidate is used.

4. **Rejected pair with no fallback**: pre-insert a rejected match. Matcher returns only the rejected candidate. Verify track goes to `notFound`.

5. **Upsert never downgrades confirmed status**: pre-insert a confirmed match. Re-run matchPlaylist. Verify match status is still "confirmed" in DB.

6. **Pending matches have parked_at**: verify that pending matches have a `parked_at` timestamp in the DB row.

7. **Playlist not found**: throws `Error("Playlist not found: ...")`.

8. **Missing track row**: track ID in playlistTracks but not in tracks table. Silently skipped, does not appear in any result array.

9. **Empty playlist**: returns all arrays empty, total = 0.

#### syncTags

10. **Tag extraction from playlist name**: `"Electronic/House/Deep"` produces 3 tags. Verify `ensureTag` called 3 times.

11. **Manual tags merged**: playlist name `"House"` with manualTags `["Energy/High", "DJ Set"]`. Produces tags `["House", "Energy/High", "DJ Set"]`.

12. **Manual tags deduplicated**: playlist name `"House"` with manualTags `["House"]`. Only 1 tag.

13. **Category ensured once**: verify `ensureTagCategory("Spotify Playlists", "#1DB954")` called once regardless of track count.

14. **Category-scoped tagging**: verify `setTrackCategoryTags` called (not `updateTrackTags` directly). Confirms category isolation.

15. **Tracks without lexiconTrackId skipped**: 2 confirmed tracks, one without `lexiconTrackId`. Verify `tagged: 1, skipped: 1`.

16. **Empty playlist name segments**: `"//"` -> no tags -> returns `{ tagged: 0, skipped: 0 }`.

17. **Lexicon API error on individual track**: one track's tagging fails with an error. Pipeline continues, tags remaining tracks. Returns partial `tagged` count.

#### dryRun

18. **Match persistence occurs**: verify matches are written to DB.

19. **No tagging**: verify `syncTags` / `ensureTagCategory` / `setTrackCategoryTags` are NOT called.

20. **Returns tagged: 0**: verify `MatchPlaylistResult.tagged === 0`.

#### Integration flow

21. **Full flow**: matchPlaylist with 5 tracks. 3 confirmed, 1 pending, 1 notFound. Verify:
    - 3 tracks tagged in Lexicon
    - 1 match row with status "pending" and parked_at
    - 1 track in notFound
    - Return object has correct counts

## Acceptance Criteria

- [ ] `SyncPipelineDeps` interface with optional `db`, `lexiconService` (no `downloadService`)
- [ ] Constructor accepts `Config` + optional `SyncPipelineDeps`
- [ ] `matchPlaylist()` fetches playlist + tracks from DB, loads Lexicon tracks, creates ISRC+Fuzzy composite matcher
- [ ] Confirmed matches reused directly (no re-matching)
- [ ] Rejected pairs block only that specific source-target pair; next-best candidate tried
- [ ] Categorization: score >= 0.9 -> confirmed, 0.7-0.9 -> pending (with `parked_at`), <0.7 -> notFound
- [ ] Match upsert with conflict handling that never downgrades confirmed status
- [ ] Confirmed tracks tagged immediately via `syncTags()` inside `matchPlaylist()`
- [ ] `syncTags()` splits playlist name by "/", merges with manual tags, deduplicates
- [ ] `syncTags()` uses configurable tag category (default "Spotify Playlists" / "#1DB954")
- [ ] `syncTags()` calls `ensureTagCategory()` and `ensureTag()` for find-or-create
- [ ] `syncTags()` uses `setTrackCategoryTags()` for category-scoped tagging (preserves other categories)
- [ ] `dryRun()` matches and persists but does NOT tag
- [ ] No `applyReviewDecisions()` method (review is async via ReviewService)
- [ ] No `downloadMissing()` method (downloads handled by download pipeline)
- [ ] No `syncToLexicon()` method (no Lexicon playlists)
- [ ] Pipeline is non-blocking: returns confirmed + pending + notFound and exits
- [ ] All errors handled per Error Handling table
- [ ] Unit tests mock all deps via `SyncPipelineDeps`
