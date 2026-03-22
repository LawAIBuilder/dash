import type Database from "better-sqlite3";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { isAIConfigured } from "./ai-service.js";
import { resolveBoxProviderConfig } from "./box-provider.js";
import { getLastAppliedMigrationId, resolveDatabasePath } from "./db.js";
import { resolvePackageExportDirInfo } from "./storage-paths.js";
import { getWorkerHealthSummary, probeWorkerHeartbeatWrite } from "./worker-health.js";

export interface EffectivePaths {
  sqlitePath: string;
  sqliteParentDir: string;
  exportDir: string;
  exportDirConfigured: boolean;
}

export interface WritablePathCheck {
  path: string;
  exists: boolean;
  writable: boolean;
  error: string | null;
}

export interface StartupValidationResult {
  ok: boolean;
  errors: string[];
  paths: EffectivePaths;
  sqliteParentDir: WritablePathCheck;
  exportDir: WritablePathCheck | null;
  databaseWritable: boolean;
  workerHeartbeatWritable: boolean;
}

function resolveExportDir() {
  const resolved = resolvePackageExportDirInfo();
  return {
    exportDir: resolved.path,
    exportDirConfigured: resolved.configured
  };
}

export function getEffectivePaths(): EffectivePaths {
  const sqlitePath = resolveDatabasePath();
  const { exportDir, exportDirConfigured } = resolveExportDir();
  return {
    sqlitePath,
    sqliteParentDir: dirname(sqlitePath),
    exportDir,
    exportDirConfigured
  };
}

export async function checkWritablePath(path: string): Promise<WritablePathCheck> {
  try {
    const details = await stat(path);
    if (!details.isDirectory()) {
      return {
        path,
        exists: true,
        writable: false,
        error: "not_a_directory"
      };
    }
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
    return {
      path,
      exists: false,
      writable: false,
      error: code === "ENOENT" ? "missing" : code
    };
  }

  try {
    await access(path, constants.W_OK);
    return {
      path,
      exists: true,
      writable: true,
      error: null
    };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
    return {
      path,
      exists: true,
      writable: false,
      error: code
    };
  }
}

export function getLastMigrationId(db: Database.Database) {
  return getLastAppliedMigrationId(db);
}

export function getConfigPresenceSummary() {
  let boxConfigured = false;
  try {
    boxConfigured = Boolean(resolveBoxProviderConfig());
  } catch {
    boxConfigured = false;
  }

  return {
    openaiConfigured: isAIConfigured(),
    boxConfigured
  };
}

export function checkDatabaseWritable(db: Database.Database) {
  try {
    db.exec("BEGIN IMMEDIATE");
    db.exec("ROLLBACK");
    return true;
  } catch {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Ignore cleanup failures from a failed BEGIN.
    }
    return false;
  }
}

export function getOcrWorkerSummary(db: Database.Database) {
  return getWorkerHealthSummary(db, "ocr");
}

export async function validateConfiguredPaths(paths = getEffectivePaths()) {
  const sqliteParentDir = await checkWritablePath(paths.sqliteParentDir);
  const exportDir = paths.exportDirConfigured ? await checkWritablePath(paths.exportDir) : null;

  const errors: string[] = [];

  if (!sqliteParentDir.exists) {
    errors.push(`SQLite parent directory does not exist: ${paths.sqliteParentDir}`);
  } else if (!sqliteParentDir.writable) {
    errors.push(`SQLite parent directory is not writable: ${paths.sqliteParentDir}`);
  }

  if (paths.exportDirConfigured) {
    if (!exportDir?.exists) {
      errors.push(`Configured export directory does not exist: ${paths.exportDir}`);
    } else if (!exportDir.writable) {
      errors.push(`Configured export directory is not writable: ${paths.exportDir}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    paths,
    sqliteParentDir,
    exportDir
  };
}

export async function validateStartupReadiness(
  db: Database.Database,
  paths = getEffectivePaths()
): Promise<StartupValidationResult> {
  const pathChecks = await validateConfiguredPaths(paths);
  const databaseWritable = checkDatabaseWritable(db);
  const workerHeartbeatWritable = probeWorkerHeartbeatWrite(db, "__startup_readiness__");
  const errors = [...pathChecks.errors];

  if (!databaseWritable) {
    errors.push("Database is not writable");
  }

  if (!workerHeartbeatWritable) {
    errors.push("Worker heartbeat table is not writable");
  }

  return {
    ok: errors.length === 0,
    errors,
    paths: pathChecks.paths,
    sqliteParentDir: pathChecks.sqliteParentDir,
    exportDir: pathChecks.exportDir,
    databaseWritable,
    workerHeartbeatWritable
  };
}

export async function buildReadinessSnapshot(
  db: Database.Database,
  startupRecovery: Record<string, number>
) {
  const paths = getEffectivePaths();
  const sqliteParentDir = await checkWritablePath(paths.sqliteParentDir);
  const exportDir = await checkWritablePath(paths.exportDir);
  const databaseWritable = checkDatabaseWritable(db);
  const config = getConfigPresenceSummary();
  const ocrWorker = getOcrWorkerSummary(db);

  return {
    ok: true,
    time: new Date().toISOString(),
    paths: {
      sqlite_path: paths.sqlitePath,
      sqlite_parent_writable: sqliteParentDir.writable,
      export_dir: paths.exportDir,
      export_dir_configured: paths.exportDirConfigured,
      export_dir_writable: exportDir.writable
    },
    database: {
      last_migration_id: getLastMigrationId(db),
      writable: databaseWritable
    },
    config: {
      openai_configured: config.openaiConfigured,
      box_configured: config.boxConfigured
    },
    ocr_worker: {
      heartbeat_present: ocrWorker.heartbeatPresent,
      stale: ocrWorker.stale,
      last_heartbeat_at: ocrWorker.lastHeartbeatAt,
      status: ocrWorker.status,
      age_ms: ocrWorker.ageMs
    },
    startup_recovery: startupRecovery
  };
}
