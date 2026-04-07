---
# spec-15
title: "Download pipeline"
status: completed
type: task
priority: high
parent: spec-E3
depends_on: spec-13, spec-14, spec-09, spec-04
created_at: 2026-03-29T00:00:00Z
updated_at: 2026-03-29T00:00:00Z
---

## Purpose

Orchestrates the full download pipeline for acquiring music files from Soulseek: search with multi-strategy queries, rank results (filtering out previously rejected files), download the best candidate, validate audio metadata with configurable strictness, and move the file to `Lexicon/Incoming/{playlist-name}/`. This is a pipeline-only service -- downloads are only triggered by the sync pipeline's unmatched tracks (spec-11) or review rejections (spec-12). There is no standalone "download this track" capability. Failed downloads stay failed; a manual `wishlist run` command re-queues eligible failed jobs.

## Public Interface

### File: `src/services/download-pipeline.ts`

### Type Definitions

```ts
export interface RankedResult {
  file: SlskdFile;
  score: number;
}

export interface DownloadResult {
  trackId: string;
  success: boolean;
  filePath?: string;
  error?: string;
  /** Which query strategy succeeded (if any). */
  strategy?: string;
  /** All strategies tried and their result counts. */
  strategyLog?: Array<{ label: string; query: string; resultCount: number }>;
}

export interface DownloadItem {
  track: TrackInfo;
  dbTrackId: string;
  playlistName: string;
}

export type ValidationStrictness = "strict" | "moderate" | "lenient";
```

### Constructor

```ts
class DownloadPipeline {
  private readonly db: Database;
  private readonly soulseek: SoulseekService;
  private readonly matcher: FuzzyMatchStrategy;
  private readonly allowedFormats: Set<string>;
  private readonly minBitrate: number;
  private readonly concurrency: number;
  private readonly downloadRoot: string;
  private readonly slskdDownloadDir: string;
  private readonly validationStrictness: ValidationStrictness;

  constructor(
    db: Database,
    soulseekConfig: SoulseekConfig,
    downloadConfig: DownloadConfig,
    lexiconConfig: LexiconConfig,
  );
}
```

The constructor takes a DB instance (for rejection memory queries) and three config objects:

- **`db: Database`**: SQLite database for querying the `rejections` table during ranking and writing new rejection entries.
- **`soulseekConfig: SoulseekConfig`**: `{ slskdUrl, slskdApiKey, searchDelayMs, downloadDir }`. Used to instantiate a `SoulseekService` and to resolve the slskd download directory on the host filesystem.
- **`downloadConfig: DownloadConfig`**: `{ formats: string[], minBitrate: number, concurrency: number, validationStrictness: ValidationStrictness }`. Configures file filtering, batch concurrency, and validation behavior.
- **`lexiconConfig: LexiconConfig`**: `{ url, downloadRoot }`. The `downloadRoot` is the Lexicon incoming folder root (files go to `<downloadRoot>/<playlistName>/`).

Internal initialization:
- `this.db = db`
- `this.soulseek = new SoulseekService(soulseekConfig)` -- creates the slskd HTTP client.
- `this.matcher = new FuzzyMatchStrategy({ autoAcceptThreshold: 0.9, reviewThreshold: 0.7, context: "soulseek", artistRejectThreshold: 0.3 })` -- creates a fuzzy matcher with soulseek-optimized weights (title: 0.3, artist: 0.25, album: 0.1, duration: 0.35).
- `this.allowedFormats = new Set(downloadConfig.formats.map(f => f.toLowerCase()))` -- normalizes format list to lowercase set.
- `this.minBitrate = downloadConfig.minBitrate` -- minimum bitrate threshold in kbps.
- `this.concurrency = downloadConfig.concurrency` -- max concurrent downloads in batch mode.
- `this.downloadRoot = lexiconConfig.downloadRoot` -- base directory for final file placement.
- `this.slskdDownloadDir = soulseekConfig.downloadDir` -- host path where slskd stores completed downloads.
- `this.validationStrictness = downloadConfig.validationStrictness` -- "strict", "moderate", or "lenient".

### `downloadBatch(items: DownloadItem[], onProgress?: (completed: number, total: number, result: DownloadResult) => void): Promise<DownloadResult[]>`

Downloads a batch of tracks through the full pipeline. This is the primary entry point -- called by the sync pipeline for unmatched tracks and by the review service for rejected matches.

