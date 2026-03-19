---
# crate-sync-wp09
title: Similarity suggestions (merge candidates)
status: pending
type: task
priority: low
created_at: 2026-03-19T12:00:00Z
updated_at: 2026-03-19T12:00:00Z
parent: crate-sync-wp00
depends_on: crate-sync-wp05
---

## Scope

Pairwise playlist name similarity to suggest merge candidates.

## Details

- Compute Levenshtein distance between all playlist name pairs
- New API route: `GET /api/playlists/similar?threshold=0.7`
- UI panel on Playlists page showing similar pairs with similarity scores
- "Merge" quick action button on each pair (plugs into wp05 merge flow)

## Key Files

- `src/api/routes/playlists.ts` — similarity endpoint
- `web/src/pages/Playlists.tsx` — similarity suggestions panel

## Acceptance Criteria

- [ ] API returns pairs of playlists exceeding similarity threshold
- [ ] Panel displays pairs with names and similarity scores
- [ ] Threshold is configurable via query parameter
- [ ] "Merge" button on each pair opens merge flow
