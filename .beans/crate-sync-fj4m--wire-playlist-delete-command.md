---
# crate-sync-fj4m
title: Wire playlist delete command
status: completed
type: task
priority: normal
created_at: 2026-03-10T04:21:31Z
updated_at: 2026-03-10T04:28:05Z
parent: crate-sync-5kpz
---

## Summary of Changes
- Implemented `playlists delete <id>` command with `--spotify` flag
- Uses readline for interactive confirmation
- Removes playlist + junction entries from local DB
- Optionally unfollows on Spotify
