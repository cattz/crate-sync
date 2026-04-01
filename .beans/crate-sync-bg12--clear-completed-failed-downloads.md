---
# crate-sync-bg12
title: Add option to clear completed or failed downloads
status: done
type: task
priority: normal
created_at: 2026-03-29T00:00:00Z
updated_at: 2026-03-29T00:00:00Z
---

## Description

The downloads list accumulates completed and failed entries over time. Add the ability to clear them from the view and database.

## Behavior

- **Web**: "Clear Completed" and "Clear Failed" buttons on the Downloads page. Each removes matching download records from the DB.
- **CLI**: `downloads clear [--completed] [--failed] [--all]` command.
- **API**: `DELETE /api/downloads?status=done` and `DELETE /api/downloads?status=failed`.

## Key Files

- `web/src/pages/Downloads.tsx` — clear buttons
- `src/api/routes/downloads.ts` — DELETE endpoint
- `src/commands/downloads.ts` — CLI command (may need to recreate since standalone download was removed)
- `src/services/playlist-service.ts` or direct DB query — delete by status
