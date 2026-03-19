---
# crate-sync-wp12
title: Playlist metadata (tags, notes, pinning)
status: completed
type: task
priority: low
created_at: 2026-03-19T12:00:00Z
updated_at: 2026-03-19T12:00:00Z
parent: crate-sync-wp00
---

## Scope

User-defined metadata on playlists: tags, notes, and pinning.

## Details

- New migration adding `tags` (text/JSON), `notes` (text), `pinned` (integer) to `playlists` table
- `PATCH /api/playlists/:id` endpoint for metadata updates
- Pinned playlists sort to top of the table
- Tag badges displayed on playlist rows, filterable by tag
- PlaylistDetail: editable notes textarea, tag editor with autocomplete from existing tags
- Schema change required

## Key Files

- `src/db/schema.ts` — add metadata columns
- `src/db/migrations/` — new migration file
- `src/api/routes/playlists.ts` — PATCH endpoint for metadata
- `web/src/pages/Playlists.tsx` — pin indicator, tag badges, tag filter
- `web/src/pages/PlaylistDetail.tsx` — notes editor, tag editor

## Acceptance Criteria

- [ ] Migration adds `tags`, `notes`, `pinned` columns
- [ ] PATCH endpoint updates metadata fields
- [ ] Pinned playlists appear at the top of the table
- [ ] Tags displayed as badges on playlist rows
- [ ] Tag filter narrows playlist list
- [ ] PlaylistDetail has editable notes and tag editor
- [ ] Tag autocomplete suggests existing tags
