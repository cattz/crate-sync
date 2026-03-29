---
# spec-19
title: CLI entry point
status: todo
type: task
priority: high
parent: spec-E4
depends_on: spec-18
created_at: 2026-03-24T00:00:00Z
updated_at: 2026-03-24T00:00:00Z
---

# CLI Entry Point

## Purpose

Define the `src/index.ts` file that serves as the main entry point for the `crate-sync` CLI. This file wires together the Commander program, registers all command groups, configures global options, defines the top-level `status` command, and sets up process lifecycle (shutdown handlers, database cleanup).

---

## Public Interface

The built file is executed as a CLI binary with a shebang line.

```
#!/usr/bin/env node
```

### Program Metadata

| Property    | Value                                                    |
|-------------|----------------------------------------------------------|
| name        | `"crate-sync"`                                           |
| description | `"Manage Spotify playlists and sync them with Lexicon DJ"` |
| version     | `"0.1.0"`                                                |

### Global Option

| Option    | Description                                      |
|-----------|--------------------------------------------------|
| `--debug` | Enable debug logging to `./data/crate-sync.log`  |

The `--debug` option is handled via a Commander `preAction` hook that fires before every command action. When set:
1. Calls `setLogLevel("debug")`.
2. Calls `setLogFile("./data/crate-sync.log")`.

---

## Behavior

### Initialization Sequence

The following happens at module load time, before any command is parsed:

1. **Shutdown handler setup:** `setupShutdownHandler()` is called to register process signal handlers (SIGINT, SIGTERM).
2. **Database cleanup registration:** `onShutdown(closeDb)` ensures the SQLite database connection is closed on process exit.
3. **Log cleanup registration:** `onShutdown(closeLog)` ensures the log file handle is closed on process exit.
4. **Commander program instantiation:** `const program = new Command()`.
5. **Program configuration:** `.name()`, `.description()`, `.version()`, `.option("--debug", ...)`.
6. **PreAction hook:** `.hook("preAction", ...)` reads `program.opts()` and conditionally enables debug logging.

### Top-Level `status` Command

Defined inline in `index.ts` (not in a separate command file):

- **Command:** `status`
- **Description:** `"Check connectivity to all external services"`
- **Behavior:**
  1. Calls `loadConfig()` and `checkHealth(config)`.
  2. Prints status for each service:
     - **Spotify:** green checkmark + "Authenticated" or red X + error.
     - **Lexicon:** green checkmark + "Connected ({url})" or red X + error.
     - **Soulseek:** green checkmark + "Connected ({url})" or red X + error.
     - **Database:** tries `getDb()` and runs `count(*)` on `playlists` and `tracks` tables. Green checkmark + "{N} playlists, {N} tracks" or red X + "Not available".
  3. Database check is wrapped in its own try/catch to handle the case where the DB is not initialized.
- **Error handling:** Wraps entire action in try/catch, prints `chalk.red("Status check failed: {message}")`.

### Command Registration Order

Commands are registered in this exact order after the `status` command definition:

1. `registerAuthCommands(program)` -- `auth login`, `auth status`
2. `registerDbCommands(program)` -- `db sync`, `db status`
3. `registerPlaylistCommands(program)` -- `playlists list/show/rename/merge/dupes/delete/repair/push`
4. `registerLexiconCommands(program)` -- `lexicon status/match/sync`
5. `registerDownloadCommands(program)` -- `download search/playlist/resume`
6. `registerMatchCommands(program)` -- `matches list/confirm/reject`
7. `registerSyncCommand(program)` -- `sync [playlist]`
8. `registerServeCommand(program)` -- `serve`
9. `registerJobCommands(program)` -- `jobs list/retry/retry-all/stats` + `wishlist run`
10. `registerReviewCommand(program)` -- `review`

### Program Execution

```typescript
program.parse();
```

Called at the very end with no arguments, which defaults to parsing `process.argv`.

---

## Dependencies

### Imports

| Module                            | Imports                                    |
|-----------------------------------|--------------------------------------------|
| `commander`                       | `Command`                                  |
| `chalk`                           | `chalk` (default)                          |
| `drizzle-orm`                     | `sql`                                      |
| `./commands/auth.js`              | `registerAuthCommands`                     |
| `./commands/db.js`                | `registerDbCommands`                       |
| `./commands/playlists.js`         | `registerPlaylistCommands`                 |
| `./commands/lexicon.js`           | `registerLexiconCommands`                  |
| `./commands/download.js`          | `registerDownloadCommands`                 |
| `./commands/matches.js`           | `registerMatchCommands`                    |
| `./commands/sync.js`              | `registerSyncCommand`                      |
| `./commands/serve.js`             | `registerServeCommand`                     |
| `./commands/jobs.js`              | `registerJobCommands`                      |
| `./commands/review.js`            | `registerReviewCommand`                    |
| `./utils/shutdown.js`             | `setupShutdownHandler`, `onShutdown`       |
| `./db/client.js`                  | `closeDb`, `getDb`                         |
| `./config.js`                     | `loadConfig`                               |
| `./utils/health.js`              | `checkHealth`                              |
| `./db/schema.js`                  | `playlists`, `tracks`                      |
| `./utils/logger.js`              | `setLogLevel`, `setLogFile`, `closeLog`    |

---

## Error Handling

- The `status` command has a nested try/catch for the database section so that a missing or uninitialized database does not prevent reporting on other services.
- The outer try/catch on `status` catches any unexpected errors from `loadConfig()` or `checkHealth()`.
- Commander itself handles unknown commands and missing required arguments.

---

## Tests

### Unit Tests

- Verify `program.name()` returns `"crate-sync"`, `.version()` returns `"0.1.0"`.
- Verify the `--debug` preAction hook calls `setLogLevel("debug")` and `setLogFile("./data/crate-sync.log")` when `--debug` is present.
- Verify all 10 register functions are called by checking that the program has the expected top-level commands: `status`, `auth`, `db`, `playlists`, `lexicon`, `download`, `matches`, `sync`, `serve`, `jobs`, `review`, `wishlist`.
- Verify `setupShutdownHandler()` is called once.
- Verify `onShutdown` is called with `closeDb` and `closeLog`.

### Integration Tests

- Run `crate-sync --version` and verify output is `"0.1.0"`.
- Run `crate-sync --help` and verify the description and listed commands.
- Run `crate-sync status` with mocked services and verify output format.

---

## Acceptance Criteria

1. The file starts with `#!/usr/bin/env node` shebang.
2. `setupShutdownHandler()` is called before any command registration.
3. `onShutdown(closeDb)` and `onShutdown(closeLog)` are registered before any command registration.
4. The Commander program is configured with name `"crate-sync"`, version `"0.1.0"`, and the exact description.
5. The `--debug` option triggers `setLogLevel("debug")` and `setLogFile("./data/crate-sync.log")` via a `preAction` hook.
6. The top-level `status` command checks Spotify, Lexicon, Soulseek, and Database, with the database check isolated in its own try/catch.
7. All 10 command registration functions are called in the documented order.
8. `program.parse()` is the final statement in the file.
