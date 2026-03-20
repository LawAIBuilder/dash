import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db.js";
import { authoritativeMigrations } from "../schema.js";
import { seedFoundation } from "../seed.js";

function createTempDbPath() {
  const dir = mkdtempSync(join(tmpdir(), "wc-legal-prep-migration-"));
  return {
    dir,
    dbPath: join(dir, "authoritative.sqlite")
  };
}

function initializeLegacyDb(dbPath: string, migrationCount: number) {
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS authoritative_migrations (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const insertApplied = db.prepare(`
    INSERT INTO authoritative_migrations (id, description)
    VALUES (?, ?)
  `);

  for (const migration of authoritativeMigrations.slice(0, migrationCount)) {
    migration.up(db);
    insertApplied.run(migration.id, migration.description);
  }

  return db;
}

describe("openDatabase migration compatibility", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("upgrades a pre-0005 database cleanly through the latest migrations", () => {
    const { dir, dbPath } = createTempDbPath();
    tempDirs.push(dir);

    const legacyDb = initializeLegacyDb(dbPath, 4);
    seedFoundation(legacyDb);

    legacyDb.prepare(
      `
        INSERT INTO source_connections
          (id, provider, account_label, auth_mode, scopes, status, last_verified_at)
        VALUES
          ('conn-1', 'box', 'Legacy Box', 'development_local_process', '[]', 'active', CURRENT_TIMESTAMP)
      `
    ).run();

    legacyDb.prepare(
      `
        INSERT INTO cases (id, name, case_type)
        VALUES ('case-1', 'Legacy Matter', 'wc')
      `
    ).run();

    legacyDb.prepare(
      `
        INSERT INTO canonical_documents
          (id, case_id, title, page_count, total_text_length, ocr_status, ingestion_status)
        VALUES
          ('doc-1', 'case-1', 'Legacy Doc', 1, 0, 'pending', 'pending')
      `
    ).run();

    legacyDb.prepare(
      `
        INSERT INTO canonical_pages
          (id, canonical_doc_id, page_number_in_doc, text_length, raw_text, ocr_method, ocr_confidence, ocr_status)
        VALUES
          ('page-1', 'doc-1', 1, 0, NULL, NULL, NULL, 'pending')
      `
    ).run();

    legacyDb.close();

    const upgradedDb = openDatabase(dbPath);
    const appliedMigrations = upgradedDb
      .prepare(`SELECT id FROM authoritative_migrations ORDER BY id ASC`)
      .all() as Array<{ id: string }>;
    expect(appliedMigrations.map((row) => row.id)).toEqual(
      authoritativeMigrations.map((migration) => migration.id)
    );

    const sourceConnection = upgradedDb.prepare(
      `
        SELECT metadata_json, updated_at, external_account_id, callback_state, authorization_url, last_error_message
        FROM source_connections
        WHERE id = 'conn-1'
        LIMIT 1
      `
    ).get() as
      | {
          metadata_json: string | null;
          updated_at: string | null;
          external_account_id: string | null;
          callback_state: string | null;
          authorization_url: string | null;
          last_error_message: string | null;
        }
      | undefined;

    expect(sourceConnection).toEqual({
      metadata_json: "{}",
      updated_at: expect.any(String),
      external_account_id: null,
      callback_state: null,
      authorization_url: null,
      last_error_message: null
    });

    const canonicalPage = upgradedDb.prepare(
      `
        SELECT extraction_status, updated_at
        FROM canonical_pages
        WHERE id = 'page-1'
        LIMIT 1
      `
    ).get() as
      | {
          extraction_status: string;
          updated_at: string | null;
        }
      | undefined;

    expect(canonicalPage).toEqual({
      extraction_status: "pending",
      updated_at: expect.any(String)
    });

    upgradedDb.close();
  });

  it("fails fast when migration bookkeeping claims columns exist but the runtime schema is missing them", () => {
    const { dir, dbPath } = createTempDbPath();
    tempDirs.push(dir);

    const legacyDb = initializeLegacyDb(dbPath, 4);
    const insertApplied = legacyDb.prepare(`
      INSERT INTO authoritative_migrations (id, description)
      VALUES (?, ?)
    `);
    for (const migration of authoritativeMigrations.slice(4)) {
      insertApplied.run(migration.id, migration.description);
    }
    legacyDb.close();

    expect(() => openDatabase(dbPath)).toThrow(
      "Runtime schema compatibility check failed. Missing columns:"
    );
  });
});
