---
# spec-01
title: Project scaffold and build tooling
status: todo
type: task
priority: critical
parent: spec-E0
depends_on:
created_at: 2026-03-29T00:00:00Z
updated_at: 2026-03-29T00:00:00Z
---

# spec-01: Project scaffold and build tooling

## Purpose

Define the complete project skeleton for crate-sync: package metadata, dependency manifest, TypeScript compilation, bundling for a CLI binary, test runner, ORM migration tooling, and directory layout. A developer should be able to run the commands in this spec on a bare machine (with Node >= 20 and pnpm) and have a fully functional build/test/lint pipeline with zero source files beyond what the scaffold creates.

## Public Interface

Not applicable -- this spec produces configuration files, not runtime code.

## Dependencies

### Runtime dependencies (exact version ranges from current `package.json`)

| Package | Version | Purpose |
|---|---|---|
| `@hono/node-server` | `^1.19.11` | Node.js adapter for Hono HTTP framework |
| `better-sqlite3` | `^12.6.2` | Native SQLite3 binding |
| `chalk` | `^5.6.2` | Terminal string styling |
| `commander` | `^14.0.3` | CLI argument parsing |
| `drizzle-orm` | `^0.45.1` | TypeScript ORM for SQLite |
| `fuse.js` | `^7.1.0` | Fuzzy search library |
| `hono` | `^4.12.8` | Lightweight HTTP framework |
| `music-metadata` | `^11.12.1` | Audio file metadata parsing |

### Dev dependencies (exact version ranges from current `package.json`)

| Package | Version | Purpose |
|---|---|---|
| `@types/better-sqlite3` | `^7.6.13` | Type definitions for better-sqlite3 |
| `@types/node` | `^25.4.0` | Node.js type definitions |
| `@vitest/coverage-v8` | `^4.0.18` | V8 coverage provider for vitest |
| `drizzle-kit` | `^0.31.9` | Drizzle schema migration CLI |
| `tsup` | `^8.5.1` | TypeScript bundler (esbuild-based) |
| `tsx` | `^4.21.0` | TypeScript execution engine for dev |
| `typescript` | `^5.9.3` | TypeScript compiler |
| `vitest` | `^4.0.18` | Test runner |

## Behavior

### package.json

```jsonc
{
  "name": "crate-sync",
  "version": "0.1.0",
  "description": "Unified CLI to manage Spotify playlists and sync them with Lexicon DJ",
  "type": "module",
  "bin": {
    "crate-sync": "./dist/index.js"
  },
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsup",
    "test": "vitest",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "lint": "tsc --noEmit"
  },
  "engines": {
    "node": ">=20"
  },
  "license": "MIT",
  "pnpm": {
    "onlyBuiltDependencies": [
      "better-sqlite3",
      "esbuild"
    ]
  }
}
```

**Key points:**
- `"type": "module"` -- the entire project uses ESM. All internal imports use `.js` extensions.
- `"bin"` maps the `crate-sync` command to `./dist/index.js` (the tsup output).
- `pnpm.onlyBuiltDependencies` restricts native addon builds to `better-sqlite3` and `esbuild` only.

### npm scripts

| Script | Command | Description |
|---|---|---|
| `dev` | `tsx src/index.ts` | Run the CLI in development mode without building |
| `build` | `tsup` | Bundle the CLI for production using tsup |
| `test` | `vitest` | Run the test suite (watch mode by default) |
| `db:generate` | `drizzle-kit generate` | Generate new SQL migration files from schema changes |
| `db:migrate` | `drizzle-kit migrate` | Apply pending migrations to the database |
| `lint` | `tsc --noEmit` | Type-check the project without emitting output |

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

**Key points:**
- `target: ES2022` -- enables top-level await, `structuredClone`, etc.
- `module: ESNext` + `moduleResolution: bundler` -- for ESM with tsup bundling.
- `strict: true` -- full strict mode (strictNullChecks, noImplicitAny, etc.).
- Path alias `@/*` maps to `./src/*` for cleaner imports during development (tsup resolves these at build time).

### tsup.config.ts

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
```

**Key points:**
- Single entry point: `src/index.ts`.
- Output format: ESM only (`format: ["esm"]`).
- Target: Node.js 20 (`target: "node20"`).
- `clean: true` -- removes `dist/` before each build.
- `sourcemap: true` -- generates `.js.map` files for debugging.
- `dts: false` -- no declaration files in the bundle (this is a CLI, not a library).
- `banner.js` -- prepends the shebang line `#!/usr/bin/env node` so the output is directly executable.

### vitest.config.ts

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: ["**/node_modules/**", "**/.claude/**"],
  },
  resolve: {
    alias: {
      "@": "./src",
    },
  },
});
```

**Key points:**
- `globals: true` -- `describe`, `it`, `expect`, `vi`, etc. are available without importing.
- Excludes `node_modules` and `.claude` directories from test discovery.
- Path alias `@` resolves to `./src` to match tsconfig paths.

### drizzle.config.ts

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: "./data/crate-sync.db",
  },
});
```

**Key points:**
- Schema source: `./src/db/schema.ts`.
- Migration output directory: `./src/db/migrations` (migrations are checked into git and bundled with the CLI).
- Dialect: `sqlite`.
- Default database location for generation: `./data/crate-sync.db`.

### Directory structure

