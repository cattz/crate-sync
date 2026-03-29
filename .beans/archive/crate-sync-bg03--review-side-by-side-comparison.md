---
# crate-sync-bg03
title: Review UI side-by-side track comparison
status: scrapped
type: task
priority: normal
created_at: 2026-03-19T18:00:00Z
updated_at: 2026-03-19T18:00:00Z
---

## Description

Review visualization should show the Spotify track on top of the Lexicon track, field by field, for easy comparison. Ideally, highlight the differences between fields (title, artist, album, duration).

## Current Behavior

Review panel shows a flat list with track name, artist, and match score. No side-by-side comparison with the matched Lexicon track.

## Expected Behavior

- Show Spotify source track fields (title, artist, album, duration)
- Show matched Lexicon target track fields below/beside
- Highlight differing fields (e.g. different spelling, extra text)
- Keep accept/reject buttons accessible

## Key Files

- `web/src/pages/PlaylistDetail.tsx` (ReviewPanel component)
- `web/src/pages/Review.tsx`
- `web/src/pages/Matches.tsx`
- `src/api/routes/matches.ts`

## Resolution

Scrapped — review UI will be rebuilt from scratch in spec-22 (web interactive pages). Side-by-side comparison should be part of the new design.
