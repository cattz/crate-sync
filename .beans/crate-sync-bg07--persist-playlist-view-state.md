---
# crate-sync-bg07
title: Persist playlist view state when navigating away and back
status: done
type: bug
priority: normal
created_at: 2026-03-20T00:00:00Z
updated_at: 2026-03-20T00:00:00Z
---

## Description

When navigating away from Playlists (list or detail) to another section and back, filters (ownership, search, sort) and scroll position reset. User expects to return to the same view they left.

## Key Files

- `web/src/pages/Playlists.tsx` — filter/sort/search state
- `web/src/pages/PlaylistDetail.tsx` — return to filtered list
- `web/src/main.tsx` — routing setup
