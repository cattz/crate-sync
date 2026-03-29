---
# spec-E3
title: "External service integrations"
status: todo
type: epic
priority: critical
created_at: 2026-03-24T00:00:00Z
updated_at: 2026-03-24T00:00:00Z
---

## Purpose

Groups the three external API clients (Spotify, Lexicon, Soulseek), the internal PlaylistService, and the DownloadService. Each service is a class that can be instantiated independently.

## Children

- spec-09: Spotify service
- spec-10: Lexicon service
- spec-11: Soulseek service (slskd client)
- spec-12: Playlist service (DB-only)
- spec-13: Download service

## Cross-Cutting Principles

- **Constructor dependency injection** — every service takes its dependencies (config, db) in the constructor. No global singletons inside services (except DB client which is a managed singleton).
- **Retry on transient failures** — all HTTP calls use `withRetry()` from utils. Retry on network errors, 5xx, and 429. Respect Retry-After headers.
- **Stateless** — services hold config/connection info but no mutable request state. Safe to instantiate multiple times.
- **Pagination handled internally** — callers get complete results, services handle pagination loops
- **Error types** — services throw descriptive errors. Callers decide how to handle (CLI prints, API returns JSON, job handler records in DB).
