import Database from "better-sqlite3";
import type { Database as SqliteDatabase } from "better-sqlite3";
import { authoritativeMigrations } from "../schema.js";
import { seedFoundation } from "../seed.js";

export function createTestDb(): SqliteDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const migration of authoritativeMigrations) {
    migration.up(db);
  }
  return db;
}

export function createSeededTestDb(): SqliteDatabase {
  const db = createTestDb();
  seedFoundation(db);
  return db;
}

export function seedCase(
  db: SqliteDatabase,
  input: {
    caseId: string;
    name?: string;
    caseType?: string;
  }
) {
  db.prepare(
    `
      INSERT INTO cases (id, name, case_type)
      VALUES (?, ?, ?)
    `
  ).run(input.caseId, input.name ?? "Test Matter", input.caseType ?? "wc");

  return input.caseId;
}

export function seedSourceConnection(
  db: SqliteDatabase,
  input: {
    connectionId: string;
    provider: "box" | "practicepanther";
    accountLabel?: string;
    status?: string;
    authMode?: string;
  }
) {
  db.prepare(
    `
      INSERT INTO source_connections
        (id, provider, account_label, auth_mode, scopes, status, metadata_json)
      VALUES
        (?, ?, ?, ?, '[]', ?, '{}')
    `
  ).run(
    input.connectionId,
    input.provider,
    input.accountLabel ?? `Test ${input.provider}`,
    input.authMode ?? "development_local_process",
    input.status ?? "active"
  );

  return input.connectionId;
}

export function createThrowingJsonValue(message = "Intentional serialization failure") {
  return {
    toJSON() {
      throw new Error(message);
    }
  };
}
