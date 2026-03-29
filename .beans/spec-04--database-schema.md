---
# spec-04
title: Database schema and client
status: todo
type: task
priority: critical
parent: spec-E0
depends_on: spec-01
created_at: 2026-03-29T00:00:00Z
updated_at: 2026-03-29T00:00:00Z
---

# spec-04: Database schema and client

## Purpose

Define the complete SQLite database schema for crate-sync using Drizzle ORM, along with the singleton database client that manages connections, enables WAL mode, and auto-runs migrations. The schema stores Spotify playlists and tracks, Lexicon DJ library tracks, cross-service match records, download tasks, Soulseek download rejections, background jobs, and an audit sync log. This spec also defines a single consolidated initial migration that combines all existing incremental migrations.

## Public Interface

### File: `src/db/schema.ts`

#### Table definitions

```ts
import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";
import { type InferSelectModel, type InferInsertModel } from "drizzle-orm";

// Helpers (internal)
// id:        text("id").primaryKey().$defaultFn(() => crypto.randomUUID())
// createdAt: integer("created_at").notNull().$defaultFn(() => Date.now())
// updatedAt: integer("updated_at").notNull().$defaultFn(() => Date.now()).$onUpdateFn(() => Date.now())

export const playlists: SQLiteTable;
export const tracks: SQLiteTable;
export const playlistTracks: SQLiteTable;
export const lexiconTracks: SQLiteTable;
export const matches: SQLiteTable;
export const downloads: SQLiteTable;
export const rejections: SQLiteTable;
export const jobs: SQLiteTable;
export const syncLog: SQLiteTable;
```

#### Inferred types

```ts
export type Playlist = InferSelectModel<typeof playlists>;
export type NewPlaylist = InferInsertModel<typeof playlists>;

export type Track = InferSelectModel<typeof tracks>;
export type NewTrack = InferInsertModel<typeof tracks>;

export type PlaylistTrack = InferSelectModel<typeof playlistTracks>;
export type NewPlaylistTrack = InferInsertModel<typeof playlistTracks>;

export type LexiconTrack = InferSelectModel<typeof lexiconTracks>;
export type NewLexiconTrack = InferInsertModel<typeof lexiconTracks>;

export type Match = InferSelectModel<typeof matches>;
export type NewMatch = InferInsertModel<typeof matches>;

export type Download = InferSelectModel<typeof downloads>;
export type NewDownload = InferInsertModel<typeof downloads>;

export type Rejection = InferSelectModel<typeof rejections>;
export type NewRejection = InferInsertModel<typeof rejections>;

export type Job = InferSelectModel<typeof jobs>;
export type NewJob = InferInsertModel<typeof jobs>;

export type JobType = Job["type"];
export type JobStatus = Job["status"];

export type SyncLogEntry = InferSelectModel<typeof syncLog>;
export type NewSyncLogEntry = InferInsertModel<typeof syncLog>;
```

### File: `src/db/client.ts`

```ts
export function getDb(dbPath?: string): ReturnType<typeof drizzle<typeof schema>>;
export function closeDb(): void;
```

## Dependencies

- `drizzle-orm` -- ORM for type-safe SQL
- `drizzle-orm/sqlite-core` -- SQLite table builders (`sqliteTable`, `text`, `integer`, `real`, `uniqueIndex`)
- `drizzle-orm/better-sqlite3` -- Drizzle driver for better-sqlite3 (`drizzle`, `migrate`)
- `better-sqlite3` -- Native SQLite3 binding
- `node:crypto` -- `crypto.randomUUID()` for UUID generation
- `node:fs` -- `mkdirSync` for creating the database directory
- `node:path` -- `dirname`, `resolve` for path resolution
- `node:url` -- `fileURLToPath` for resolving migration folder relative to the module

## Behavior

### Table: `playlists`

