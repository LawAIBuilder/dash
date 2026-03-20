import type Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { BoxClient } from "box-typescript-sdk-gen/client.generated";
import { BoxJwtAuth, JwtConfig } from "box-typescript-sdk-gen/box/jwtAuth.generated";
import { readByteStream } from "box-typescript-sdk-gen/internal/utils";
import type { BoxInventoryAdapterInput } from "./source-adapters.js";

/** Box SDK folder item entries expose id/type/name on the object; do not rely on rawData for fields. */
function formatBoxModifiedAt(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && "value" in (value as object)) {
    const inner = (value as { value?: unknown }).value;
    if (inner instanceof Date) {
      return inner.toISOString();
    }
  }
  return null;
}

export type BoxFolderListEntryMap =
  | { kind: "file"; file: BoxInventoryAdapterInput }
  | { kind: "folder"; folderId: string }
  | { kind: "ignore" };

export function mapBoxFolderListEntry(entry: unknown, parentFolderId: string): BoxFolderListEntryMap {
  if (!entry || typeof entry !== "object") {
    return { kind: "ignore" };
  }

  const e = entry as Record<string, unknown>;
  const entryType = typeof e.type === "string" ? e.type : null;
  const idRaw = e.id;
  const id = typeof idRaw === "string" ? idRaw : idRaw != null ? String(idRaw) : "";

  if (!entryType || !id) {
    return { kind: "ignore" };
  }

  if (entryType === "folder") {
    return { kind: "folder", folderId: id };
  }

  if (entryType !== "file") {
    return { kind: "ignore" };
  }

  const name = typeof e.name === "string" ? e.name : null;
  if (!name) {
    return { kind: "ignore" };
  }

  const sha1 = typeof e.sha1 === "string" ? e.sha1 : null;
  const modifiedAt = formatBoxModifiedAt(e.modifiedAt ?? e.modified_at);

  const rawJson: Record<string, unknown> = {
    id,
    type: entryType,
    name,
    sha1,
    modified_at: modifiedAt,
    path_collection: e.pathCollection ?? e.path_collection ?? null
  };

  return {
    kind: "file",
    file: {
      remote_id: id,
      title: name,
      filename: name,
      parent_folder_id: parentFolderId,
      content_hash: sha1,
      remote_modified_at: modifiedAt,
      authoritative_asset_uri: `https://api.box.com/2.0/files/${id}/content`,
      raw_json: rawJson
    }
  };
}

export interface BoxFolderPage {
  files: BoxInventoryAdapterInput[];
  subfolderIds: string[];
  nextMarker: string | null;
  totalCount: number | null;
}

export async function fetchBoxFolderPage(
  client: BoxClient,
  folderId: string,
  options?: {
    marker?: string | null;
    limit?: number;
  }
): Promise<BoxFolderPage> {
  const response = await client.folders.getFolderItems(folderId, {
    queryParams: {
      usemarker: true,
      marker: options?.marker ?? undefined,
      limit: options?.limit ?? 1000,
      fields: ["id", "type", "name", "sha1", "modified_at", "path_collection"]
    }
  });

  const files: BoxInventoryAdapterInput[] = [];
  const subfolderIds: string[] = [];

  for (const entry of response.entries ?? []) {
    const mapped = mapBoxFolderListEntry(entry, folderId);
    if (mapped.kind === "file") {
      files.push(mapped.file);
    } else if (mapped.kind === "folder") {
      subfolderIds.push(mapped.folderId);
    }
  }

  return {
    files,
    subfolderIds,
    nextMarker: response.nextMarker ?? null,
    totalCount: response.totalCount ?? null
  };
}

async function listAllBoxFolderItems(
  client: BoxClient,
  folderId: string,
  limitPerPage = 1000
): Promise<{ files: BoxInventoryAdapterInput[]; subfolderIds: string[] }> {
  const files: BoxInventoryAdapterInput[] = [];
  const subfolderIds: string[] = [];
  let marker: string | null = null;

  do {
    const page = await fetchBoxFolderPage(client, folderId, { marker, limit: limitPerPage });
    files.push(...page.files);
    subfolderIds.push(...page.subfolderIds);
    marker = page.nextMarker;
  } while (marker);

  return { files, subfolderIds };
}

