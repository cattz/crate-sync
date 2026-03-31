---
# crate-sync-bg22
title: Log of latest tracks added to Lexicon/Incoming with timestamp
status: done
type: task
priority: normal
created_at: 2026-03-31T00:00:00Z
updated_at: 2026-03-31T00:00:00Z
---

## Description

Add a visible log/feed of the most recently moved tracks (files placed in Lexicon/Incoming) with timestamps. Shows what was successfully downloaded, validated, and placed — essentially a "recently added" feed.

## Behavior

- **Web**: New section on Dashboard or a dedicated "Recent Additions" view showing the last N tracks moved to Lexicon/Incoming, with: track title, artist, playlist name, timestamp, file path
- **Data source**: Query `downloads` table where `status='done'` ordered by `completedAt DESC`
- Could also be a section in the Logs page or a separate tab

## Key Files

- `web/src/pages/Dashboard.tsx` — recent additions section
- `src/api/routes/downloads.ts` — endpoint for recent completed downloads (may already exist with status filter)
- `web/src/api/client.ts` — may need dedicated method or reuse existing
