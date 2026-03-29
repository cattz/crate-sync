---
# spec-07
title: "Matching: fuzzy strategy, composite, factory"
status: todo
type: task
priority: critical
parent: spec-E2
depends_on: spec-06
created_at: 2026-03-24T00:00:00Z
updated_at: 2026-03-24T00:00:00Z
---

## Purpose

Implement the fuzzy matching strategy (the workhorse of the system), the composite strategy that cascades ISRC-then-fuzzy with short-circuit logic, and the `createMatcher()` factory function. This is the most algorithm-dense module in the codebase: Damerau-Levenshtein edit distance, Jaccard word-set similarity, weighted multi-field scoring with context-dependent presets, remix fallback, artist gating, and duration power-decay.

## Public Interface

### File: `src/matching/fuzzy.ts`

Exports: `FuzzyMatchStrategy` class implementing `MatchStrategy`.

```ts
class FuzzyMatchStrategy implements MatchStrategy {
  readonly name = "fuzzy";
  constructor(config: FuzzyMatchConfig);
  match(source: TrackInfo, candidates: TrackInfo[]): MatchResult[];
}
```

### File: `src/matching/composite.ts`

Exports: `CompositeMatchStrategy` class implementing `MatchStrategy`.

```ts
class CompositeMatchStrategy implements MatchStrategy {
  readonly name = "composite";
  constructor(strategies: MatchStrategy[], options: MatchOptions);
  match(source: TrackInfo, candidates: TrackInfo[]): MatchResult[];
}
```

### File: `src/matching/index.ts`

Re-exports all types and classes. Exports: `createMatcher()` factory function.

```ts
function createMatcher(options: MatchOptions, context?: MatchContext): MatchStrategy;
```

## Dependencies

| Module | Dependency | Kind |
|---|---|---|
| `fuzzy.ts` | `../types/common.js` (`TrackInfo`, `MatchResult`) | type-only import |
| `fuzzy.ts` | `./types.js` (`MatchStrategy`, `FuzzyMatchConfig`, `WeightProfile`, `MatchContext`) | type-only import |
| `fuzzy.ts` | `./normalize.js` (`normalizeBase`, `normalizeArtist`, `removeStopwords`, `stripRemixSuffix`) | runtime import |
| `composite.ts` | `../types/common.js` (`TrackInfo`, `MatchResult`) | type-only import |
| `composite.ts` | `./types.js` (`MatchStrategy`, `MatchOptions`) | type-only import |
| `index.ts` | `./types.js`, `./isrc.js`, `./fuzzy.js`, `./composite.js` | re-export + runtime |

No I/O. No database. No network. Pure computation only.

## Behavior

### Constants

#### `MIN_THRESHOLD` (module-private in `fuzzy.ts`)

Value: `0.3`

Any candidate with a weighted score below 0.3 is excluded from results entirely. This prevents noise in the output.

#### `WEIGHT_PRESETS` (module-private in `fuzzy.ts`)

```ts
Record<MatchContext, WeightProfile>
```

| Context | title | artist | album | duration |
|---|---|---|---|---|
| `"lexicon"` | 0.30 | 0.30 | 0.15 | 0.25 |
| `"soulseek"` | 0.30 | 0.25 | 0.10 | 0.35 |
| `"post-download"` | 0.30 | 0.30 | 0.15 | 0.25 |

All weight profiles sum to 1.0. Duration is weighted higher for soulseek (file-based matching where duration is a strong signal). Album is weighted lower for soulseek (album metadata often missing from Soulseek results).

#### `DEFAULT_WEIGHTS`

Set to `WEIGHT_PRESETS.lexicon` (the lexicon preset is used when no context or explicit weights are provided).

### Algorithm: Damerau-Levenshtein Distance

Module-private function: `damerauLevenshtein(a: string, b: string): number`

This is the **full** Damerau-Levenshtein algorithm (not the simpler Optimal String Alignment variant). It correctly handles non-adjacent transpositions.

#### Edge cases
- If `a` is empty, return `b.length`.
- If `b` is empty, return `a.length`.

#### Matrix setup
- Dimensions: `(m + 2) x (n + 2)` where `m = a.length`, `n = b.length`.
- `maxDist = m + n` (sentinel value).
- `d[0][0] = maxDist`
- For `i` in `0..m`: `d[i+1][0] = maxDist`, `d[i+1][1] = i`
- For `j` in `0..n`: `d[0][j+1] = maxDist`, `d[1][j+1] = j`

