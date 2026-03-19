---
# crate-sync-wp08
title: Multi-select and bulk operations toolbar
status: pending
type: task
priority: low
created_at: 2026-03-19T12:00:00Z
updated_at: 2026-03-19T12:00:00Z
parent: crate-sync-wp00
depends_on: crate-sync-wp03, crate-sync-wp05
---

## Scope

Reusable multi-select hook and floating bulk toolbar component for playlist and track tables.

## Details

- Reusable `useMultiSelect` hook (select/deselect, select all, clear, selection count)
- Floating `BulkToolbar` component that appears when items are selected
- Actions: Delete Selected (plugs into wp03), Merge Selected (plugs into wp05)
- Select all / clear toggle with selection count display

## Key Files

- `web/src/hooks/useMultiSelect.ts` — new reusable hook
- `web/src/components/BulkToolbar.tsx` — new floating toolbar component
- `web/src/pages/Playlists.tsx` — integrate hook and toolbar

## Acceptance Criteria

- [ ] `useMultiSelect` hook manages selection state for any list
- [ ] Floating toolbar appears when 1+ items selected
- [ ] Toolbar shows selection count and clear button
- [ ] Delete Selected triggers delete confirmation for all selected
- [ ] Merge Selected opens merge modal with selected playlists
- [ ] Select all / deselect all toggle works correctly