### `rankResults(files: SlskdFile[], track: TrackInfo, trackId: string): { ranked: RankedResult[]; diagnostics: string }`

Filters and ranks Soulseek search results against an expected track, excluding previously rejected files.

### `searchAndRank(track: TrackInfo, trackId: string): Promise<{ ranked: RankedResult[]; diagnostics: string; strategy?: string; strategyLog: Array<{ label: string; query: string; resultCount: number }> }>`

Searches Soulseek using the multi-strategy query builder (spec-13) and ranks results.

### `searchAndRankBatch(items: DownloadItem[]): Promise<Map<string, { ranked: RankedResult[]; diagnostics: string; strategy?: string; strategyLog?: Array<...> }>>`

Batch search optimization: POSTs all searches upfront using strategy 1, polls concurrently, falls back to sequential multi-strategy for tracks with 0 results.

## Dependencies

| Module | Dependency | Kind |
|---|---|---|
| `download-pipeline.ts` | `node:fs` (`mkdirSync`, `renameSync`, `copyFileSync`, `unlinkSync`, `existsSync`, `readdirSync`, `statSync`) | runtime import |
| `download-pipeline.ts` | `node:path` (`extname`, `join`, `basename`, `dirname`) | runtime import |
| `download-pipeline.ts` | `music-metadata` (`parseFile`) | runtime import |
| `download-pipeline.ts` | `../config.js` (`SoulseekConfig`, `DownloadConfig`, `LexiconConfig`) | type-only import |
| `download-pipeline.ts` | `../types/common.js` (`TrackInfo`) | type-only import |
| `download-pipeline.ts` | `../types/soulseek.js` (`SlskdFile`) | type-only import |
| `download-pipeline.ts` | `./soulseek-service.js` (`SoulseekService`) | runtime import |
| `download-pipeline.ts` | `../matching/fuzzy.js` (`FuzzyMatchStrategy`) | runtime import |
| `download-pipeline.ts` | `../utils/shutdown.js` (`isShutdownRequested`) | runtime import |
| `download-pipeline.ts` | `../utils/logger.js` (`createLogger`) | runtime import |
| `download-pipeline.ts` | `../search/query-builder.js` (`generateSearchQueries`, `QueryStrategy`) | runtime + type import |
| `download-pipeline.ts` | `../db/database.js` (`Database`) | runtime import |

### Service Dependencies (spec references)

- **SoulseekService (spec-14)**: HTTP client for slskd API. Methods used: `rateLimitedSearch(query)`, `startSearchBatch(queries)`, `waitForSearchBatch(entries)`, `download(username, filename, size)`, `waitForDownload(username, filename)`.
- **FuzzyMatchStrategy (spec-09)**: Fuzzy matching with soulseek weight profile. Methods used: `match(expected, candidates)`.
- **Query builder (spec-13)**: `generateSearchQueries(track)` for multi-strategy search.
- **Database (spec-04)**: `rejections` table for rejection memory. Read during ranking, written on validation failure.
- **Shutdown utility (spec-05)**: `isShutdownRequested()` for graceful batch interruption.
- **Logger utility (spec-05)**: `createLogger("download")` for structured debug/info logging.

## Behavior

### Rejection Memory

The pipeline consults the `rejections` table to avoid re-downloading files that have previously failed validation or been manually rejected. The rejection key is `(track_id, "soulseek_download", file_key)` where `file_key = username + ":" + filepath`.

**Reading rejections** (`getRejectionsForTrack`, private):
```ts
private getRejectionsForTrack(trackId: string): Set<string>
```
Queries `SELECT file_key FROM rejections WHERE track_id = ? AND context = 'soulseek_download'`. Returns a `Set<string>` of rejected file keys for fast lookup during ranking.

**Writing rejections** (`recordRejection`, private):
```ts
private recordRejection(trackId: string, file: SlskdFile, reason: string): void
```
Inserts into `rejections` table: `{ id: uuid(), track_id: trackId, context: "soulseek_download", file_key: username + ":" + filename, reason, created_at: Date.now() }`. Uses `INSERT OR IGNORE` to handle the unique constraint `(track_id, context, file_key)`.

### `rankResults(files: SlskdFile[], track: TrackInfo, trackId: string): { ranked: RankedResult[]; diagnostics: string }`

Pure filtering + scoring (aside from the rejection lookup). Filters and ranks Soulseek search results against an expected track.

**Pipeline:**

