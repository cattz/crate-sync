---
# crate-sync-9xiw
title: Display internal playlist ID on playlists list
status: completed
type: feature
created_at: 2026-03-10T06:51:08Z
updated_at: 2026-03-10T06:51:08Z
---

Show truncated internal DB ID (first 8 chars, dim) as the first column in the playlists list command output.

## Summary of Changes

- Modified `src/commands/playlists.ts` `list` subcommand to display the first 8 characters of the internal playlist ID as the first column, rendered in dim/grey using chalk.
- Added ID column header and adjusted separator width accordingly.
- Output format: `abc12345  My Playlist Name  (tracks)  (last synced)`
