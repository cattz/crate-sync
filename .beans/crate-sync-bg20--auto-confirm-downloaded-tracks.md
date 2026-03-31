---
# crate-sync-bg20
title: Auto-confirm downloaded tracks on re-sync
status: done
type: task
priority: high
created_at: 2026-03-31T00:00:00Z
updated_at: 2026-03-31T00:00:00Z
---

## Description

When a file is downloaded from Soulseek, validated, and moved to Lexicon/Incoming for Spotify track X, store the file path association. On re-sync, if a Lexicon track's file path matches a file we placed, auto-confirm the match instead of relying on fuzzy matching (which may fail due to metadata differences).

## Behavior

1. When `moveToPlaylistFolder()` succeeds, record `{ spotifyTrackId, filePath }` in a new `placed_files` table (or extend downloads table)
2. During `matchPlaylist()`, before running the fuzzy matcher, check if any Lexicon track's `filePath` matches a placed file for the current Spotify track
3. If found → auto-confirm (score 1.0, method "placed") and tag
4. This only applies to files that passed validation — it's not blindly trusting the search

## Key Files

- `src/db/schema.ts` — new table or column for placed file paths
- `src/services/download-service.ts` — record placed file after move
- `src/services/sync-pipeline.ts` — check placed files before fuzzy matching
