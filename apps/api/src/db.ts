import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { authoritativeMigrations } from "./schema.js";

function resolveDefaultDbPath() {
  const fromEnv = process.env.WC_SQLITE_PATH?.trim();
  if (fromEnv) {
    return resolve(fromEnv);
  }
  return resolve(process.cwd(), "apps/api/data/authoritative.sqlite");
}

function tableColumns(db: Database.Database, tableName: string) {
  return new Set(
    (
      db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
        name: string;
      }>
    ).map((row) => row.name)
  );
}

function assertRuntimeCompatibility(db: Database.Database) {
  const requiredColumns: Record<string, string[]> = {
    source_connections: [
      "external_account_id",
      "callback_state",
      "authorization_url",
      "metadata_json",
      "last_error_message",
      "updated_at"
    ],
    canonical_pages: ["ocr_status", "extraction_status", "updated_at"],
    sync_runs: ["warning_message"],
    ai_jobs: ["error_code"],
    package_runs: ["error_code"],
    usage_counters: ["counter_key", "usage_date", "units"]
  };

  const missingByTable = Object.entries(requiredColumns)
    .map(([tableName, columns]) => {
      const actual = tableColumns(db, tableName);
      const missing = columns.filter((column) => !actual.has(column));
      return [tableName, missing] as const;
    })
    .filter(([, missing]) => missing.length > 0);

  if (missingByTable.length === 0) {
    return;
  }

  const message = missingByTable
    .map(([tableName, missing]) => `${tableName}: ${missing.join(", ")}`)
    .join(" | ");

  throw new Error(`Runtime schema compatibility check failed. Missing columns: ${message}`);
}

function applyAuthoritativeMigrations(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS authoritative_migrations (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const appliedMigrationIds = new Set(
    (
      db.prepare(`SELECT id FROM authoritative_migrations ORDER BY id ASC`).all() as Array<{
        id: string;
      }>
    ).map((row) => row.id)
  );

  const insertAppliedMigration = db.prepare(`
    INSERT INTO authoritative_migrations (id, description)
    VALUES (?, ?)
  `);

  for (const migration of authoritativeMigrations) {
    if (appliedMigrationIds.has(migration.id)) {
      continue;
    }

    db.transaction(() => {
      migration.up(db);
      insertAppliedMigration.run(migration.id, migration.description);
    })();
  }
}

export function openDatabase(dbPath?: string): Database.Database {
  const path = dbPath ?? resolveDefaultDbPath();
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  applyAuthoritativeMigrations(db);
  assertRuntimeCompatibility(db);
  return db;
}
