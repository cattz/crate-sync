---
# crate-sync-bg38
title: Bulk edit playlist tags with smart common/partial display
status: done
type: task
priority: normal
created_at: 2026-04-05T00:00:00Z
updated_at: 2026-04-05T00:00:00Z
---

## Description

Allow editing tags for multiple selected playlists at once. The tag editor should be smart about showing the union of all tags across selected playlists.

## Behavior

- Select multiple playlists via checkboxes
- Click "Edit Tags" in the bulk toolbar
- Tag editor shows:
  - **Normal (solid) tags**: present in ALL selected playlists
  - **Grayed (partial) tags**: present in SOME but not all selected playlists
  - Clicking a **grayed tag** → adds it to all selected playlists (becomes solid)
  - Clicking a **solid tag** → removes it from all selected playlists
  - Adding a **new tag** via input → adds to all selected playlists
- Save applies changes to all selected playlists

## UI

- Could be a modal or inline section in the bulk toolbar
- Show count: "Editing tags for 5 playlists"
- Each tag badge: solid green = all have it, outlined/grayed = partial

## Key Files

- `web/src/pages/Playlists.tsx` — bulk toolbar, tag editor
- `src/api/routes/playlists.ts` — may need bulk tag update endpoint
- `web/src/api/client.ts` + `hooks.ts` — bulk tag mutations
