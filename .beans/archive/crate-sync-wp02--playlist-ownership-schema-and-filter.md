---
# crate-sync-wp02
title: Playlist ownership schema and filter
status: completed
type: task
priority: high
created_at: 2026-03-19T12:00:00Z
updated_at: 2026-03-19T12:00:00Z
parent: crate-sync-wp00
---

## Scope

Add ownership fields to playlists schema, persist owner data from Spotify API, and add ownership filter toggle on the Playlists page.

## Details

- New migration adding `is_owned` (integer), `owner_id` (text), `owner_name` (text) to `playlists` table
- Update `SpotifyService.syncToDb()` to persist owner data from the Spotify API response
- Add "Own / Followed / All" toggle/tabs on Playlists page
- Schema change required

## Key Files

- `src/db/schema.ts` — add ownership columns
- `src/db/migrations/` — new migration file
- `src/services/spotify-service.ts` — persist owner data on sync
- `web/src/pages/Playlists.tsx` — ownership filter toggle

## Acceptance Criteria

- [x] Migration adds `is_owned`, `owner_id`, `owner_name` columns
- [x] Spotify sync populates ownership fields from API data
- [x] Playlists page has Own / Followed / All filter
- [x] Filtering works correctly with sort and search (wp01)
