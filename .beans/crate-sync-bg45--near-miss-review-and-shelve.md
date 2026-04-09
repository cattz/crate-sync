---
# crate-sync-bg45
title: "Near-miss matches: review instead of download, shelve unfindable tracks"
status: todo
type: task
priority: high
created_at: 2026-04-09T00:00:00Z
updated_at: 2026-04-09T00:00:00Z
---

## Problem

Tracks that exist in Lexicon under a different version or artist name get missed by auto-matching and enter the download loop unnecessarily:

- **Duration mismatch**: "House Music Machine" by Pedroz — Lexicon has the Extended Mix (5:54), Spotify has the radio edit (3:14). Match scored 0.62, below the 0.65 notFoundThreshold. Download found the same extended mix, which now gets rejected by duration validation. Endless retry loop.
- **Artist name mismatch**: "Ibbiti" is in Lexicon as "Anna Graceman". Fuzzy matching can't bridge that gap. Needs manual assignment.

## Design options discussed

### 1. Near-miss review (score 0.5–0.65)
Instead of sending tracks straight to download when score is between `notFoundThreshold` (0.65) and a new lower bound (~0.5), park them for review. The Review UI would show "closest match in Lexicon" with a note about what didn't match (duration, artist). User can accept or dismiss.

### 2. Shelved state
After wishlist gives up (5 retries), move to `shelved` instead of spawning a new search job. Shelved tracks retry weekly/monthly or only on manual trigger. Stops the aggressive retry loop for genuinely unfindable tracks.

### 3. Manual assignment
Allow manually linking a Spotify track to a Lexicon track from the UI — bypass the matcher entirely. Covers cases like artist name differences (Ibbiti → Anna Graceman) that no fuzzy matching can solve.

### 4. Duration override on accept
If a user manually confirms a Lexicon match with a duration mismatch, skip the download pipeline entirely. The track IS in Lexicon, just a different version.

## Key files

- `src/services/sync-pipeline.ts` — matchPlaylist categorisation (confirmed/pending/notFound)
- `src/config.ts` — notFoundThreshold
- `src/services/review-service.ts` — review queue
- `src/jobs/handlers/search.ts` — search → download → wishlist flow
- `web/src/pages/Review.tsx` — review UI
