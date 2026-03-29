---
# spec-13
title: "Search query builder"
status: todo
type: task
priority: critical
parent: spec-E3
depends_on: spec-09
created_at: 2026-03-29T00:00:00Z
updated_at: 2026-03-29T00:00:00Z
---

## Purpose

Generate multiple search query strategies for a track, ordered from most specific to most lenient. The caller (typically the Soulseek download service) tries each query in sequence, stopping at the first that returns results. This module bridges the matching system (spec-09 normalization) with the search/download pipeline, applying a different set of cleaning rules optimized for search engine input rather than similarity comparison.

## Public Interface

### File: `src/search/query-builder.ts`

```ts
interface QueryStrategy {
  label: string;   // human-readable label for logging: "full", "base-title", "title-only", "keywords"
  query: string;   // the actual search query string
}

function generateSearchQueries(track: TrackInfo): QueryStrategy[];
```

## Dependencies

| Module | Dependency | Kind |
|---|---|---|
| `query-builder.ts` | `../types/common.js` (`TrackInfo`) | type-only import |
| `query-builder.ts` | `../matching/normalize.js` (`stripRemixSuffix`) | runtime import |

The only runtime dependency is `stripRemixSuffix` from the matching normalization module (spec-09). No I/O, no database, no network.

## Behavior

### Helper: `cleanForSearch(s: string): string` (module-private)

Cleans a raw string for use in search queries. Different from `normalizeBase` -- this preserves original casing and unicode characters (search engines handle those), but removes structural noise.

Pipeline:
1. `.replace(/\s+-\s+/g, " ")` -- replace ` - ` (space-dash-space) with a single space. This converts "Title - Suffix" to "Title Suffix".
2. `.replace(/\([^)]*\)/g, "")` -- remove all parenthesized content including parentheses. This strips `(Remix)`, `(feat. X)`, `(Extended Mix)`, etc. Handles multiple parenthesized groups.
3. `.replace(/\[[^\]]*\]/g, "")` -- remove all bracketed content including brackets. This strips `[Remastered 2023]`, `[Deluxe Edition]`, etc.
4. `.replace(/\s+/g, " ")` -- collapse multiple spaces to single space.
5. `.trim()` -- strip leading/trailing whitespace.

Examples:
- `"Reliquia - German Brigante Remix"` -> `"Reliquia German Brigante Remix"`
- `"Blue Monday (12 inch version)"` -> `"Blue Monday"`
- `"Close To Me (feat. Swae Lee)"` -> `"Close To Me"`
- `"Song (feat. Artist B) (Radio Edit)"` -> `"Song"`
- `"Track [Remastered 2023]"` -> `"Track"`
- `"Linger - SiriusXM Session"` -> `"Linger SiriusXM Session"`
- `"Sérgio Mendes"` -> `"Sérgio Mendes"` (unicode preserved)

### Helper: `significantWords(s: string, count: number): string[]` (module-private)

Extracts the first N "significant" words from a string to build a keyword-focused search query.

Algorithm:
1. Apply `cleanForSearch(s)` to the input.
2. Split on whitespace: `.split(/\s+/).filter(Boolean)`.
3. Filter to significant words: keep only words with `length > 2`.
4. If the significant set has `>= count` items, use the significant set. Otherwise, fall back to the full word list (including short words).
5. Slice to first `count` items: `.slice(0, count)`.

Rationale: Short words (e.g., "Me", "Up", "It") are less useful as search keywords, but if the title is made up of mostly short words, we fall back to using them.

### `generateSearchQueries(track: TrackInfo): QueryStrategy[]`

Generates an ordered list of search strategies. The caller should try each in order and stop at the first that returns results.

**Setup:**
- `artist = cleanForSearch(track.artist)`
- `title = cleanForSearch(track.title)`

**Strategy 1: "full" -- full cleaned artist + title**
- Condition: both `artist` and `title` are truthy (non-empty after cleaning).
- Query: `"${artist} ${title}"`
- Example: track `{ title: "Mr. Brightside", artist: "The Killers" }` -> `"The Killers Mr. Brightside"`

