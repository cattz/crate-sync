---
# spec-13
title: Download service
status: todo
type: task
priority: high
parent: spec-E3
depends_on: spec-08, spec-11, spec-07
created_at: 2026-03-24T00:00:00Z
updated_at: 2026-03-24T00:00:00Z
---

## Purpose

Orchestrates the full download pipeline for acquiring music files from Soulseek: search with multi-strategy queries, rank results using fuzzy matching, download the best candidate, validate audio metadata, and move the file to the correct playlist folder under the Lexicon download root. This is the most complex service in the system, combining the query builder (spec-08), Soulseek client (spec-11), and fuzzy matching (spec-07) into a cohesive pipeline. It supports both single-track and batch downloads with concurrency control, progress callbacks, and an interactive review workflow.

## Public Interface

### File: `src/services/download-service.ts`

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

export interface DownloadCandidate {
  track: TrackInfo;
  file: SlskdFile;
  /** Parsed artist/title from the Soulseek filename. */
  parsedTrack: TrackInfo;
  score: number;
  diagnostics: string;
}

/**
 * Review callback for download candidates.
 * Return true to accept, false to skip.
 * Returning "all" accepts this and all remaining without further prompts.
 */
export type DownloadReviewFn = (
  candidate: DownloadCandidate,
  index: number,
  total: number,
) => Promise<boolean | "all">;
```

### Constructor

```ts
class DownloadService {
  private readonly soulseek: SoulseekService;
  private readonly matcher: FuzzyMatchStrategy;
  private readonly allowedFormats: Set<string>;
  private readonly minBitrate: number;
  private readonly concurrency: number;
  private readonly downloadRoot: string;
  private readonly slskdDownloadDir: string;

