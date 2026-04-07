---
# crate-sync-bg43
title: "Merge improvements: dry-run, self-merge guard, push flag"
status: completed
type: task
priority: normal
created_at: 2026-04-07T00:00:00Z
updated_at: 2026-04-07T00:00:00Z
---

## Description

Improve the playlist merge workflow with safety and convenience features.

## Changes

- **Dry-run mode** — `--dry-run` flag on CLI, `dryRun` option on API. Returns preview counts without modifying data.
- **Self-merge guard** — reject merge when a source ID matches the target ID (API returns 400, CLI prints error, service throws).
- **`--push` flag** on CLI — push the merged target playlist to Spotify after merge.
- **`POST /api/playlists/:id/merge`** — per-playlist merge endpoint (alternative to the bulk `/merge`).
- **Tests** — added test coverage for merge, dry-run, self-merge rejection.
