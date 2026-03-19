---
# crate-sync-wp06
title: Duplicate detection from web
status: todo
type: task
priority: normal
created_at: 2026-03-19T12:00:00Z
updated_at: 2026-03-19T12:00:00Z
parent: crate-sync-wp00
---

## Scope

Duplicate track detection within and across playlists from the web UI.

## Details

- "Find Duplicates" button on PlaylistDetail (within-playlist duplicates)
- Cross-playlist duplicates view (on Playlists page or as a sub-route)
- New API routes: `GET /api/playlists/:id/duplicates`, `GET /api/playlists/duplicates`
- Reuses `findDuplicatesInPlaylist()` / `findDuplicatesAcrossPlaylists()`

## Key Files

- `src/api/routes/playlists.ts` — duplicate detection endpoints
- `web/src/pages/PlaylistDetail.tsx` — within-playlist duplicates button and display
- `web/src/pages/Playlists.tsx` — cross-playlist duplicates view
- `web/src/api/client.ts` + `hooks.ts` — new queries

## Acceptance Criteria

- [ ] "Find Duplicates" button on PlaylistDetail shows within-playlist dupes
- [ ] Duplicate groups displayed with track details
- [ ] Cross-playlist view shows tracks appearing in multiple playlists
- [ ] Both reuse existing service methods