export interface CollectBoxRecursiveFileInventoryOptions {
  /** Stop after this many files (default 50_000, max applied in route). */
  maxFiles?: number;
  /** Safety cap on folders visited (default 25_000). */
  maxFoldersVisited?: number;
}

export interface CollectBoxRecursiveFileInventoryResult {
  files: BoxInventoryAdapterInput[];
  foldersVisited: number;
  truncated: boolean;
}

/**
 * Depth-first inventory of all files under a Box folder (BFS over subfolders).
 * Use a matter "Client File" folder (or matter root), not the org-wide PP root.
 */
export async function collectBoxRecursiveFileInventory(
  client: BoxClient,
  rootFolderId: string,
  options?: CollectBoxRecursiveFileInventoryOptions
): Promise<CollectBoxRecursiveFileInventoryResult> {
  const maxFiles = options?.maxFiles ?? 50_000;
  const maxFoldersVisited = options?.maxFoldersVisited ?? 25_000;

  const files: BoxInventoryAdapterInput[] = [];
  const queue: string[] = [rootFolderId];
  const enqueued = new Set<string>([rootFolderId]);
  let foldersVisited = 0;
  let truncated = false;

  while (queue.length > 0) {
    if (foldersVisited >= maxFoldersVisited) {
      truncated = true;
      break;
    }
    if (files.length >= maxFiles) {
      truncated = true;
      break;
    }

    const folderId = queue.shift()!;
    foldersVisited += 1;

    const { files: pageFiles, subfolderIds } = await listAllBoxFolderItems(client, folderId);

    for (const file of pageFiles) {
      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }
      files.push(file);
    }
    if (truncated) {
      break;
    }

    for (const subId of subfolderIds) {
      if (!enqueued.has(subId)) {
        enqueued.add(subId);
        queue.push(subId);
      }
    }
  }

  return { files, foldersVisited, truncated };
}

export type BoxConnectionScope = "global_box_app_user" | "global_box_enterprise_service_account";

export interface BoxProviderConfig {
  jwtConfigJson: string;
  enterpriseId?: string | null;
  userId?: string | null;
  rootFolderId?: string | null;
  incomingMailFolderId?: string | null;
}

export interface BoxConnectionProbe {
  connectionScope: BoxConnectionScope;
  subjectType: "user" | "enterprise";
  subjectId: string;
  enterpriseId?: string | null;
  configuredUserId?: string | null;
  currentUserId: string;
  currentUserName: string;
  currentUserType?: string | null;
}

