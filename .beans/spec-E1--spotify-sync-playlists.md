---
# spec-E1
title: "Spotify sync and playlist management"
status: todo
type: epic
priority: critical
created_at: 2026-03-29T00:00:00Z
updated_at: 2026-03-29T00:00:00Z
depends_on: spec-E0
---

## Purpose

Group 1 — Spotify API integration and local playlist management. Works standalone without Lexicon or Soulseek. Covers OAuth, playlist CRUD, bulk rename, metadata (tags/notes/pinning), and bidirectional sync with Spotify (including description sync).

## Children

- spec-06: Spotify service (OAuth + API client)
- spec-07: Playlist service (local DB CRUD)
- spec-08: Spotify push (local → Spotify sync)

## Key Decisions

- **No merge, duplicates, similarity, or statistics** — scope reduced from prior design
- **Bulk rename with regex** — full regex support with dry-run preview
- **Description sync** — tags + notes serialized into Spotify playlist description field
- **Local metadata** — tags (auto-extracted from name + manual), notes, pinning stored in local DB
- **Tag extraction** — playlist name split by "/" into segments, each becomes a tag
