---
# crate-sync-jq11
title: End-to-end job queue verification
status: completed
type: task
priority: high
created_at: 2026-03-17T16:20:00Z
parent: crate-sync-ph2e
---

Verify the full job queue pipeline works end-to-end:

1. `pnpm dev serve` — server starts, job runner picks up work
2. Trigger sync via web UI or API — creates spotify_sync job
3. Jobs flow through: spotify_sync → match → search → download
4. Web UI Queue page shows real-time updates
5. Kill server mid-download → restart → resumes from DB state (jobs still queued/failed, not lost)
6. Failed search → wishlist re-queues after cooldown → finds track with different query strategy
7. `pnpm dev jobs list` shows correct state after each step
8. `pnpm dev jobs retry <id>` successfully re-queues and re-processes a failed job

This can be manual testing or integration tests with mocked services. Document any issues found.
