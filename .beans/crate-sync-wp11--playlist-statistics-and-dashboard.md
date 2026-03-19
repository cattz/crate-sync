---
# crate-sync-wp11
title: Playlist statistics and dashboard
status: todo
type: task
priority: low
created_at: 2026-03-19T12:00:00Z
updated_at: 2026-03-19T12:00:00Z
parent: crate-sync-wp00
---

## Scope

Playlist statistics on the detail page and a library stats section on the dashboard.

## Details

- Enrich playlists API response with total duration
- PlaylistDetail stats section: total tracks, total duration, unique artists, most common artist
- Dashboard library stats section: total playlists, total tracks, total duration
- May require minor API enrichment but no schema changes

## Key Files

- `src/api/routes/playlists.ts` — enrich response with computed stats
- `web/src/pages/PlaylistDetail.tsx` — stats display section
- `web/src/pages/Dashboard.tsx` — library stats section

## Acceptance Criteria

- [ ] PlaylistDetail shows total tracks, duration, unique artists, top artist
- [ ] Dashboard shows library-wide stats (total playlists, tracks, duration)
- [ ] Stats computed from existing data (no new schema)
