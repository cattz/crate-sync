---
# crate-sync-bg33
title: Investigate why slskd destination parameter is not being used
status: completed
type: bug
priority: high
created_at: 2026-04-04T00:00:00Z
updated_at: 2026-04-04T00:00:00Z
---

## Description

Downloads should land in `slskd/data/downloads/{playlist-name}/` via the per-download `destination` parameter (slskd bg02). Instead, files land in the default remote-path-mirroring location (e.g. `Maria's Hunt (2023)/`).

## Investigation needed

1. Is the running slskd Docker image rebuilt with the bg02 changes?
2. Check if the download handler is actually sending the `destination` field — log the request payload
3. Check if slskd is receiving and honoring the destination — check slskd logs
4. Verify the API payload format matches what slskd expects: `[{ filename, size, destination }]`

## Key Files

- `src/jobs/handlers/download.ts` — constructs the download request with destination
- `src/services/soulseek-service.ts` — `download()` method sends the API call
