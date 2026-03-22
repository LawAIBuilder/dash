import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { readPositiveIntegerEnv } from "./env.js";
import { toSafeFilesystemSegment } from "./fs-safety.js";
import { resolveMatterUploadDirectory } from "./storage-paths.js";
import { upsertSourceItemRecord, upsertSourceVersionRecord } from "./source-persistence.js";
import { normalizeSourceItemDocumentSpine } from "./runtime.js";

/** Fixed migration seed id in source_connections (provider matter_upload) */
export const MATTER_UPLOAD_CONNECTION_ID = "a0000001-0000-4000-8000-000000000001";

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 200) || "upload.bin";
}

export interface PersistCaseUploadResult {
  ok: true;
  source_item_id: string;
  relative_path: string;
  absolute_path: string;
  normalization: ReturnType<typeof normalizeSourceItemDocumentSpine>;
}

export async function persistCaseUploadAndIngest(
  db: Database.Database,
  input: {
    caseId: string;
    filename: string;
    mimeType: string | null;
    buffer: Buffer;
  }
): Promise<PersistCaseUploadResult | { ok: false; error: string }> {
  const maxBytes = readPositiveIntegerEnv("WC_UPLOAD_MAX_BYTES", 45 * 1024 * 1024, { min: 1 });
  if (input.buffer.length > maxBytes) {
    return { ok: false, error: `file exceeds maximum size (${maxBytes} bytes)` };
  }

  const allowed = (
    process.env.WC_UPLOAD_MIME_ALLOWLIST ??
    "application/pdf,image/png,image/jpeg,image/tiff,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const mime = (input.mimeType ?? "application/octet-stream").toLowerCase();
  if (allowed.length > 0 && !allowed.includes(mime)) {
    return { ok: false, error: `MIME type not allowed: ${mime}` };
  }

  const baseDir = resolveMatterUploadDirectory();
  const caseDirSegment = toSafeFilesystemSegment(input.caseId, "case");
  const caseDir = join(baseDir, caseDirSegment);
  await mkdir(caseDir, { recursive: true });

  const safeName = sanitizeFilename(input.filename);
  const remoteId = randomUUID();
  const absolutePath = join(caseDir, `${remoteId}-${safeName}`);
  await writeFile(absolutePath, input.buffer);

  const fileUrl = pathToFileURL(absolutePath).href;

  const persisted = upsertSourceItemRecord(db, {
    caseId: input.caseId,
    sourceConnectionId: MATTER_UPLOAD_CONNECTION_ID,
    provider: "matter_upload",
    remoteId,
    parentRemoteId: null,
    sourceKind: "upload",
    title: input.filename,
    mimeType: input.mimeType,
    contentHash: null,
    latestVersionToken: "v1",
    rawJson: {
      upload_filename: input.filename,
      upload_stored_at: new Date().toISOString()
    }
  });

  upsertSourceVersionRecord(db, {
    sourceItemId: persisted.id,
    versionToken: "v1",
    contentHash: null,
    remoteModifiedAt: new Date().toISOString(),
    authoritativeAssetUri: fileUrl,
    rawJson: { stored_path: absolutePath, mime_type: input.mimeType }
  });

  db.prepare(`UPDATE source_items SET latest_version_token = 'v1', mime_type = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
    input.mimeType,
    persisted.id
  );

  const normalization = normalizeSourceItemDocumentSpine(db, {
    sourceItemId: persisted.id,
    stubPageCount: null
  });

  return {
    ok: true,
    source_item_id: persisted.id,
    relative_path: join(caseDirSegment, `${remoteId}-${safeName}`),
    absolute_path: absolutePath,
    normalization
  };
}
