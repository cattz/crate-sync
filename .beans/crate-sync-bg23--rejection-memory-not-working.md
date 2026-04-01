---
# crate-sync-bg23
title: Rejection memory not preventing repeated wrong matches
status: done
type: bug
priority: high
created_at: 2026-04-01T00:00:00Z
updated_at: 2026-04-01T00:00:00Z
---

## Description

When a user rejects a match (e.g. Lexicon "Ginuwine - Pony" is not a good match for Spotify "Skeleton - Pogo"), the same wrong match keeps being proposed on subsequent syncs. The rejection memory should prevent this pair from being suggested again.

## Expected behavior

Once a match pair (sourceId, targetId) is rejected, it should never be proposed again for the same source track. The matcher should skip that pair and try the next best candidate (or mark as "not found" if no better candidate exists).

## Investigation needed

1. Check if rejected pairs are actually being stored in the `matches` table with `status='rejected'`
2. Check if `matchPlaylist()` in `sync-pipeline.ts` correctly loads and consults the rejected pairs set
3. The recent change to re-evaluate rejected pairs (notFoundThreshold) may have introduced a regression — if a rejected pair scores above 0.4, it gets re-proposed as pending review instead of staying rejected
4. Check the upsert logic: does `onConflictDoUpdate` accidentally overwrite a rejected status?

## Likely cause

The notFoundThreshold change allows rejected pairs to be re-evaluated: if the score is >= 0.4, the pair is upgraded to "pending" review. This defeats the purpose of rejection memory — a pair rejected by the user should STAY rejected regardless of score.

## Fix

Only re-evaluate **auto-rejected** pairs (those rejected by the system due to low score), NOT **user-rejected** pairs. Need to distinguish between:
- System rejection (low score, never presented to user) — can be re-evaluated if score improves
- User rejection (explicitly rejected by the user in review) — permanent, never re-propose

## Key Files

- `src/services/sync-pipeline.ts` — matchPlaylist() rejection pair handling
- `src/db/schema.ts` — matches table (may need a field to distinguish user vs system rejection)
