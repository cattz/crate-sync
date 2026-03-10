---
# crate-sync-iyfh
title: Service health checks on startup
status: completed
type: task
priority: low
created_at: 2026-03-10T04:21:32Z
updated_at: 2026-03-10T06:00:32Z
parent: crate-sync-nybe
---

## Summary of Changes
Added `src/utils/health.ts` with `checkHealth()` that tests Spotify auth, Lexicon ping, and slskd ping. Added `crate-sync status` top-level command showing service connectivity and DB stats. Added pre-flight health checks to sync, download playlist, and lexicon match/sync commands.
