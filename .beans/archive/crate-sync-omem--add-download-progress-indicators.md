---
# crate-sync-omem
title: Add download progress indicators
status: completed
type: task
priority: normal
created_at: 2026-03-10T04:21:31Z
updated_at: 2026-03-10T06:00:32Z
parent: crate-sync-uijj
---

Show progress bars or status lines during long download/sync operations.

## Summary of Changes\n\nAdded `src/utils/progress.ts` with a `Progress` class that renders an overwriting progress bar. Integrated it into `db sync` (playlist track syncing), `download playlist`, `download resume`, and `sync` Phase 3 downloads.
