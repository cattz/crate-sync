---
# crate-sync-bg42
title: Remove duplicate tracks from playlists
status: completed
type: task
priority: normal
created_at: 2026-04-06T00:00:00Z
updated_at: 2026-04-06T00:00:00Z
---

## Description

Detect and remove duplicate tracks within playlists. Should work both locally and on Spotify directly.

## Duplicate detection criteria

A track is a duplicate if any of these match against another track in the same playlist:
1. Same Spotify URI (exact duplicate)
2. Same ISRC (same recording, different releases)
3. Same title + artist (fuzzy match, handles spelling variants)

## Behavior

### Single playlist
- "Find Duplicates" button on playlist detail page
- Shows list of duplicate groups with option to keep one and remove the rest
- Removes from both local DB and Spotify playlist

### Bulk (all playlists)
- CLI: `playlists dedup [--all] [--dry-run]`
- API: `POST /api/playlists/dedup` with `{ playlistIds: [] }` or `{ all: true }`
- Shows report: N playlists checked, M duplicates found, K removed

## Spotify API

Spotify allows removing tracks by URI + position:
- `DELETE /v1/playlists/{id}/tracks` with `{ tracks: [{ uri, positions: [N] }] }`
- This removes the duplicate at a specific position while keeping the first occurrence

## Safety

- Always keep the FIRST occurrence, remove subsequent duplicates
- Dry-run mode by default — show what would be removed before doing it
- Confirmation required before actual removal
- Tests covering: exact URI dupes, ISRC dupes, fuzzy title+artist dupes, no false positives

## Key Files

- `src/services/playlist-service.ts` — duplicate detection logic
- `src/api/routes/playlists.ts` — dedup endpoint
- `src/commands/playlists.ts` — dedup CLI command
- `web/src/pages/PlaylistDetail.tsx` — find duplicates button + report
