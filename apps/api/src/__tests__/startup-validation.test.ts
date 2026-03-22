import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateConfiguredPaths } from "../readiness.js";
import { authoritativeMigrations } from "../schema.js";

function makeTempDir(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function createMigratedDb(dbPath: string) {
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  for (const migration of authoritativeMigrations) {
    migration.up(db);
  }
  return db;
}

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) {
      rmSync(path, { recursive: true, force: true });
    }
  }
});

describe("startup validation", () => {
  it("passes with a valid sqlite parent dir", async () => {
    const root = makeTempDir("wc-readiness-valid-db-");
    cleanupPaths.push(root);

    const result = await validateConfiguredPaths({
      sqlitePath: join(root, "authoritative.sqlite"),
      sqliteParentDir: root,
      exportDir: join(root, "data", "exports"),
      exportDirConfigured: false
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.sqliteParentDir.writable).toBe(true);
  });

  it("fails when the sqlite parent dir is missing", async () => {
    const root = makeTempDir("wc-readiness-missing-db-parent-");
    cleanupPaths.push(root);

    const missingParent = join(root, "missing");
    const result = await validateConfiguredPaths({
      sqlitePath: join(missingParent, "authoritative.sqlite"),
      sqliteParentDir: missingParent,
      exportDir: join(root, "data", "exports"),
      exportDirConfigured: false
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(`SQLite parent directory does not exist: ${missingParent}`);
  });

  it("fails when a configured export dir is missing", async () => {
    const root = makeTempDir("wc-readiness-missing-export-");
    cleanupPaths.push(root);

    const exportDir = join(root, "missing-exports");
    const result = await validateConfiguredPaths({
      sqlitePath: join(root, "authoritative.sqlite"),
      sqliteParentDir: root,
      exportDir,
      exportDirConfigured: true
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(`Configured export directory does not exist: ${exportDir}`);
  });

  it("passes when a configured export dir exists", async () => {
    const root = makeTempDir("wc-readiness-valid-export-");
    cleanupPaths.push(root);

    const exportDir = join(root, "exports");
    mkdirSync(exportDir, { recursive: true });

    const result = await validateConfiguredPaths({
      sqlitePath: join(root, "authoritative.sqlite"),
      sqliteParentDir: root,
      exportDir,
      exportDirConfigured: true
    });

    expect(result.ok).toBe(true);
    expect(result.exportDir?.writable).toBe(true);
  });

  it("still passes when no export dir is configured", async () => {
    const root = makeTempDir("wc-readiness-no-export-");
    cleanupPaths.push(root);

    const dbPath = join(root, "authoritative.sqlite");
    const db = createMigratedDb(dbPath);
    db.close();

    const result = await validateConfiguredPaths({
      sqlitePath: dbPath,
      sqliteParentDir: root,
      exportDir: join(root, "data", "exports"),
      exportDirConfigured: false
    });

    expect(result.ok).toBe(true);
    expect(result.exportDir).toBeNull();
  });
});
