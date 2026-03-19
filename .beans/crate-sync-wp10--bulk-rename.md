---
# crate-sync-wp10
title: Bulk rename (find-replace, prefix/suffix)
status: todo
type: task
priority: low
created_at: 2026-03-19T12:00:00Z
updated_at: 2026-03-19T12:00:00Z
parent: crate-sync-wp00
depends_on: crate-sync-wp03
---

## Scope

Bulk rename playlists with find/replace or prefix/suffix modes, with mandatory dry-run preview.

## Details

- Two modes: find/replace (literal or regex) and prefix/suffix (add/remove)
- Mandatory dry-run preview showing before/after for all affected playlists
- New API route: `POST /api/playlists/bulk-rename`
- Optional "push to Spotify" checkbox to sync renames upstream

## Key Files

- `src/api/routes/playlists.ts` — bulk-rename endpoint
- `web/src/pages/Playlists.tsx` — bulk rename modal with mode selector and preview

## Acceptance Criteria

- [ ] Find/replace mode supports literal and regex patterns
- [ ] Prefix/suffix mode can add or remove prefixes/suffixes
- [ ] Dry-run preview shows before/after for all affected playlists
- [ ] User must confirm after reviewing preview
- [ ] Optional Spotify push applies renames upstream
- [ ] Only affected playlists are shown in preview
