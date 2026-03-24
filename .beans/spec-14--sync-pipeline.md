---
# spec-14
title: Sync pipeline
status: todo
type: task
priority: critical
parent: spec-E4
depends_on: spec-10, spec-13, spec-07, spec-04
created_at: 2026-03-24T00:00:00Z
updated_at: 2026-03-24T00:00:00Z
---

## Purpose

`SyncPipeline` orchestrates the full sync lifecycle for a single playlist: match Spotify tracks against Lexicon, apply user review decisions, download missing tracks via Soulseek, sync the final track list to a Lexicon playlist, and assign custom tags. It is the central coordination layer that composes lower-level services (DB, LexiconService, DownloadService) without implementing business logic itself. All external dependencies are injectable via `SyncPipelineDeps` for testability.

## Public Interface

### Dependency injection

```ts
export interface SyncPipelineDeps {
  /** Override the DB instance (useful for tests). */
  db?: ReturnType<typeof getDb>;
  /** Override the LexiconService factory (useful for tests). */
  lexiconService?: LexiconService;
  /** Override the DownloadService factory (useful for tests). */
  downloadService?: DownloadService;
}
```

### Types

```ts
export interface MatchedTrack {
  dbTrackId: string;
  track: TrackInfo;
  lexiconTrackId?: string;
  /** The Lexicon candidate's details (for review UI comparison). */
  lexiconTrack?: TrackInfo;
  score: number;
  confidence: "high" | "review" | "low";
  method: string;
}

export interface PhaseOneResult {
  playlistName: string;
  found: MatchedTrack[];
  needsReview: MatchedTrack[];
  notFound: Array<{ dbTrackId: string; track: TrackInfo }>;
  total: number;
}

export interface ReviewDecision {
  dbTrackId: string;
  accepted: boolean;
}

export interface PhaseTwoResult {
  confirmed: MatchedTrack[];
  missing: Array<{ dbTrackId: string; track: TrackInfo }>;
}
```

### SyncPipeline class

```ts
class SyncPipeline {
  constructor(config: Config, deps?: SyncPipelineDeps)

  // Phase 1 - match
  async matchPlaylist(playlistId: string): Promise<PhaseOneResult>

  // Phase 2 - review
  applyReviewDecisions(phaseOne: PhaseOneResult, decisions: ReviewDecision[]): PhaseTwoResult

  // Phase 3 - download
  async downloadMissing(
    phaseTwo: PhaseTwoResult,
    playlistName: string,
    onProgress?: (completed: number, total: number, trackTitle: string, success: boolean, error?: string, meta?: {
      strategy?: string;
      strategyLog?: Array<{ label: string; query: string; resultCount: number }>;
      topCandidates?: Array<{ score: number; filename: string }>;
    }) => void,
    onReview?: DownloadReviewFn,
  ): Promise<{ succeeded: number; failed: number }>

  // Phase 3b - sync to Lexicon
  async syncToLexicon(playlistId: string, playlistName: string, allMatchedTrackIds: string[]): Promise<void>

  // Phase 4 - tag sync
  async syncTags(playlistName: string, confirmedTracks: MatchedTrack[]): Promise<{ tagged: number; skipped: number }>

  // Dry run (Phase 1 only, match persistence still occurs)
  async dryRun(playlistId: string): Promise<PhaseOneResult>
}
```

## Dependencies

| Import | Source |
|---|---|
| `eq`, `and`, `sql` | `drizzle-orm` |
| `Config` | `../config.js` |
| `TrackInfo` | `../types/common.js` |
| `getDb` | `../db/client.js` |
| `playlists`, `playlistTracks`, `tracks`, `matches`, `downloads`, `syncLog` (via `* as schema`) | `../db/schema.js` |
| `createMatcher` | `../matching/index.js` |
| `LexiconService` | `./lexicon-service.js` |
| `DownloadService`, `DownloadReviewFn` | `./download-service.js` |

## Behavior

### Constructor

Accepts `Config` and an optional `SyncPipelineDeps`. Stores deps (defaults to `{}`). Three private getters lazily resolve dependencies:

- `getDb()` — returns `deps.db ?? getDb()` (global singleton fallback)
- `getLexiconService()` — returns `deps.lexiconService ?? new LexiconService(config.lexicon)`
- `getDownloadService()` — returns `deps.downloadService ?? new DownloadService(config.soulseek, config.download, config.lexicon)`

### matchPlaylist(playlistId): Phase 1

Full algorithm:

