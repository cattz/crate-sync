---
# crate-sync-bg35
title: Rescue orphan downloads from slskd and schedule daily scan
status: done
type: task
priority: high
created_at: 2026-04-04T00:00:00Z
updated_at: 2026-04-04T00:00:00Z
---

## Description

Downloads completed in slskd before the destination parameter was active land in unpredictable folders (remote-path mirroring). The scanner doesn't find them because it looks for specific username+filename patterns. These orphan files sit in slskd/data/downloads/ taking up space and never reaching Lexicon.

## Behavior

### Rescue scan logic

1. Recursively scan `config.soulseek.downloadDir` for audio files (flac, mp3)
2. Skip files in playlist-named folders (those are managed by the destination feature)
3. For each orphan file:
   a. Parse artist/title from filename
   b. Check `downloads` table for a `downloading` record matching by filename → validate → move → mark done
   c. Check for wishlisted/failed tracks matching by fuzzy match → validate → move → mark done
   d. If no match found, log as "unmatched orphan" (leave it, don't delete)
4. Clean up empty folders after rescue

### Scheduling

- New job type: `orphan_rescue`
- Run daily via `setInterval` in the job runner (like wishlist scan)
- Also available as CLI: `downloads rescue`
- Also available as API: `POST /api/downloads/rescue`
- Show rescue results in Logs page

### Web UI

- "Rescue Orphan Downloads" button on Downloads page
- Shows count of rescued / unmatched files

## Key Files

- `src/jobs/handlers/orphan-rescue.ts` — new handler
- `src/jobs/runner.ts` — daily scheduling
- `src/api/routes/downloads.ts` — rescue endpoint
- `src/services/download-service.ts` — reuse findDownloadedFile, validateDownload, moveToPlaylistFolder
