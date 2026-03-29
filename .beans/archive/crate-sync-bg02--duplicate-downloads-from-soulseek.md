---
# crate-sync-bg02
title: Duplicate downloads from Soulseek
status: scrapped
type: bug
priority: high
created_at: 2026-03-19T18:00:00Z
updated_at: 2026-03-19T18:00:00Z
---

## Description

Evidence in slskd/data/downloads shows the same songs being downloaded repeatedly. Need to troubleshoot why already-downloaded tracks are not being skipped.

## Possible Causes

- Download status not being updated to "done" after completion
- Track matching not recognizing already-downloaded files
- Wishlist scan re-queuing tracks that are already downloaded
- Search/download jobs created without checking existing download records

## Key Files

- `src/services/download-service.ts`
- `src/services/soulseek-service.ts`
- `src/jobs/handlers/download.ts`
- `src/jobs/handlers/search.ts`
- `src/jobs/handlers/wishlist-scan.ts`
- `src/db/schema.ts` (downloads table)

## Steps to Troubleshoot

1. Check downloads table for duplicate entries (same track_id with status "done")
2. Check if download jobs are being created for tracks that already have a completed download
3. Check wishlist scan logic for deduplication

## Resolution

Scrapped — download logic will be rebuilt from scratch in spec-13 (download service). Deduplication concerns should be captured as requirements/test cases there.
