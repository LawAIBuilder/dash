import { dirname, join, resolve } from "node:path";
import { resolveDatabasePath } from "./db.js";

export interface ResolvedStorageDirectory {
  path: string;
  configured: boolean;
}

export function resolvePackageExportDirInfo(): ResolvedStorageDirectory {
  const configured = process.env.WC_EXPORT_DIR?.trim();
  if (configured) {
    return {
      path: resolve(configured),
      configured: true
    };
  }

  return {
    path: resolve(process.cwd(), "data", "exports"),
    configured: false
  };
}

export function resolvePackageExportDir() {
  return resolvePackageExportDirInfo().path;
}

export function resolveExhibitExportDirInfo(): ResolvedStorageDirectory {
  const configured = process.env.WC_EXHIBIT_EXPORT_DIR?.trim();
  if (configured) {
    return {
      path: resolve(configured),
      configured: true
    };
  }

  return {
    path: join(dirname(resolveDatabasePath()), "exhibit_exports"),
    configured: false
  };
}

export function resolveExhibitExportDir() {
  return resolveExhibitExportDirInfo().path;
}

export function resolveMatterUploadDirectoryInfo(): ResolvedStorageDirectory {
  const configured = process.env.WC_UPLOAD_DIR?.trim();
  if (configured) {
    return {
      path: resolve(configured),
      configured: true
    };
  }

  return {
    path: resolve(process.cwd(), "data", "uploads"),
    configured: false
  };
}

export function resolveMatterUploadDirectory() {
  return resolveMatterUploadDirectoryInfo().path;
}

export function resolveBackupBaseDirInfo(): ResolvedStorageDirectory {
  const configured = process.env.WC_BACKUP_DIR?.trim();
  if (configured) {
    return {
      path: resolve(configured),
      configured: true
    };
  }

  return {
    path: join(dirname(resolveDatabasePath()), "backups"),
    configured: false
  };
}

export function resolveBackupBaseDir() {
  return resolveBackupBaseDirInfo().path;
}
