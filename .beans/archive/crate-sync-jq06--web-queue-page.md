---
# crate-sync-jq06
title: Web UI queue page + job detail
status: completed
type: task
priority: normal
created_at: 2026-03-17T16:12:00Z
updated_at: 2026-03-17T16:18:00Z
parent: crate-sync-ph2e
---

Created `web/src/pages/Queue.tsx` (live job list with status/type filters, stats cards, retry/cancel buttons) and `web/src/pages/JobDetail.tsx` (full job view with payload/result JSON, child jobs, parent link). Updated API client with job types and endpoints, added React Query hooks, updated Dashboard with job stats, added Queue nav link and routes.
