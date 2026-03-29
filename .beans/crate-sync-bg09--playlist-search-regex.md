---
# crate-sync-bg09
title: Playlist search should support regex
status: todo
type: task
priority: normal
created_at: 2026-03-29T00:00:00Z
updated_at: 2026-03-29T00:00:00Z
---

## Description

The playlist search/filter bar (CLI and web) currently does substring matching. It should also support regex patterns for more powerful filtering (e.g. `^House` to find playlists starting with "House", `(Tech|Techno)` for alternatives).

## Behavior

- Default: plain substring match (current behavior)
- If the input looks like a regex (e.g. starts/ends with `/`) or a toggle is enabled, treat as regex
- Invalid regex should fall back to literal match, not error

## Key Files

- `web/src/pages/Playlists.tsx` — client-side filtering
- `src/services/playlist-service.ts` — `getPlaylists` filtering
- `src/commands/playlists.ts` — CLI `list --filter`
