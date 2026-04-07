---
# spec-E5
title: "Web frontend"
status: completed
type: epic
priority: normal
created_at: 2026-03-29T00:00:00Z
updated_at: 2026-03-29T00:00:00Z
depends_on: spec-E4
---

## Purpose

Spans all groups — React SPA consuming the API. Vite + React 19, dark Spotify-inspired theme, independent build.

## Children

- spec-20: Web frontend (scaffold, API client, all pages)

## Key Decisions

- **Single spec** — scaffold, browsing pages, and interactive pages merged into one spec (one build unit)
- **Review always accessible** — sidebar badge with pending count, non-blocking flow
- **No merge/dupes/similarity/statistics** — removed from prior design
- **Rejection history visible** — Track Detail page shows match and download rejections
