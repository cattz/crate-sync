---
# crate-sync-wp03
title: Playlist rename and delete from web
status: pending
type: task
priority: high
created_at: 2026-03-19T12:00:00Z
updated_at: 2026-03-19T12:00:00Z
parent: crate-sync-wp00
depends_on: crate-sync-wp02
---

## Scope

Rename and delete playlists from the web UI via modals and new API routes.

## Details

- Rename modal: pre-filled current name, optional "push to Spotify" checkbox
- Delete confirmation dialog: shows playlist name + track count
- New API routes: `PUT /api/playlists/:id/rename`, `DELETE /api/playlists/:id`
- Both reuse existing `PlaylistService` methods
- Disable rename/delete for followed playlists (depends on wp02 ownership data)

## Key Files

- `src/api/routes/playlists.ts` — new rename and delete endpoints
- `web/src/pages/Playlists.tsx` — action buttons, modals
- `web/src/pages/PlaylistDetail.tsx` — action buttons on detail page
- `web/src/api/client.ts` + `hooks.ts` — new mutations

## Acceptance Criteria

- [ ] Rename modal opens with current name pre-filled
- [ ] Rename updates local DB and optionally pushes to Spotify
- [ ] Delete confirmation shows playlist name and track count
- [ ] Delete removes playlist from DB
- [ ] Both actions disabled for followed (non-owned) playlists
- [ ] Table refreshes after rename/delete
