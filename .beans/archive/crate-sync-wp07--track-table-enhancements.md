---
# crate-sync-wp07
title: Track table enhancements in PlaylistDetail
status: completed
type: task
priority: normal
created_at: 2026-03-19T12:00:00Z
updated_at: 2026-03-19T12:00:00Z
parent: crate-sync-wp00
---

## Scope

Enhance the track table in PlaylistDetail with sorting, search, duration summary, and track links.

## Details

- Client-side sorting on columns: title, artist, album, duration, position
- Search/filter bar for title + artist
- Total duration summary bar at the top or bottom
- Link track rows to TrackDetail page
- Pure frontend work — no API changes needed

## Key Files

- `web/src/pages/PlaylistDetail.tsx`

## Acceptance Criteria

- [ ] Sortable column headers for title, artist, album, duration, position
- [ ] Search bar filters tracks by title or artist
- [ ] Total duration displayed (e.g., "2h 34m across 45 tracks")
- [ ] Clicking a track row navigates to TrackDetail page
