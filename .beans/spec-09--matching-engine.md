---
# spec-09
title: "Matching engine"
status: completed
type: task
priority: critical
parent: spec-E2
depends_on: spec-02
created_at: 2026-03-29T00:00:00Z
updated_at: 2026-03-29T00:00:00Z
---

## Purpose

Self-contained, pure-logic matching engine. Defines the type contracts for the pluggable matching system, all text normalization functions, ISRC exact-match strategy, fuzzy multi-field strategy (Damerau-Levenshtein + Jaccard + weighted scoring), composite cascade strategy, and the `createMatcher()` factory. Zero I/O, zero database — this module is used by both the Lexicon sync pipeline (spec-11) and the download pipeline (spec-15).

## Public Interface

### File: `src/matching/types.ts`

Imports `TrackInfo` and `MatchResult` from `../types/common.js`.

```ts
interface MatchStrategy {
  name: string;
  match(source: TrackInfo, candidates: TrackInfo[]): MatchResult[];
}

interface MatchOptions {
  autoAcceptThreshold: number;   // score >= this -> confidence "high"
  reviewThreshold: number;       // score >= this -> confidence "review"
}

type MatchContext = "lexicon" | "soulseek" | "post-download";

interface WeightProfile {
  title: number;
  artist: number;
  album: number;
  duration: number;
}

interface FuzzyMatchConfig extends MatchOptions {
  context?: MatchContext;
  weights?: WeightProfile;                // overrides context preset if provided
  artistRejectThreshold?: number;         // early rejection gate for artist score
}
```

### File: `src/matching/normalize.ts`

Exports: `STOPWORDS`, `normalizeUnicode`, `normalizeBase`, `normalizeArtist`, `removeStopwords`, `stripRemixSuffix`.

### File: `src/matching/isrc.ts`

Exports: `IsrcMatchStrategy` class implementing `MatchStrategy`.

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
| `types.ts` | `../types/common.js` (`TrackInfo`, `MatchResult`) | type-only import |
| `normalize.ts` | none | standalone |
| `isrc.ts` | `../types/common.js`, `./types.js` | type-only import |
| `fuzzy.ts` | `../types/common.js`, `./types.js` | type-only import |
| `fuzzy.ts` | `./normalize.js` | runtime import |
| `composite.ts` | `../types/common.js`, `./types.js` | type-only import |
| `index.ts` | `./types.js`, `./isrc.js`, `./fuzzy.js`, `./composite.js` | re-export + runtime |

No runtime dependencies. No I/O. No database.

## Behavior

### Normalization Functions

#### `STOPWORDS` (constant `Set<string>`)

Exact members: `"the"`, `"a"`, `"an"`, `"of"`, `"and"`, `"in"`, `"on"`, `"at"`, `"to"`, `"for"`, `"is"`, `"it"` (12 words).

#### `REMIX_KEYWORDS` (module-private constant `Set<string>`)

Exact members: `"remix"`, `"edit"`, `"mix"`, `"version"`, `"dub"`, `"rework"`, `"remaster"`, `"remastered"`, `"bootleg"`, `"instrumental"`, `"acoustic"`, `"live"`, `"radio"`, `"extended"`, `"vip"` (15 words).

#### `normalizeUnicode(s: string): string`

1. Decompose to NFKD: `s.normalize("NFKD")`
2. Strip all Unicode combining marks: `.replace(/\p{M}/gu, "")`
3. Recompose to NFC: `.normalize("NFC")`

Examples:
- `"Beyonce\u0301"` -> `"Beyonce"`
- `"Sigur Ro\u0301s"` -> `"Sigur Ros"`
- `"Mo\u0308terhead"` -> `"Moterhead"`
- `"Queen"` -> `"Queen"` (plain ASCII unchanged)

#### `normalizeBase(s: string): string`

