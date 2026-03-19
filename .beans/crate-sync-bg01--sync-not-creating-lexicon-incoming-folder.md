---
# crate-sync-bg01
title: Sync not creating Lexicon/Incoming folder for new playlists
status: todo
type: bug
priority: high
created_at: 2026-03-19T18:00:00Z
updated_at: 2026-03-19T18:00:00Z
---

## Description

When syncing a new Spotify playlist, a folder is not created in Lexicon/Incoming. Expected behavior is that a matching folder is created so downloaded tracks have a destination.

## Key Files

- `src/services/sync-pipeline.ts`
- `src/services/download-service.ts`
- `src/services/lexicon-service.ts`

## Steps to Reproduce

1. Add a new Spotify playlist that doesn't exist in Lexicon yet
2. Run sync
3. Observe that no folder is created under Lexicon's Incoming directory
