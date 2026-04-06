---
# crate-sync-bg40
title: Repair playlists with broken/local tracks by searching Spotify
status: done
type: task
priority: normal
created_at: 2026-04-06T00:00:00Z
updated_at: 2026-04-06T00:00:00Z
---

## Description

Some Spotify playlists contain broken tracks from old local library imports (`is_local: true` or unavailable tracks). Create a repair workflow that searches Spotify for proper versions of these tracks and rebuilds the playlist.

## Workflow

1. **Detect broken playlists**: Scan playlists for tracks with `is_local: true` or no valid Spotify URI. Show a list of affected playlists with broken track count.
2. **Repair**: For each broken track in a playlist:
   - Search Spotify by title + artist for the proper streaming version
   - If found (high confidence match), add to the repaired list
   - If not found, add to the "not found" report
3. **Create repaired playlist**: Create a new Spotify playlist named `{original}-repaired` containing:
   - All working tracks from the original (in order)
   - Replaced tracks for broken ones (at the same position)
   - Skip tracks that couldn't be found
4. **Review**: Show the user:
   - Repaired playlist with track-by-track comparison (original → replacement)
   - List of tracks that couldn't be found
   - Option to accept (delete old, rename repaired) or reject
5. **Finalize**: On accept:
   - Delete the original playlist from Spotify
   - Rename the repaired playlist (remove "-repaired" suffix)

## Interfaces

- **CLI**: `playlists repair <playlist>` — runs the full workflow interactively
- **API**: `POST /api/playlists/:id/repair` — creates repair job, returns report
- **Web**: "Repair" button on playlist detail (visible when broken tracks detected), shows repair report modal

## Detection

Spotify API returns `is_local: true` for local tracks. These have URIs like `spotify:local:Artist:Album:Title:Duration`. Need to check this during `db sync` and flag in the local DB.

## Key Files

- `src/services/spotify-service.ts` — search Spotify for replacement tracks
- `src/services/playlist-service.ts` — detect broken tracks, create repaired list
- `src/api/routes/playlists.ts` — repair endpoint
- `src/commands/playlists.ts` — repair CLI command
- `web/src/pages/PlaylistDetail.tsx` — repair button + report modal
