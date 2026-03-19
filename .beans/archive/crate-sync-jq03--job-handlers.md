---
# crate-sync-jq03
title: Job handlers (all 7 types)
status: completed
type: task
priority: high
created_at: 2026-03-17T16:05:00Z
updated_at: 2026-03-17T16:15:00Z
parent: crate-sync-ph2e
---

Created `src/jobs/handlers/` with 7 handlers: spotify-sync (refresh + create match job), match (run matcher + create search jobs), search (multi-strategy + create download job), download (acquireAndMove + DB state tracking), validate (metadata check), lexicon-sync (playlist + tags), wishlist-scan (re-queue past cooldown). All reuse existing service methods.
