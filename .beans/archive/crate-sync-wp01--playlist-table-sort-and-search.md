---
# crate-sync-wp01
title: Playlist table sort and search
status: completed
type: task
priority: high
created_at: 2026-03-19T12:00:00Z
updated_at: 2026-03-19T12:00:00Z
parent: crate-sync-wp00
---

## Scope

Client-side column sorting (name, tracks, last synced) and a search bar filtering by name on the Playlists page.

## Details

- Add sortable column headers (click to toggle asc/desc) for Name, Tracks, Last Synced
- Add a text input search bar that filters playlists by name (case-insensitive substring match)
- Pure frontend work on `Playlists.tsx` — no API or schema changes needed

## Key Files

- `web/src/pages/Playlists.tsx`

## Acceptance Criteria

- [ ] Clicking a column header sorts the table by that column
- [ ] Clicking again reverses the sort direction
- [ ] Visual indicator shows current sort column and direction
- [ ] Search bar filters playlists by name in real time
- [ ] Empty search shows all playlists
