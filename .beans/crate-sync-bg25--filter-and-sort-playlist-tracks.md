---
# crate-sync-bg25
title: Filter playlist tracks by status + fix sorting
status: done
type: bug
priority: normal
created_at: 2026-04-01T00:00:00Z
updated_at: 2026-04-01T00:00:00Z
---

## Description

Two issues in the playlist detail track table:

### 1. Filter tracks by status
Add a status filter (dropdown or toggle buttons) to filter tracks by their sync status: All, In Lexicon, Downloaded, Pending Review, Not Found, etc.

### 2. Sorting by Status column doesn't work properly
Screenshot shows sorting by Status ascending — "In Lexicon" and "Downloaded" tracks are mixed with "—" (no status) tracks. The sort appears to be treating status as a string but the column shows badges. The sort comparison likely isn't handling the status values correctly.

## Key Files

- `web/src/pages/PlaylistDetail.tsx` — track table, sorting logic, status column
