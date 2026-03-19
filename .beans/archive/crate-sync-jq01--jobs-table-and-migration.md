---
# crate-sync-jq01
title: Jobs table and migration
status: completed
type: task
priority: high
created_at: 2026-03-17T16:00:00Z
updated_at: 2026-03-17T16:05:00Z
parent: crate-sync-ph2e
---

Added `jobs` table to `src/db/schema.ts` with type, status, priority, JSON payload/result, attempt tracking, max_attempts, run_after (backoff), parent_job_id. Generated migration `0002_bouncy_wallop.sql`. Added Job/NewJob/JobType/JobStatus type exports.