| Column | SQL Type | Drizzle Type | Constraints | Default |
|---|---|---|---|---|
| `id` | `TEXT` | `text("id")` | `PRIMARY KEY` | `crypto.randomUUID()` |
| `spotify_id` | `TEXT` | `text("spotify_id")` | `UNIQUE` | -- |
| `name` | `TEXT` | `text("name")` | `NOT NULL` | -- |
| `description` | `TEXT` | `text("description")` | -- | -- |
| `snapshot_id` | `TEXT` | `text("snapshot_id")` | -- | -- |
| `is_owned` | `INTEGER` | `integer("is_owned")` | -- | -- |
| `owner_id` | `TEXT` | `text("owner_id")` | -- | -- |
| `owner_name` | `TEXT` | `text("owner_name")` | -- | -- |
| `tags` | `TEXT` | `text("tags")` | -- | -- |
| `notes` | `TEXT` | `text("notes")` | -- | -- |
| `pinned` | `INTEGER` | `integer("pinned")` | -- | `0` |
| `last_synced` | `INTEGER` | `integer("last_synced")` | -- | -- |
| `created_at` | `INTEGER` | `integer("created_at")` | `NOT NULL` | `Date.now()` |
| `updated_at` | `INTEGER` | `integer("updated_at")` | `NOT NULL` | `Date.now()` (auto-updated) |

- `spotify_id` has a unique index (`playlists_spotify_id_unique`).
- `tags` stores a JSON-stringified array (e.g., `'["techno","house"]'`).
- `is_owned` is used as a boolean (0/1/null).
- `pinned` defaults to `0` (not pinned).

### Table: `tracks`

| Column | SQL Type | Drizzle Type | Constraints | Default |
|---|---|---|---|---|
| `id` | `TEXT` | `text("id")` | `PRIMARY KEY` | `crypto.randomUUID()` |
| `spotify_id` | `TEXT` | `text("spotify_id")` | `UNIQUE` | -- |
| `title` | `TEXT` | `text("title")` | `NOT NULL` | -- |
| `artist` | `TEXT` | `text("artist")` | `NOT NULL` | -- |
| `album` | `TEXT` | `text("album")` | -- | -- |
| `duration_ms` | `INTEGER` | `integer("duration_ms")` | `NOT NULL` | -- |
| `isrc` | `TEXT` | `text("isrc")` | -- | -- |
| `spotify_uri` | `TEXT` | `text("spotify_uri")` | -- | -- |
| `created_at` | `INTEGER` | `integer("created_at")` | `NOT NULL` | `Date.now()` |
| `updated_at` | `INTEGER` | `integer("updated_at")` | `NOT NULL` | `Date.now()` (auto-updated) |

- `spotify_id` has a unique index (`tracks_spotify_id_unique`).

### Table: `playlist_tracks`

| Column | SQL Type | Drizzle Type | Constraints | Default |
|---|---|---|---|---|
| `id` | `TEXT` | `text("id")` | `PRIMARY KEY` | `crypto.randomUUID()` |
| `playlist_id` | `TEXT` | `text("playlist_id")` | `NOT NULL`, `FK -> playlists.id` | -- |
| `track_id` | `TEXT` | `text("track_id")` | `NOT NULL`, `FK -> tracks.id` | -- |
| `position` | `INTEGER` | `integer("position")` | `NOT NULL` | -- |
| `added_at` | `INTEGER` | `integer("added_at")` | -- | -- |

- Composite unique index: `playlist_track_uniq` on `(playlist_id, track_id)`.
- Foreign keys reference `playlists.id` and `tracks.id` with no cascade (default `ON UPDATE no action ON DELETE no action`).

### Table: `lexicon_tracks`

| Column | SQL Type | Drizzle Type | Constraints | Default |
|---|---|---|---|---|
| `id` | `TEXT` | `text("id")` | `PRIMARY KEY` | `crypto.randomUUID()` |
| `file_path` | `TEXT` | `text("file_path")` | `UNIQUE`, `NOT NULL` | -- |
| `title` | `TEXT` | `text("title")` | `NOT NULL` | -- |
| `artist` | `TEXT` | `text("artist")` | `NOT NULL` | -- |
| `album` | `TEXT` | `text("album")` | -- | -- |
| `duration_ms` | `INTEGER` | `integer("duration_ms")` | -- | -- |
| `last_synced` | `INTEGER` | `integer("last_synced")` | `NOT NULL` | -- |

- `file_path` has a unique index (`lexicon_tracks_file_path_unique`).
- No `updated_at` column on this table (only `last_synced`).
- No `created_at` column on this table.

### Table: `matches`

