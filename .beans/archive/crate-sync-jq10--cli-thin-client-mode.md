---
# crate-sync-jq10
title: CLI thin client mode for sync command
status: completed
type: task
priority: low
created_at: 2026-03-17T16:20:00Z
parent: crate-sync-ph2e
---

When `crate-sync serve` is running, `crate-sync sync <playlist>` should:
1. Detect that the server is running (try GET /api/status)
2. POST to `/api/sync/:playlistId` to create jobs
3. Connect to SSE stream and display real-time progress in the terminal
4. Show job status updates as they flow through the queue

Add `--standalone` flag to force the old behavior (run pipeline directly without server).

This is lower priority because the current standalone mode works fine and the web UI provides the same functionality. The main benefit is avoiding two separate Soulseek connections and letting the job runner handle retries.