function parseJsonRecord(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function normalizeJwtConfigJson(rawJson: string) {
  const parsed = parseJsonRecord(rawJson);
  const jwtConfig =
    parsed.box_jwt_config && typeof parsed.box_jwt_config === "object" && !Array.isArray(parsed.box_jwt_config)
      ? (parsed.box_jwt_config as Record<string, unknown>)
      : parsed;

  if (!jwtConfig.boxAppSettings || typeof jwtConfig.boxAppSettings !== "object") {
    throw new Error("BOX_JWT_CONFIG_JSON must contain a Box JWT config with boxAppSettings");
  }

  return JSON.stringify(jwtConfig);
}

export function resolveBoxProviderConfig(
  env: Record<string, string | undefined> = process.env
): BoxProviderConfig | null {
  const inlineJson = env.BOX_JWT_CONFIG_JSON ?? env.BOX_JWT_CONFIG;
  const filePath = env.BOX_JWT_CONFIG_FILE;

  let jwtConfigJson = inlineJson?.trim() ?? "";
  if (!jwtConfigJson && filePath) {
    jwtConfigJson = readFileSync(filePath, "utf8");
  }

  if (!jwtConfigJson) {
    return null;
  }

  return {
    jwtConfigJson: normalizeJwtConfigJson(jwtConfigJson),
    enterpriseId: env.BOX_ENTERPRISE_ID ?? null,
    userId: env.BOX_USER_ID ?? null,
    rootFolderId: env.BOX_PP_ROOT_FOLDER_ID ?? null,
    incomingMailFolderId: env.BOX_INCOMING_MAIL_FOLDER_ID ?? null
  };
}

export function resolveBoxConnectionScope(config: BoxProviderConfig): {
  connectionScope: BoxConnectionScope;
  subjectType: "user" | "enterprise";
  subjectId: string;
} {
  if (config.userId && config.userId.trim().length > 0) {
    return {
      connectionScope: "global_box_app_user",
      subjectType: "user",
      subjectId: config.userId
    };
  }

  const parsed = parseJsonRecord(config.jwtConfigJson);
  const rawEnterpriseId =
    (typeof parsed.enterpriseID === "string" ? parsed.enterpriseID : null) ??
    (typeof parsed.enterpriseId === "string" ? parsed.enterpriseId : null) ??
    config.enterpriseId ??
    null;

  if (!rawEnterpriseId) {
    throw new Error("BOX_ENTERPRISE_ID or enterpriseID in BOX_JWT_CONFIG_JSON is required");
  }

  return {
    connectionScope: "global_box_enterprise_service_account",
    subjectType: "enterprise",
    subjectId: rawEnterpriseId
  };
}

export function createBoxClient(config: BoxProviderConfig) {
  const jwtConfig = JwtConfig.fromConfigJsonString(config.jwtConfigJson);
  let auth = new BoxJwtAuth({ config: jwtConfig });
  const scope = resolveBoxConnectionScope(config);

  auth =
    scope.subjectType === "user"
      ? auth.withUserSubject(scope.subjectId)
      : auth.withEnterpriseSubject(scope.subjectId);

  return {
    client: new BoxClient({ auth }),
    auth,
    scope
  };
}

export async function authenticateBoxConnection(
  db: Database.Database,
  connectionId: string,
  config: BoxProviderConfig
): Promise<BoxConnectionProbe> {
  const existing = db
    .prepare(
      `
        SELECT metadata_json
        FROM source_connections
        WHERE id = ?
        LIMIT 1
      `
    )
    .get(connectionId) as { metadata_json: string | null } | undefined;

  if (!existing) {
    throw new Error("source connection not found");
  }

  const { client, auth, scope } = createBoxClient(config);
  const token = await auth.retrieveToken();
  if (!token.accessToken) {
    throw new Error("Box JWT auth did not return an access token");
  }

  const currentUser = await client.users.getUserMe();
  const metadata = {
    ...parseJsonRecord(existing.metadata_json),
    box_connection_scope: scope.connectionScope,
    box_subject_type: scope.subjectType,
    box_subject_id: scope.subjectId,
    box_enterprise_id: config.enterpriseId ?? null,
    box_user_id: config.userId ?? null,
    box_root_folder_id: config.rootFolderId ?? null,
    box_incoming_mail_folder_id: config.incomingMailFolderId ?? null,
    auth_strategy: "jwt_server_auth",
    box_sdk_package: "box-typescript-sdk-gen"
  };

  db.prepare(
    `
      UPDATE source_connections
      SET auth_mode = ?,
          status = 'active',
          external_account_id = ?,
          metadata_json = ?,
          last_verified_at = CURRENT_TIMESTAMP,
          last_error_message = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
  ).run(
    scope.connectionScope,
    currentUser.id ?? scope.subjectId,
    JSON.stringify(metadata),
    connectionId
  );

  return {
    connectionScope: scope.connectionScope,
    subjectType: scope.subjectType,
    subjectId: scope.subjectId,
    enterpriseId: config.enterpriseId ?? null,
    configuredUserId: config.userId ?? null,
    currentUserId: currentUser.id,
    currentUserName: currentUser.name ?? "Unknown Box user",
    currentUserType: currentUser.type ?? null
  };
}

export async function fetchBoxFolderInventory(
  client: BoxClient,
  folderId: string,
  options?: {
    marker?: string | null;
    limit?: number;
  }
): Promise<{
  files: BoxInventoryAdapterInput[];
  nextMarker: string | null;
  totalCount: number | null;
}> {
  const page = await fetchBoxFolderPage(client, folderId, options);
  return {
    files: page.files,
    nextMarker: page.nextMarker,
    totalCount: page.totalCount
  };
}

export async function downloadBoxFileContent(client: BoxClient, fileId: string): Promise<Buffer> {
  const stream = await client.downloads.downloadFile(fileId);
  if (!stream) {
    throw new Error(`Box download returned no stream for file ${fileId}`);
  }

  return readByteStream(stream);
}