| Column | SQL Type | Drizzle Type | Constraints | Default |
|---|---|---|---|---|
| `id` | `TEXT` | `text("id")` | `PRIMARY KEY` | `crypto.randomUUID()` |
| `source_type` | `TEXT` | `text("source_type", { enum: ["spotify", "soulseek", "file"] })` | `NOT NULL` | -- |
| `source_id` | `TEXT` | `text("source_id")` | `NOT NULL` | -- |
| `target_type` | `TEXT` | `text("target_type", { enum: ["spotify", "lexicon", "soulseek"] })` | `NOT NULL` | -- |
| `target_id` | `TEXT` | `text("target_id")` | `NOT NULL` | -- |
| `score` | `REAL` | `real("score")` | `NOT NULL` | -- |
| `confidence` | `TEXT` | `text("confidence", { enum: ["high", "review", "low"] })` | `NOT NULL` | -- |
| `method` | `TEXT` | `text("method", { enum: ["isrc", "fuzzy", "manual"] })` | `NOT NULL` | -- |
| `status` | `TEXT` | `text("status", { enum: ["pending", "confirmed", "rejected"] })` | `NOT NULL` | -- |
| `parked_at` | `INTEGER` | `integer("parked_at")` | -- | -- |
| `created_at` | `INTEGER` | `integer("created_at")` | `NOT NULL` | `Date.now()` |
| `updated_at` | `INTEGER` | `integer("updated_at")` | `NOT NULL` | `Date.now()` (auto-updated) |

- Composite unique index: `match_pair_uniq` on `(source_type, source_id, target_type, target_id)`.
- `source_type` enum values: `"spotify"`, `"soulseek"`, `"file"`.
- `target_type` enum values: `"spotify"`, `"lexicon"`, `"soulseek"`.
- `confidence` enum values: `"high"`, `"review"`, `"low"`.
- `method` enum values: `"isrc"`, `"fuzzy"`, `"manual"`.
- `status` enum values: `"pending"`, `"confirmed"`, `"rejected"`.
- `parked_at` is a nullable timestamp (epoch ms). When a match with `"review"` confidence is created, `parked_at` is set to `Date.now()` to indicate it is parked for async review. `null` means the match was not parked (either auto-confirmed or already resolved).

### Table: `downloads`

| Column | SQL Type | Drizzle Type | Constraints | Default |
|---|---|---|---|---|
| `id` | `TEXT` | `text("id")` | `PRIMARY KEY` | `crypto.randomUUID()` |
| `track_id` | `TEXT` | `text("track_id")` | `NOT NULL`, `FK -> tracks.id` | -- |
| `playlist_id` | `TEXT` | `text("playlist_id")` | `FK -> playlists.id` | -- |
| `origin` | `TEXT` | `text("origin", { enum: ["not_found", "review_rejected"] })` | `NOT NULL` | -- |
| `status` | `TEXT` | `text("status", { enum: [...] })` | `NOT NULL` | -- |
| `soulseek_path` | `TEXT` | `text("soulseek_path")` | -- | -- |
| `file_path` | `TEXT` | `text("file_path")` | -- | -- |
| `error` | `TEXT` | `text("error")` | -- | -- |
| `started_at` | `INTEGER` | `integer("started_at")` | -- | -- |
| `completed_at` | `INTEGER` | `integer("completed_at")` | -- | -- |
| `created_at` | `INTEGER` | `integer("created_at")` | `NOT NULL` | `Date.now()` |

- `origin` enum values: `"not_found"` (track had no Lexicon match), `"review_rejected"` (user rejected the proposed Lexicon match).
- `status` enum values: `"pending"`, `"searching"`, `"downloading"`, `"validating"`, `"moving"`, `"done"`, `"failed"`.
- Foreign keys: `track_id -> tracks.id`, `playlist_id -> playlists.id` (nullable).
- No `updated_at` column on this table.

### Table: `rejections`

| Column | SQL Type | Drizzle Type | Constraints | Default |
|---|---|---|---|---|
| `id` | `TEXT` | `text("id")` | `PRIMARY KEY` | `crypto.randomUUID()` |
| `track_id` | `TEXT` | `text("track_id")` | `NOT NULL`, `FK -> tracks.id` | -- |
| `context` | `TEXT` | `text("context")` | `NOT NULL` | -- |
| `file_key` | `TEXT` | `text("file_key")` | `NOT NULL` | -- |
| `reason` | `TEXT` | `text("reason")` | -- | -- |
| `created_at` | `INTEGER` | `integer("created_at")` | `NOT NULL` | `Date.now()` |

