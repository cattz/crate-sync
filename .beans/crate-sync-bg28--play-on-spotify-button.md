---
# crate-sync-bg28
title: Add Play on Spotify button for tracks and playlists
status: done
type: task
priority: normal
created_at: 2026-04-01T00:00:00Z
updated_at: 2026-04-01T00:00:00Z
---

## Description

Add a "Play on Spotify" button that opens the track or playlist in Spotify (web or app) using the Spotify URI.

## Behavior

- **Track**: open `spotify:track:<spotifyId>` or `https://open.spotify.com/track/<spotifyId>`
- **Playlist**: open `spotify:playlist:<spotifyId>` or `https://open.spotify.com/playlist/<spotifyId>`
- Use `window.open()` with the web URL — Spotify app intercepts `open.spotify.com` links if installed
- Only show button when `spotifyId` or `spotifyUri` is available

## Locations

- Playlist detail page: play button next to playlist name
- Track table rows: small play icon per track
- Review cards: play icon next to the Spotify track title
- Track detail page: play button

## Key Files

- `web/src/pages/PlaylistDetail.tsx`
- `web/src/pages/Review.tsx`
- `web/src/pages/TrackDetail.tsx`
