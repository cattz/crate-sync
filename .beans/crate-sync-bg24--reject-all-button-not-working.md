---
# crate-sync-bg24
title: Reject All button not working in matches section
status: done
type: bug
priority: high
created_at: 2026-04-01T00:00:00Z
updated_at: 2026-04-01T00:00:00Z
---

## Description

The "Reject All" button in the Matches/Review section does not work. Need to investigate — could be a frontend issue (not calling the API), API issue (bulk reject endpoint), or the button not being wired up.

## Key Files

- `web/src/pages/Matches.tsx` or `web/src/pages/Review.tsx` — button handler
- `src/api/routes/matches.ts` or `src/api/routes/review.ts` — bulk reject endpoint
- `src/services/review-service.ts` — bulkReject method
- `web/src/api/hooks.ts` — mutation hook
