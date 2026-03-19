---
# crate-sync-wp04
title: Playlist push and repair from web
status: completed
type: task
priority: normal
created_at: 2026-03-19T12:00:00Z
updated_at: 2026-03-19T12:00:00Z
parent: crate-sync-wp00
depends_on: crate-sync-wp02
---

## Scope

Add "Push to Spotify" and "Repair" action buttons on PlaylistDetail page with new API routes.

## Details

- "Push to Spotify" button: calls `POST /api/playlists/:id/push`, reuses CLI logic (getPlaylistDiff + apply)
- "Repair" button: calls `POST /api/playlists/:id/repair`, reuses SyncPipeline.matchPlaylist()
- Both show inline result display (diff summary for push, match report counts for repair)
- Disabled for followed playlists (depends on wp02)

## Key Files

- `src/api/routes/playlists.ts` — push and repair endpoints
- `web/src/pages/PlaylistDetail.tsx` — action buttons and result display
- `web/src/api/client.ts` + `hooks.ts` — new mutations

## Acceptance Criteria

- [ ] Push button triggers Spotify sync and shows diff summary
- [ ] Repair button runs match pipeline and shows OK/review/missing counts
- [ ] Both disabled for followed playlists
- [ ] Loading states shown during operations
- [ ] Error handling for failed operations
