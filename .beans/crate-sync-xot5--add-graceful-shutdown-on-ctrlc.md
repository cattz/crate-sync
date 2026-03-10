---
# crate-sync-xot5
title: Add graceful shutdown on Ctrl+C
status: completed
type: task
priority: normal
created_at: 2026-03-10T04:21:32Z
updated_at: 2026-03-10T06:00:32Z
parent: crate-sync-uijj
---

Handle SIGINT during downloads: finish current downloads, persist state, exit cleanly.

## Summary of Changes\n\nAdded `src/utils/shutdown.ts` with graceful SIGINT handling. Registered it in `src/index.ts` with `closeDb` as a cleanup function. Added shutdown checks in `DownloadService.downloadBatch`, `SpotifyService.syncToDb`, and `db sync` command.
