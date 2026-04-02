---
# crate-sync-epic-multi-source
title: "Multi-source download pipeline: local libraries + slskd webhook"
status: todo
type: epic
priority: high
created_at: 2026-04-02T00:00:00Z
updated_at: 2026-04-02T00:00:00Z
---

## Purpose

Decouple the download pipeline from slskd and support multiple track sources with configurable priority. Enables searching local music libraries before falling back to Soulseek, and integrates slskd webhook for immediate download notification.

## Source priority chain (configurable)

1. Local: Full Lossless LP library
2. Local: Old library
3. Local: slskd downloads folder (already downloaded files)
4. Soulseek network search (via slskd)

Search stops at the first source that returns a good match.

## Key abstractions

- **TrackSource interface**: `search()` + `acquire()` + optional `checkAcquisition()`
- **SourceCandidate**: source-agnostic file candidate with quality info and opaque metadata
- **AcquisitionService**: orchestrates source queries, ranking, validation, and file placement
- **Source registry**: builds available sources from config

## Phases

### Phase 1: Source abstraction + local filesystem source
- Define TrackSource interface and SourceCandidate type
- Implement LocalFilesystemSource (scan dirs, match by audio metadata)
- Implement SoulseekSource (wraps existing SoulseekService)
- Create AcquisitionService (source-agnostic rank, validate, move)
- Refactor DownloadService to delegate to new abstractions
- Add source config to Settings UI

### Phase 2: slskd webhook integration
- Add POST /api/webhooks/slskd/download-complete endpoint
- Create notify-download.sh script for slskd container
- Webhook creates validate+place job directly (no filesystem polling needed)
- Reduce download_scan frequency to 60s as fallback safety net

### Phase 3: Job handler updates
- Refactor search handler to query all sources via AcquisitionService
- Refactor download handler to use source-agnostic acquire()
- Update download_scan to work with all async sources

### Phase 4: Schema migration + cleanup
- Add source_id, source_key, source_meta to downloads table
- Migrate existing slskd-specific columns
- Expand rejections context for all sources

## Children (to be created)

_Tasks will be broken out after design review._

## slskd upstream requests

1. Document $SLSKD_SCRIPT_DATA JSON schema for DownloadFileComplete
2. Upvote issue #1584 (per-download destination path)
3. Request native HTTP webhook support