Pipeline:
1. `normalizeUnicode(s)` -- strip diacritics
2. `.toLowerCase()` -- case fold
3. `.replace(/[^\w\s]/g, "")` -- remove all non-word, non-whitespace characters
4. `.replace(/\s+/g, " ")` -- collapse multiple whitespace to single space
5. `.trim()` -- strip leading/trailing whitespace

Examples:
- `"Don't Stop Me Now!"` -> `"dont stop me now"`
- `"  hello   world  "` -> `"hello world"`
- `"Beyonce\u0301"` -> `"beyonce"`

#### `normalizeArtist(s: string): string`

Pipeline:
1. Replace `&` (with optional surrounding whitespace) with ` and `: `s.replace(/\s*&\s*/g, " and ")`
2. Apply `normalizeBase()` on the result
3. Strip leading `"the "` prefix: `.replace(/^the\s+/, "")`

Examples:
- `"The Smiths"` -> `"smiths"`
- `"The The"` -> `"the"` (strips only the leading "the ")
- `"Simon & Garfunkel"` -> `"simon and garfunkel"`
- `"The Beastie\u0301 Boys & Friends"` -> `"beastie boys and friends"`

#### `removeStopwords(words: Set<string>): Set<string>`

1. Filter out any word present in `STOPWORDS`.
2. If the filtered set is non-empty, return it.
3. If the filtered set is empty (all words were stopwords), return the **original** unfiltered set.

Examples:
- `{"the", "sound", "of", "music"}` -> `{"sound", "music"}`
- `{"the", "a", "of"}` -> `{"the", "a", "of"}` (all stopwords -- return original)

#### `stripRemixSuffix(title: string): string`

Two-pass approach, tried in order:

**Pass 1 -- dash pattern:** Find the last occurrence of `" - "` in the title. If found, extract the suffix after it. If that suffix contains any word matching `REMIX_KEYWORDS` (after stripping non-word chars from each word), return the title truncated before the dash (trimmed).

**Pass 2 -- parenthesis pattern:** Match `^(.+?)\s*\(([^)]+)\)\s*$` (last parenthesized group at the end). If the content inside parentheses contains any remix keyword, return the text before the parentheses (trimmed).

**Neither matches:** Return the original title unchanged.

The helper function `hasRemixKeyword(s)` splits on whitespace and checks if any word (after removing non-word chars) is in `REMIX_KEYWORDS`.

Examples:
- `"Blue Monday - 2023 Remix"` -> `"Blue Monday"`
- `"Blue Monday (Radio Edit)"` -> `"Blue Monday"`
- `"Heroes - 2017 Remastered"` -> `"Heroes"`
- `"Blue Monday"` -> `"Blue Monday"` (no suffix)
- `"Blue Monday - Part 2"` -> `"Blue Monday - Part 2"` (non-remix dash suffix)
- `"Yesterday (From the Album Help)"` -> `"Yesterday (From the Album Help)"` (no remix keyword)

### ISRC Match Strategy

#### `IsrcMatchStrategy` class

- `name`: `"isrc"` (readonly)
- Implements `MatchStrategy.match(source, candidates)`

Algorithm:
1. If `source.isrc` is falsy, return `[]` immediately.
2. Normalize source ISRC to uppercase.
3. Iterate all candidates:
   - Skip candidates without an `isrc` field.
   - Compare uppercased ISRCs.
   - On exact match, push `MatchResult` with score `1.0`, confidence `"high"`, method `"isrc"`.
4. Return accumulated results.

Key behaviors:
- Case-insensitive comparison (both sides uppercased).
- Multiple candidates can match the same ISRC.
- No partial matching -- exact or nothing.

### Fuzzy Match Strategy

#### Constants

**`MIN_THRESHOLD`** (module-private): `0.3` -- candidates below this are excluded.

**`WEIGHT_PRESETS`** (module-private):

| Context | title | artist | album | duration |
|---|---|---|---|---|
| `"lexicon"` | 0.30 | 0.30 | 0.15 | 0.25 |
| `"soulseek"` | 0.30 | 0.25 | 0.10 | 0.35 |
| `"post-download"` | 0.30 | 0.30 | 0.15 | 0.25 |

