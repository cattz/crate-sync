---
# crate-sync-43nq
title: Network error handling and retries
status: completed
type: task
priority: normal
created_at: 2026-03-10T04:21:32Z
updated_at: 2026-03-10T05:57:58Z
parent: crate-sync-nybe
---

## Summary of Changes
Added `src/utils/retry.ts` with `withRetry()` function implementing exponential backoff with jitter. Wrapped external API fetch calls in SpotifyService, LexiconService, and SoulseekService with retry logic. Default: 3 retries, retries on network errors and 5xx/429 status codes.
