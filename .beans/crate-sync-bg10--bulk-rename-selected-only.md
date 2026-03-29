---
# crate-sync-bg10
title: Bulk rename should only apply to selected playlists
status: todo
type: task
priority: normal
created_at: 2026-03-29T00:00:00Z
updated_at: 2026-03-29T00:00:00Z
---

## Description

Bulk rename currently applies to all playlists matching the pattern. It should instead only apply to playlists that are explicitly selected via the multi-select UI (web) or a filter flag (CLI).

## Behavior

- **Web**: Bulk rename button appears in the bulk toolbar when playlists are selected. Only selected playlists are candidates for the rename operation. Dry-run preview shows only affected selected playlists.
- **CLI**: `playlists bulk-rename <pattern> <replacement> [--regex] [--dry-run] [--filter <name-filter>]` — the `--filter` flag restricts which playlists are considered. Without `--filter`, applies to all owned playlists (with confirmation).

## Key Files

- `web/src/pages/Playlists.tsx` — bulk rename modal + multi-select integration
- `src/services/playlist-service.ts` — `bulkRename()` should accept playlist IDs to scope
- `src/api/routes/playlists.ts` — bulk-rename endpoint body should accept `playlistIds?: string[]`
- `src/commands/playlists.ts` — CLI flag handling