#### Character position map
- `da`: `Record<string, number>` -- maps each character to the last row where it was seen. Initialized empty (lookups for unseen chars return `0` via `|| 0`).

#### Main loop
For `i` from `1` to `m`:
  - `db = 0` (last column where current `a[i-1]` matched in `b`)
  - For `j` from `1` to `n`:
    - `i1 = da[b[j-1]] || 0` (last row in `a` where char `b[j-1]` appeared)
    - `j1 = db` (last column in `b` where char `a[i-1]` matched)
    - `cost = 1` (substitution cost)
    - If `a[i-1] === b[j-1]`: set `cost = 0`, set `db = j`
    - `d[i+1][j+1] = min(`
      - `d[i][j] + cost` -- substitution
      - `d[i+1][j] + 1` -- insertion
      - `d[i][j+1] + 1` -- deletion
      - `d[i1][j1] + (i - i1 - 1) + 1 + (j - j1 - 1)` -- transposition
    - `)`
  - After inner loop: `da[a[i-1]] = i`

#### Result
Return `d[m+1][n+1]`.

### Algorithm: Edit Similarity

Module-private function: `editSimilarity(a: string, b: string): number`

Formula: `1 - damerauLevenshtein(a, b) / max(a.length, b.length)`

Edge cases:
- Both empty: return `1` (identical).
- One empty, other non-empty: return `0`.

### Algorithm: Jaccard Similarity

Module-private function: `jaccardSimilarity(a: Set<string>, b: Set<string>): number`

Formula: `|intersection| / |union|`

Where `|union| = |a| + |b| - |intersection|`.

Edge cases:
- Both sets empty: return `1`.
- One empty, other non-empty: return `0`.
- Union is zero (redundant with both-empty): return `0`.

Implementation counts intersection by iterating set `a` and checking membership in `b`.

### Algorithm: Word Set Construction

Module-private function: `wordSet(s: string): Set<string>`

- If `s.length === 0`, return empty set.
- Split on single space `" "` and return as `Set<string>`.

Expects pre-normalized input (from `normalizeBase`), so splitting on `" "` is sufficient.

### Algorithm: String Similarity

Module-private function: `stringSimilarity(normA: string, normB: string): number`

Takes **pre-normalized** strings (output of `normalizeBase` or `normalizeArtist`).

1. Build word sets: `wordsA = removeStopwords(wordSet(normA))`, `wordsB = removeStopwords(wordSet(normB))`.
2. Compute Jaccard similarity on the stopword-filtered word sets.
3. Compute edit similarity on the full normalized strings.
4. Return `max(jaccard, edit)`.

Rationale: Jaccard is better for word reordering ("Sound of Music" vs "Music Sound"); edit distance is better for typos ("Rhapsodi" vs "Rhapsody"). Taking the max gives the best of both.

### Algorithm: Artist Similarity

Module-private function: `artistSimilarity(normA: string, normB: string): number`

1. Compute `base = stringSimilarity(normA, normB)`.
2. **Containment floor**: if both strings are non-empty and one contains the other as a substring, return `max(base, 0.7)`.
3. Otherwise return `base`.

This handles "Daft Punk feat. Pharrell Williams" vs "Daft Punk" -- after normalization the shorter string is contained in the longer, so the score floors at 0.7 even if Jaccard/edit distance would be lower.

### Algorithm: Duration Similarity

Module-private function: `durationSimilarity(aMs: number | undefined, bMs: number | undefined): number`

**Power-decay formula**: `max(0, 1 - (diff / 30000)^1.5)`

Where `diff = abs(aMs - bMs)`.

Edge cases:
- Both `null`/`undefined`: return `1.0` (both missing = no penalty).
- One `null`/`undefined`, other present: return `0.5` (uncertain).

The power exponent `1.5` creates a curve that is forgiving for small differences but drops off steeply:
- 0ms diff -> 1.0
- 5000ms (5s) diff -> ~0.97
- 15000ms (15s) diff -> ~0.81
- 30000ms (30s) diff -> 0.0

### Algorithm: Confidence Assignment

Module-private function: `assignConfidence(score: number, config: FuzzyMatchConfig): "high" | "review" | "low"`