1. **Fetch playlist metadata** from DB via `db.query.playlists.findFirst()` where `id = playlistId`. Throws if not found.
2. **Fetch playlist tracks** from `playlistTracks` table, ordered by `position`. Extract track IDs.
3. **Load all track rows** from `tracks` table in one query. Build `Map<id, row>` for O(1) lookup.
4. **Get all Lexicon tracks** via `lexiconService.getTracks()`. Convert to `TrackInfo[]` candidates. Build `Map<lexiconId, TrackInfo>` for review UI enrichment.
5. **Create matcher** via `createMatcher(config.matching, "lexicon")` — produces an ISRC + Fuzzy composite matcher.
6. **Load existing matches** from `matches` table where `sourceType = "spotify"` and `targetType = "lexicon"`:
   - **Confirmed matches**: index by `sourceId`, keeping the most recent (by `updatedAt`) per source. These are reused directly (skip re-matching).
   - **Rejected pairs**: collect as `Set<"sourceId:targetId">`. Only that specific pair is blocked, not all future matching for the source track.
7. **Categorize each playlist track**:
   - If a confirmed match exists for this `dbTrackId`, push directly to `found` array with the stored match data. Skip matcher.
   - Otherwise, run `matcher.match(trackInfo, lexiconCandidates)` which returns results sorted by score descending.
   - Iterate results to find the best candidate whose `sourceId:targetId` pair is not in the rejected set.
   - If no viable match found, push to `notFound`.
   - If best match has `confidence === "high"`, push to `found`.
   - If best match has `confidence === "review"`, push to `needsReview`.
   - Otherwise (low/none), push to `notFound`.
   - Queue a new match row for persistence with status derived from confidence: `high -> "confirmed"`, `review -> "pending"`, `low -> "rejected"`.
8. **Persist new matches** via upsert. Conflict target: `(sourceType, sourceId, targetType, targetId)`. On conflict, update `score`, `confidence`, `method`, and `updatedAt`, but **never downgrade a confirmed match** — status uses SQL CASE: `CASE WHEN matches.status = 'confirmed' THEN 'confirmed' ELSE excluded.status END`.
9. **Return** `PhaseOneResult` with `playlistName`, `found`, `needsReview`, `notFound`, `total`.

### applyReviewDecisions(phaseOne, decisions): Phase 2

Synchronous method (DB writes use `.run()` not `await`).

1. Build a `Map<dbTrackId, accepted>` from decisions.
2. Start with `confirmed = [...phaseOne.found]` and `missing = [...phaseOne.notFound]`.
3. For each item in `phaseOne.needsReview`:
   - If `accepted === true`: push to `confirmed`. Update match status to `"confirmed"` in DB.
   - Otherwise (rejected or no decision): push to `missing`. Update match status to `"rejected"` in DB.
4. DB updates use `.where(and(sourceType="spotify", sourceId=dbTrackId, targetType="lexicon", targetId=lexiconTrackId))`.
5. Return `{ confirmed, missing }`.

### downloadMissing(phaseTwo, playlistName, onProgress?, onReview?): Phase 3

1. Get `downloadService`. Call `ensurePlaylistFolder(playlistName)` to create the folder up front.
2. Map `phaseTwo.missing` to `batchItems` array of `{ track, dbTrackId, playlistName }`.
3. Call `downloadService.downloadBatch(batchItems, progressCallback, onReview)`.
4. The progress callback increments `succeeded`/`failed` counters and delegates to the caller's `onProgress` with `(done, total, title, success, error, { strategy, strategyLog })`.
5. After batch completes, insert a `downloads` record for each result: `{ trackId, status: success ? "done" : "failed", filePath, error, startedAt: Date.now(), completedAt: Date.now() }`.
6. Return `{ succeeded, failed }`.

### syncToLexicon(playlistId, playlistName, allMatchedTrackIds): Phase 3b

1. Get `lexiconService`. Check if a Lexicon playlist with `playlistName` already exists via `getPlaylistByName()`.
2. If exists: call `setPlaylistTracks(existingId, allMatchedTrackIds)` to replace the full track list.
3. If not: call `createPlaylist(playlistName, allMatchedTrackIds)`.
4. Insert a `syncLog` row: `{ playlistId, action: "sync_to_lexicon", details: 'Synced N tracks to Lexicon playlist "name"' }`.

### syncTags(playlistName, confirmedTracks): Phase 4

1. Split `playlistName` by `"/"`, trim each segment, filter empty. Return `{ tagged: 0, skipped: 0 }` if no segments.
2. Get `lexiconService`. Fetch all categories and tags via `getTags()`.
3. Find or create a `"Spotify"` tag category (color: `"#1DB954"`).
4. For each segment, find or create a tag under the Spotify category.
5. For each confirmed track with a `lexiconTrackId`:
   - Fetch existing tags via `getTrackTags(lexiconTrackId)`.
   - Compute union of existing + new segment tag IDs.
   - If union is larger than existing set, call `updateTrackTags(lexiconTrackId, [...merged])`. Increment `tagged`.
   - Otherwise increment `skipped`.