  constructor(
    soulseekConfig: SoulseekConfig,
    downloadConfig: DownloadConfig,
    lexiconConfig: LexiconConfig,
  );
}
```

The constructor takes three config objects (not a DB instance -- this service does not directly access the database):

- **`soulseekConfig: SoulseekConfig`**: `{ slskdUrl, slskdApiKey, searchDelayMs, downloadDir }`. Used to instantiate a `SoulseekService` and to resolve the slskd download directory on the host filesystem.
- **`downloadConfig: DownloadConfig`**: `{ formats: string[], minBitrate: number, concurrency: number }`. Configures file filtering and batch concurrency.
- **`lexiconConfig: LexiconConfig`**: `{ url, downloadRoot }`. The `downloadRoot` is where validated files are moved to (under `<downloadRoot>/<playlistName>/`).

Internal initialization:
- `this.soulseek = new SoulseekService(soulseekConfig)` -- creates the slskd HTTP client.
- `this.matcher = new FuzzyMatchStrategy({ autoAcceptThreshold: 0.9, reviewThreshold: 0.7, context: "soulseek", artistRejectThreshold: 0.3 })` -- creates a fuzzy matcher with soulseek-optimized weights (title: 0.3, artist: 0.25, album: 0.1, duration: 0.35).
- `this.allowedFormats = new Set(downloadConfig.formats.map(f => f.toLowerCase()))` -- normalizes format list to lowercase set.
- `this.minBitrate = downloadConfig.minBitrate` -- minimum bitrate threshold in kbps.
- `this.concurrency = downloadConfig.concurrency` -- max concurrent downloads in batch mode.
- `this.downloadRoot = lexiconConfig.downloadRoot` -- base directory for final file placement.
- `this.slskdDownloadDir = soulseekConfig.downloadDir` -- host path where slskd stores completed downloads.

### `rankResults(files: SlskdFile[], track: TrackInfo): { ranked: RankedResult[]; diagnostics: string }`

Pure function (no I/O). Filters and ranks Soulseek search results against an expected track.

**Pipeline:**

1. **Format filter**: Keep only files whose extension (lowercase, without dot) is in `this.allowedFormats`. Extension is extracted via `extname(file.filename).toLowerCase()`, stripping the leading dot.

2. **Bitrate filter**: From format-filtered results, keep files where `bitRate == null` (no info) OR `bitRate >= this.minBitrate`. Files with known bitrate below the threshold are removed.

3. **Fuzzy match scoring**: For each surviving file:
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

4. **Sort**: `ranked.sort((a, b) => b.score - a.score)` -- descending by score.

5. **Build diagnostics string**: Comma-separated summary, e.g., `"150 results, 12 filtered by format, 5 filtered by bitrate (<320kbps), 30 rejected by artist mismatch, 103 candidates"`. Null entries (zero counts) are omitted.

### `searchAndRank(track: TrackInfo): Promise<{ ranked: RankedResult[]; diagnostics: string; strategy?: string; strategyLog: Array<{ label: string; query: string; resultCount: number }> }>`

Searches Soulseek using the multi-strategy query builder (spec-08) and ranks results.

**Pipeline:**

1. Call `generateSearchQueries(track)` to get ordered strategies (full, base-title, title-only, keywords).
2. For each strategy in order:
   - Call `this.soulseek.rateLimitedSearch(strategy.query)` -- respects `searchDelayMs` between searches.
   - Call `this.rankResults(files, track)` on returned files.
   - Push `{ label, query, resultCount: result.ranked.length }` to `strategyLog`.
   - If `result.ranked.length > 0`: return immediately with `{ ...result, strategy: strategy.label, strategyLog }`. Logs top 5 candidates at debug level (score, filename, parsed title/artist, bitrate, username).
   - If `result.ranked.length === 0`: log debug and continue to next strategy.
3. If all strategies exhausted: return `{ ranked: [], diagnostics: "0 results across N strategies", strategyLog }`.

### `searchAndRankBatch(tracks: Array<{ track: TrackInfo; dbTrackId: string }>): Promise<Map<string, { ranked: RankedResult[]; diagnostics: string; strategy?: string; strategyLog?: Array<...> }>>`

Batch search optimization: POSTs all searches upfront using strategy 1 ("full"), polls all concurrently, then falls back to sequential multi-strategy for tracks with 0 results.

**Pipeline:**

1. For each track, generate search queries and take `strategies[0]?.query` (or fallback `"${artist} ${title}"`). Map query -> track item.
2. Call `this.soulseek.startSearchBatch(queries)` -- posts all searches with rate-limit delays, returns `Map<query, { searchId, startedAt }>`.
3. Call `this.soulseek.waitForSearchBatch(searchEntries)` -- polls all searches in a single loop until done/timeout.
4. For each track, rank the batch results via `this.rankResults(files, track)`.
5. Tracks with `ranked.length > 0` are stored in the results map with `strategy: "full"`.
6. Tracks with `ranked.length === 0` are collected into a `needsFallback` list.
7. For each fallback track, call `this.searchAndRank(track)` sequentially (tries all strategies).
8. Return the combined results map keyed by `dbTrackId`.

### `downloadTrack(track: TrackInfo, playlistName: string, dbTrackId: string): Promise<DownloadResult>`

Downloads a single track through the full pipeline.

**Pipeline:**

1. `this.ensurePlaylistFolder(playlistName)` -- create destination folder.
2. `const { ranked, diagnostics, strategy, strategyLog } = await this.searchAndRank(track)`.
3. If `ranked.length === 0`: return failure with error `"No matching files on Soulseek (${diagnostics})"` and `strategyLog`.
4. Take `best = ranked[0]`.
5. If `best.score < 0.3`: return failure with error `"Best match score too low: ${score}% -- \"${filename}\" (${diagnostics})"` and `strategy`, `strategyLog`.
6. Call `this.acquireAndMove(best.file, track, playlistName, dbTrackId)`.
7. Merge `strategy` and `strategyLog` into the result.
8. **Catch block**: any thrown error returns `{ trackId: dbTrackId, success: false, error: message }`.

### `downloadBatch(tracks: Array<{ track: TrackInfo; playlistName: string; dbTrackId: string }>, onProgress?: (completed: number, total: number, result: DownloadResult) => void, onReview?: DownloadReviewFn): Promise<DownloadResult[]>`

Downloads multiple tracks with batch search, concurrency control, progress reporting, and optional interactive review.

**Pipeline:**

1. **Early return**: if `tracks.length === 0`, return `[]`.

2. **Create playlist folders upfront**: collect unique `playlistName` values, call `ensurePlaylistFolder` for each. This makes folders visible in Lexicon/Incoming before any downloads complete.

3. **Batch search**: build input and call `searchAndRankBatch(batchInput)`. Returns a map of `dbTrackId -> { ranked, diagnostics, strategy, strategyLog }`.

4. **Review phase** (only if `onReview` callback provided):
   - Filter to reviewable tracks: those with `ranked.length > 0` AND `ranked[0].score >= 0.3`.
   - Iterate reviewable tracks in order. For each:
     - If `autoAcceptAll` is true (user previously returned `"all"`), auto-approve.
     - Otherwise call `onReview({ track, file: best.file, parsedTrack: trackInfoFromFilename(best.file.filename), score: best.score, diagnostics }, index, reviewable.length)`.
     - `"all"` response: set `autoAcceptAll = true`, approve current track.
     - `true` response: approve.
     - `false` response: add to `rejected` set.

5. **Download phase** with concurrency control:
   - Iterate all tracks. For each:
     - Check `isShutdownRequested()` -- break if true (graceful shutdown via SIGINT handler).
     - If review was used and track is in `rejected` set: push `{ trackId, success: false, error: "Rejected during review" }`, call `onProgress`, continue.
     - Call `downloadFromSearchResults(track, playlistName, dbTrackId, searchResult)` (private method that uses pre-computed search results).
     - Track as a `Promise`. Add to `pending` set.
     - When the promise resolves: push result, increment `completed`, call `onProgress`.
     - If `pending.size >= this.concurrency`: `await Promise.race(pending)` to wait for one slot to free up.
   - After loop: `await Promise.all(pending)` to flush remaining.

6. Return all results.

### `acquireAndMove(file: SlskdFile, track: TrackInfo, playlistName: string, dbTrackId: string): Promise<DownloadResult>`

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
5. **Validate**: call `this.validateDownload(tempPath, track)`.
6. If invalid: return `{ trackId, success: false, filePath: tempPath, error: "Downloaded file failed metadata validation" }`.
7. **Move**: call `this.moveToPlaylistFolder(tempPath, playlistName, track)`.
8. Return `{ trackId, success: true, filePath: finalPath }`.
9. **Catch block**: return failure with error message.

### `validateDownload(filePath: string, expected: TrackInfo): Promise<boolean>`

Validates a downloaded file's audio metadata against the expected track info.

1. Parse the file with `music-metadata`'s `parseFile(filePath)`.
2. Build a `TrackInfo` from metadata tags: `{ title: common.title ?? "", artist: common.artist ?? "", album: common.album ?? undefined, durationMs: Math.round(format.duration * 1000) or undefined }`.
3. Run `this.matcher.match(expected, [tagTrack])`.
4. Return `true` if at least one match with `score > 0.5` (lenient threshold -- audio tags are often messy).
5. If `parseFile` throws (corrupt file, unrecognized format): return `false`.

### `moveToPlaylistFolder(tempPath: string, playlistName: string, track: TrackInfo): string`

Moves a validated file to its final location.

**File naming convention**: `<Artist> - <Title>.<ext>`
- Artist and title are sanitized via `sanitize()` which replaces `/:*?"<>|\` with space, collapses multiple spaces, and trims.
- Extension is lowercase without dot.
- Full path: `<downloadRoot>/<sanitize(playlistName)>/<sanitize(artist)> - <sanitize(title)>.<ext>`.

