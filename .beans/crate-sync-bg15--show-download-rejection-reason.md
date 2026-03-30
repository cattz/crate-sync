---
# crate-sync-bg15
title: Show why downloaded files were not moved (rejection visibility)
status: todo
type: task
priority: high
created_at: 2026-03-30T00:00:00Z
updated_at: 2026-03-30T00:00:00Z
---

## Description

Files downloaded from Soulseek sometimes fail validation and are not moved to Lexicon/Incoming. The user has no visibility into why a file was rejected. Need to surface rejection reasons in the UI.

## Expected behavior

- Downloads page: show rejection reason when a download was validated but rejected (e.g. "wrong track", "validation_failed", "corrupt file")
- Track Detail: already has rejection history section — make sure it's populated
- Logs: download validation failures should appear as log events
- Queue: failed download jobs should show the specific validation error, not just "Downloaded file not found"

## Key Files

- `web/src/pages/Downloads.tsx` — show rejection reason
- `src/services/download-service.ts` — ensure rejection records are created with clear reasons
- `src/jobs/handlers/download.ts` — surface validation errors in job result/error
