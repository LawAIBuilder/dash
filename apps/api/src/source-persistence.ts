import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import type { BoxInventoryAdapterInput, NormalizedBoxInventoryFile } from "./source-adapters.js";
import {
  buildPracticePantherSourceItemRawJson,
  derivePracticePantherMatterPatch,
  resolvePracticePantherEntityTitle
} from "./source-adapters.js";

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

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export interface UpsertSourceItemRecordInput {
  caseId: string;
  sourceConnectionId: string;
  provider: string;
  remoteId: string;
  parentRemoteId?: string | null;
  sourceKind: string;
  title?: string | null;
  mimeType?: string | null;
  contentHash?: string | null;
  latestVersionToken?: string | null;
  rawJson?: Record<string, unknown>;
}

export function upsertSourceItemRecord(
  db: Database.Database,
  input: UpsertSourceItemRecordInput
) {
  const existing = db
    .prepare(
      `
        SELECT id, raw_json
        FROM source_items
        WHERE provider = ? AND remote_id = ?
        LIMIT 1
      `
    )
    .get(input.provider, input.remoteId) as
    | {
        id: string;
        raw_json: string | null;
      }
    | undefined;

  const id = existing?.id ?? randomUUID();
  const mergedRawJson = {
    ...parseJsonRecord(existing?.raw_json),
    ...(input.rawJson ?? {})
  };

  db.prepare(
    `
      INSERT INTO source_items
        (id, case_id, source_connection_id, provider, remote_id, parent_remote_id, source_kind, title, mime_type, content_hash, latest_version_token, status, raw_json)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
      ON CONFLICT(provider, remote_id) DO UPDATE SET
        case_id = excluded.case_id,
        source_connection_id = excluded.source_connection_id,
        parent_remote_id = excluded.parent_remote_id,
        source_kind = excluded.source_kind,
        title = excluded.title,
        mime_type = excluded.mime_type,
        content_hash = COALESCE(excluded.content_hash, source_items.content_hash),
        latest_version_token = COALESCE(excluded.latest_version_token, source_items.latest_version_token),
        status = 'active',
        raw_json = excluded.raw_json,
        updated_at = CURRENT_TIMESTAMP
    `
  ).run(
    id,
    input.caseId,
    input.sourceConnectionId,
    input.provider,
    input.remoteId,
    input.parentRemoteId ?? null,
    input.sourceKind,
    input.title ?? null,
    input.mimeType ?? null,
    input.contentHash ?? null,
    input.latestVersionToken ?? null,
    JSON.stringify(mergedRawJson)
  );

  return {
    id,
    wasExisting: Boolean(existing)
  };
}

export interface UpsertSourceVersionRecordInput {
  sourceItemId: string;
  versionToken: string;
  remoteModifiedAt?: string | null;
  contentHash?: string | null;
  authoritativeAssetUri?: string | null;
  rawJson?: Record<string, unknown>;
}

export function upsertSourceVersionRecord(
  db: Database.Database,
  input: UpsertSourceVersionRecordInput
) {
  const existing = db
    .prepare(
      `
        SELECT id
        FROM source_versions
        WHERE source_item_id = ? AND version_token = ?
        LIMIT 1
      `
    )
    .get(input.sourceItemId, input.versionToken) as { id: string } | undefined;

  db.prepare(
    `
      INSERT INTO source_versions
        (id, source_item_id, version_token, content_hash, remote_modified_at, authoritative_asset_uri, raw_json)
      VALUES
        (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_item_id, version_token) DO UPDATE SET
        content_hash = COALESCE(excluded.content_hash, source_versions.content_hash),
        remote_modified_at = COALESCE(excluded.remote_modified_at, source_versions.remote_modified_at),
        authoritative_asset_uri = COALESCE(excluded.authoritative_asset_uri, source_versions.authoritative_asset_uri),
        raw_json = excluded.raw_json
    `
  ).run(
    existing?.id ?? randomUUID(),
    input.sourceItemId,
    input.versionToken,
    input.contentHash ?? null,
    input.remoteModifiedAt ?? null,
    input.authoritativeAssetUri ?? null,
    JSON.stringify(input.rawJson ?? {})
  );
}

export interface PersistBoxInventoryFileInput {
  caseId: string;
  sourceConnectionId: string;
  provider: string;
  file: BoxInventoryAdapterInput;
  normalizedFile: NormalizedBoxInventoryFile;
}

export function persistBoxInventoryFile(
  db: Database.Database,
  input: PersistBoxInventoryFileInput
) {
  const sourceItem = upsertSourceItemRecord(db, {
    caseId: input.caseId,
    sourceConnectionId: input.sourceConnectionId,
    provider: input.provider,
    remoteId: input.file.remote_id,
    parentRemoteId: input.normalizedFile.parentRemoteId,
    sourceKind: "file",
    title: input.normalizedFile.filename,
    mimeType: input.file.mime_type ?? null,
    contentHash: input.file.content_hash ?? null,
    latestVersionToken: input.file.version_token ?? null,
    rawJson: input.normalizedFile.sourceItemRawJson
  });

  if (input.file.version_token) {
    upsertSourceVersionRecord(db, {
      sourceItemId: sourceItem.id,
      versionToken: input.file.version_token,
      remoteModifiedAt: input.file.remote_modified_at ?? null,
      contentHash: input.file.content_hash ?? null,
      authoritativeAssetUri: input.normalizedFile.authoritativeAssetUri,
      rawJson: input.normalizedFile.sourceVersionRawJson
    });
  }

  return {
    sourceItemId: sourceItem.id,
    title: input.normalizedFile.filename,
    parentRemoteId: input.normalizedFile.parentRemoteId
  };
}