**Move strategy**:
1. Create destination directory if it doesn't exist (`mkdirSync` with `recursive: true`).
2. Try `renameSync(tempPath, destPath)` -- fast same-filesystem move.
3. If `renameSync` throws (cross-device move): `copyFileSync(tempPath, destPath)` then `unlinkSync(tempPath)`.

Returns the final `destPath`.

### `ensurePlaylistFolder(playlistName: string): string`

Creates the playlist destination folder under `downloadRoot` if it doesn't exist.
- Path: `join(this.downloadRoot, sanitize(playlistName))`.
- Uses `mkdirSync(destDir, { recursive: true })`.
- Returns the directory path.

## Dependencies

| Module | Dependency | Kind |
|---|---|---|
| `download-service.ts` | `node:fs` (`mkdirSync`, `renameSync`, `copyFileSync`, `unlinkSync`, `existsSync`, `readdirSync`, `statSync`) | runtime import |
| `download-service.ts` | `node:path` (`extname`, `join`, `basename`, `dirname`) | runtime import |
| `download-service.ts` | `music-metadata` (`parseFile`) | runtime import |
| `download-service.ts` | `../config.js` (`SoulseekConfig`, `DownloadConfig`, `LexiconConfig`) | type-only import |
| `download-service.ts` | `../types/common.js` (`TrackInfo`) | type-only import |
| `download-service.ts` | `../types/soulseek.js` (`SlskdFile`) | type-only import |
| `download-service.ts` | `./soulseek-service.js` (`SoulseekService`) | runtime import |
| `download-service.ts` | `../matching/fuzzy.js` (`FuzzyMatchStrategy`) | runtime import |
| `download-service.ts` | `../utils/shutdown.js` (`isShutdownRequested`) | runtime import |
| `download-service.ts` | `../utils/logger.js` (`createLogger`) | runtime import |
| `download-service.ts` | `../search/query-builder.js` (`generateSearchQueries`, `QueryStrategy`) | runtime + type import |