1. **Rejection filter**: Load `rejectedKeys = this.getRejectionsForTrack(trackId)`. Remove files where `username + ":" + filename` is in the rejected set. Track count as `rejectionFiltered`.

2. **Format filter**: Keep only files whose extension (lowercase, without dot) is in `this.allowedFormats`. Extension is extracted via `extname(file.filename).toLowerCase()`, stripping the leading dot.

3. **Bitrate filter**: From format-filtered results, keep files where `bitRate == null` (no info) OR `bitRate >= this.minBitrate`. Files with known bitrate below the threshold are removed.

4. **Fuzzy match scoring**: For each surviving file:
   - Parse the filename into a `TrackInfo` via `trackInfoFromFilename(file.filename)`:
     - Take `basename(filename, extname(filename))`.
     - Strip leading track numbers: regex `/^\d+[\s.\-_]*[-.]?\s*/`.
     - Split on first ` - ` occurrence: left part is artist, right part is title.
     - Fallback: if no ` - ` found, the entire cleaned name becomes the title with empty artist.
   - If `file.length != null`, set `candidate.durationMs = file.length * 1000` (slskd provides duration in seconds).
   - Build `expected: TrackInfo` from the input track (title, artist, durationMs).
   - Call `this.matcher.match(expected, [candidate])`.
   - If matches returned (score >= 0.3 internal threshold of FuzzyMatchStrategy), push `{ file, score: matches[0].score }` to ranked.
   - If no matches returned, increment `artistRejected` counter (the artist gate in FuzzyMatchStrategy rejected it below `artistRejectThreshold: 0.3`).

5. **Sort**: `ranked.sort((a, b) => b.score - a.score)` -- descending by score.

6. **Build diagnostics string**: Comma-separated summary, e.g., `"150 results, 3 filtered by rejection memory, 12 filtered by format, 5 filtered by bitrate (<320kbps), 30 rejected by artist mismatch, 100 candidates"`. Zero counts are omitted.

### `searchAndRank(track: TrackInfo, trackId: string): Promise<{ ranked: RankedResult[]; diagnostics: string; strategy?: string; strategyLog: Array<{ label: string; query: string; resultCount: number }> }>`

Searches Soulseek using the multi-strategy query builder (spec-13) and ranks results.

**Pipeline:**

1. Call `generateSearchQueries(track)` to get ordered strategies (full, base-title, title-only, keywords).
2. For each strategy in order:
   - Call `this.soulseek.rateLimitedSearch(strategy.query)` -- respects `searchDelayMs` between searches.
   - Call `this.rankResults(files, track, trackId)` on returned files.
   - Push `{ label, query, resultCount: result.ranked.length }` to `strategyLog`.
   - If `result.ranked.length > 0`: return immediately with `{ ...result, strategy: strategy.label, strategyLog }`. Logs top 5 candidates at debug level (score, filename, parsed title/artist, bitrate, username).
   - If `result.ranked.length === 0`: log debug and continue to next strategy.
3. If all strategies exhausted: return `{ ranked: [], diagnostics: "0 results across N strategies", strategyLog }`.

### `searchAndRankBatch(items: DownloadItem[]): Promise<Map<string, { ranked: RankedResult[]; diagnostics: string; strategy?: string; strategyLog?: Array<...> }>>`

Batch search optimization: POSTs all searches upfront using strategy 1 ("full"), polls all concurrently, then falls back to sequential multi-strategy for tracks with 0 results.

**Pipeline:**

1. For each item, generate search queries and take `strategies[0]?.query` (or fallback `"${artist} ${title}"`). Map query -> item.
2. Call `this.soulseek.startSearchBatch(queries)` -- posts all searches with rate-limit delays, returns `Map<query, { searchId, startedAt }>`.
3. Call `this.soulseek.waitForSearchBatch(searchEntries)` -- polls all searches in a single loop until done/timeout.
4. For each item, rank the batch results via `this.rankResults(files, track, trackId)`.
5. Items with `ranked.length > 0` are stored in the results map with `strategy: "full"`.
6. Items with `ranked.length === 0` are collected into a `needsFallback` list.
7. For each fallback item, call `this.searchAndRank(track, trackId)` sequentially (tries all strategies).
8. Return the combined results map keyed by `dbTrackId`.

### `downloadBatch(items: DownloadItem[], onProgress?: (completed: number, total: number, result: DownloadResult) => void): Promise<DownloadResult[]>`

