---
# crate-sync-rmbg
title: Implement playlist repair
status: completed
type: task
priority: normal
created_at: 2026-03-10T04:21:31Z
updated_at: 2026-03-10T06:00:32Z
parent: crate-sync-5kpz
---

## Summary of Changes
Implemented `playlists repair <id>` command that re-matches playlist tracks against Lexicon library using SyncPipeline.matchPlaylist(). Reports OK/review/missing counts. With `--download` flag, triggers Phase 3 download pipeline for missing tracks.
