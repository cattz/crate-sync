---
# spec-E0
title: "Foundation: types, config, DB, utilities"
status: todo
type: epic
priority: critical
created_at: 2026-03-29T00:00:00Z
updated_at: 2026-03-29T00:00:00Z
---

## Purpose

Groups all leaf-layer modules that have no internal dependencies. Establishes project scaffolding, shared types, configuration, database schema, and utility modules.

## Children

- spec-01: Project scaffold and build tooling
- spec-02: Type definitions
- spec-03: Configuration module
- spec-04: Database schema and client
- spec-05: Utility modules

## Cross-Cutting Principles

- **ESM only** — all files use `import`/`export`, file extensions in imports (`.js`)
- **Strict TypeScript** — `strict: true`, no `any` except where interfacing with external libs
- **No side effects on import** — modules export functions/classes, don't execute on load
- **Pure functions where possible** — especially types, config, utils, matching
- **Test co-location** — tests in `__tests__/` subdirectory next to source

## Naming Conventions

- Files: kebab-case (`spotify-service.ts`)
- Types/interfaces: PascalCase (`TrackInfo`, `MatchResult`)
- Functions: camelCase (`loadConfig`, `getDb`)
- Constants: UPPER_SNAKE_CASE for true constants (`DEFAULT_SCOPES`), camelCase for config-like objects
- DB columns: snake_case in SQL, camelCase in Drizzle schema definitions
