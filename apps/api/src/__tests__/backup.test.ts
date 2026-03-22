import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackupSnapshot } from "../backup.js";
import { openDatabase } from "../db.js";
import { seedFoundation } from "../seed.js";

function createTempRoot(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function withTempEnv<T>(
  env: Record<string, string | undefined>,
  fn: () => Promise<T> | T
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(env)) {
    previous.set(key, process.env[key]);
    const value = env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return Promise.resolve(fn()).finally(() => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

async function loadServerWithEnv(
  root: string,
  env: Record<string, string | undefined>
): Promise<{ app: FastifyInstance; cleanup: () => Promise<void> }> {
  vi.resetModules();
  const previousCwd = process.cwd();
  process.chdir(root);
  const previous = new Map<string, string | undefined>();
  const appliedEnv = {
    WC_SKIP_LISTEN: "1",
    ...env
  };
  for (const [key, value] of Object.entries(appliedEnv)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  const mod = await import("../server.js");
  return {
    app: mod.app as FastifyInstance,
    cleanup: async () => {
      await mod.app.close();
      process.chdir(previousCwd);
      for (const [key, value] of previous.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  };
}

describe("backup snapshots", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a consistent sqlite snapshot and copies export/upload directories", async () => {
    const root = createTempRoot("wc-backup-helper-");
    const dbDir = join(root, "persistent");
    const dbPath = join(dbDir, "authoritative.sqlite");
    const backupDir = join(root, "snapshots");
    const packageExportDir = join(root, "package-exports");
    const exhibitExportDir = join(root, "exhibit-exports");
    const uploadDir = join(root, "uploads");

    mkdirSync(dbDir, { recursive: true });
    mkdirSync(packageExportDir, { recursive: true });
    mkdirSync(join(exhibitExportDir, "case-a"), { recursive: true });
    mkdirSync(join(uploadDir, "case-b"), { recursive: true });
    writeFileSync(join(packageExportDir, "draft.docx"), "package draft");
    writeFileSync(join(exhibitExportDir, "case-a", "packet.pdf"), "packet pdf");
    writeFileSync(join(uploadDir, "case-b", "upload.pdf"), "upload pdf");

    await withTempEnv(
      {
        WC_SQLITE_PATH: dbPath,
        WC_BACKUP_DIR: backupDir,
        WC_EXPORT_DIR: packageExportDir,
        WC_EXHIBIT_EXPORT_DIR: exhibitExportDir,
        WC_UPLOAD_DIR: uploadDir
      },
      async () => {
        const db = openDatabase(dbPath);
        seedFoundation(db);

        try {
          const snapshot = await createBackupSnapshot(db, {
            label: "nightly ops"
          });

          expect(snapshot.snapshot_id).toContain("nightly_ops");
          expect(snapshot.database.method).toBe("better_sqlite3_backup");
          expect(snapshot.database.total_pages).toBeGreaterThan(0);
          expect(await stat(snapshot.database.backup_path)).toBeTruthy();

          const copiedPackage = await readFile(
            join(snapshot.snapshot_dir, "artifacts", "package_exports", "draft.docx"),
            "utf8"
          );
          const copiedPacket = await readFile(
            join(snapshot.snapshot_dir, "artifacts", "exhibit_exports", "case-a", "packet.pdf"),
            "utf8"
          );
          const copiedUpload = await readFile(
            join(snapshot.snapshot_dir, "artifacts", "matter_uploads", "case-b", "upload.pdf"),
            "utf8"
          );

          expect(copiedPackage).toBe("package draft");
          expect(copiedPacket).toBe("packet pdf");
          expect(copiedUpload).toBe("upload pdf");

          const manifestJson = JSON.parse(await readFile(snapshot.manifest_path, "utf8")) as {
            snapshot_id: string;
            directories: Array<{ key: string; included: boolean; file_count: number }>;
          };
          expect(manifestJson.snapshot_id).toBe(snapshot.snapshot_id);
          expect(manifestJson.directories).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ key: "package_exports", included: true, file_count: 1 }),
              expect.objectContaining({ key: "exhibit_exports", included: true, file_count: 1 }),
              expect.objectContaining({ key: "matter_uploads", included: true, file_count: 1 })
            ])
          );
        } finally {
          db.close();
        }
      }
    );

    rmSync(root, { recursive: true, force: true });
  });

  it("skips missing optional default directories without failing the snapshot", async () => {
    const root = createTempRoot("wc-backup-defaults-");
    const previousCwd = process.cwd();
    process.chdir(root);

    const dbDir = join(root, "persistent");
    const dbPath = join(dbDir, "authoritative.sqlite");
    const backupDir = join(root, "snapshots");
    mkdirSync(dbDir, { recursive: true });

    try {
      await withTempEnv(
        {
          WC_SQLITE_PATH: dbPath,
          WC_BACKUP_DIR: backupDir,
          WC_EXPORT_DIR: undefined,
          WC_EXHIBIT_EXPORT_DIR: undefined,
          WC_UPLOAD_DIR: undefined
        },
        async () => {
          const db = openDatabase(dbPath);
          seedFoundation(db);

          try {
            const snapshot = await createBackupSnapshot(db);
            expect(snapshot.directories).toEqual(
              expect.arrayContaining([
                expect.objectContaining({ key: "package_exports", exists: false, included: false }),
                expect.objectContaining({ key: "exhibit_exports", exists: false, included: false }),
                expect.objectContaining({ key: "matter_uploads", exists: false, included: false })
              ])
            );
          } finally {
            db.close();
          }
        }
      );
    } finally {
      process.chdir(previousCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("cleans up partial snapshot state when a configured backup source is missing", async () => {
    const root = createTempRoot("wc-backup-failure-");
    const dbDir = join(root, "persistent");
    const dbPath = join(dbDir, "authoritative.sqlite");
    const backupDir = join(root, "snapshots");
    const missingPackageExportDir = join(root, "missing-package-exports");

    mkdirSync(dbDir, { recursive: true });

    try {
      await withTempEnv(
        {
          WC_SQLITE_PATH: dbPath,
          WC_BACKUP_DIR: backupDir,
          WC_EXPORT_DIR: missingPackageExportDir,
          WC_EXHIBIT_EXPORT_DIR: undefined,
          WC_UPLOAD_DIR: undefined
        },
        async () => {
          const db = openDatabase(dbPath);
          seedFoundation(db);

          try {
            await expect(createBackupSnapshot(db)).rejects.toThrow(
              `Configured backup source is missing: ${missingPackageExportDir}`
            );
            const remaining = await readdir(backupDir);
            expect(remaining).toEqual([]);
          } finally {
            db.close();
          }
        }
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("backup snapshot route", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("requires auth when WC_API_KEY is configured and returns a snapshot with auth", async () => {
    const root = createTempRoot("wc-backup-route-");
    const dbDir = join(root, "persistent");
    const dbPath = join(dbDir, "authoritative.sqlite");
    const backupDir = join(root, "snapshots");
    const packageExportDir = join(root, "package-exports");
    const exhibitExportDir = join(root, "exhibit-exports");
    const uploadDir = join(root, "uploads");

    mkdirSync(dbDir, { recursive: true });
    mkdirSync(packageExportDir, { recursive: true });
    mkdirSync(exhibitExportDir, { recursive: true });
    mkdirSync(uploadDir, { recursive: true });

    const server = await loadServerWithEnv(root, {
      WC_SQLITE_PATH: dbPath,
      WC_BACKUP_DIR: backupDir,
      WC_EXPORT_DIR: packageExportDir,
      WC_EXHIBIT_EXPORT_DIR: exhibitExportDir,
      WC_UPLOAD_DIR: uploadDir,
      WC_API_KEY: "operator-secret"
    });

    try {
      const unauthorized = await server.app.inject({
        method: "POST",
        url: "/api/ops/backups/snapshot"
      });
      expect(unauthorized.statusCode).toBe(401);

      const authorized = await server.app.inject({
        method: "POST",
        url: "/api/ops/backups/snapshot",
        headers: {
          authorization: "Bearer operator-secret"
        },
        payload: {
          label: "before-upgrade"
        }
      });
      expect(authorized.statusCode).toBe(200);
      const body = authorized.json<{
        ok: true;
        snapshot: {
          snapshot_id: string;
          manifest_path: string;
          database: { backup_path: string };
        };
      }>();
      expect(body.ok).toBe(true);
      expect(body.snapshot.snapshot_id).toContain("before-upgrade");
      expect(await stat(body.snapshot.database.backup_path)).toBeTruthy();
      expect(await stat(body.snapshot.manifest_path)).toBeTruthy();
    } finally {
      await server.cleanup();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
