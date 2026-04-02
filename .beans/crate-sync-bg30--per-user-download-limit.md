---
# crate-sync-bg30
title: Per-user download concurrency limit for Soulseek
status: done
type: bug
priority: high
created_at: 2026-04-02T00:00:00Z
updated_at: 2026-04-02T00:00:00Z
---

## Description

When multiple tracks resolve to the same Soulseek user, crate-sync queues all downloads simultaneously. Remote users reject with "Too many files" when their per-user queue limit is exceeded.

## Current behavior

8 concurrent downloads from DJ_Promo → all rejected with TransferRejectedException.

## Expected behavior

- Limit concurrent downloads per Soulseek user (e.g. max 2 per user)
- When limit is hit, queue remaining downloads and retry when a slot opens
- On "Too many files" rejection, back off and retry from that user later
- Optionally: try next-best result from a different user

## Key Files

- `src/jobs/handlers/download.ts` — initiates downloads without checking per-user count
- `src/services/soulseek-service.ts` — could add per-user tracking
- `src/db/schema.ts` — downloads table has slskd_username
