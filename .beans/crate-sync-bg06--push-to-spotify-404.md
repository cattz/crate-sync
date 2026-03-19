---
# crate-sync-bg06
title: Push to Spotify returns 404
status: todo
type: bug
priority: high
created_at: 2026-03-19T19:00:00Z
updated_at: 2026-03-19T19:00:00Z
---

## Description

POST /api/playlists/:id/push returns 404 when trying to push local changes to Spotify from the web UI.

## Likely Cause

Route ordering issue in playlists.ts — the `POST /:id/push` route may be shadowed by another parameterized route.

## Key Files

- `src/api/routes/playlists.ts`
- `web/src/pages/PlaylistDetail.tsx`
