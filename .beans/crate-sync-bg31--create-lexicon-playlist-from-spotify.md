---
# crate-sync-bg31
title: Create ordered Lexicon playlist from Spotify playlist
status: done
type: task
priority: high
created_at: 2026-04-03T00:00:00Z
updated_at: 2026-04-03T00:00:00Z
---

## Description

For a selected Spotify playlist, create the equivalent playlist in Lexicon DJ preserving the exact track order. Tracks that don't have a confirmed Lexicon match are skipped (not included).

## Behavior

1. Take a Spotify playlist from local DB
2. Get all tracks in order (by position)
3. For each track, look up the confirmed Lexicon match (target_id from matches table)
4. Skip tracks without a confirmed match
5. Create a playlist in Lexicon with the matched track IDs, preserving the original order
6. Playlist name in Lexicon = Spotify playlist name (or configurable)

## Interfaces

- **Web**: "Create Lexicon Playlist" button on Playlist Detail page
- **CLI**: `lexicon create-playlist <playlist-id>`
- **API**: `POST /api/playlists/:id/lexicon` — creates the Lexicon playlist, returns { created: true, trackCount, skipped }

## Notes

- This is a one-shot operation (not a continuous sync)
- If the Lexicon playlist already exists, either update it or error (TBD)
- The Lexicon service currently has no playlist methods (removed in the spec rewrite) — they need to be re-added or a new method created
- Track order is critical — the Lexicon API needs to accept an ordered list

## Key Files

- `src/services/lexicon-service.ts` — re-add createPlaylist / setPlaylistTracks
- `src/services/sync-pipeline.ts` or new service — orchestrate the lookup
- `src/api/routes/playlists.ts` — new endpoint
- `web/src/pages/PlaylistDetail.tsx` — button
