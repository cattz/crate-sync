---
# spec-E4
title: "Orchestration: job queue, API, CLI"
status: todo
type: epic
priority: high
created_at: 2026-03-29T00:00:00Z
updated_at: 2026-03-29T00:00:00Z
depends_on: spec-E0, spec-E1, spec-E2, spec-E3
---

## Purpose

Spans all groups — job queue, API server, REST routes, and CLI commands. Thin orchestration layers that compose services into user-facing features.

## Children

- spec-16: Job queue (runner + handlers)
- spec-17: API server (Hono app setup)
- spec-18: API routes (REST endpoints)
- spec-19: CLI (commands + entry point)

## Key Decisions

- **Unified interface** — groups are internal organization, not user-facing
- **Long-lived server** — always-on, web UI always available
- **Non-blocking sync** — CLI sync prints summary and exits; review is async
- **Manual wishlist only** — no automatic job scheduling for retries
- **Job types**: spotify_sync, lexicon_match, lexicon_tag, search, download, validate, wishlist_run
