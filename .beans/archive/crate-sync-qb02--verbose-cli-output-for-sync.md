---
# crate-sync-qb02
title: Verbose CLI output for sync command
status: completed
type: task
priority: normal
created_at: 2026-03-17T15:55:00Z
updated_at: 2026-03-17T16:00:00Z
parent: crate-sync-ph1e
---

Added `--verbose` flag to `sync` command. Shows per-track search diagnostics: which strategy succeeded, all strategies tried with result counts, top 3 candidates with scores. Strategy metadata flows through DownloadResult → SyncPipeline → CLI callback.