- `score >= config.autoAcceptThreshold` -> `"high"`
- `score >= config.reviewThreshold` -> `"review"`
- Otherwise -> `"low"`

### FuzzyMatchStrategy

#### Constructor

```ts
constructor(config: FuzzyMatchConfig)
```

Weight resolution priority:
1. `config.weights` (explicit override) -- if provided, use directly.
2. `WEIGHT_PRESETS[config.context]` -- if context is provided and no explicit weights.
3. `DEFAULT_WEIGHTS` (lexicon preset) -- fallback.

#### `match(source, candidates)` Algorithm

For each candidate:

**Step 1: Normalize inputs**
- `srcTitle = normalizeBase(source.title)`
- `srcArtist = normalizeArtist(source.artist)`
- `srcAlbum = source.album ? normalizeBase(source.album) : undefined`
- `candTitle = normalizeBase(candidate.title)`
- `candArtist = normalizeArtist(candidate.artist)`
- `candAlbum = candidate.album ? normalizeBase(candidate.album) : undefined`

**Step 2: Artist gate (early rejection)**
- Compute `artScore = artistSimilarity(srcArtist, candArtist)`.
- If `config.artistRejectThreshold` is set and `artScore < artistRejectThreshold`: skip this candidate entirely (continue to next). This is used in the soulseek context where artist mismatch is a strong rejection signal.

**Step 3: Title score with remix fallback**
- Compute `titleScore = stringSimilarity(srcTitle, candTitle)`.
- If `titleScore < config.reviewThreshold`:
  - Compute stripped versions: `strippedSrc = normalizeBase(stripRemixSuffix(source.title))`, `strippedCand = normalizeBase(stripRemixSuffix(candidate.title))`.
  - If either stripped version differs from the original normalized version (i.e., a remix suffix was actually stripped):
    - `titleScore = max(titleScore, stringSimilarity(strippedSrc, strippedCand))`
  - This allows "Blue Monday - 2023 Remix" to match "Blue Monday" by comparing the base titles.

**Step 4: Duration score**
- `durScore = durationSimilarity(source.durationMs, candidate.durationMs)`

**Step 5: Album score with weight redistribution**
- Start with weight copies: `wT, wA, wAl, wD` from the resolved weight profile.
- If both `srcAlbum` and `candAlbum` are non-null:
  - `albumScore = stringSimilarity(srcAlbum, candAlbum)`
- Else (one or both albums missing):
  - **Redistribute** `wAl` proportionally among the other three weights:
    - `sumOther = wT + wA + wD`
    - If `sumOther > 0`: `wT += wAl * (wT / sumOther)`, `wA += wAl * (wA / sumOther)`, `wD += wAl * (wD / sumOther)`
  - Set `wAl = 0`, `albumScore = 0`.
  - Example with lexicon weights (0.30, 0.30, 0.15, 0.25): `sumOther = 0.85`. New weights: title = `0.30 + 0.15 * (0.30/0.85)` = ~0.353, artist = ~0.353, duration = ~0.294, album = 0. Sum still = 1.0.

**Step 6: Weighted score**
- `score = wT * titleScore + wA * artScore + wAl * albumScore + wD * durScore`

**Step 7: Threshold filter**
- If `score < MIN_THRESHOLD` (0.3): skip this candidate.

**Step 8: Build result**
- Push `MatchResult` with `candidate`, `score`, `confidence` from `assignConfidence(score, config)`, `method: "fuzzy"`.

**Step 9: Sort and return**
- Sort results descending by score.

### CompositeMatchStrategy

#### Constructor

```ts
constructor(strategies: MatchStrategy[], options: MatchOptions)
```

Takes an ordered list of strategies and shared threshold options.

#### `match(source, candidates)` Algorithm

**Phase 1: Short-circuit scan**

Iterate strategies in order. For each strategy:
1. Run `strategy.match(source, candidates)`.
2. Check if **any** result has `confidence === "high"`.
3. If yes: return the full result set from that strategy immediately. Do not run subsequent strategies.

This means if ISRC produces a high-confidence match, fuzzy is never executed at all.

**Phase 2: Fallback merge (no strategy produced a high-confidence result)**