export interface PracticePantherCustomFieldRecordInput {
  pp_field_id: string;
  field_key: string;
  label: string;
  entity_scope?: string;
  field_type?: string | null;
  options_json?: unknown;
  value?: unknown;
  normalized_text?: string | null;
  normalized_number?: number | null;
  normalized_date?: string | null;
}

export interface PracticePantherEntityRecordInput {
  entity_type: string;
  pp_entity_id: string;
  title?: string | null;
  source_updated_at?: string | null;
  raw_json?: Record<string, unknown>;
  custom_fields?: PracticePantherCustomFieldRecordInput[];
}

export function persistPracticePantherEntity(
  db: Database.Database,
  input: {
    caseId: string;
    sourceConnectionId: string;
    provider: string;
    entity: PracticePantherEntityRecordInput;
  }
) {
  const entity = input.entity;
  const existingRaw = db
    .prepare(
      `
        SELECT id
        FROM pp_entities_raw
        WHERE entity_type = ? AND pp_entity_id = ?
        LIMIT 1
      `
    )
    .get(entity.entity_type, entity.pp_entity_id) as { id: string } | undefined;

  const rawPayload = entity.raw_json ?? {};
  db.prepare(
    `
      INSERT INTO pp_entities_raw
        (id, case_id, entity_type, pp_entity_id, raw_json, source_updated_at, content_hash)
      VALUES
        (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_type, pp_entity_id) DO UPDATE SET
        case_id = excluded.case_id,
        raw_json = excluded.raw_json,
        source_updated_at = excluded.source_updated_at,
        synced_at = CURRENT_TIMESTAMP,
        content_hash = excluded.content_hash
    `
  ).run(
    existingRaw?.id ?? randomUUID(),
    input.caseId,
    entity.entity_type,
    entity.pp_entity_id,
    JSON.stringify(rawPayload),
    entity.source_updated_at ?? null,
    sha256(JSON.stringify(rawPayload))
  );

  const title = resolvePracticePantherEntityTitle(entity);
  const sourceItem = upsertSourceItemRecord(db, {
    caseId: input.caseId,
    sourceConnectionId: input.sourceConnectionId,
    provider: input.provider,
    remoteId: `${entity.entity_type}:${entity.pp_entity_id}`,
    sourceKind: entity.entity_type,
    title,
    rawJson: buildPracticePantherSourceItemRawJson(entity)
  });

  for (const customField of entity.custom_fields ?? []) {
    const existingDef = db
      .prepare(
        `
          SELECT id
          FROM pp_custom_field_defs
          WHERE pp_field_id = ?
          LIMIT 1
        `
      )
      .get(customField.pp_field_id) as { id: string } | undefined;

    db.prepare(
      `
        INSERT INTO pp_custom_field_defs
          (id, pp_field_id, entity_scope, field_key, label, field_type, options_json, active)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(pp_field_id) DO UPDATE SET
          entity_scope = excluded.entity_scope,
          field_key = excluded.field_key,
          label = excluded.label,
          field_type = excluded.field_type,
          options_json = excluded.options_json,
          active = 1,
          synced_at = CURRENT_TIMESTAMP
      `
    ).run(
      existingDef?.id ?? randomUUID(),
      customField.pp_field_id,
      customField.entity_scope ?? entity.entity_type,
      customField.field_key,
      customField.label,
      customField.field_type ?? null,
      customField.options_json !== undefined ? JSON.stringify(customField.options_json) : null
    );

    const existingValue = db
      .prepare(
        `
          SELECT id
          FROM pp_custom_field_values
          WHERE entity_type = ? AND entity_remote_id = ? AND pp_field_id = ?
          LIMIT 1
        `
      )
      .get(entity.entity_type, entity.pp_entity_id, customField.pp_field_id) as
      | { id: string }
      | undefined;

    db.prepare(
      `
        INSERT INTO pp_custom_field_values
          (id, case_id, entity_type, entity_remote_id, pp_field_id, field_key, raw_value_json, normalized_text, normalized_number, normalized_date)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(entity_type, entity_remote_id, pp_field_id) DO UPDATE SET
          case_id = excluded.case_id,
          field_key = excluded.field_key,
          raw_value_json = excluded.raw_value_json,
          normalized_text = excluded.normalized_text,
          normalized_number = excluded.normalized_number,
          normalized_date = excluded.normalized_date,
          synced_at = CURRENT_TIMESTAMP
      `
    ).run(
      existingValue?.id ?? randomUUID(),
      input.caseId,
      entity.entity_type,
      entity.pp_entity_id,
      customField.pp_field_id,
      customField.field_key,
      customField.value !== undefined ? JSON.stringify(customField.value) : null,
      customField.normalized_text ?? null,
      customField.normalized_number ?? null,
      customField.normalized_date ?? null
    );
  }

  return {
    sourceItemId: sourceItem.id,
    title,
    matterPatch: derivePracticePantherMatterPatch(entity)
  };
}
