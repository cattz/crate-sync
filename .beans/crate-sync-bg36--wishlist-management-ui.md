---
# crate-sync-bg36
title: Wishlist management section in web UI
status: done
type: task
priority: normal
created_at: 2026-04-04T00:00:00Z
updated_at: 2026-04-04T00:00:00Z
---

## Description

Add a dedicated Wishlist section where users can see all wishlisted tracks and manage them (remove, retry, view details).

## Features

- Table showing wishlisted downloads: track title, artist, playlist, retry count, next retry, error/reason
- Remove from wishlist (delete the download record, stops retries)
- Force retry now (re-queue search immediately)
- Bulk remove selected
- Filter/search by title or artist

## Location

Either a new page `/wishlist` in the sidebar, or a tab/section on the Downloads page filtered to `status=wishlisted`.

## Key Files

- `web/src/pages/Wishlist.tsx` or section in `Downloads.tsx`
- `src/api/routes/downloads.ts` — may need `DELETE /api/downloads/:id` for removing wishlisted entries
- `web/src/api/client.ts` + `hooks.ts` — new methods
