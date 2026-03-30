---
# crate-sync-bg13
title: Improve sync progress display in web UI
status: done
type: task
priority: high
created_at: 2026-03-30T00:00:00Z
updated_at: 2026-03-30T00:00:00Z
---

## Description

Two improvements to make sync progress more visible in the web UI.

### 1. Status bar with live log

Add a fixed status bar at the bottom of the page that shows the last 3 lines of sync/job activity. Updated in real-time via SSE events. Gives the user a persistent view of what's happening without navigating to the Queue page.

### 2. Track status column in playlist detail

Add a "Status" column to the track table in PlaylistDetail that shows the current state of each track:
- **In Lexicon** — confirmed match exists (green)
- **Pending review** — match parked, awaiting user decision (yellow)
- **Downloading** — active download in progress (blue)
- **Not found** — no match, no download yet (red)
- **Downloaded** — file downloaded, awaiting next sync to match (gray)
- **Failed** — download failed (red)

This requires joining track data with matches and downloads tables to determine per-track status.

## Key Files

- `web/src/App.tsx` — status bar component (fixed bottom)
- `web/src/pages/PlaylistDetail.tsx` — track status column
- `web/src/api/client.ts` — SSE connection for log stream, track status enrichment
- `web/src/api/hooks.ts` — hook for status bar events
- `web/src/styles/globals.css` — status bar styling
- `src/api/routes/playlists.ts` — enrich track list with match/download status
- `src/api/routes/jobs.ts` — SSE endpoint for activity log (may already exist)