- Composite unique index: `rejection_uniq` on `(track_id, context, file_key)`.
- Foreign key: `track_id -> tracks.id`.
- `context` identifies where the rejection originated. Currently only `"soulseek_download"` is used, but the column is a plain text to allow future contexts.
- `file_key` is a string that uniquely identifies the rejected file within the context. For Soulseek downloads, this is `"<username>/<filepath>"` (the username and remote file path concatenated with a separator).
- `reason` is an optional human/machine-readable reason for the rejection:
  - `"validation_failed"` -- post-download audio validation failed (wrong duration, corrupt file, etc.)
  - `"user_rejected"` -- user manually rejected the download after review
  - `"wrong_track"` -- the downloaded file turned out to be a different track
- No `updated_at` column on this table (rejections are immutable once created).

### Table: `jobs`

| Column | SQL Type | Drizzle Type | Constraints | Default |
|---|---|---|---|---|
| `id` | `TEXT` | `text("id")` | `PRIMARY KEY` | `crypto.randomUUID()` |
| `type` | `TEXT` | `text("type", { enum: [...] })` | `NOT NULL` | -- |
| `status` | `TEXT` | `text("status", { enum: [...] })` | `NOT NULL` | -- |
| `priority` | `INTEGER` | `integer("priority")` | `NOT NULL` | `0` |
| `payload` | `TEXT` | `text("payload")` | -- | -- |
| `result` | `TEXT` | `text("result")` | -- | -- |
| `error` | `TEXT` | `text("error")` | -- | -- |
| `attempt` | `INTEGER` | `integer("attempt")` | `NOT NULL` | `0` |
| `max_attempts` | `INTEGER` | `integer("max_attempts")` | `NOT NULL` | `3` |
| `parent_job_id` | `TEXT` | `text("parent_job_id")` | -- | -- |
| `started_at` | `INTEGER` | `integer("started_at")` | -- | -- |
| `completed_at` | `INTEGER` | `integer("completed_at")` | -- | -- |
| `created_at` | `INTEGER` | `integer("created_at")` | `NOT NULL` | `Date.now()` |

- `type` enum values: `"spotify_sync"`, `"lexicon_match"`, `"search"`, `"download"`, `"validate"`, `"lexicon_tag"`, `"wishlist_run"`.
- `status` enum values: `"queued"`, `"running"`, `"done"`, `"failed"`.
- `payload` and `result` are JSON-stringified text fields.
- `parent_job_id` is a self-referencing text field (not a formal FK) for job hierarchies.
- No `updated_at` column on this table.
- No `run_after` column -- automatic retry scheduling with backoff is removed. Failed jobs stay as `"failed"` and require manual intervention or re-queueing.

### Table: `sync_log`

| Column | SQL Type | Drizzle Type | Constraints | Default |
|---|---|---|---|---|
| `id` | `TEXT` | `text("id")` | `PRIMARY KEY` | `crypto.randomUUID()` |
| `playlist_id` | `TEXT` | `text("playlist_id")` | `FK -> playlists.id` | -- |
| `action` | `TEXT` | `text("action")` | `NOT NULL` | -- |
| `details` | `TEXT` | `text("details")` | -- | -- |
| `created_at` | `INTEGER` | `integer("created_at")` | `NOT NULL` | `Date.now()` |

- Foreign key: `playlist_id -> playlists.id` (nullable).
- No `updated_at` column on this table.

### Common column helpers

Three reusable column definitions are used across all tables:

1. **`id`**: `text("id").primaryKey().$defaultFn(() => crypto.randomUUID())` -- every row gets a UUID primary key auto-generated on insert.
2. **`createdAt`**: `integer("created_at").notNull().$defaultFn(() => Date.now())` -- epoch milliseconds, set once on insert.
3. **`updatedAt`**: `integer("updated_at").notNull().$defaultFn(() => Date.now()).$onUpdateFn(() => Date.now())` -- epoch milliseconds, auto-updated on every Drizzle update operation.

Note: Not all tables use `updatedAt`. Only `playlists`, `tracks`, and `matches` have this column.

### Indexes summary

