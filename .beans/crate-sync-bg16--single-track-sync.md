---
# crate-sync-bg16
title: Allow single track sync with Lexicon
status: done
type: task
priority: normal
created_at: 2026-03-30T00:00:00Z
updated_at: 2026-03-30T00:00:00Z
---

## Description

Currently sync only works at the playlist level. Add the ability to sync a single track with Lexicon — match it, tag it, and optionally trigger download if not found.

## Behavior

- **Web**: "Sync" button on TrackDetail page. Runs match against Lexicon for that one track and shows the result (matched, pending review, not found).
- **CLI**: `sync track <id>` command.
- **API**: `POST /api/sync/track/:id` — runs match + tag for a single track, returns match result.

## Key Files

- `src/services/sync-pipeline.ts` — add `matchTrack(trackId)` method
- `src/api/routes/sync.ts` — single track sync endpoint
- `src/commands/sync.ts` — single track CLI command
- `web/src/pages/TrackDetail.tsx` — sync button
- `web/src/api/client.ts` — new API method
