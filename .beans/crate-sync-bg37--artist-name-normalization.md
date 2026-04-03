---
# crate-sync-bg37
title: Investigate artist name normalization for spelling variants
status: done
type: task
priority: normal
created_at: 2026-04-04T00:00:00Z
updated_at: 2026-04-04T00:00:00Z
---

## Description

Artist names can have different spellings across Spotify, Lexicon, and Soulseek: BLOND:ISH vs Blond-Ish, E.T.A. vs ETA vs E T A, etc. The current `normalizeArtist()` strips "&" → "and" and leading "the", but doesn't handle punctuation variants.

## Examples

- BLOND:ISH vs Blond-Ish vs Blondish
- E.T.A. vs ETA vs E T A
- AC/DC vs ACDC vs AC DC
- Röyksopp vs Royksopp
- Beyoncé vs Beyonce (accents — already handled by normalizeUnicode)

## Investigation needed

1. How much does `normalizeBase` already handle? It strips non-word chars — does that collapse "BLOND:ISH" and "Blond-Ish" to the same string?
2. If not, what additional normalization is needed?
3. Should we maintain an alias table (manual mappings)?
4. Could we use the Spotify artist ID as a canonical key instead of the name string?

## Quick test

Run normalizeBase and normalizeArtist on the known variants and see if they already match.

## Key Files

- `src/matching/normalize.ts` — normalizeBase, normalizeArtist
- `src/matching/fuzzy.ts` — uses normalized strings for comparison
