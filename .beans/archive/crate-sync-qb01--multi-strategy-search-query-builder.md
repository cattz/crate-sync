---
# crate-sync-qb01
title: Multi-strategy search query builder
status: completed
type: task
priority: high
created_at: 2026-03-17T15:48:00Z
updated_at: 2026-03-17T16:00:00Z
parent: crate-sync-ph1e
---

Created `src/search/query-builder.ts` with 4 strategies: full (cleaned artist+title), base-title (strip remix suffix), title-only, keywords (first 2 significant words). Applied to `searchAndRank()` and `searchAndRankBatch()` in download-service. 12 unit tests covering remixes, unicode, parens, brackets, empty artist.
