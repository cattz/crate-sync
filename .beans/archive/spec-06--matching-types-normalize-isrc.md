---
# spec-06
title: "Matching: types, normalization, ISRC strategy"
status: todo
type: task
priority: critical
parent: spec-E2
depends_on: spec-02
created_at: 2026-03-24T00:00:00Z
updated_at: 2026-03-24T00:00:00Z
---

## Purpose

Define the core type contracts for the pluggable matching system, implement all text normalization functions used before similarity comparison, and provide the simplest matching strategy (exact ISRC lookup). These are pure-logic, zero-I/O modules that form the foundation for fuzzy and composite matching in spec-07.

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

## Dependencies

| Module | Dependency | Kind |
|---|---|---|
| `types.ts` | `../types/common.js` (`TrackInfo`, `MatchResult`) | type-only import |
| `normalize.ts` | none | standalone |
| `isrc.ts` | `../types/common.js` (`TrackInfo`, `MatchResult`) | type-only import |
| `isrc.ts` | `./types.js` (`MatchStrategy`) | type-only import |

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

This strips diacritics while preserving base characters. Uses the Unicode property escape `\p{M}` with the `u` flag.

Examples:
- `"Beyonce\u0301"` -> `"Beyonce"`
- `"Sigur Ro\u0301s"` -> `"Sigur Ros"`
- `"Mo\u0308terhead"` -> `"Moterhead"`
- `"Queen"` -> `"Queen"` (plain ASCII unchanged)

#### `normalizeBase(s: string): string`

Pipeline:
1. `normalizeUnicode(s)` -- strip diacritics
2. `.toLowerCase()` -- case fold
3. `.replace(/[^\w\s]/g, "")` -- remove all non-word, non-whitespace characters (strips punctuation: apostrophes, exclamation marks, etc.)
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

Key detail: step 3 only strips the leading "the "; subsequent occurrences of "the" within the string are preserved.

Examples:
- `"The Smiths"` -> `"smiths"`
- `"The The"` -> `"the"` (strips only the leading "the ", the second "the" remains)
- `"Simon & Garfunkel"` -> `"simon and garfunkel"`
- `"The Beastie\u0301 Boys & Friends"` -> `"beastie boys and friends"` (combines all transformations)

#### `removeStopwords(words: Set<string>): Set<string>`

1. Filter out any word present in `STOPWORDS`.
2. If the filtered set is non-empty, return it.
3. If the filtered set is empty (all words were stopwords), return the **original** unfiltered set to avoid degenerate empty input to similarity functions.

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
- `"Blue Monday - Part 2"` -> `"Blue Monday - Part 2"` ("Part" and "2" are not remix keywords)
- `"Yesterday (From the Album Help)"` -> `"Yesterday (From the Album Help)"` (no remix keyword in parens)

### ISRC Match Strategy

#### `IsrcMatchStrategy` class

- `name`: `"isrc"` (readonly)
- Implements `MatchStrategy.match(source, candidates)`

Algorithm:
1. If `source.isrc` is falsy (undefined/null/empty), return `[]` immediately.
2. Normalize source ISRC to uppercase: `source.isrc.toUpperCase()`.
3. Iterate all candidates:
   - Skip candidates without an `isrc` field.
   - Compare `candidate.isrc.toUpperCase()` against the uppercase source ISRC.
   - On exact match, push a `MatchResult` with:
     - `candidate`: the matching candidate
     - `score`: `1.0`
     - `confidence`: `"high"`
     - `method`: `"isrc"`
4. Return accumulated results (no sorting needed; all scores are 1.0).

Key behaviors:
- Case-insensitive comparison (both sides uppercased).
- Multiple candidates can match the same ISRC (e.g., original + remaster sharing the same ISRC code).
- No partial matching -- ISRC is either exact or no match.

## Error Handling

These are pure functions with no failure modes beyond receiving invalid input. All functions accept any string (including empty strings) gracefully:

- `normalizeUnicode("")` -> `""`
- `normalizeBase("")` -> `""`
- `normalizeArtist("")` -> `""`
- `removeStopwords(new Set())` -> `new Set()` (empty set returned as-is since filtered is also empty, but the guard `filtered.size > 0` is false, so original empty set is returned)
- `stripRemixSuffix("")` -> `""` (no dash found, no paren match)
- `IsrcMatchStrategy.match(source, [])` -> `[]`

