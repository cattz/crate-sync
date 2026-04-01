---
# crate-sync-bg27
title: Improve review UI — field-by-field comparison with similarity colors
status: done
type: task
priority: normal
created_at: 2026-04-01T00:00:00Z
updated_at: 2026-04-01T00:00:00Z
---

## Description

The review UI currently shows Spotify and Lexicon tracks side-by-side in two boxes, but fields are just listed vertically with no alignment. Hard to compare at a glance.

## Expected layout

Replace the two side-by-side boxes with a compact table: one row per field (Title, Artist, Album, Duration), two columns (Spotify value, Lexicon value). Each cell colored by similarity:
- Green: high similarity (> 0.8)
- Orange: partial similarity (0.4–0.8)
- Red: low similarity (< 0.4)

```
         SPOTIFY                    LEXICON
Title    Burn Baby Burn      (red)  London Calling - Remastered
Artist   Ash                 (red)  The Clash
Album    Free All Angels     (red)  London Calling (Remastered)
Duration 3:29                (grn)  3:21
```

This makes it immediately obvious which fields match and which don't.

## Implementation

- Compute per-field similarity in the frontend (simple normalized string comparison)
- Or: return per-field scores from the API (matching engine already computes them but only returns the composite score)

## Key Files

- `web/src/pages/Review.tsx` — review card layout
