---
# slskd-vqmi
title: Fallback to next candidate on download failure
status: completed
type: bug
priority: high
created_at: 2026-04-03T22:04:02Z
updated_at: 2026-04-03T22:04:02Z
---

## Problem

When a download fails (peer timeout, 'Too many files' rejection, etc.), crate-sync re-queues the same job which picks the same top-ranked user again. It never tries alternative candidates from the search results.

## Evidence (from logs)

Track "High Time" by Glyders had 4 candidates:
- acidzwan (score 0.83) — picked, timed out
- acidzwan (score 0.80) — duplicate user
- isitme (score 0.72) — never tried
- ragnarok (score 0.72, FLAC) — never tried

After acidzwan timed out, no fallback occurred.

## Suggested fix

1. **Persist top N candidates per track** in the downloads table (e.g. a candidates JSON column) when the search completes and ranking is done.
2. **Track which candidates have been attempted** — add an attemptedUsers or rejections entry per failed username+filename pair.
3. **On retry, skip previously failed candidates** — when the download handler picks the next candidate, filter out usernames that failed with non-transient errors (timeout, rejected, too many files).
4. **Only re-search if all candidates exhausted** — fall through to wishlist/re-search only when no untried candidates remain.

## Key files

- src/services/download-service.ts — acquireAndMove() and ranking logic
- src/jobs/handlers/download.ts — download job handler, retry logic
- src/db/schema.ts — downloads table, rejections table
- src/services/soulseek-service.ts — slskd API client

## Related

- slskd returns HTTP 500 with 'Operation timed out' for unreachable peers
- slskd returns HTTP 500 with 'Transfer rejected: Too many files' for overloaded peers
- Both should trigger candidate rotation, not blind retry
