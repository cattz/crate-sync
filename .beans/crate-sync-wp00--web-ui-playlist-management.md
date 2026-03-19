---
# crate-sync-wp00
title: Web UI playlist management
status: pending
type: epic
priority: normal
created_at: 2026-03-19T12:00:00Z
updated_at: 2026-03-19T12:00:00Z
---

Web UI playlist management features. The CLI already has rename, delete, merge, dupes, repair, and push — the gap is API routes + React UI. Also adds sorting, search, ownership filtering, bulk operations, similarity suggestions, statistics, and metadata.

## Children

- wp01: Sort and search
- wp02: Ownership + filter
- wp03: Rename & delete from web
- wp04: Push & repair from web
- wp05: Merge from web
- wp06: Duplicate detection from web
- wp07: Track table enhancements
- wp08: Multi-select + bulk toolbar
- wp09: Similarity suggestions
- wp10: Bulk rename
- wp11: Statistics + dashboard
- wp12: Metadata (tags/notes/pin)

## Key Files

- `web/src/pages/Playlists.tsx`
- `web/src/pages/PlaylistDetail.tsx`
- `src/api/routes/playlists.ts`
- `src/db/schema.ts`
- `src/services/playlist-service.ts`
- `web/src/api/client.ts` + `hooks.ts`
