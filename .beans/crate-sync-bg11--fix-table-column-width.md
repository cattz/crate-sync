---
# crate-sync-bg11
title: Fix table column widths to adapt to window width
status: done
type: bug
priority: normal
created_at: 2026-03-29T00:00:00Z
updated_at: 2026-03-29T00:00:00Z
---

## Description

Tables in the web UI have fixed or unconstrained column widths that don't adapt to the browser window size. Columns should flex to fill available width, with sensible min/max constraints per column type.

## Key Files

- `web/src/styles/globals.css` — table styles
- `web/src/pages/Playlists.tsx` — playlist table
- `web/src/pages/PlaylistDetail.tsx` — track table
- `web/src/pages/Downloads.tsx` — downloads table
- `web/src/pages/Queue.tsx` — jobs table
- `web/src/pages/Matches.tsx` — matches table
