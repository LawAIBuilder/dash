import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReadinessSnapshot } from "../readiness.js";
import { openDatabase } from "../db.js";
import { seedFoundation } from "../seed.js";
import { writeWorkerHeartbeat } from "../worker-health.js";

function makeTempDbPath() {
  const dir = mkdtempSync(join(tmpdir(), "wc-legal-prep-readiness-test-"));
  return {
    dir,
    dbPath: join(dir, "authoritative.sqlite"),
    exportDir: join(dir, "exports")
  };
}

async function loadServerWithEnv(env: Record<string, string | undefined>) {
  const { dir, dbPath, exportDir } = makeTempDbPath();
  mkdirSync(exportDir, { recursive: true });
  vi.resetModules();
  process.env.WC_SKIP_LISTEN = "1";
  process.env.WC_SQLITE_PATH = dbPath;

  for (const [key, value] of Object.entries(env)) {
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
      rmSync(dir, { recursive: true, force: true });
      delete process.env.WC_SKIP_LISTEN;
      delete process.env.WC_SQLITE_PATH;
      for (const key of Object.keys(env)) {
        delete process.env[key];
      }
    }
  };
}

function createRuntimeReadyDb(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const dbPath = join(dir, "authoritative.sqlite");
  const db = openDatabase(dbPath);
  seedFoundation(db);
  return { dir, db };
}

describe("readiness helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns expected top-level keys and includes last migration id", async () => {
    const { dir, db } = createRuntimeReadyDb("wc-readiness-helper-");
    try {
      writeWorkerHeartbeat(db, {
        workerName: "ocr",
        status: "idle"
      });

      const snapshot = await buildReadinessSnapshot(db, {
        stale_sync_runs_reconciled: 0
      });

      expect(snapshot).toMatchObject({
        ok: true,
        paths: expect.any(Object),
        database: expect.any(Object),
        config: expect.any(Object),
        ocr_worker: expect.any(Object),
        startup_recovery: { stale_sync_runs_reconciled: 0 }
      });
      expect(typeof snapshot.time).toBe("string");
      expect(snapshot.database.last_migration_id).not.toBeNull();
      expect(typeof snapshot.database.last_migration_id).toBe("string");
      if (!snapshot.database.last_migration_id) {
        throw new Error("expected last_migration_id to be present");
      }
      expect(snapshot.database.last_migration_id.length).toBeGreaterThan(0);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("contains no secret values in output", async () => {
    const { dir, db } = createRuntimeReadyDb("wc-readiness-secret-");
    process.env.OPENAI_API_KEY = "sk-secret-openai-key";
    process.env.BOX_JWT_CONFIG_JSON = JSON.stringify({
      boxAppSettings: {}
    });

    try {
      const snapshot = await buildReadinessSnapshot(db, {
        stale_sync_runs_reconciled: 1
      });
      const serialized = JSON.stringify(snapshot);

      expect(serialized).not.toContain("sk-secret-openai-key");
      expect(serialized).not.toContain("boxAppSettings");
      expect(snapshot.config.openai_configured).toBe(true);
      expect(snapshot.config.box_configured).toBe(true);
    } finally {
      delete process.env.OPENAI_API_KEY;
      delete process.env.BOX_JWT_CONFIG_JSON;
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports config booleans correctly when env is absent", async () => {
    const { dir, db } = createRuntimeReadyDb("wc-readiness-config-");
    delete process.env.OPENAI_API_KEY;
    delete process.env.BOX_JWT_CONFIG_JSON;

    try {
      const snapshot = await buildReadinessSnapshot(db, {
        stale_sync_runs_reconciled: 0
      });

      expect(snapshot.config.openai_configured).toBe(false);
      expect(snapshot.config.box_configured).toBe(false);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports OCR worker summary with stable shape", async () => {
    const { dir, db } = createRuntimeReadyDb("wc-readiness-worker-");
    try {
      writeWorkerHeartbeat(db, {
        workerName: "ocr",
        status: "processing"
      });

      const snapshot = await buildReadinessSnapshot(db, {
        stale_sync_runs_reconciled: 0
      });

      expect(snapshot.ocr_worker).toEqual({
        heartbeat_present: true,
        stale: expect.any(Boolean),
        last_heartbeat_at: expect.any(String),
        status: "processing",
        age_ms: expect.any(Number)
      });
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("readiness route", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("returns 200 and leaves existing health endpoints intact", async () => {
    const server = await loadServerWithEnv({
      NODE_ENV: "test",
      WC_EXPORT_DIR: undefined
    });

    try {
      const readinessRes = await server.app.inject({
        method: "GET",
        url: "/api/ops/readiness"
      });
      expect(readinessRes.statusCode).toBe(200);
      const readiness = readinessRes.json<{
        paths: { sqlite_path: string; export_dir_configured: boolean };
        database: { last_migration_id: string | null; writable: boolean };
      }>();
      expect(readiness.paths.sqlite_path).toContain("authoritative.sqlite");
      expect(typeof readiness.database.writable).toBe("boolean");

      const healthRes = await server.app.inject({
        method: "GET",
        url: "/health"
      });
      expect(healthRes.statusCode).toBe(200);
      expect(healthRes.json()).toEqual({
        ok: true,
        service: "wc-authoritative-api",
        seeded_at_startup: true,
        startup_recovery: expect.any(Object)
      });

      const workerRes = await server.app.inject({
        method: "GET",
        url: "/api/workers/ocr/health"
      });
      expect(workerRes.statusCode).toBe(200);
      expect(workerRes.json()).toEqual({
        ok: true,
        worker: null,
        stale: true,
        age_ms: null
      });
    } finally {
      await server.cleanup();
    }
  });
});