Downloads a batch of tracks with batch search, concurrency control, and progress reporting.

**Pipeline:**

1. **Early return**: if `items.length === 0`, return `[]`.

2. **Create playlist folders upfront**: collect unique `playlistName` values, call `ensurePlaylistFolder` for each. This makes folders visible in Lexicon/Incoming before any downloads complete.

3. **Batch search**: call `searchAndRankBatch(items)`. Returns a map of `dbTrackId -> { ranked, diagnostics, strategy, strategyLog }`.

4. **Download phase** with concurrency control:
   - Iterate all items. For each:
     - Check `isShutdownRequested()` -- break if true (graceful shutdown via SIGINT handler).
     - Call `downloadFromSearchResults(item, searchResult)` (private method that uses pre-computed search results).
     - Track as a `Promise`. Add to `pending` set.
     - When the promise resolves: push result, increment `completed`, call `onProgress`.
     - If `pending.size >= this.concurrency`: `await Promise.race(pending)` to wait for one slot to free up.
   - After loop: `await Promise.all(pending)` to flush remaining.

5. Return all results.

### `downloadFromSearchResults(item: DownloadItem, searchResult: { ranked: RankedResult[]; diagnostics: string; strategy?: string; strategyLog?: Array<...> }): Promise<DownloadResult>` (private)

Downloads a single track using pre-computed search results.

**Pipeline:**

1. If `ranked.length === 0`: return failure with error `"No matching files on Soulseek (${diagnostics})"` and `strategyLog`.
2. Take `best = ranked[0]`.
3. If `best.score < 0.3`: return failure with error `"Best match score too low: ${score}% -- \"${filename}\" (${diagnostics})"` and `strategy`, `strategyLog`.
4. Call `this.acquireAndMove(best.file, item.track, item.playlistName, item.dbTrackId)`.
5. Merge `strategy` and `strategyLog` into the result.
6. **Catch block**: any thrown error returns `{ trackId: dbTrackId, success: false, error: message }`.

### `acquireAndMove(file: SlskdFile, track: TrackInfo, playlistName: string, dbTrackId: string): Promise<DownloadResult>` (private)

Downloads a file (or reuses an existing download) and moves it to the playlist folder.

**Pipeline:**

1. Extract `{ username, filename, size }` from the `SlskdFile`.
2. **Check for existing download**: call `this.findDownloadedFile(username, filename)`.
   - `findDownloadedFile` (private) resolves the local path where slskd stored the file:
     - Strip the `@@share\` prefix from the filename: regex `/^@@[^\\\/]+[\\\/]/`.
     - Normalize backslashes to forward slashes.
     - Build expected path: `join(this.slskdDownloadDir, normalized)`.
     - Try exact match first (`existsSync`).
     - If not found, search the parent directory for files matching `${base}*${ext}` (slskd may append unique suffixes like `_639091878895823617`). Sort candidates by modification time (most recent first). Return first match or `null`.
3. If file exists: skip download, log debug.
4. If file doesn't exist:
   - Call `this.soulseek.download(username, filename, size)` -- POST to slskd API.
   - Call `this.soulseek.waitForDownload(username, filename)` -- poll until completed/errored/timeout (default 300s).
   - Recheck `this.findDownloadedFile(username, filename)`. If still not found: return failure `"Downloaded file not found in slskd download dir for: ${filename}"`.
5. **Validate**: call `this.validateDownload(tempPath, track, dbTrackId, file)`.
6. If invalid: return `{ trackId, success: false, filePath: tempPath, error: "Downloaded file failed metadata validation" }`.
7. **Move**: call `this.moveToPlaylistFolder(tempPath, playlistName, track)`.
8. Return `{ trackId, success: true, filePath: finalPath }`.
9. **Catch block**: return failure with error message.

### `validateDownload(filePath: string, expected: TrackInfo, trackId: string, file: SlskdFile): Promise<boolean>` (private)

Validates a downloaded file's audio metadata against the expected track info. Behavior depends on `this.validationStrictness`.

**Strict mode** (`"strict"`):
1. Parse the file with `music-metadata`'s `parseFile(filePath)`.
2. Build a `TrackInfo` from metadata tags: `{ title: common.title ?? "", artist: common.artist ?? "", album: common.album ?? undefined, durationMs: Math.round(format.duration * 1000) or undefined }`.
3. Run `this.matcher.match(expected, [tagTrack])`.
4. Check title similarity >= 0.7, artist similarity >= 0.5, and duration within 5 seconds (if both have duration).
5. If any check fails: call `this.recordRejection(trackId, file, "validation_failed")` and return `false`.
6. If `parseFile` throws (corrupt file, unrecognized format): record rejection with reason `"validation_failed"` and return `false`.

**Moderate mode** (`"moderate"`):
1. Parse the file with `parseFile(filePath)`.
2. Check that the file has a recognized audio format (`format.codec` is truthy).
3. Run basic metadata check: `this.matcher.match(expected, [tagTrack])` must return at least one match with `score > 0.5`.
4. If match fails: call `this.recordRejection(trackId, file, "validation_failed")` and return `false`.
5. If `parseFile` throws: record rejection and return `false`.

**Lenient mode** (`"lenient"`):
1. Parse the file with `parseFile(filePath)`.
2. Only check that parsing succeeds without throwing (file is not corrupt).
3. If `parseFile` throws: record rejection with reason `"validation_failed"` and return `false`.
4. Otherwise return `true` (no metadata matching).

### `moveToPlaylistFolder(tempPath: string, playlistName: string, track: TrackInfo): string` (private)

Moves a validated file to its final location under `Lexicon/Incoming/{playlist-name}/`.

**File naming convention**: `<Artist> - <Title>.<ext>`
- Artist and title are sanitized via `sanitize()` which replaces `/:*?"<>|\` with space, collapses multiple spaces, and trims.
- Extension is lowercase without dot.
- Full path: `<downloadRoot>/<sanitize(playlistName)>/<sanitize(artist)> - <sanitize(title)>.<ext>`.

