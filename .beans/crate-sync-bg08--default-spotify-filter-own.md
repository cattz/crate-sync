---
# crate-sync-bg08
title: Default Spotify filter for playlist lists should be "Own"
status: done
type: task
priority: normal
created_at: 2026-03-29T00:00:00Z
updated_at: 2026-03-29T00:00:00Z
---

## Description

When listing playlists (both CLI and web UI), the default ownership filter should be "Own" (only playlists owned by the authenticated user), not "All". Users primarily work with their own playlists and rarely need to see followed playlists.

## Key Files

- `web/src/pages/Playlists.tsx` — default filter state
- `src/commands/playlists.ts` — CLI `list` default
- `src/api/routes/playlists.ts` — API default if filter is query-param based
