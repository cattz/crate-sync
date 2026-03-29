---
# spec-E5
title: "React web frontend"
status: todo
type: epic
priority: normal
created_at: 2026-03-24T00:00:00Z
updated_at: 2026-03-24T00:00:00Z
---

## Purpose

Groups the Vite + React SPA. Communicates with the backend exclusively via HTTP. Independent build, independent `package.json`, no shared code with the server.

## Children

- spec-20: Web scaffold, API client, layout
- spec-21: Web browsing pages
- spec-22: Web interactive pages

## Cross-Cutting Principles

- **API-only coupling** — the frontend NEVER imports from `src/`. All data comes via `/api/*` endpoints. Types are defined independently in `web/src/api/client.ts`.
- **React Query for everything** — all server state managed via TanStack React Query. No manual fetch + useState patterns. Mutations invalidate relevant query keys.
- **Dark theme** — Spotify-inspired dark palette. CSS custom properties for all colors. No Tailwind — plain CSS with utility classes.
- **Modal pattern** — modals use `.modal-overlay` (fixed backdrop) + `.modal` (card-styled content). Click overlay to dismiss. Prevent propagation on modal content.
- **Inline results** — action results (push, repair, merge) display inline as colored text below the action area, not in alerts or toasts.
- **Forms** — inputs, selects, textareas styled via element selectors in globals.css. No component library.
- **SSE for live data** — Queue page and sync progress use EventSource. Hooks manage connection lifecycle.