6. Tracks without `lexiconTrackId` are skipped.
7. Return `{ tagged, skipped }`.

### dryRun(playlistId)

Delegates to `matchPlaylist(playlistId)`. Identical behavior — match persistence still occurs so repeated dry runs benefit from cache. Returns `PhaseOneResult`.

## Error Handling

| Scenario | Behavior |
|---|---|
| Playlist not found in DB | `matchPlaylist` throws `Error("Playlist not found: {playlistId}")` |
| Lexicon unreachable | `getTracks()` throws; propagated to caller. No partial state stored. |
| Download failures | Individual failures tracked per-item. `downloadMissing` returns aggregate counts. Download records persisted with `status: "failed"` and `error` message. |
| No Lexicon match found | Track categorized as `notFound`. No match row written (no `lexiconTrackId`). |
| All search strategies exhausted | `downloadBatch` reports failure for that track via callback. |
| DB conflict on match upsert | Handled by `onConflictDoUpdate`. Never downgrades confirmed status. |
| Missing track row in `trackMap` | Silently skipped via `if (!row) continue` in the categorization loop. |
| No confirmed matches for syncToLexicon | Caller passes empty array; Lexicon service handles accordingly. |
| `syncTags` with no segments | Returns `{ tagged: 0, skipped: 0 }` immediately. |

## Tests

### Test approach

Mock all external dependencies via `SyncPipelineDeps`:
- **db**: in-memory Drizzle SQLite instance with schema applied
- **lexiconService**: mock `LexiconService` with stubbed `getTracks()`, `getPlaylistByName()`, `createPlaylist()`, `setPlaylistTracks()`, `getTags()`, `createTagCategory()`, `createTag()`, `getTrackTags()`, `updateTrackTags()`
- **downloadService**: mock `DownloadService` with stubbed `ensurePlaylistFolder()`, `downloadBatch()`

### Key test scenarios

- **matchPlaylist**: correct categorization into found/needsReview/notFound based on matcher confidence thresholds
- **matchPlaylist**: confirmed matches are reused without re-running the matcher
- **matchPlaylist**: rejected pairs are skipped, next-best candidate used
- **matchPlaylist**: upsert never downgrades confirmed status (verify SQL CASE)
- **matchPlaylist**: playlist not found throws
- **applyReviewDecisions**: accepted items move to confirmed, rejected to missing
- **applyReviewDecisions**: DB updates correct match status
- **downloadMissing**: playlist folder created before any downloads
- **downloadMissing**: progress callback invoked with correct counts and metadata
- **downloadMissing**: download records persisted for both succeeded and failed
- **syncToLexicon**: creates new playlist when none exists
- **syncToLexicon**: replaces tracks in existing playlist
- **syncToLexicon**: syncLog row inserted
- **syncTags**: creates Spotify category + segment tags when missing
- **syncTags**: merges new tags with existing (union), skips when no new tags
- **syncTags**: tracks without lexiconTrackId are skipped
- **dryRun**: produces same result as matchPlaylist

## Acceptance Criteria

- [ ] `SyncPipelineDeps` interface with optional `db`, `lexiconService`, `downloadService`
- [ ] Constructor accepts `Config` + optional `SyncPipelineDeps`, defaults to empty
- [ ] `matchPlaylist()` fetches playlist + tracks from DB, loads Lexicon tracks, creates ISRC+Fuzzy composite matcher
- [ ] Confirmed matches reused directly (no re-matching)
- [ ] Rejected pairs block only that specific source-target pair
- [ ] Categorization: high -> found, review -> needsReview, low/none -> notFound
- [ ] Match upsert with conflict handling that never downgrades confirmed status
- [ ] `applyReviewDecisions()` updates match status and returns `{confirmed, missing}`
- [ ] `downloadMissing()` creates playlist folder, runs batch download, persists download records, returns `{succeeded, failed}`
- [ ] `syncToLexicon()` creates or updates Lexicon playlist, logs to syncLog
- [ ] `syncTags()` parses playlist name by "/", finds/creates "Spotify" category (#1DB954), creates tags per segment, assigns to tracks via union merge
- [ ] `dryRun()` delegates to `matchPlaylist()` and returns `PhaseOneResult`
- [ ] All errors handled per Error Handling table
- [ ] Unit tests mock all deps via `SyncPipelineDeps`
