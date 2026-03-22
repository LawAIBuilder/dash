import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { toSafeFilesystemSegment } from "./fs-safety.js";
import { resolveDatabasePath } from "./db.js";
import {
  resolveBackupBaseDirInfo,
  resolveExhibitExportDirInfo,
  resolveMatterUploadDirectoryInfo,
  resolvePackageExportDirInfo
} from "./storage-paths.js";

export interface BackupDirectoryManifestEntry {
  key: "package_exports" | "exhibit_exports" | "matter_uploads";
  source_path: string;
  configured: boolean;
  exists: boolean;
  included: boolean;
  backup_path: string | null;
  file_count: number;
  total_bytes: number;
}

export interface BackupSnapshotManifest {
  snapshot_id: string;
  created_at: string;
  label: string | null;
  backup_base_dir: string;
  snapshot_dir: string;
  manifest_path: string;
  database: {
    source_path: string;
    backup_path: string;
    method: "better_sqlite3_backup";
    source_wal_present: boolean;
    source_shm_present: boolean;
    total_pages: number;
  };
  directories: BackupDirectoryManifestEntry[];
}

type DirectoryCopyStats = {
  fileCount: number;
  totalBytes: number;
};

type BackupSource = {
  key: BackupDirectoryManifestEntry["key"];
  path: string;
  configured: boolean;
};

async function pathExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyDirectoryRecursive(sourceDir: string, destinationDir: string): Promise<DirectoryCopyStats> {
  await mkdir(destinationDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  let fileCount = 0;
  let totalBytes = 0;

  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry.name);
    const destinationPath = join(destinationDir, entry.name);

    if (entry.isDirectory()) {
      const nested = await copyDirectoryRecursive(sourcePath, destinationPath);
      fileCount += nested.fileCount;
      totalBytes += nested.totalBytes;
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    await copyFile(sourcePath, destinationPath);
    const details = await stat(sourcePath);
    fileCount += 1;
    totalBytes += details.size;
  }

  return { fileCount, totalBytes };
}

function buildBackupSources(): BackupSource[] {
  const packageExports = resolvePackageExportDirInfo();
  const exhibitExports = resolveExhibitExportDirInfo();
  const uploads = resolveMatterUploadDirectoryInfo();

  return [
    {
      key: "package_exports",
      path: packageExports.path,
      configured: packageExports.configured
    },
    {
      key: "exhibit_exports",
      path: exhibitExports.path,
      configured: exhibitExports.configured
    },
    {
      key: "matter_uploads",
      path: uploads.path,
      configured: uploads.configured
    }
  ];
}

export async function createBackupSnapshot(
  db: Database.Database,
  input?: {
    label?: string | null;
  }
): Promise<BackupSnapshotManifest> {
  const createdAt = new Date().toISOString();
  const safeLabel = input?.label?.trim() ? toSafeFilesystemSegment(input.label.trim(), "snapshot") : null;
  const snapshotId = safeLabel
    ? `${createdAt.slice(0, 19).replace(/[:T]/g, "-")}-${safeLabel}-${randomUUID().slice(0, 8)}`
    : `${createdAt.slice(0, 19).replace(/[:T]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const backupBaseDir = resolveBackupBaseDirInfo().path;
  const snapshotDir = join(backupBaseDir, snapshotId);
  const artifactsDir = join(snapshotDir, "artifacts");
  const manifestPath = join(snapshotDir, "manifest.json");
  const sourceDbPath = resolveDatabasePath();
  const backupDbPath = join(snapshotDir, basename(sourceDbPath));

  await mkdir(backupBaseDir, { recursive: true });
  await mkdir(snapshotDir, { recursive: true });
  await mkdir(artifactsDir, { recursive: true });

  try {
    const backupMetadata = await db.backup(backupDbPath);
    const directories: BackupDirectoryManifestEntry[] = [];

    for (const source of buildBackupSources()) {
      let entry: BackupDirectoryManifestEntry = {
        key: source.key,
        source_path: source.path,
        configured: source.configured,
        exists: false,
        included: false,
        backup_path: null,
        file_count: 0,
        total_bytes: 0
      };

      const details = await stat(source.path).catch(() => null);
      if (!details) {
        if (source.configured) {
          throw new Error(`Configured backup source is missing: ${source.path}`);
        }
        directories.push(entry);
        continue;
      }

      if (!details.isDirectory()) {
        throw new Error(`Backup source is not a directory: ${source.path}`);
      }

      const destination = join(artifactsDir, source.key);
      const copied = await copyDirectoryRecursive(source.path, destination);
      entry = {
        ...entry,
        exists: true,
        included: true,
        backup_path: resolve(destination),
        file_count: copied.fileCount,
        total_bytes: copied.totalBytes
      };
      directories.push(entry);
    }

    const manifest: BackupSnapshotManifest = {
      snapshot_id: snapshotId,
      created_at: createdAt,
      label: input?.label?.trim() || null,
      backup_base_dir: backupBaseDir,
      snapshot_dir: snapshotDir,
      manifest_path: manifestPath,
      database: {
        source_path: sourceDbPath,
        backup_path: backupDbPath,
        method: "better_sqlite3_backup",
        source_wal_present: await pathExists(`${sourceDbPath}-wal`),
        source_shm_present: await pathExists(`${sourceDbPath}-shm`),
        total_pages: backupMetadata.totalPages
      },
      directories
    };

    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    return manifest;
  } catch (error) {
    await rm(snapshotDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
