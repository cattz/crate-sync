---
# crate-sync-bg18
title: Match and Spotify Sync jobs should display track info in logs
status: done
type: bug
priority: normal
created_at: 2026-03-31T00:00:00Z
updated_at: 2026-03-31T00:00:00Z
---

## Description

In the Logs and status bar, Match and Spotify Sync jobs show only the job ID (e.g. "done ca564c53") instead of track/playlist info. Search and Download jobs correctly show "Artist — Title" because their payloads include that data.

## Expected behavior

- **Spotify Sync**: show playlist name (e.g. "done PXD/26/Roadtrip")
- **Match (lexicon_match)**: show playlist name (e.g. "done PXD/26/Roadtrip — 4 matched, 1 not found")

## Likely cause

The job payload for `spotify_sync` and `lexicon_match` jobs doesn't include `title`/`artist` fields — it has `playlistId` or `playlistName` instead. The frontend detail extraction in Logs.tsx and App.tsx only checks for `payload.title`.

## Key Files

- `src/jobs/handlers/spotify-sync.ts` — payload shape
- `src/jobs/handlers/lexicon-match.ts` — payload shape
- `src/jobs/runner.ts` — completeJob result payload
- `web/src/pages/Logs.tsx` — detail extraction logic
- `web/src/App.tsx` — StatusBar detail extraction logic
