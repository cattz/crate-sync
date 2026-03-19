---
# crate-sync-jq02
title: Job runner with polling loop
status: completed
type: task
priority: high
created_at: 2026-03-17T16:05:00Z
updated_at: 2026-03-17T16:10:00Z
parent: crate-sync-ph2e
---

Created `src/jobs/runner.ts` with atomic claim (UPDATE WHERE status='queued'), exponential backoff (1h→6h→24h→7d), SSE event emitter, createJob/completeJob/failJob helpers. Runs in-process alongside Hono server. Configurable poll interval and wishlist scan interval.