Re-run all strategies (note: strategies are run again in this phase; they were already run in phase 1 but results were not stored):
1. For each strategy, run `strategy.match(source, candidates)`.
2. Merge results into a `Map<TrackInfo, MatchResult>` keyed by candidate reference equality.
3. For each result, keep only the **highest-scoring** result per candidate.
4. After merging all strategies:
   - Reassign confidence based on the composite's `options` thresholds (not the original strategy's thresholds).
   - Override `method` to `"composite"` for all merged results.
5. Sort descending by score.

Key details:
- Deduplication is by **object reference** (`Map<TrackInfo, MatchResult>` uses `===` on TrackInfo objects).
- The confidence reassignment uses the shared `MatchOptions`, not the individual strategy configs. This means composite thresholds can differ from the underlying strategy thresholds.
- In the current implementation, strategies are called twice when no high-confidence match exists (once in phase 1 scan, once in phase 2 merge). This is acceptable because matching is CPU-cheap.

### `createMatcher()` Factory

```ts
function createMatcher(options: MatchOptions, context?: MatchContext): MatchStrategy
```

Creates a `CompositeMatchStrategy` with two strategies in this order:
1. `new IsrcMatchStrategy()`
2. `new FuzzyMatchStrategy({ ...options, context })`

The composite uses the provided `options` for its own confidence thresholds.

### Re-exports from `index.ts`

Types re-exported: `MatchStrategy`, `MatchOptions`, `MatchContext`, `WeightProfile`, `FuzzyMatchConfig`.
Classes re-exported: `IsrcMatchStrategy`, `FuzzyMatchStrategy`, `CompositeMatchStrategy`.
Function exported: `createMatcher`.

## Error Handling

All functions are pure and accept any valid input without throwing. Edge case behaviors:

- Empty candidate list: returns `[]`.
- Empty title/artist strings: normalization produces `""`, similarity functions handle empty strings (Jaccard returns 1 for both-empty, 0 for one-empty; edit similarity returns 1 for both-empty, 0 for one-empty).
- Missing duration on both sides: duration similarity returns 1.0 (no penalty).
- Missing duration on one side: duration similarity returns 0.5 (uncertain).
- Missing album on either side: album weight is redistributed; album does not contribute to score.
- All candidates below `MIN_THRESHOLD`: returns `[]`.

## Tests

Test framework: Vitest. Tests co-located at `src/matching/__tests__/`.

### `fuzzy.test.ts`

#### Setup
- Default config: `{ autoAcceptThreshold: 0.85, reviewThreshold: 0.6 }`.
- Helper: `makeTrack(overrides)` creates `TrackInfo` by spreading overrides.

#### Test cases

1. **Exact match scores ~1.0 with high confidence**: Source and candidate both `"Bohemian Rhapsody"` / `"Queen"` / 354000ms. Expected: length 1, score >= 0.95, confidence "high", method "fuzzy".

2. **Close match with small typo scores high**: `"Bohemian Rhapsody"` vs `"Bohemian Rhapsodi"`, both "Queen". Expected: length 1, score > 0.7.

3. **Same title, different artist scores medium**: `"Yesterday"` / `"The Beatles"` vs `"Yesterday"` / `"John Smith"`. Expected: length 1, score > 0.3 and < 0.85.

4. **Completely different track scores low or absent**: `"Bohemian Rhapsody"` / `"Queen"` vs `"Stairway to Heaven"` / `"Led Zeppelin"`. Expected: if any results, score < 0.5 and confidence "low".

5. **Duration penalty**: Same title+artist, durations 354000 vs 355000 (close) and 354000 vs 60000 (far). Expected: close result scores higher than far result.

6. **Case insensitivity**: `"The Beatles"` / `"Let It Be"` vs `"the beatles"` / `"let it be"`. Expected: score >= 0.95, confidence "high".

7. **Punctuation tolerance**: `"Don't Stop Me Now"` / `"Queen"` vs `"Dont Stop Me Now"` / `"Queen"`. Expected: score > 0.85.

8. **Empty candidates**: returns `[]`.

9. **Diacritics**: `"Halo"` / `"Beyonce\u0301"` vs `"Halo"` / `"Beyonce"`. Expected: score >= 0.95.

10. **Stopword invariance**: `"Sound of Music"` / `"Test"` vs `"Sound Music"` / `"Test"`. Expected: score > 0.8.

11. **Artist containment (feat.)**: `"Get Lucky"` / `"Daft Punk feat. Pharrell Williams"` vs `"Get Lucky"` / `"Daft Punk"`. Expected: score > 0.7.

