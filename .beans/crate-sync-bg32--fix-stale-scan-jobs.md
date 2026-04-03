---
# crate-sync-bg32
title: Fix stale download_scan jobs blocking the scanner
status: done
type: bug
priority: high
created_at: 2026-04-04T00:00:00Z
updated_at: 2026-04-04T00:00:00Z
---

## Description

The `scheduleDownloadScan()` function only creates a new scan job if no `queued` or `running` scan job exists. If a scan job gets stuck as `queued` (never claimed by the runner), all future scans are blocked.

## Root cause

A `download_scan` job created at 12:37 remained `queued` forever, blocking all scans. The download initiated at 19:31 completed in slskd but was never picked up by the scanner.

## Proposed fix

In `scheduleDownloadScan()`, before checking for existing jobs, clear stale ones:
- If a `queued` scan job is older than 5 minutes, delete it (it should have been claimed within seconds)
- If a `running` scan job is older than 10 minutes, reset it to `queued` (it's stuck)

Also: the orphan reset on startup should handle `download_scan` jobs like other types.

## Key Files

- `src/jobs/runner.ts` — `scheduleDownloadScan()` function
