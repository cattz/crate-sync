---
# crate-sync-bg39
title: Merge playlists — union merge tracks from multiple playlists
status: done
type: task
priority: normal
created_at: 2026-04-06T00:00:00Z
updated_at: 2026-04-06T00:00:00Z
---

## Description

Select multiple playlists and merge their tracks into a target playlist (union — add tracks not already present, preserve order, no duplicates).

## Behavior

- Select playlists via checkboxes → "Merge" button in bulk toolbar
- Modal: pick target playlist (existing or create new), option to delete sources after
- Union merge: for each source, add tracks to target that aren't already there (dedup by track ID)
- Preserve target's existing track order, append new tracks at end
- Optionally delete source playlists after merge

## Interfaces

- **Web**: Merge button in bulk toolbar, modal for target selection
- **CLI**: `playlists merge <target> <source1> [source2...]`
- **API**: `POST /api/playlists/merge` with `{ targetId, sourceIds, deleteSourcesAfter? }`

## Key Files

- `src/services/playlist-service.ts` — add mergeTracks method
- `src/api/routes/playlists.ts` — merge endpoint
- `web/src/pages/Playlists.tsx` — merge button + modal
- `src/commands/playlists.ts` — CLI merge command
