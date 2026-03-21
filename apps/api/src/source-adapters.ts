import type { EventName } from "@wc/domain-core";

export type SupportedSourceProvider = "box" | "practicepanther";

export interface SourceConnectorSpec {
  provider: SupportedSourceProvider;
  defaultAccountLabel: string;
  defaultScopes: string[];
  cursorKey: string;
  syncType: string;
  snapshotType: string;
  sourceType: "box" | "pp";
  inventoryEventName: EventName;
}

const SOURCE_CONNECTOR_SPECS: Record<SupportedSourceProvider, SourceConnectorSpec> = {
  box: {
    provider: "box",
    defaultAccountLabel: "Development Box",
    defaultScopes: ["root_readonly", "items_readonly"],
    cursorKey: "box_inventory_cursor",
    syncType: "box_inventory",
    snapshotType: "box_inventory",
    sourceType: "box",
    inventoryEventName: "box.file_inventoried"
  },
  practicepanther: {
    provider: "practicepanther",
    defaultAccountLabel: "Development PracticePanther",
    defaultScopes: ["matter:read", "notes:read", "tasks:read"],
    cursorKey: "pp_incremental_cursor",
    syncType: "pp_incremental",
    snapshotType: "pp_state",
    sourceType: "pp",
    inventoryEventName: "pp.entity_synced"
  }
};

export function getSourceConnectorSpec(provider: SupportedSourceProvider): SourceConnectorSpec {
  return SOURCE_CONNECTOR_SPECS[provider];
}

export interface BoxInventoryAdapterInput {
  remote_id: string;
  title?: string | null;
  filename?: string | null;
  mime_type?: string | null;
  parent_folder_id?: string | null;
  version_token?: string | null;
  remote_modified_at?: string | null;
  content_hash?: string | null;
  authoritative_asset_uri?: string | null;
  raw_json?: Record<string, unknown>;
}

export interface NormalizedBoxInventoryFile {
  filename: string;
  parentRemoteId: string | null;
  authoritativeAssetUri: string | null;
  sourceItemRawJson: Record<string, unknown>;
  sourceVersionRawJson: Record<string, unknown>;
}

export function normalizeBoxInventoryFile(file: BoxInventoryAdapterInput): NormalizedBoxInventoryFile {
  const filename = file.title ?? file.filename ?? file.remote_id;
  const authoritativeAssetUri =
    file.authoritative_asset_uri ??
    (typeof file.raw_json?.download_url === "string" ? (file.raw_json.download_url as string) : null) ??
    (typeof file.raw_json?.authoritative_asset_uri === "string"
      ? (file.raw_json.authoritative_asset_uri as string)
      : null);

  return {
    filename,
    parentRemoteId: file.parent_folder_id ?? null,
    authoritativeAssetUri,
    sourceItemRawJson: {
      filename,
      parent_folder_id: file.parent_folder_id ?? null,
      ...(file.raw_json ?? {})
    },
    sourceVersionRawJson: {
      filename,
      mime_type: file.mime_type ?? null,
      remote_modified_at: file.remote_modified_at ?? null,
      authoritative_asset_uri: authoritativeAssetUri
    }
  };
}

export interface PracticePantherEntityAdapterInput {
  entity_type: string;
  pp_entity_id: string;
  title?: string | null;
  raw_json?: Record<string, unknown>;
}

export function resolvePracticePantherEntityTitle(entity: PracticePantherEntityAdapterInput): string | null {
  const rawPayload = entity.raw_json ?? {};
  return (
    entity.title ??
    (typeof rawPayload.name === "string" ? rawPayload.name : null) ??
    (typeof rawPayload.summary === "string" ? rawPayload.summary : null)
  );
}

export function buildPracticePantherSourceItemRawJson(
  entity: PracticePantherEntityAdapterInput
): Record<string, unknown> {
  return {
    entity_type: entity.entity_type,
    pp_entity_id: entity.pp_entity_id,
    ...(entity.raw_json ?? {})
  };
}

export function derivePracticePantherMatterPatch(entity: PracticePantherEntityAdapterInput): {
  name?: string;
  ppMatterId: string;
  boxRootFolderId?: string;
} | null {
  if (entity.entity_type !== "matter") {
    return null;
  }

  const rawPayload = entity.raw_json ?? {};
  const matterName =
    typeof rawPayload.name === "string"
      ? rawPayload.name
      : typeof rawPayload.display_name === "string"
        ? rawPayload.display_name
        : undefined;
  const ppMatterId =
    typeof rawPayload.pp_matter_id === "string"
      ? rawPayload.pp_matter_id
      : typeof rawPayload.id === "string"
        ? rawPayload.id
        : entity.pp_entity_id;
  const boxRootFolderId =
    typeof rawPayload.box_root_folder_id === "string" ? rawPayload.box_root_folder_id : undefined;

  return {
    name: matterName,
    ppMatterId,
    boxRootFolderId
  };
}
