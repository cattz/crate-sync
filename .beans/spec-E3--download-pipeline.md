---
# spec-E3
title: "Download pipeline"
status: todo
type: epic
priority: high
created_at: 2026-03-29T00:00:00Z
updated_at: 2026-03-29T00:00:00Z
depends_on: spec-E0, spec-E2
---

## Purpose

Group 3 — Download missing tracks from Soulseek. Pipeline-only: triggered by Group 2's unmatched tracks or review rejections. No standalone download capability.

## Children

- spec-13: Search query builder (multi-strategy query generation)
- spec-14: Soulseek service (slskd API client)
- spec-15: Download pipeline (search, rank, download, validate, move)

## Key Decisions

- **Pipeline only** — no standalone "download this track" command
- **Configurable validation** — strictness levels: strict, moderate, lenient
- **Manual wishlist retry** — no automatic backoff schedule
- **Rejection memory** — previously rejected Soulseek files filtered from ranking results
- **Files to Lexicon/Incoming** — Lexicon auto-imports; tagging happens on next sync
