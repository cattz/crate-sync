---
# crate-sync-bg29
title: Auto-wishlist failed searches with periodic retry
status: done
type: task
priority: high
created_at: 2026-04-01T00:00:00Z
updated_at: 2026-04-01T00:00:00Z
---

## Description

When all search strategies are exhausted for a track, it should automatically be added to a wishlist. The wishlist retries periodically (e.g. daily) since new users may come online with the file.

## Behavior

1. When a search job fails with "all strategies exhausted", mark the track as wishlisted
2. A periodic wishlist scan re-queues wishlisted tracks for search
3. Show "Wishlisted" status badge in track table (distinct from "Not Found")
4. Configurable retry interval (default: 24h)
5. Max retries before giving up permanently (default: 5)

## Key Files

- `src/db/schema.ts` — add wishlist fields to downloads or new wishlist table
- `src/jobs/handlers/search.ts` — on failure, create wishlist entry
- `src/jobs/runner.ts` — periodic wishlist scan interval
- `src/services/playlist-service.ts` — new "wishlisted" TrackStatus
- `web/src/pages/PlaylistDetail.tsx` — wishlist badge