All weight profiles sum to 1.0. `DEFAULT_WEIGHTS` = `WEIGHT_PRESETS.lexicon`.

#### Algorithm: Damerau-Levenshtein Distance

Module-private function: `damerauLevenshtein(a: string, b: string): number`

This is the **full** Damerau-Levenshtein algorithm (not OSA). Correctly handles non-adjacent transpositions.

- Edge cases: empty `a` returns `b.length`; empty `b` returns `a.length`.
- Matrix: `(m + 2) x (n + 2)` where `m = a.length`, `n = b.length`.
- `maxDist = m + n` (sentinel value).
- `d[0][0] = maxDist`; `d[i+1][0] = maxDist`, `d[i+1][1] = i`; `d[0][j+1] = maxDist`, `d[1][j+1] = j`.
- Character position map `da`: `Record<string, number>`, initialized empty.
- Main loop: for `i` 1..m, `db = 0`, for `j` 1..n:
  - `i1 = da[b[j-1]] || 0`, `j1 = db`
  - `cost = (a[i-1] === b[j-1]) ? 0 : 1`; if match, `db = j`
  - `d[i+1][j+1] = min(substitution, insertion, deletion, transposition)`
  - After inner loop: `da[a[i-1]] = i`
- Return `d[m+1][n+1]`.

#### Algorithm: Edit Similarity

`editSimilarity(a, b)`: `1 - damerauLevenshtein(a, b) / max(a.length, b.length)`

Edge cases: both empty = `1`; one empty = `0`.

#### Algorithm: Jaccard Similarity

`jaccardSimilarity(a: Set, b: Set)`: `|intersection| / |union|`

Edge cases: both empty = `1`; one empty = `0`.

#### Algorithm: Word Set Construction

`wordSet(s: string): Set<string>`: if empty, return empty set; otherwise split on `" "`.

#### Algorithm: String Similarity

`stringSimilarity(normA, normB)`:
1. Build word sets with stopword removal.
2. Compute Jaccard on filtered word sets.
3. Compute edit similarity on full normalized strings.
4. Return `max(jaccard, edit)`.

#### Algorithm: Artist Similarity

`artistSimilarity(normA, normB)`:
1. Compute `base = stringSimilarity(normA, normB)`.
2. **Containment floor**: if both non-empty and one contains the other as substring, return `max(base, 0.7)`.
3. Otherwise return `base`.

#### Algorithm: Duration Similarity

`durationSimilarity(aMs, bMs)`: `max(0, 1 - (diff / 30000)^1.5)`

Edge cases: both missing = `1.0`; one missing = `0.5`.

Curve: 0ms=1.0, 5s~0.97, 15s~0.81, 30s=0.0.

#### Algorithm: Confidence Assignment

`assignConfidence(score, config)`:
- `score >= autoAcceptThreshold` -> `"high"`
- `score >= reviewThreshold` -> `"review"`
- Otherwise -> `"low"`

#### `FuzzyMatchStrategy.match(source, candidates)`

For each candidate:

1. **Normalize**: `normalizeBase(title)`, `normalizeArtist(artist)`, `normalizeBase(album)` if present.
2. **Artist gate**: compute `artScore`; if `artistRejectThreshold` set and `artScore < threshold`, skip candidate.
3. **Title score with remix fallback**: compute `titleScore`; if `< reviewThreshold`, try stripped versions via `stripRemixSuffix` and take `max`.
4. **Duration score**: `durationSimilarity(source.durationMs, candidate.durationMs)`.
5. **Album score with weight redistribution**: if both albums present, compute similarity; else redistribute `wAl` proportionally to other weights.
6. **Weighted score**: `wT * titleScore + wA * artScore + wAl * albumScore + wD * durScore`.
7. **Threshold filter**: skip if `score < MIN_THRESHOLD` (0.3).
8. **Build result**: push `MatchResult` with confidence from `assignConfidence`, method `"fuzzy"`.
9. **Sort**: descending by score.

