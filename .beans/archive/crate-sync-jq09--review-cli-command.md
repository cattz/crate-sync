---
# crate-sync-jq09
title: Standalone review CLI command
status: completed
type: task
priority: normal
created_at: 2026-03-17T16:20:00Z
parent: crate-sync-ph2e
---

Create `crate-sync review` command (`src/commands/review.ts`) for interactive terminal review outside the sync flow. Features:

- Show all pending matches with side-by-side Spotify vs Lexicon info
- Accept/reject/skip individual matches (y/n/s), accept-all (a), quit (q)
- Show pending download candidates (from search jobs with results awaiting review)
- Accept/reject download candidates
- Works without the server running (reads directly from DB)

This gives CLI parity with the web Review panel (crate-sync-jq07).

## Summary of Changes
Created `src/commands/review.ts` with interactive terminal review. Shows side-by-side Spotify vs Lexicon info for each pending match (title, artist, album, duration, ISRC, file path). Supports y/n/a=all/q=quit/s=skip. Updates match status directly in DB. Registered in index.ts.
