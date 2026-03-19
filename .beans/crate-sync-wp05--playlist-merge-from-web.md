---
# crate-sync-wp05
title: Playlist merge from web
status: completed
type: task
priority: normal
created_at: 2026-03-19T12:00:00Z
updated_at: 2026-03-19T12:00:00Z
parent: crate-sync-wp00
depends_on: crate-sync-wp01
---

## Scope

Merge playlists from the web UI with multi-select and a merge modal.

## Details

- Multi-select checkboxes on playlist rows + "Merge Selected" button
- Modal: target selector (pick existing playlist or create new) + preview (total/unique track counts)
- New API route: `POST /api/playlists/merge`
- Reuses `PlaylistService.mergePlaylistTracks()`

## Key Files

- `src/api/routes/playlists.ts` — merge endpoint
- `web/src/pages/Playlists.tsx` — multi-select checkboxes, merge button, merge modal
- `web/src/api/client.ts` + `hooks.ts` — new mutation

## Acceptance Criteria

- [ ] Checkboxes on playlist rows allow multi-selection
- [ ] "Merge Selected" button appears when 2+ playlists selected
- [ ] Modal shows target selector and preview with track counts
- [ ] Merge creates/updates target playlist with combined unique tracks
- [ ] Table refreshes after merge