**Strategy 2: "base-title" -- artist + base title (remix suffix stripped)**
- Compute: `baseTitle = cleanForSearch(stripRemixSuffix(track.title))`
- Condition: both `artist` and `baseTitle` are truthy, **and** `baseTitle !== title` (the stripping actually changed something; avoid duplicate of strategy 1).
- Query: `"${artist} ${baseTitle}"`
- Example: track `{ title: "Reliquia - German Brigante Remix", artist: "Satori" }` -> `"Satori Reliquia"`
- Note: `stripRemixSuffix` is called on the **raw** `track.title` (not the cleaned version), then `cleanForSearch` is applied to the stripped result. This ensures the remix suffix detection works on the original format (which contains ` - ` and parentheses).

**Strategy 3: "title-only" -- just the cleaned title**
- Condition: `title` is truthy.
- Query: `title`
- Example: track `{ title: "Linger - SiriusXM Session", artist: "The Cranberries" }` -> `"Linger SiriusXM Session"`
- Rationale: handles cases where the artist name is spelled differently in the search index.

**Strategy 4: "keywords" -- artist + first 2 significant words from title**
- Compute: `keywords = significantWords(track.title, 2)`
- Condition: both `artist` and `title` are truthy, **and** `keywords.length >= 2`, **and** the resulting query string `"${artist} ${keywords.join(" ")}"` is not already present in any previously generated strategy.
- Query: `"${artist} ${keywords.join(" ")}"`
- Note: `significantWords` is called on **raw** `track.title` (not the cleaned version). The function internally calls `cleanForSearch`.
- The deduplication check iterates existing strategies and compares `.query` strings. If the keywords query is identical to any existing strategy's query, it is **not** added.
- Example: track `{ title: "Never Gonna Give You Up (Extended Club Mix)", artist: "Rick Astley" }` -> keywords extracted from `"Never Gonna Give You Up"` (after cleaning) -> significant words (>2 chars): `["Never", "Gonna", "Give", "You"]` -> first 2: `["Never", "Gonna"]` -> query: `"Rick Astley Never Gonna"`.

### Strategy Generation Summary

| Order | Label | Condition | Query Template |
|---|---|---|---|
| 1 | `"full"` | artist && title | `${artist} ${title}` |
| 2 | `"base-title"` | artist && baseTitle && baseTitle !== title | `${artist} ${baseTitle}` |
| 3 | `"title-only"` | title | `${title}` |
| 4 | `"keywords"` | artist && title && keywords.length >= 2 && not duplicate | `${artist} ${keywords[0]} ${keywords[1]}` |

The function always returns strategies in this order. Strategies that fail their condition are simply omitted.

### Edge Cases

- **Empty artist**: Strategies 1, 2, and 4 are skipped (they all require truthy `artist`). Only strategy 3 ("title-only") is generated.
- **Very short title** (e.g., `"Go"`): `significantWords("Go", 2)` -> after cleaning, words = `["Go"]`, significant (>2 chars) = `[]`, fallback to full list = `["Go"]`, sliced to 2 = `["Go"]` -> length is 1, which is < 2, so strategy 4 is skipped.
- **Title with only parenthetical content** (e.g., `"(Remix)"`): `cleanForSearch("(Remix)")` -> `""` (all content was parenthetical). Title is falsy, so strategies 1, 3, 4 are skipped. Strategy 2 depends on baseTitle which may also be empty.
- **Unicode characters**: Preserved as-is in search queries. `cleanForSearch` does not strip diacritics. `"Sérgio Mendes"` stays `"Sérgio Mendes"`.
- **Remix track where stripped title equals cleaned title**: Strategy 2 is skipped because `baseTitle === title`. Example: `"Simple"` -> `stripRemixSuffix("Simple")` = `"Simple"` -> `cleanForSearch("Simple")` = `"Simple"` = `title`, so base-title strategy is not added.
- **Multiple parenthesized groups**: All are removed by `cleanForSearch`. `"Song (feat. Artist B) (Radio Edit)"` -> `"Song"`.
- **Square brackets**: Removed by `cleanForSearch`. `"Track [Remastered 2023]"` -> `"Track"`.