### Composite Match Strategy

#### `CompositeMatchStrategy.match(source, candidates)`

**Phase 1: Short-circuit scan**
Iterate strategies in order. Run each. If any result has `confidence === "high"`, return that strategy's full result set immediately.

**Phase 2: Fallback merge (no high-confidence result)**
Re-run all strategies. Merge into `Map<TrackInfo, MatchResult>` by candidate reference, keeping highest score per candidate. Reassign confidence using composite's `MatchOptions`. Override method to `"composite"`. Sort descending by score.

### `createMatcher()` Factory

```ts
function createMatcher(options: MatchOptions, context?: MatchContext): MatchStrategy
```

Creates `CompositeMatchStrategy` with:
1. `new IsrcMatchStrategy()`
2. `new FuzzyMatchStrategy({ ...options, context })`

### Re-exports from `index.ts`

Types: `MatchStrategy`, `MatchOptions`, `MatchContext`, `WeightProfile`, `FuzzyMatchConfig`.
Classes: `IsrcMatchStrategy`, `FuzzyMatchStrategy`, `CompositeMatchStrategy`.
Function: `createMatcher`.

## Error Handling

All functions are pure and accept any valid input without throwing:

- `normalizeUnicode("")` -> `""`
- `normalizeBase("")` -> `""`
- `normalizeArtist("")` -> `""`
- `removeStopwords(new Set())` -> `new Set()`
- `stripRemixSuffix("")` -> `""`
- `IsrcMatchStrategy.match(source, [])` -> `[]`
- Empty candidate list -> `[]`
- Empty title/artist: similarity functions handle (both-empty = 1, one-empty = 0)
- Missing duration on both sides: 1.0; on one side: 0.5
- Missing album on either side: weight redistributed
- All candidates below `MIN_THRESHOLD`: `[]`

## Tests

Test framework: Vitest. Tests co-located at `src/matching/__tests__/`.

### `normalize.test.ts`

#### `normalizeUnicode`
- `"Beyonce\u0301"` -> `"Beyonce"`
- `"Sigur Ro\u0301s"` -> `"Sigur Ros"`
- `"Mo\u0308terhead"` -> `"Moterhead"`
- `"Queen"` -> `"Queen"`

#### `normalizeBase`
- `"Don't Stop Me Now!"` -> `"dont stop me now"`
- `"  hello   world  "` -> `"hello world"`
- `"Beyonce\u0301"` -> `"beyonce"`

#### `normalizeArtist`
- `"The Smiths"` -> `"smiths"`
- `"The The"` -> `"the"`
- `"Simon & Garfunkel"` -> `"simon and garfunkel"`
- `"The Beastie\u0301 Boys & Friends"` -> `"beastie boys and friends"`

#### `removeStopwords`
- `{"the", "sound", "of", "music"}` -> `{"sound", "music"}`
- `{"the", "a", "of"}` -> `{"the", "a", "of"}`

#### `stripRemixSuffix`
- `"Blue Monday - 2023 Remix"` -> `"Blue Monday"`
- `"Blue Monday (Radio Edit)"` -> `"Blue Monday"`
- `"Heroes - 2017 Remastered"` -> `"Heroes"`
- `"Blue Monday"` -> `"Blue Monday"`
- `"Blue Monday - Part 2"` -> `"Blue Monday - Part 2"`
- `"Yesterday (From the Album Help)"` -> `"Yesterday (From the Album Help)"`

### `isrc.test.ts`

1. **Matching ISRC returns score 1.0**: score 1.0, confidence "high", method "isrc".
2. **No ISRC on source returns empty**.
3. **No matching ISRC in candidates returns empty**.
4. **Multiple candidates with same ISRC all returned**: length 2, all score 1.0.

### `fuzzy.test.ts`

