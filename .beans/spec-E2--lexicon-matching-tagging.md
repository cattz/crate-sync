---
# spec-E2
title: "Lexicon matching and tagging"
status: todo
type: epic
priority: critical
created_at: 2026-03-29T00:00:00Z
updated_at: 2026-03-29T00:00:00Z
depends_on: spec-E0, spec-E1
---

## Purpose

Group 2 — Match Spotify tracks against the Lexicon DJ library and tag matched tracks. No Lexicon playlists are created. Tags are scoped to a single configurable Lexicon tag category. Review is async and non-blocking.

## Children

- spec-09: Matching engine (types, normalization, ISRC, fuzzy, composite)
- spec-10: Lexicon service (API client, tag-only operations)
- spec-11: Sync pipeline (match + tag orchestration)
- spec-12: Review service (async review queue)

## Key Decisions

- **No Lexicon playlists** — only tag tracks under a dedicated category (default "Spotify Playlists")
- **Category-scoped tagging** — only modify tags in the configured category, leave others untouched
- **Async non-blocking review** — pending matches parked, pipeline continues with confirmed + missing
- **Rejection memory** — rejected match pairs persisted, never re-proposed
- **Rejected reviews auto-queue downloads** — rejection triggers Group 3 download pipeline
- **Tag on next sync** — downloaded files tagged after Lexicon imports them and re-matching discovers them
