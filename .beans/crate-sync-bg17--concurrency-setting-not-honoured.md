---
# crate-sync-bg17
title: Download concurrency setting not being honoured
status: done
type: bug
priority: high
created_at: 2026-03-31T00:00:00Z
updated_at: 2026-03-31T00:00:00Z
---

## Description

The `download.concurrency` config setting (default 3) is not being honoured. The job runner processes jobs sequentially (one at a time via polling), so the concurrency only applies within a single `downloadBatch` call, not across queued download/search jobs.

## Expected behavior

Multiple search and download jobs should run concurrently up to the configured limit (e.g. 3 parallel downloads).

## Likely cause

The job runner in `src/jobs/runner.ts` uses `claimNextJob()` in a sequential poll loop — it claims one job, awaits it, then claims the next. The `download.concurrency` setting in `src/services/download-service.ts` only controls parallelism within a single batch download call.

## Possible fixes

- Modify the job runner to claim and run up to N jobs concurrently (where N = `config.download.concurrency` or a separate `jobRunner.concurrency` setting)
- Or keep the runner sequential but have the `lexicon_match` handler create fewer, larger batch jobs instead of one job per track

## Key Files

- `src/jobs/runner.ts` — sequential poll loop (claimNextJob + await)
- `src/config.ts` — `download.concurrency` setting
- `src/services/download-service.ts` — `downloadBatch` sliding-window concurrency
