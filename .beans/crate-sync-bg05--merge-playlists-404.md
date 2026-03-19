---
# crate-sync-bg05
title: Merging 2 playlists returns 404
status: done
type: bug
priority: high
created_at: 2026-03-19T19:00:00Z
updated_at: 2026-03-19T19:00:00Z
---

## Description

POST /api/playlists/:id/merge returns 404 when trying to merge two playlists from the web UI.

## Likely Cause

Route ordering issue in playlists.ts — the `POST /:id/merge` route may be shadowed by another parameterized route, or the route may not be registered at all.

## Key Files

- `src/api/routes/playlists.ts`
- `web/src/pages/PlaylistDetail.tsx`