### Service Dependencies (spec references)

- **SoulseekService (spec-11)**: HTTP client for slskd API. Methods used: `rateLimitedSearch(query)`, `startSearchBatch(queries)`, `waitForSearchBatch(entries)`, `download(username, filename, size)`, `waitForDownload(username, filename)`.
- **FuzzyMatchStrategy (spec-07)**: Fuzzy matching with soulseek weight profile. Methods used: `match(expected, candidates)`.
- **Query builder (spec-08)**: `generateSearchQueries(track)` for multi-strategy search.
- **Shutdown utility (spec-05)**: `isShutdownRequested()` for graceful batch interruption.
- **Logger utility (spec-05)**: `createLogger("download")` for structured debug/info logging.

## Behavior

### Search Strategy Cascade

The download service implements a cascading search strategy to maximize the chance of finding a track on Soulseek's P2P network:

1. **Full query** (`"Artist Title"`) -- most specific, best match quality.
2. **Base title** (`"Artist BaseTitle"`) -- strips remix/edit suffixes, finds the original track.
3. **Title only** (`"Title"`) -- handles artist name spelling differences.
4. **Keywords** (`"Artist Keyword1 Keyword2"`) -- handles very long titles.

Each strategy respects the `searchDelayMs` rate limit between slskd API calls (default 5000ms). The cascade short-circuits on the first strategy that produces ranked results.

### Batch Search Optimization

`searchAndRankBatch` optimizes for the common case (most tracks found with strategy 1) by:
1. POSTing all search requests upfront with rate-limit delays between POSTs.
2. Polling all searches in a single loop (via `SoulseekService.waitForSearchBatch`).
3. Only falling back to sequential multi-strategy search for tracks with zero results.

This reduces total search time from `O(N * strategies * searchDelay)` to approximately `O(N * searchDelay + fallback * strategies * searchDelay)`.

### Ranking Algorithm