12. **Remix fallback**: `"Blue Monday - 2023 Remix"` / `"New Order"` vs `"Blue Monday"` / `"New Order"`. Expected: score > 0.7.

13. **Album contributes to score**: `"Yesterday"` / `"The Beatles"` / album `"Help!"` / 125000ms vs same with album `"Help!"` (matching) and `"Let It Be"` (wrong). Expected: matching album scores higher than wrong album.

14. **Artist gate in soulseek context**: Config: `{ ...defaultConfig, context: "soulseek", artistRejectThreshold: 0.3 }`. `"Yesterday"` / `"The Beatles"` vs `"Yesterday"` / `"DJ Shadow"`. Expected: empty results (artist rejected).

15. **Duration power curve**: `"Test"` / `"Test"` / 200000ms vs 215000ms (15s diff) and 230000ms (30s diff). Expected: 15s result scores higher than 30s result.

16. **Transposition typo (Damerau-Levenshtein)**: `"Bohemian Rhapsody"` / `"Queeen"` vs `"Bohemian Rhapsody"` / `"Queen"`. Expected: score > 0.8.

### `composite.test.ts`

#### Setup
- Default options: `{ autoAcceptThreshold: 0.85, reviewThreshold: 0.6 }`.

#### Test cases

1. **ISRC match short-circuits**: Source and candidate share ISRC `"USAT21234567"`. Expected: length 1, score 1.0, confidence "high", method "isrc" (not "composite" -- ISRC short-circuited).

2. **Fallback to fuzzy -- exact match short-circuits on fuzzy**: No ISRC, `"Bohemian Rhapsody"` / `"Queen"` exact match. Expected: score > 0.85, confidence "high", method "fuzzy" (fuzzy produced high confidence, so fuzzy results returned directly).

3. **Fallback merges when no high confidence**: `"Yesterday"` / `"The Beatles"` vs `"Yesterday"` / `"John Smith"` (partial match). Expected: method "composite" (neither strategy produced high confidence, so merge path was taken).

4. **Deduplication by candidate**: Two candidates for `"Let It Be"` / `"The Beatles"` and `"Let It Be"` / `"Beatles"`. Expected: each candidate appears at most once in results.

5. **createMatcher factory works**: Uses `createMatcher(defaultOptions)`. Source has ISRC matching one candidate. Expected: length >= 1, first result score 1.0, confidence "high".

## Acceptance Criteria

1. `MIN_THRESHOLD` is `0.3`.
2. Weight presets match the exact values: lexicon `(0.30, 0.30, 0.15, 0.25)`, soulseek `(0.30, 0.25, 0.10, 0.35)`, post-download `(0.30, 0.30, 0.15, 0.25)`.
3. Default weights are the lexicon preset.
4. Damerau-Levenshtein is the full algorithm (not OSA), using a `(m+2) x (n+2)` matrix and a character-position map `da`.
5. Edit similarity formula: `1 - dist / max(len1, len2)`.
6. Jaccard similarity: `|intersection| / |union|`, with both-empty returning 1.
7. String similarity: `max(jaccard_with_stopword_removal, edit_similarity)`.
8. Artist similarity applies a containment floor of `0.7` when one normalized string contains the other.
9. Duration similarity uses power-decay: `max(0, 1 - (diff / 30000)^1.5)`. Both missing = 1.0, one missing = 0.5.
10. Album weight redistribution: when album is missing, `wAl` is distributed proportionally to `wT + wA + wD`, preserving total weight = 1.0.
11. Remix fallback: triggered only when initial `titleScore < reviewThreshold`; the stripped score is compared via `max(original, stripped)`.
12. Artist gate: when `artistRejectThreshold` is set and `artScore` is below it, the candidate is skipped entirely.
13. Composite short-circuits on the first strategy that produces any result with `confidence === "high"`, returning that strategy's full result set.
14. Composite fallback merges all strategies, deduplicates by candidate reference, keeps highest score per candidate, reassigns confidence using composite options, overrides method to `"composite"`.
15. `createMatcher()` creates `CompositeMatchStrategy([IsrcMatchStrategy, FuzzyMatchStrategy], options)`.
16. Results are sorted descending by score in both `FuzzyMatchStrategy` and `CompositeMatchStrategy`.
17. All tests pass in Vitest.
