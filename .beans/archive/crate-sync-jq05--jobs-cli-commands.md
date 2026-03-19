---
# crate-sync-jq05
title: Jobs CLI commands + wishlist
status: completed
type: task
priority: normal
created_at: 2026-03-17T16:10:00Z
updated_at: 2026-03-17T16:15:00Z
parent: crate-sync-ph2e
---

Created `src/commands/jobs.ts` with `jobs list` (--status, --type), `jobs retry <id>` (supports short IDs), `jobs retry-all` (--type), `jobs stats`, and `wishlist run`. Registered in index.ts. Serve command now starts job runner by default (--no-jobs to disable).