**Move strategy**:
1. Create destination directory if it doesn't exist (`mkdirSync` with `recursive: true`).
2. Try `renameSync(tempPath, destPath)` -- fast same-filesystem move.
3. If `renameSync` throws (cross-device move): `copyFileSync(tempPath, destPath)` then `unlinkSync(tempPath)`.

Returns the final `destPath`.

### `ensurePlaylistFolder(playlistName: string): string` (private)

Creates the playlist destination folder under `downloadRoot` if it doesn't exist.
- Path: `join(this.downloadRoot, sanitize(playlistName))`.
- Uses `mkdirSync(destDir, { recursive: true })`.
- Returns the directory path.

## Search Strategy Cascade

The pipeline implements a cascading search strategy to maximize the chance of finding a track on Soulseek's P2P network:

1. **Full query** (`"Artist Title"`) -- most specific, best match quality.
2. **Base title** (`"Artist BaseTitle"`) -- strips remix/edit suffixes, finds the original track.
3. **Title only** (`"Title"`) -- handles artist name spelling differences.
4. **Keywords** (`"Artist Keyword1 Keyword2"`) -- handles very long titles.

Each strategy respects the `searchDelayMs` rate limit between slskd API calls (default 5000ms). The cascade short-circuits on the first strategy that produces ranked results.

## Batch Search Optimization

`searchAndRankBatch` optimizes for the common case (most tracks found with strategy 1) by:
1. POSTing all search requests upfront with rate-limit delays between POSTs.
2. Polling all searches in a single loop (via `SoulseekService.waitForSearchBatch`).
3. Only falling back to sequential multi-strategy search for tracks with zero results.

This reduces total search time from `O(N * strategies * searchDelay)` to approximately `O(N * searchDelay + fallback * strategies * searchDelay)`.

## Ranking Algorithm

