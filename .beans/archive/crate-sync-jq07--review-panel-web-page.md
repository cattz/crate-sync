---
# crate-sync-jq07
title: Web UI review panel with side-by-side comparison
status: completed
type: task
priority: high
created_at: 2026-03-17T16:20:00Z
parent: crate-sync-ph2e
---

Create a dedicated Review page (`web/src/pages/Review.tsx`) that shows:
- Pending matches with side-by-side Spotify vs Lexicon track info (title, artist, album, duration)
- Score visualization and confidence badge
- Bulk accept/reject controls (accept all, reject all, individual)
- Pending download candidates with Soulseek file details (filename, bitrate, duration, username)
- Accept/reject download candidates before they're processed

The current Matches page does basic confirm/reject but lacks the comparison UI. This page is the non-blocking alternative to the CLI's interactive review prompts.

## Summary of Changes
Created `web/src/pages/Review.tsx` with side-by-side Spotify vs Lexicon comparison cards for each pending match. Shows title, artist, album, duration, ISRC, file path. Confirm/reject per-match plus Confirm All/Reject All bulk actions. Match API enriched with `targetTrack` (Lexicon track info). Added nav link and route.
