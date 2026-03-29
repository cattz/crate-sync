---
# spec-E2
title: "Matching engine and search query builder"
status: todo
type: epic
priority: critical
created_at: 2026-03-24T00:00:00Z
updated_at: 2026-03-24T00:00:00Z
---

## Purpose

Groups the pluggable matching system and multi-strategy search. These are pure-logic modules with extensive test coverage and no I/O dependencies.

## Children

- spec-06: Matching: types, normalization, ISRC strategy
- spec-07: Matching: fuzzy strategy, composite, factory
- spec-08: Search query builder

## Cross-Cutting Principles

- **Pure functions** — no database, no network, no side effects. Input in, result out.
- **Heavy test coverage** — matching is the most critical logic in the system. Every algorithm needs edge case tests.
- **Pluggable strategies** — new matching strategies can be added without modifying existing ones (Strategy pattern)
- **Context-aware** — weight profiles differ by use case (lexicon matching vs soulseek search vs post-download validation)
- **Normalization before comparison** — all text is normalized (unicode, accents, feat., remix) before any similarity computation
