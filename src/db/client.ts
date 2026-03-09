import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

const DEFAULT_DB_PATH = "./data/crate-sync.db";

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

/**
 * Returns a singleton Drizzle instance backed by better-sqlite3.
 *
 * - Creates the parent directory for the DB file if it doesn't exist.
 * - Enables WAL journal mode for better concurrent-read performance.
 * - Runs pending migrations on first connect.
 */
export function getDb(dbPath?: string): ReturnType<typeof drizzle<typeof schema>> {
  if (db) return db;

  const resolvedPath = resolve(dbPath ?? DEFAULT_DB_PATH);

  // Ensure the directory exists
  mkdirSync(dirname(resolvedPath), { recursive: true });

  const sqlite = new Database(resolvedPath);
  sqlite.pragma("journal_mode = WAL");

  db = drizzle(sqlite, { schema });

  // Run migrations — resolve path relative to this file so it works from any cwd
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolve(currentDir, "migrations");

  migrate(db, { migrationsFolder });

  return db;
}

/**
 * Close the database connection and reset the singleton.
 * Useful for tests and graceful shutdown.
 */
export function closeDb(): void {
  if (!db) return;
  // Access the underlying better-sqlite3 instance to close it
  (db as any).$client.close();
  db = null;
}
