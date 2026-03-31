---
# crate-sync-bg21
title: Clean up failed download files and empty folders
status: todo
type: task
priority: normal
created_at: 2026-03-31T00:00:00Z
updated_at: 2026-03-31T00:00:00Z
---

## Description

Files that fail validation are left orphaned in the slskd download directory. Empty folders also accumulate after files are moved to Lexicon/Incoming. Need cleanup options.

## Features

### 1. Delete failed download files
- Web: "Delete File" button on failed downloads in the Downloads page
- API: `DELETE /api/downloads/:id/file` — deletes the physical file from slskd download dir
- CLI: `downloads clean --failed` — delete all files for failed downloads

### 2. Clean up empty folders
- After moving a file to Incoming, check if the source folder in slskd downloads is now empty and delete it
- CLI: `downloads clean --empty-dirs` — scan slskd download dir and remove empty subdirectories
- Could also run automatically after each successful move

### 3. Mark for review
- Failed downloads with validation errors should appear in a dedicated section (or filter) on the Downloads page
- Show the file path, rejection reason, and options: retry with different settings, delete file, or dismiss

## Key Files

- `src/services/download-service.ts` — add folder cleanup after move, file deletion
- `src/api/routes/downloads.ts` — file deletion endpoint
- `web/src/pages/Downloads.tsx` — delete button, failed files section