| Index Name | Table | Columns | Type |
|---|---|---|---|
| `playlists_spotify_id_unique` | `playlists` | `spotify_id` | UNIQUE (automatic from `.unique()`) |
| `tracks_spotify_id_unique` | `tracks` | `spotify_id` | UNIQUE (automatic from `.unique()`) |
| `playlist_track_uniq` | `playlist_tracks` | `playlist_id, track_id` | UNIQUE (explicit `uniqueIndex`) |
| `lexicon_tracks_file_path_unique` | `lexicon_tracks` | `file_path` | UNIQUE (automatic from `.unique()`) |
| `match_pair_uniq` | `matches` | `source_type, source_id, target_type, target_id` | UNIQUE (explicit `uniqueIndex`) |
| `rejection_uniq` | `rejections` | `track_id, context, file_key` | UNIQUE (explicit `uniqueIndex`) |

### Foreign keys summary

| Source Table | Source Column | Target Table | Target Column | On Delete | On Update |
|---|---|---|---|---|---|
| `playlist_tracks` | `playlist_id` | `playlists` | `id` | no action | no action |
| `playlist_tracks` | `track_id` | `tracks` | `id` | no action | no action |
| `downloads` | `track_id` | `tracks` | `id` | no action | no action |
| `downloads` | `playlist_id` | `playlists` | `id` | no action | no action |
| `rejections` | `track_id` | `tracks` | `id` | no action | no action |
| `sync_log` | `playlist_id` | `playlists` | `id` | no action | no action |

### Consolidated initial migration

Combine all existing migrations into a single `0000_initial.sql`:

```sql
-- 0000_initial.sql
-- Consolidated migration for crate-sync database

CREATE TABLE `playlists` (
  `id` text PRIMARY KEY NOT NULL,
  `spotify_id` text,
  `name` text NOT NULL,
  `description` text,
  `snapshot_id` text,
  `is_owned` integer,
  `owner_id` text,
  `owner_name` text,
  `tags` text,
  `notes` text,
  `pinned` integer DEFAULT 0,
  `last_synced` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `playlists_spotify_id_unique` ON `playlists` (`spotify_id`);
--> statement-breakpoint

CREATE TABLE `tracks` (
  `id` text PRIMARY KEY NOT NULL,
  `spotify_id` text,
  `title` text NOT NULL,
  `artist` text NOT NULL,
  `album` text,
  `duration_ms` integer NOT NULL,
  `isrc` text,
  `spotify_uri` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tracks_spotify_id_unique` ON `tracks` (`spotify_id`);
--> statement-breakpoint