## Error Handling

Pure function, no failure modes. Any `TrackInfo` input produces a valid (possibly empty) array of strategies. If both artist and title are empty after cleaning, the returned array is empty.

## Tests

Test framework: Vitest. Tests at `src/search/__tests__/query-builder.test.ts`.

### Test cases

1. **Simple track generates full, title-only, and keywords strategies**: `{ title: "Mr. Brightside", artist: "The Killers" }`. Expected: length >= 2, first strategy label "full", first query "The Killers Mr. Brightside".

2. **Remix track generates base-title strategy**: `{ title: "Reliquia - German Brigante Remix", artist: "Satori" }`. Expected: labels include "full" and "base-title", base-title query is "Satori Reliquia".

3. **Parenthetical remix info stripped**: `{ title: "Blue Monday (12 inch version)", artist: "New Order" }`. Expected: first query "New Order Blue Monday".

4. **Featured artist parentheticals stripped**: `{ title: "Close To Me (feat. Swae Lee)", artist: "Ellie Goulding" }`. Expected: first query "Ellie Goulding Close To Me".

5. **Title-only strategy present**: `{ title: "Linger - SiriusXM Session", artist: "The Cranberries" }`. Expected: title-only strategy query is "Linger SiriusXM Session".

6. **Keywords strategy for long titles**: `{ title: "Never Gonna Give You Up (Extended Club Mix)", artist: "Rick Astley" }`. Expected: if keywords strategy exists, it contains "Rick Astley".

7. **Dash in title replaced with space**: `{ title: "Linger - SiriusXM Session", artist: "The Cranberries" }`. Expected: first query "The Cranberries Linger SiriusXM Session".

8. **Deduplication of identical query strings**: `{ title: "Simple", artist: "Artist" }`. Expected: all query strings are unique (no duplicates).

9. **Unicode characters preserved**: `{ title: "Más Que Nada", artist: "Sérgio Mendes" }`. Expected: first query "Sérgio Mendes Más Que Nada".

10. **Multiple parenthesized groups all removed**: `{ title: "Song (feat. Artist B) (Radio Edit)", artist: "Artist A" }`. Expected: first query "Artist A Song".

11. **Square brackets removed**: `{ title: "Track [Remastered 2023]", artist: "Band" }`. Expected: first query "Band Track".

12. **Empty artist handled gracefully**: `{ title: "Some Track", artist: "" }`. Expected: length >= 1, title-only strategy present with query "Some Track".

## Acceptance Criteria

1. `cleanForSearch` removes ` - ` separators, parenthesized content `(...)`, and bracketed content `[...]`, collapses whitespace, and trims.
2. `cleanForSearch` preserves original casing and unicode characters (no lowercasing, no diacritic stripping).
3. `significantWords` filters words with length <= 2, falls back to full word list when too few significant words remain, and returns at most `count` words.
4. `generateSearchQueries` produces strategies in strict order: full, base-title, title-only, keywords.
5. Strategy 2 (base-title) calls `stripRemixSuffix` on the raw title, then `cleanForSearch` on the result.
6. Strategy 2 is omitted when `baseTitle === title` (no remix suffix was stripped).
7. Strategy 4 (keywords) uses `significantWords(track.title, 2)` on the raw title.
8. Strategy 4 is omitted when `keywords.length < 2` or the resulting query duplicates an existing strategy.
9. Empty artist causes strategies 1, 2, and 4 to be skipped; only strategy 3 is generated.
10. The `QueryStrategy` interface has exactly two fields: `label` (string) and `query` (string).
11. All tests pass in Vitest.