Setup: default config `{ autoAcceptThreshold: 0.85, reviewThreshold: 0.6 }`.

1. **Exact match scores ~1.0 with high confidence**.
2. **Close match with small typo scores high** (>0.7).
3. **Same title, different artist scores medium** (>0.3 and <0.85).
4. **Completely different track scores low or absent** (<0.5).
5. **Duration penalty**: close durations score higher than far durations.
6. **Case insensitivity**: score >= 0.95.
7. **Punctuation tolerance**: score > 0.85.
8. **Empty candidates**: returns `[]`.
9. **Diacritics**: score >= 0.95.
10. **Stopword invariance**: score > 0.8.
11. **Artist containment (feat.)**: score > 0.7.
12. **Remix fallback**: score > 0.7.
13. **Album contributes**: matching album scores higher than wrong album.
14. **Artist gate in soulseek context**: empty results for mismatched artist.
15. **Duration power curve**: 15s diff scores higher than 30s diff.
16. **Transposition typo**: score > 0.8.

### `composite.test.ts`

1. **ISRC match short-circuits**: score 1.0, method "isrc".
2. **Fallback to fuzzy -- exact match short-circuits**: score > 0.85, method "fuzzy".
3. **Fallback merges when no high confidence**: method "composite".
4. **Deduplication by candidate**: each candidate appears at most once.
5. **createMatcher factory works**: first result score 1.0, confidence "high".

## Acceptance Criteria

1. All five normalization functions exported with exact behavior described above.
2. `STOPWORDS` exported as `Set<string>` with exactly 12 members.
3. `REMIX_KEYWORDS` module-private with exactly 15 members.
4. `normalizeUnicode` uses NFKD -> combining-mark removal -> NFC.
5. `normalizeBase` applies pipeline in exact order: unicode, lowercase, punctuation, whitespace, trim.
6. `normalizeArtist` converts `&` to `and` before base normalization, strips leading "the " after.
7. `removeStopwords` preserves original set when all words are stopwords.
8. `stripRemixSuffix` tries dash then paren, returns original if neither matches.
9. `IsrcMatchStrategy.name` is `"isrc"`. ISRC comparison case-insensitive. Always score 1.0 / confidence "high" / method "isrc".
10. `MIN_THRESHOLD` is 0.3.
11. Weight presets: lexicon (0.30, 0.30, 0.15, 0.25), soulseek (0.30, 0.25, 0.10, 0.35), post-download (0.30, 0.30, 0.15, 0.25). Default = lexicon.
12. Damerau-Levenshtein is the full algorithm (not OSA), `(m+2) x (n+2)` matrix with `da` map.
13. Edit similarity: `1 - dist / max(len1, len2)`.
14. Jaccard: `|intersection| / |union|`, both-empty = 1.
15. String similarity: `max(jaccard_with_stopwords, edit_similarity)`.
16. Artist similarity: containment floor of 0.7 when one normalized string contains the other.
17. Duration similarity: `max(0, 1 - (diff / 30000)^1.5)`. Both missing = 1.0, one missing = 0.5.
18. Album weight redistribution preserves total weight = 1.0.
19. Remix fallback triggered only when `titleScore < reviewThreshold`.
20. Artist gate skips candidate when `artScore < artistRejectThreshold`.
21. Composite short-circuits on first strategy producing any "high" confidence result.
22. Composite fallback merges, deduplicates by reference, keeps highest score, reassigns confidence, overrides method to "composite".
23. `createMatcher()` creates `CompositeMatchStrategy([IsrcMatchStrategy, FuzzyMatchStrategy], options)`.
24. Results sorted descending by score in both Fuzzy and Composite strategies.
25. All types (`MatchStrategy`, `MatchOptions`, `MatchContext`, `WeightProfile`, `FuzzyMatchConfig`) exported from `types.ts`.
26. `FuzzyMatchConfig` extends `MatchOptions`.
27. All tests pass in Vitest.