CREATE TABLE `playlist_tracks` (
  `id` text PRIMARY KEY NOT NULL,
  `playlist_id` text NOT NULL,
  `track_id` text NOT NULL,
  `position` integer NOT NULL,
  `added_at` integer,
  FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `playlist_track_uniq` ON `playlist_tracks` (`playlist_id`,`track_id`);
--> statement-breakpoint

CREATE TABLE `lexicon_tracks` (
  `id` text PRIMARY KEY NOT NULL,
  `file_path` text NOT NULL,
  `title` text NOT NULL,
  `artist` text NOT NULL,
  `album` text,
  `duration_ms` integer,
  `last_synced` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lexicon_tracks_file_path_unique` ON `lexicon_tracks` (`file_path`);
--> statement-breakpoint

CREATE TABLE `matches` (
  `id` text PRIMARY KEY NOT NULL,
  `source_type` text NOT NULL,
  `source_id` text NOT NULL,
  `target_type` text NOT NULL,
  `target_id` text NOT NULL,
  `score` real NOT NULL,
  `confidence` text NOT NULL,
  `method` text NOT NULL,
  `status` text NOT NULL,
  `parked_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `match_pair_uniq` ON `matches` (`source_type`,`source_id`,`target_type`,`target_id`);
--> statement-breakpoint

CREATE TABLE `downloads` (
  `id` text PRIMARY KEY NOT NULL,
  `track_id` text NOT NULL,
  `playlist_id` text,
  `origin` text NOT NULL,
  `status` text NOT NULL,
  `soulseek_path` text,
  `file_path` text,
  `error` text,
  `started_at` integer,
  `completed_at` integer,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint

CREATE TABLE `rejections` (
  `id` text PRIMARY KEY NOT NULL,
  `track_id` text NOT NULL,
  `context` text NOT NULL,
  `file_key` text NOT NULL,
  `reason` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rejection_uniq` ON `rejections` (`track_id`,`context`,`file_key`);
--> statement-breakpoint

CREATE TABLE `jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `type` text NOT NULL,
  `status` text NOT NULL,
  `priority` integer DEFAULT 0 NOT NULL,
  `payload` text,
  `result` text,
  `error` text,
  `attempt` integer DEFAULT 0 NOT NULL,
  `max_attempts` integer DEFAULT 3 NOT NULL,
  `parent_job_id` text,
  `started_at` integer,
  `completed_at` integer,
  `created_at` integer NOT NULL
);
--> statement-breakpoint

CREATE TABLE `sync_log` (
  `id` text PRIMARY KEY NOT NULL,
  `playlist_id` text,
  `action` text NOT NULL,
  `details` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON UPDATE no action ON DELETE no action
);
```

The corresponding `meta/_journal.json` should have a single entry at index 0.

### Database client (`src/db/client.ts`)

#### `getDb(dbPath?: string)`

1. If the singleton `db` is already initialized, return it immediately.
2. Resolve the database path: use the provided `dbPath`, or default to `"./data/crate-sync.db"`.
3. Resolve the path to an absolute path using `path.resolve()`.
4. Create the parent directory if it does not exist (`mkdirSync(dirname(resolvedPath), { recursive: true })`).
5. Create a new `better-sqlite3` `Database` instance at the resolved path.
6. Set WAL journal mode: `sqlite.pragma("journal_mode = WAL")`.
7. Create a Drizzle instance: `drizzle(sqlite, { schema })` where `schema` is the `* as schema` import from `./schema.js`.
8. Resolve the migrations folder relative to the current module file:
   ```ts
   const currentDir = dirname(fileURLToPath(import.meta.url));
   const migrationsFolder = resolve(currentDir, "migrations");
   ```
9. Run pending migrations: `migrate(db, { migrationsFolder })`.
10. Store the Drizzle instance in the module-level `db` variable and return it.

**Key points:**
- The function is synchronous (better-sqlite3 is synchronous).
- The return type is `ReturnType<typeof drizzle<typeof schema>>` which provides full type inference for queries.
- `import.meta.url` is used so migrations resolve correctly regardless of the working directory.

#### `closeDb()`

1. If `db` is `null`, return immediately (no-op).
2. Access the underlying better-sqlite3 instance via `(db as any).$client.close()`.
3. Set `db = null` to reset the singleton.

**Key points:**
- Uses `(db as any).$client` because Drizzle does not expose a typed `close()` method.
- Useful for tests (to get a fresh database) and graceful shutdown.

#### Constants

```ts
const DEFAULT_DB_PATH = "./data/crate-sync.db";
```

## Error Handling

| Scenario | Behavior |
|---|---|
| Database directory cannot be created | `mkdirSync` throws -- propagates to caller |
| Database file is corrupted | `better-sqlite3` constructor throws -- propagates to caller |
| Migration fails (SQL error) | `migrate()` throws -- propagates to caller; database may be in a partially migrated state |
| `closeDb()` called when already closed | No-op, returns silently |
| `getDb()` called after `closeDb()` | Creates a new database connection (singleton is reset) |
| SQLite lock contention | WAL mode reduces this; better-sqlite3 retries internally with `SQLITE_BUSY` handling |

## Tests

### Test: getDb creates database file and returns Drizzle instance

```
Input:  Call getDb("/tmp/test-crate-sync.db")
Output: - File /tmp/test-crate-sync.db exists
        - Return value has query methods (select, insert, etc.)
        - All tables exist (can insert into playlists, tracks, etc.)
Cleanup: Call closeDb(), delete /tmp/test-crate-sync.db
```

### Test: getDb returns singleton on repeated calls

```
Input:  const db1 = getDb("/tmp/test.db"); const db2 = getDb();
Output: db1 === db2 (same reference)
Cleanup: closeDb()
```

### Test: getDb enables WAL mode

```
Input:  Call getDb("/tmp/test.db")
Output: Query "PRAGMA journal_mode" returns "wal"
Cleanup: closeDb()
```

### Test: closeDb resets singleton, allowing new connection

```
Input:  getDb("/tmp/test1.db"); closeDb(); getDb("/tmp/test2.db");
Output: Second getDb opens a different database at test2.db
Cleanup: closeDb()
```

### Test: insert and select a playlist round-trips correctly

```
Input:  Insert { name: "Test", spotifyId: "abc123" } into playlists
Output: Select by spotifyId returns the inserted row with:
        - id is a valid UUID string
        - name === "Test"
        - spotifyId === "abc123"
        - createdAt is a number (epoch ms)
        - updatedAt is a number (epoch ms)
Cleanup: closeDb()
```

### Test: playlist_track_uniq prevents duplicate (playlistId, trackId)

```
Input:  Insert same (playlistId, trackId) pair twice
Output: Second insert throws a UNIQUE constraint error
Cleanup: closeDb()
```

### Test: match_pair_uniq prevents duplicate match pairs

```
Input:  Insert same (sourceType, sourceId, targetType, targetId) pair twice
Output: Second insert throws a UNIQUE constraint error
Cleanup: closeDb()
```

### Test: matches table supports parked_at column

```
Input:  Insert a match with parked_at = Date.now()
Output: Select returns the match with parked_at as a number (epoch ms)

Input:  Insert a match with parked_at = null
Output: Select returns the match with parked_at === null
Cleanup: closeDb()
```

### Test: downloads table requires origin column

```
Input:  Insert a download with origin = "not_found"
Output: Select returns the download with origin === "not_found"

Input:  Insert a download with origin = "review_rejected"
Output: Select returns the download with origin === "review_rejected"
Cleanup: closeDb()
```

### Test: rejections table enforces unique constraint

```
Input:  Insert { trackId: "t1", context: "soulseek_download", fileKey: "user1/path/file.flac" } twice
Output: Second insert throws a UNIQUE constraint error
Cleanup: closeDb()
```

### Test: rejections table allows different files for same track

```
Input:  Insert { trackId: "t1", context: "soulseek_download", fileKey: "user1/path/file.flac" }
        Insert { trackId: "t1", context: "soulseek_download", fileKey: "user2/path/file.mp3" }
Output: Both inserts succeed
Cleanup: closeDb()
```

### Test: jobs table has no run_after column

```
Input:  Inspect the jobs table schema
Output: No column named "run_after" exists
Cleanup: closeDb()
```

## Acceptance Criteria

- [ ] `playlists` table has all 14 columns with correct types, constraints, and defaults
- [ ] `tracks` table has all 10 columns with correct types, constraints, and defaults
- [ ] `playlist_tracks` table has all 5 columns with composite unique index and two foreign keys
- [ ] `lexicon_tracks` table has all 7 columns with unique `file_path`
- [ ] `matches` table has all 12 columns (including `parked_at`) with composite unique index and enum constraints
- [ ] `matches.parked_at` is an integer (nullable) for async review timestamps
- [ ] `downloads` table has all 11 columns (including `origin`) with two foreign keys and status enum
- [ ] `downloads.origin` is a NOT NULL text column with enum values `"not_found"` and `"review_rejected"`
- [ ] `rejections` table has all 6 columns with foreign key to tracks and composite unique index on `(track_id, context, file_key)`
- [ ] `rejections.reason` is nullable text (optional)
- [ ] `jobs` table has all 13 columns with type and status enums and correct defaults (priority=0, attempt=0, max_attempts=3)
- [ ] `jobs` table does NOT have a `run_after` column (no automatic retry scheduling)
- [ ] `jobs.type` enum includes: `"spotify_sync"`, `"lexicon_match"`, `"search"`, `"download"`, `"validate"`, `"lexicon_tag"`, `"wishlist_run"`
- [ ] `sync_log` table has all 5 columns with foreign key to playlists
- [ ] All `id` columns use `crypto.randomUUID()` as the default function
- [ ] All `created_at` columns use `Date.now()` as the default function
- [ ] `updated_at` columns on playlists, tracks, and matches use `$onUpdateFn(() => Date.now())`
- [ ] `getDb()` creates the parent directory if it does not exist
- [ ] `getDb()` enables WAL journal mode
- [ ] `getDb()` runs migrations from the folder relative to the module file
- [ ] `getDb()` returns a singleton (same reference on repeated calls)
- [ ] `getDb(path)` accepts an optional custom database path
- [ ] `closeDb()` closes the underlying SQLite connection and resets the singleton
- [ ] `closeDb()` is a no-op when no connection is open
- [ ] A single consolidated migration file reproduces the complete schema
- [ ] Inferred select and insert types are exported for all 9 tables (including `Rejection` and `NewRejection`)
- [ ] `JobType` and `JobStatus` utility types are exported