The ranking combines format/bitrate filtering with fuzzy matching:
1. **Hard filters**: only allowed formats (default: flac, mp3) and minimum bitrate (default: 320kbps).
2. **Fuzzy scoring**: uses soulseek weight profile (title: 0.3, artist: 0.25, album: 0.1, duration: 0.35). Duration is heavily weighted because Soulseek metadata often has accurate duration info.
3. **Artist gate**: candidates with artist similarity < 0.3 are rejected outright (the `artistRejectThreshold` setting).
4. **Score threshold**: candidates must score >= 0.3 to be ranked (FuzzyMatchStrategy's `MIN_THRESHOLD`). Additionally, `downloadTrack` rejects the best match if `score < 0.3`.

### File Discovery and Naming

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

### Concurrency Control

`downloadBatch` uses a sliding-window concurrency model:
- Maintains a `pending: Set<Promise<void>>` of active downloads.
- Before adding a new download, checks `pending.size >= this.concurrency`.
- If at capacity: `await Promise.race(pending)` waits for one to complete.
- Each promise removes itself from `pending` via `.finally()`.
- After the loop: `await Promise.all(pending)` flushes remaining tasks.

Default concurrency is 3 (from `DownloadConfig.concurrency`).

### Review Workflow

When `onReview` is provided to `downloadBatch`:
1. Only tracks with viable candidates (ranked results with score >= 0.3) are presented for review.
2. The callback receives a `DownloadCandidate` with: the original track, the best Soulseek file, parsed track info from the filename, score, and diagnostics string.
3. Three responses: `true` (accept), `false` (reject), `"all"` (accept this and all remaining without further prompts).
4. Rejected tracks get a `DownloadResult` with `error: "Rejected during review"`.
5. Non-reviewable tracks (no results or score < 0.3) bypass review entirely and proceed to download attempt (which will fail with appropriate error).

### Graceful Shutdown

`downloadBatch` checks `isShutdownRequested()` before starting each new download in the loop. If shutdown is requested (SIGINT received), the loop breaks. In-flight downloads in the `pending` set are awaited but no new downloads are started.

## Error Handling

### `searchAndRank`
- Network errors from `soulseek.rateLimitedSearch` propagate up. The caller (`downloadTrack`) catches all errors.
- All strategies exhausted returns `{ ranked: [], diagnostics: "0 results across N strategies", strategyLog }` -- not an error, handled by caller.

### `downloadTrack`
- Wraps entire pipeline in try/catch. Any thrown error becomes `{ trackId, success: false, error: message }`.
- Zero results: `"No matching files on Soulseek (${diagnostics})"`.
- Score too low: `"Best match score too low: ${score}% -- \"${filename}\" (${diagnostics})"`.

### `acquireAndMove`
- Download timeout: `soulseek.waitForDownload` throws after 300s (default). Error message: `"Download timed out after ${timeoutMs}ms: ${username} / ${filename}"`.
- Download error state: throws `"Download failed with state \"${state}\": ${username} / ${filename}"`.
- Transfer not found: throws `"Transfer not found: ${username} / ${filename}"`.
- File not found after download: returns failure `"Downloaded file not found in slskd download dir for: ${filename}"`.
- Validation failure: returns failure `"Downloaded file failed metadata validation"` with `filePath` set to the temp path.
- Move failure: `renameSync` throws -> falls back to `copyFileSync` + `unlinkSync`. If `copyFileSync` also fails, the error propagates.

### `validateDownload`
- `parseFile` throws (corrupt file, unsupported format): returns `false`.
- Matcher returns no matches or score <= 0.5: returns `false`.

### `findDownloadedFile` (private)
- Directory doesn't exist: returns `null`.
- `readdirSync` or `statSync` throws: sort comparison returns 0 (tolerant).

### `downloadBatch`
- Individual track errors are captured in `DownloadResult` and reported via `onProgress`. The batch does not abort on individual failures.
- Shutdown: breaks the loop, awaits in-flight tasks, returns partial results.

## Tests

Test framework: Vitest. Tests at `src/services/__tests__/download-service.test.ts`.

### Test Approach

- **Mock `SoulseekService`**: mock `rateLimitedSearch`, `startSearchBatch`, `waitForSearchBatch`, `download`, `waitForDownload` methods. Control returned files, search timing, download states.
- **Mock filesystem**: mock `existsSync`, `mkdirSync`, `renameSync`, `copyFileSync`, `unlinkSync`, `readdirSync`, `statSync` from `node:fs`. Control file existence and directory listings.
- **Mock `music-metadata`**: mock `parseFile` to return controlled metadata for validation tests.
- **Mock `isShutdownRequested`**: control shutdown signal for graceful shutdown tests.

### Test Cases

#### `rankResults`

1. **Filters by format**: input files with .flac, .mp3, .wav, .ogg. Allowed formats: ["flac", "mp3"]. Expect only .flac and .mp3 files in ranked results.

2. **Filters by bitrate**: files with bitRate 128, 320, null. minBitrate 320. Expect 128 filtered out, 320 and null kept.

3. **Scores via fuzzy match**: file with matching artist/title scores > 0.7. File with non-matching artist gets rejected (artist gate < 0.3).

4. **Sorts by score descending**: 3 files with different match quality. Verify ranked[0] has the highest score.

5. **Builds diagnostics string**: verify format includes result counts, filter counts, artist rejection count.

6. **Converts file.length to durationMs**: file with `length: 240` (seconds). Verify candidate has `durationMs: 240000`.

7. **Empty input returns empty ranked**: `rankResults([], track)` returns `{ ranked: [], diagnostics: "0 results, 0 candidates" }`.

#### `searchAndRank`

8. **Returns results from first successful strategy**: mock `rateLimitedSearch` to return files on strategy 1 ("full"). Expect `strategy: "full"`, `strategyLog` has 1 entry.

9. **Falls back to next strategy on zero results**: mock first strategy returns 0 results, second strategy returns results. Expect `strategy: "base-title"`, `strategyLog` has 2 entries.

10. **All strategies exhausted**: mock all strategies return 0 results. Expect `ranked: []`, diagnostics mentions strategy count.

11. **strategyLog records all attempted strategies**: mock 3 strategies tried, results on 3rd. Expect `strategyLog.length === 3` with correct labels and result counts.

#### `downloadTrack`

12. **Full success pipeline**: mock search returns files, rank produces score > 0.3, download succeeds, validation passes, move succeeds. Expect `{ success: true, filePath: "...", strategy: "full" }`.

13. **No search results**: mock search returns empty. Expect `{ success: false, error: "No matching files..." }`.

14. **Score too low**: mock best score 0.2. Expect failure with "Best match score too low".

15. **Download timeout**: mock `waitForDownload` throws timeout error. Expect `{ success: false, error: "..." }`.

16. **Validation failure**: mock `validateDownload` returns false. Expect `{ success: false, error: "Downloaded file failed metadata validation" }`.

17. **Creates playlist folder**: verify `ensurePlaylistFolder` called before search begins.

#### `downloadBatch`

18. **Processes all tracks**: 3 tracks, all succeed. Expect 3 results, all success.

19. **Concurrency limit respected**: 5 tracks, concurrency 2. Verify at most 2 downloads run simultaneously (mock downloads with delays, check pending set behavior).

20. **Progress callback called for each track**: mock `onProgress`. Verify called with incrementing `completed` and correct `total`.

21. **Review callback -- accept**: provide `onReview` that returns `true`. Verify track is downloaded.

22. **Review callback -- reject**: provide `onReview` that returns `false`. Expect `{ success: false, error: "Rejected during review" }`.

23. **Review callback -- accept all**: provide `onReview` that returns `"all"` on first call. Verify subsequent tracks are not reviewed but still downloaded.

24. **Review skips tracks with no results**: tracks with zero ranked results are not presented to `onReview`.

25. **Graceful shutdown**: set `isShutdownRequested()` to return true after 2 downloads. Verify loop breaks, in-flight tasks complete, remaining tracks not started.

26. **Creates all playlist folders upfront**: 3 tracks across 2 playlists. Verify both folders created before any downloads start.

#### `acquireAndMove`

27. **Reuses existing download**: mock `findDownloadedFile` returns a path. Verify `soulseek.download` is NOT called. Validation and move still run.

28. **Downloads and finds file**: mock `findDownloadedFile` returns null first, then returns path after download. Verify full pipeline runs.

29. **File not found after download**: mock `findDownloadedFile` returns null even after download. Expect failure error.

#### `validateDownload`

30. **Valid metadata above threshold**: mock `parseFile` returns matching title/artist/duration. Expect `true`.

31. **Invalid metadata below threshold**: mock `parseFile` returns non-matching metadata. Expect `false`.

32. **Corrupt file (parseFile throws)**: mock `parseFile` throws. Expect `false`.

#### `moveToPlaylistFolder`

33. **Same-filesystem move**: mock `renameSync` succeeds. Verify `copyFileSync` NOT called.

34. **Cross-device fallback**: mock `renameSync` throws, `copyFileSync` succeeds. Verify `copyFileSync` called, `unlinkSync` called to remove temp file.

35. **File naming convention**: track `{ artist: "The Prodigy", title: "Firestarter" }`, ext `.flac`. Expect filename `The Prodigy - Firestarter.flac`.

36. **Sanitizes special characters**: track with `artist: "AC/DC"`, `title: "Back In Black"`. Expect filename `AC DC - Back In Black.flac` (slash replaced with space).

#### `ensurePlaylistFolder`

37. **Creates directory if missing**: mock `existsSync` returns false. Verify `mkdirSync` called with `{ recursive: true }`.

38. **Skips creation if exists**: mock `existsSync` returns true. Verify `mkdirSync` NOT called.

39. **Sanitizes playlist name**: name `"Drum & Bass / 2024"`. Expect sanitized to `"Drum & Bass   2024"` -> collapsed to `"Drum & Bass 2024"`.

#### Module-private helpers

40. **`trackInfoFromFilename` basic**: `"@@user\\music\\Artist\\Album\\01 - Title.flac"` -> `{ artist: "01", title: "Title" }` -- wait, the track number stripping happens on the basename: basename is `"01 - Title"`, strip leading `01 - ` -> `"Title"`, then no ` - ` in remaining -> `{ title: "Title", artist: "" }`. Actually: basename is `"01 - Title"`, cleaned is `"Title"` (after stripping `01 - `), no ` - ` -> `{ title: "Title", artist: "" }`. For filename `"@@user\\music\\Artist - Title.flac"`: basename `"Artist - Title"`, no leading number, split on ` - ` -> `{ artist: "Artist", title: "Title" }`.

41. **`sanitize` removes unsafe characters**: `"AC/DC: Greatest Hits"` -> `"AC DC  Greatest Hits"` -> collapsed: `"AC DC Greatest Hits"`.

42. **`getExtension` extracts lowercase ext**: `"file.FLAC"` -> `"flac"`. `"file"` -> `""`.

## Acceptance Criteria

1. Constructor takes `SoulseekConfig`, `DownloadConfig`, `LexiconConfig` and initializes all private fields. No DB dependency.
2. `rankResults` filters by format (case-insensitive) and bitrate (>= minBitrate, null bitrate passes), then scores with FuzzyMatchStrategy using soulseek weights.
3. `rankResults` returns results sorted by score descending with a diagnostics string summarizing filter/rejection counts.
4. `searchAndRank` tries strategies from `generateSearchQueries` in order, short-circuits on first strategy producing ranked results.
5. `searchAndRank` populates `strategyLog` with every strategy attempted (including failed ones), recording label, query, and result count.
6. `searchAndRankBatch` posts all first-strategy queries in batch, polls concurrently, then falls back to sequential `searchAndRank` for zero-result tracks.
7. `downloadTrack` rejects candidates with `score < 0.3` even if results exist.
8. `downloadBatch` respects `this.concurrency` limit using `Promise.race` on a pending set.
9. `downloadBatch` calls `onProgress(completed, total, result)` after each track completes (success or failure).
10. `downloadBatch` review phase only presents candidates with `ranked.length > 0` and `score >= 0.3`. The `"all"` response auto-approves remaining tracks.
11. `downloadBatch` checks `isShutdownRequested()` before each new download and breaks the loop on shutdown.
12. `downloadBatch` creates all playlist folders upfront before any search/download begins.
13. `acquireAndMove` checks for existing downloads before initiating new ones via `findDownloadedFile`.
14. `findDownloadedFile` strips the `@@share\` prefix, tries exact match, then searches for suffixed variants sorted by mtime.
15. `validateDownload` uses `music-metadata` `parseFile` and fuzzy matching with `score > 0.5` threshold. Returns `false` on parse errors.
16. `moveToPlaylistFolder` uses `renameSync` with fallback to `copyFileSync` + `unlinkSync` for cross-device moves.
17. File naming follows `<sanitize(artist)> - <sanitize(title)>.<ext>` under `<downloadRoot>/<sanitize(playlistName)>/`.
18. `RankedResult`, `DownloadResult`, `DownloadCandidate`, and `DownloadReviewFn` types are exported and match their documented shapes.
19. All 42 test cases pass in Vitest.