```
crate-sync/
  .beans/              # Spec beans (this directory)
  .gitignore
  package.json
  tsconfig.json
  tsup.config.ts
  vitest.config.ts
  drizzle.config.ts
  CHANGELOG.md
  README.md
  CLAUDE.md
  src/
    index.ts           # CLI entry point (commander program)
    config.ts          # Configuration loading/saving
    types/
      common.ts        # Shared types (TrackInfo, MatchResult, etc.)
      spotify.ts       # Spotify API types
      lexicon.ts       # Lexicon DJ types
      soulseek.ts      # Soulseek/slskd types
    db/
      schema.ts        # Drizzle table definitions
      client.ts        # Database singleton (getDb, closeDb)
      migrations/      # SQL migration files (generated by drizzle-kit)
    utils/
      logger.ts        # Structured file logger
      retry.ts         # Exponential backoff retry utility
      progress.ts      # Terminal progress bar
      shutdown.ts      # Graceful shutdown handler
      spotify-url.ts   # Spotify URL/ID extraction
      health.ts        # Service health checks
      __tests__/       # Utility unit tests
    matching/
      index.ts         # Matching module barrel export
      types.ts         # Matching strategy types
      normalize.ts     # Text normalization for matching
      isrc.ts          # ISRC-based exact matching
      fuzzy.ts         # Fuse.js fuzzy matching
      composite.ts     # Multi-strategy composite matcher
      __tests__/       # Matching unit tests
    search/
      query-builder.ts # Multi-strategy search query builder
      __tests__/       # Search unit tests
    services/
      spotify-service.ts      # Spotify Web API client
      spotify-auth-server.ts  # OAuth callback server
      lexicon-service.ts      # Lexicon DJ API client
      soulseek-service.ts     # slskd API client
      playlist-service.ts     # Playlist CRUD operations
      download-service.ts     # Download orchestration
      sync-pipeline.ts        # End-to-end sync pipeline
      review-service.ts       # Async review queue
      __tests__/              # Service unit tests
    jobs/
      runner.ts        # SQLite-polling job runner
      handlers/
        spotify-sync.ts   # Spotify playlist sync handler
        lexicon-match.ts  # Track matching handler
        search.ts         # Soulseek search handler
        download.ts       # Download handler
        validate.ts       # Downloaded file validation handler
        lexicon-tag.ts    # Lexicon tagging handler
        wishlist-run.ts   # Manual wishlist re-scan handler
      __tests__/          # Job system unit tests
    commands/
      auth.ts          # `crate-sync auth` command
      playlists.ts     # `crate-sync playlists` command
      sync.ts          # `crate-sync sync` command
      sync-client.ts   # Sync client logic
      review.ts        # `crate-sync review` command
      wishlist.ts      # `crate-sync wishlist` command
      lexicon.ts       # `crate-sync lexicon` command
      db.ts            # `crate-sync db` command
      jobs.ts          # `crate-sync jobs` command
      serve.ts         # `crate-sync serve` command
    api/
      server.ts        # Hono HTTP server setup
      state.ts         # Shared API state
      routes/
        status.ts      # GET /api/status
        playlists.ts   # /api/playlists routes
        tracks.ts      # /api/tracks routes
        matches.ts     # /api/matches routes
        review.ts      # /api/review routes
        downloads.ts   # /api/downloads routes
        sync.ts        # /api/sync routes
        jobs.ts        # /api/jobs routes
      __tests__/       # API route tests
  data/                # Runtime database (gitignored)
  dist/                # Build output (gitignored)
```

### .gitignore

```gitignore
sldl-python
spoty-poty
slsk-batchdl

node_modules
dist
data
*.db
.env
.env.local
.claude/worktrees/
coverage/
```

**Key points:**
- `sldl-python`, `spoty-poty`, `slsk-batchdl` -- legacy project directories kept for reference but excluded from git.
- `data/` and `*.db` -- runtime SQLite databases are never committed.
- `.env` / `.env.local` -- environment secrets are excluded.
- `.claude/worktrees/` -- Claude Code worktree artifacts are excluded.
- `coverage/` -- test coverage reports are excluded.

## Error Handling

- If `pnpm install` fails due to native build issues with `better-sqlite3`, ensure the system has a C++ compiler (Xcode CLT on macOS, build-essential on Linux).
- If `tsup` build fails, check that `src/index.ts` exists and has valid TypeScript.
- If `drizzle-kit generate` fails, ensure `src/db/schema.ts` exports valid Drizzle table definitions.

## Tests

No runtime tests for this spec -- validation is performed by:

1. `pnpm install` completes without errors.
2. `pnpm lint` (`tsc --noEmit`) exits 0.
3. `pnpm build` produces `dist/index.js` with the shebang line.
4. `pnpm test` discovers and runs test files.
5. `./dist/index.js --help` prints CLI usage.

## Acceptance Criteria

- [ ] `package.json` contains all listed dependencies at the specified version ranges
- [ ] `"type": "module"` is set in package.json
- [ ] `"bin"` maps `crate-sync` to `./dist/index.js`
- [ ] All six npm scripts are defined: `dev`, `build`, `test`, `db:generate`, `db:migrate`, `lint`
- [ ] `tsconfig.json` has all compiler options listed above including path alias `@/*`
- [ ] `tsup.config.ts` produces a single ESM bundle with shebang banner targeting node20
- [ ] `vitest.config.ts` enables globals and excludes `.claude/` directory
- [ ] `drizzle.config.ts` points to `./src/db/schema.ts` and outputs to `./src/db/migrations`
- [ ] `.gitignore` contains all listed entries
- [ ] All directories from the directory structure exist (may contain placeholder files)
- [ ] `pnpm install && pnpm lint && pnpm build` succeeds
- [ ] `pnpm.onlyBuiltDependencies` lists `better-sqlite3` and `esbuild`