The ranking combines rejection memory, format/bitrate filtering, and fuzzy matching:
1. **Rejection filter**: previously rejected files for this track (from the `rejections` table) are excluded upfront.
2. **Hard filters**: only allowed formats (default: flac, mp3) and minimum bitrate (default: 320kbps).
3. **Fuzzy scoring**: uses soulseek weight profile (title: 0.3, artist: 0.25, album: 0.1, duration: 0.35). Duration is heavily weighted because Soulseek metadata often has accurate duration info.
4. **Artist gate**: candidates with artist similarity < 0.3 are rejected outright (the `artistRejectThreshold` setting).
5. **Score threshold**: candidates must score >= 0.3 to be ranked (FuzzyMatchStrategy's `MIN_THRESHOLD`). Additionally, `downloadFromSearchResults` rejects the best match if `score < 0.3`.

## File Discovery and Naming

**Soulseek filename parsing** (`trackInfoFromFilename`):
- Input: full slskd path like `@@user\music\Artist\Album\01 - Title.flac`.
- Strip directory path (use `basename`) and extension.
- Strip leading track numbers: `/^\d+[\s.\-_]*[-.]?\s*/`.
- Split on first ` - `: left = artist, right = title.
- Fallback: entire cleaned string = title, artist = empty string.

**Final file naming** (`moveToPlaylistFolder`):
- Pattern: `<sanitize(artist)> - <sanitize(title)>.<ext>`.
- Sanitize: replace `/:*?"<>|\` with space, collapse spaces, trim.
- Placed under `<downloadRoot>/<sanitize(playlistName)>/`.

## Concurrency Control

`downloadBatch` uses a sliding-window concurrency model:
- Maintains a `pending: Set<Promise<void>>` of active downloads.
- Before adding a new download, checks `pending.size >= this.concurrency`.
- If at capacity: `await Promise.race(pending)` waits for one to complete.
- Each promise removes itself from `pending` via `.finally()`.
- After the loop: `await Promise.all(pending)` flushes remaining tasks.

Default concurrency is 3 (from `DownloadConfig.concurrency`).

## Graceful Shutdown

`downloadBatch` checks `isShutdownRequested()` before starting each new download in the loop. If shutdown is requested (SIGINT received), the loop breaks. In-flight downloads in the `pending` set are awaited but no new downloads are started.

## Error Handling

### `searchAndRank`
- Network errors from `soulseek.rateLimitedSearch` propagate up. The caller (`downloadFromSearchResults`) catches all errors.
- All strategies exhausted returns `{ ranked: [], diagnostics: "0 results across N strategies", strategyLog }` -- not an error, handled by caller.

### `downloadFromSearchResults`
- Wraps entire pipeline in try/catch. Any thrown error becomes `{ trackId, success: false, error: message }`.
- Zero results: `"No matching files on Soulseek (${diagnostics})"`.
- Score too low: `"Best match score too low: ${score}% -- \"${filename}\" (${diagnostics})"`.

### `acquireAndMove`
- Download timeout: `soulseek.waitForDownload` throws after 300s (default). Error message: `"Download timed out after ${timeoutMs}ms: ${username} / ${filename}"`.
- Download error state: throws `"Download failed with state \"${state}\": ${username} / ${filename}"`.
- Transfer not found: throws `"Transfer not found: ${username} / {filename}"`.
- File not found after download: returns failure `"Downloaded file not found in slskd download dir for: ${filename}"`.
- Validation failure: returns failure `"Downloaded file failed metadata validation"` with `filePath` set to the temp path. Rejection entry recorded.
- Move failure: `renameSync` throws -> falls back to `copyFileSync` + `unlinkSync`. If `copyFileSync` also fails, the error propagates.

### `validateDownload`
- `parseFile` throws (corrupt file, unsupported format): records rejection, returns `false`.
- Match below threshold (varies by strictness): records rejection, returns `false`.

### `findDownloadedFile` (private)
- Directory doesn't exist: returns `null`.
- `readdirSync` or `statSync` throws: sort comparison returns 0 (tolerant).

### `downloadBatch`
- Individual track errors are captured in `DownloadResult` and reported via `onProgress`. The batch does not abort on individual failures.
- Shutdown: breaks the loop, awaits in-flight tasks, returns partial results.

## Tests

Test framework: Vitest. Tests at `src/services/__tests__/download-pipeline.test.ts`.

### Test Approach

- **Mock `SoulseekService`**: mock `rateLimitedSearch`, `startSearchBatch`, `waitForSearchBatch`, `download`, `waitForDownload` methods. Control returned files, search timing, download states.
- **Mock `Database`**: mock rejection queries (`SELECT file_key FROM rejections ...`) and insertion (`INSERT INTO rejections ...`).
- **Mock filesystem**: mock `existsSync`, `mkdirSync`, `renameSync`, `copyFileSync`, `unlinkSync`, `readdirSync`, `statSync` from `node:fs`. Control file existence and directory listings.
- **Mock `music-metadata`**: mock `parseFile` to return controlled metadata for validation tests.
- **Mock `isShutdownRequested`**: control shutdown signal for graceful shutdown tests.

### Test Cases

#### `rankResults`

1. **Filters previously rejected files**: input 5 files, 2 match rejection keys in DB. Expect ranked list excludes the 2 rejected files. Diagnostics mentions "2 filtered by rejection memory".

2. **Filters by format**: input files with .flac, .mp3, .wav, .ogg. Allowed formats: ["flac", "mp3"]. Expect only .flac and .mp3 files in ranked results.

3. **Filters by bitrate**: files with bitRate 128, 320, null. minBitrate 320. Expect 128 filtered out, 320 and null kept.

4. **Scores via fuzzy match**: file with matching artist/title scores > 0.7. File with non-matching artist gets rejected (artist gate < 0.3).

5. **Sorts by score descending**: 3 files with different match quality. Verify ranked[0] has the highest score.

6. **Builds diagnostics string**: verify format includes result counts, rejection count, filter counts, artist rejection count.

7. **Converts file.length to durationMs**: file with `length: 240` (seconds). Verify candidate has `durationMs: 240000`.

8. **Empty input returns empty ranked**: `rankResults([], track, trackId)` returns `{ ranked: [], diagnostics: "0 results, 0 candidates" }`.

#### `searchAndRank`

9. **Returns results from first successful strategy**: mock `rateLimitedSearch` to return files on strategy 1 ("full"). Expect `strategy: "full"`, `strategyLog` has 1 entry.

10. **Falls back to next strategy on zero results**: mock first strategy returns 0 results, second strategy returns results. Expect `strategy: "base-title"`, `strategyLog` has 2 entries.

11. **All strategies exhausted**: mock all strategies return 0 results. Expect `ranked: []`, diagnostics mentions strategy count.

12. **strategyLog records all attempted strategies**: mock 3 strategies tried, results on 3rd. Expect `strategyLog.length === 3` with correct labels and result counts.

#### `downloadBatch`

13. **Processes all tracks**: 3 items, all succeed. Expect 3 results, all success.

14. **Concurrency limit respected**: 5 items, concurrency 2. Verify at most 2 downloads run simultaneously (mock downloads with delays, check pending set behavior).

15. **Progress callback called for each track**: mock `onProgress`. Verify called with incrementing `completed` and correct `total`.

16. **Graceful shutdown**: set `isShutdownRequested()` to return true after 2 downloads. Verify loop breaks, in-flight tasks complete, remaining tracks not started.

17. **Creates all playlist folders upfront**: 3 items across 2 playlists. Verify both folders created before any downloads start.

18. **Empty input returns empty array**: `downloadBatch([])` returns `[]`.

#### `downloadFromSearchResults`

19. **Full success pipeline**: mock search returns files, rank produces score > 0.3, download succeeds, validation passes, move succeeds. Expect `{ success: true, filePath: "...", strategy: "full" }`.

20. **No search results**: mock search returns empty. Expect `{ success: false, error: "No matching files..." }`.

21. **Score too low**: mock best score 0.2. Expect failure with "Best match score too low".

22. **Download timeout**: mock `waitForDownload` throws timeout error. Expect `{ success: false, error: "..." }`.

23. **Validation failure records rejection**: mock `validateDownload` returns false. Expect `{ success: false }` and verify rejection INSERT was called.

#### `acquireAndMove`

24. **Reuses existing download**: mock `findDownloadedFile` returns a path. Verify `soulseek.download` is NOT called. Validation and move still run.

25. **Downloads and finds file**: mock `findDownloadedFile` returns null first, then returns path after download. Verify full pipeline runs.

26. **File not found after download**: mock `findDownloadedFile` returns null even after download. Expect failure error.

#### `validateDownload`

27. **Strict mode -- valid metadata**: mock `parseFile` returns matching title/artist/duration within thresholds. Expect `true`.

28. **Strict mode -- title mismatch**: mock `parseFile` returns non-matching title. Expect `false`, rejection recorded.

29. **Strict mode -- duration off by >5s**: mock durations 240s vs 260s. Expect `false`, rejection recorded.

30. **Moderate mode -- valid with score > 0.5**: mock `parseFile` returns roughly matching metadata. Expect `true`.

31. **Moderate mode -- score below 0.5**: mock non-matching metadata. Expect `false`, rejection recorded.

32. **Lenient mode -- valid file**: mock `parseFile` succeeds. Expect `true` regardless of metadata content.

33. **Lenient mode -- corrupt file**: mock `parseFile` throws. Expect `false`, rejection recorded.

34. **All modes -- parseFile throws**: verify rejection recorded and `false` returned across all strictness levels.

#### `moveToPlaylistFolder`

35. **Same-filesystem move**: mock `renameSync` succeeds. Verify `copyFileSync` NOT called.

36. **Cross-device fallback**: mock `renameSync` throws, `copyFileSync` succeeds. Verify `copyFileSync` called, `unlinkSync` called to remove temp file.

37. **File naming convention**: track `{ artist: "The Prodigy", title: "Firestarter" }`, ext `.flac`. Expect filename `The Prodigy - Firestarter.flac`.

38. **Sanitizes special characters**: track with `artist: "AC/DC"`, `title: "Back In Black"`. Expect filename `AC DC - Back In Black.flac` (slash replaced with space).

#### `ensurePlaylistFolder`

39. **Creates directory with recursive flag**: verify `mkdirSync` called with `{ recursive: true }`.

40. **Path under downloadRoot**: playlistName `"Deep House"`. Expect path `<downloadRoot>/Deep House`.

41. **Sanitizes playlist name**: name `"Drum & Bass / 2024"`. Expect sanitized to `"Drum & Bass 2024"`.

#### Module-private helpers

42. **`trackInfoFromFilename` basic**: `"@@user\\music\\Artist - Title.flac"`: basename `"Artist - Title"`, no leading number, split on ` - ` -> `{ artist: "Artist", title: "Title" }`.

43. **`trackInfoFromFilename` with track number**: `"@@user\\music\\01 - Title.flac"`: basename `"01 - Title"`, strip `01 - ` -> `"Title"`, no ` - ` remaining -> `{ title: "Title", artist: "" }`.

44. **`sanitize` removes unsafe characters**: `"AC/DC: Greatest Hits"` -> `"AC DC Greatest Hits"`.

45. **`getExtension` extracts lowercase ext**: `"file.FLAC"` -> `"flac"`. `"file"` -> `""`.

46. **Rejection memory -- file_key format**: verify `file_key` is `"username:filepath"` for both read and write operations.

## Acceptance Criteria

1. `DownloadPipeline` class with constructor taking `Database`, `SoulseekConfig`, `DownloadConfig`, `LexiconConfig`.
2. **No standalone download** -- no public method to download a single track by query. Only `downloadBatch(items)` is exposed.
3. `rankResults` filters rejected files (from `rejections` table) before format/bitrate/fuzzy filters.
4. `rankResults` returns results sorted by score descending with a diagnostics string summarizing rejection/filter/mismatch counts.
5. `searchAndRank` tries strategies from `generateSearchQueries` in order, short-circuits on first strategy producing ranked results.
6. `searchAndRank` populates `strategyLog` with every strategy attempted (including failed ones), recording label, query, and result count.
7. `searchAndRankBatch` posts all first-strategy queries in batch, polls concurrently, then falls back to sequential `searchAndRank` for zero-result tracks.
8. `downloadFromSearchResults` rejects candidates with `score < 0.3` even if results exist.
9. `downloadBatch` respects `this.concurrency` limit using `Promise.race` on a pending set.
10. `downloadBatch` calls `onProgress(completed, total, result)` after each track completes (success or failure).
11. `downloadBatch` checks `isShutdownRequested()` before each new download and breaks the loop on shutdown.
12. `downloadBatch` creates all playlist folders upfront before any search/download begins.
13. `acquireAndMove` checks for existing downloads before initiating new ones via `findDownloadedFile`.
14. `findDownloadedFile` strips the `@@share\` prefix, tries exact match, then searches for suffixed variants sorted by mtime.
15. `validateDownload` behavior varies by `validationStrictness`: strict (title+artist+duration thresholds), moderate (format+score>0.5), lenient (just not corrupt).
16. `validateDownload` records a rejection entry on failure (all strictness levels).
17. `moveToPlaylistFolder` uses `renameSync` with fallback to `copyFileSync` + `unlinkSync` for cross-device moves.
18. File destination is `<downloadRoot>/<sanitize(playlistName)>/<sanitize(artist)> - <sanitize(title)>.<ext>` (i.e., `Lexicon/Incoming/{playlist-name}/`).
19. `RankedResult`, `DownloadResult`, `DownloadItem`, and `ValidationStrictness` types are exported and match their documented shapes.
20. Rejection memory: `getRejectionsForTrack` reads from `rejections` table, `recordRejection` writes with `INSERT OR IGNORE`.
21. All 46 test cases pass in Vitest.
