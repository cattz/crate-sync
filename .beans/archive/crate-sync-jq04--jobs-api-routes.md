---
# crate-sync-jq04
title: Jobs REST API + SSE stream
status: completed
type: task
priority: high
created_at: 2026-03-17T16:10:00Z
updated_at: 2026-03-17T16:15:00Z
parent: crate-sync-ph2e
---

Created `src/api/routes/jobs.ts` with GET /api/jobs (filterable), GET /api/jobs/:id (detail + children), GET /api/jobs/stats, GET /api/jobs/stream (SSE), POST retry, DELETE cancel, POST retry-all. Registered in server.ts. Updated sync route to also create root job.
