---
# crate-sync-jq08
title: Web UI track detail page with full lifecycle
status: completed
type: task
priority: normal
created_at: 2026-03-17T16:20:00Z
parent: crate-sync-ph2e
---

Create a TrackDetail page (`web/src/pages/TrackDetail.tsx`) accessible from playlist track lists and match/download tables. Shows the full lifecycle for any track:

- **Imported** — Spotify metadata (title, artist, album, duration, ISRC, URI)
- **Matched** — match status, score, method, confidence, Lexicon target details
- **Searched** — which query strategies were tried, result counts per strategy
- **Downloaded** — download status, file path, Soulseek source, validation result
- **Synced** — Lexicon playlist membership, tags applied

Requires a new API endpoint `GET /api/tracks/:id/lifecycle` that aggregates data from tracks, matches, downloads, and jobs tables. Add route to web router and link from existing tables.

## Summary of Changes
Created `web/src/pages/TrackDetail.tsx` and `GET /api/tracks/:id/lifecycle` endpoint. Shows Spotify metadata, playlist membership, all matches with status/score, download history with errors, and related jobs with links to queue detail. Uses `json_extract` to find jobs by trackId in payload. Added route at `/tracks/:id`.
