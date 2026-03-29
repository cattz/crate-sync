---
# spec-E4
title: "Sync pipeline, job queue, API, and CLI"
status: todo
type: epic
priority: critical
created_at: 2026-03-24T00:00:00Z
updated_at: 2026-03-24T00:00:00Z
---

## Purpose

Groups the sync pipeline, job queue, API server, and CLI — the layers that compose services into user-facing features. These modules orchestrate; they don't implement business logic directly.

## Children

- spec-14: Sync pipeline
- spec-15: Job queue: runner and handlers
- spec-16: API routes
- spec-17: API server
- spec-18: CLI commands
- spec-19: CLI entry point

## Cross-Cutting Principles

- **Thin orchestration** — commands and routes are thin wrappers. Business logic lives in services and the sync pipeline. A command should be ~50 lines max.
- **Service instantiation at call time** — routes and commands create service instances per request/invocation. No long-lived service singletons.
- **Consistent error responses** — API routes return `{ error: string }` with appropriate HTTP status codes. CLI commands print user-friendly messages via chalk.
- **Job handlers reuse services** — handlers call the same service methods that CLI commands use. No duplicate logic.
- **SSE for real-time** — sync progress and job events use Server-Sent Events, not WebSocket
- **Route ordering matters** — in Hono, static segments (e.g., `/playlists/sync`) must be registered before parameterized routes (`/playlists/:id`)
