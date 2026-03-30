---
# crate-sync-bg14
title: Dedicated log section for sync events, status badge in playlist
status: done
type: task
priority: high
created_at: 2026-03-30T00:00:00Z
updated_at: 2026-03-30T00:00:00Z
---

## Description

Replace the inline Sync Progress panel in PlaylistDetail with a simple status badge. Move all detailed sync/job event logging to a dedicated Log page accessible from the sidebar.

### 1. Log page (new)

- New route: `/logs`
- Sidebar link: "Logs" (between Queue and Settings)
- Subscribes to both SSE streams: job events + sync events
- Shows a scrollable, chronological log of all events
- Each line: timestamp, event type badge, human-readable message
- Auto-scrolls to bottom as new events arrive
- Optional filter by event type

### 2. PlaylistDetail status badge

- Replace the Sync Progress card with a single status badge next to the Sync button
- States: "Syncing…" (blue, animated), "Synced" (green), "Error" (red)
- Clicking the badge navigates to /logs

## Key Files

- `web/src/pages/Logs.tsx` — new page
- `web/src/pages/PlaylistDetail.tsx` — remove Sync Progress section, add status badge
- `web/src/App.tsx` — add Logs route and sidebar link
- `web/src/main.tsx` — add route definition
- `web/src/api/client.ts` — may need combined event stream
- `web/src/styles/globals.css` — log page styles