## Tests

Test framework: Vitest. Tests co-located at `src/matching/__tests__/`.

### `normalize.test.ts`

#### `normalizeUnicode`
- `"Beyonce\u0301"` -> `"Beyonce"` (strips diacritics)
- `"Sigur Ro\u0301s"` -> `"Sigur Ros"` (strips diacritics mid-word)
- `"Mo\u0308terhead"` -> `"Moterhead"` (umlaut)
- `"Queen"` -> `"Queen"` (plain ASCII unchanged)

#### `normalizeBase`
- `"Don't Stop Me Now!"` -> `"dont stop me now"` (lowercase + strip punctuation)
- `"  hello   world  "` -> `"hello world"` (collapse whitespace)
- `"Beyonce\u0301"` -> `"beyonce"` (diacritics + lowercase)

#### `normalizeArtist`
- `"The Smiths"` -> `"smiths"` (strips leading "the")
- `"The The"` -> `"the"` (only strips leading "the ")
- `"Simon & Garfunkel"` -> `"simon and garfunkel"` (& -> and)
- `"The Beastie\u0301 Boys & Friends"` -> `"beastie boys and friends"` (combined)

#### `removeStopwords`
- `{"the", "sound", "of", "music"}` -> `{"sound", "music"}`
- `{"the", "a", "of"}` -> `{"the", "a", "of"}` (all stopwords -- return original)

#### `stripRemixSuffix`
- `"Blue Monday - 2023 Remix"` -> `"Blue Monday"` (dash pattern)
- `"Blue Monday (Radio Edit)"` -> `"Blue Monday"` (paren pattern)
- `"Heroes - 2017 Remastered"` -> `"Heroes"` (dash pattern, "remastered" keyword)
- `"Blue Monday"` -> `"Blue Monday"` (no suffix)
- `"Blue Monday - Part 2"` -> `"Blue Monday - Part 2"` (non-remix dash suffix)
- `"Yesterday (From the Album Help)"` -> `"Yesterday (From the Album Help)"` (non-remix paren content)

### `isrc.test.ts`

#### Setup
- Helper: `makeTrack(overrides)` creates a `TrackInfo` by spreading overrides.

#### Test cases
1. **Matching ISRC returns score 1.0**: source and candidate both have `"USAT21234567"`. Result: length 1, score 1.0, confidence "high", method "isrc".
2. **No ISRC on source returns empty**: source has no isrc field. Result: empty array.
3. **No matching ISRC in candidates returns empty**: source `"USAT21234567"`, candidates have `"GBAYE9800023"` and no ISRC. Result: empty array.
4. **Multiple candidates with same ISRC all returned**: source `"USAT21234567"`, two candidates share it, one has different. Result: length 2, all score 1.0, all confidence "high".

## Acceptance Criteria

1. All five normalization functions are exported and match the exact behavior described above.
2. `STOPWORDS` is exported as a `Set<string>` with exactly 12 members.
3. `REMIX_KEYWORDS` is module-private with exactly 15 members.
4. `normalizeUnicode` uses NFKD decomposition followed by combining-mark removal and NFC recomposition.
5. `normalizeBase` applies unicode normalization, lowercasing, punctuation stripping, whitespace collapsing, and trimming in that exact order.
6. `normalizeArtist` converts `&` to `and` before base normalization, then strips leading `"the "` after.
7. `removeStopwords` preserves the original set when all words are stopwords.
8. `stripRemixSuffix` tries dash pattern first, then paren pattern, returns original if neither matches.
9. `IsrcMatchStrategy.name` is `"isrc"`.
10. ISRC comparison is case-insensitive (both sides uppercased).
11. ISRC match always produces score `1.0`, confidence `"high"`, method `"isrc"`.
12. Missing source ISRC short-circuits to empty results.
13. All types (`MatchStrategy`, `MatchOptions`, `MatchContext`, `WeightProfile`, `FuzzyMatchConfig`) are exported from `types.ts`.
14. `FuzzyMatchConfig` extends `MatchOptions` (inherits `autoAcceptThreshold` and `reviewThreshold`).
15. All tests pass in Vitest.
