import cors from "@fastify/cors";
import Fastify from "fastify";
import { Buffer } from "node:buffer";
import { openDatabase } from "./db.js";
import { appendPageExtraction } from "./extraction.js";
import { runCaseHeuristicExtractions } from "./extraction-runner.js";
import {
  authenticateBoxConnection,
  collectBoxRecursiveFileInventory,
  createBoxClient,
  downloadBoxFileContent,
  fetchBoxFolderInventory,
  resolveBoxProviderConfig
} from "./box-provider.js";
import { buildCaseProjection } from "./projection.js";
import { getSourceConnectorSpec } from "./source-adapters.js";
import {
  beginSourceConnectionAuth,
  buildRegressionSummary,
  classifySourceItemByFilename,
  completeSourceConnectionAuth,
  createRunManifest,
  evaluateMedicalRequestBranch,
  ensureCaseScaffold,
  ensureSourceConnection,
  hydrateBoxInventory,
  hydratePracticePantherState,
  normalizeCaseDocumentSpine,
  normalizeSourceItemDocumentSpine,
  queueCaseOcrWork,
  recordCanonicalPageOcrAttempt,
  recordRegressionCheck,
  resolveCanonicalPageOcrReview
} from "./runtime.js";
import {
  PRACTICE_PANTHER_SYNC_DEFERRED_MESSAGE,
  isPracticePantherOAuthReady,
  isPracticePantherProductionSyncConfigured,
  readPracticePantherConfig
} from "./pp-provider.js";
import { seedFoundation } from "./seed.js";

const db = openDatabase();
seedFoundation(db);

const app = Fastify({ logger: true });

const configuredOrigins = process.env.WC_CORS_ORIGIN?.split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);
await app.register(cors, {
  origin: configuredOrigins && configuredOrigins.length > 0 ? configuredOrigins : ["http://127.0.0.1:5173", "http://localhost:5173"]
});

const WC_API_KEY = process.env.WC_API_KEY?.trim();
if (WC_API_KEY) {
  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0] ?? "";
    if (request.method === "OPTIONS" || path === "/health") {
      return;
    }
    const auth = request.headers.authorization;
    if (auth !== `Bearer ${WC_API_KEY}`) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }
  });
}

app.get("/health", async () => ({
  ok: true,
  service: "wc-authoritative-api",
  seeded_at_startup: true
}));

app.get("/api/cases", async () => {
  const cases = db
    .prepare(
      `
        SELECT
          c.id,
          c.name,
          c.case_type,
          c.status,
          c.employee_name,
          c.employer_name,
          c.insurer_name,
          c.hearing_date,
          c.pp_matter_id,
          c.box_root_folder_id,
          c.created_at,
          c.updated_at,
          COALESCE(conn.status, 'inactive') AS box_connection_status,
          COALESCE(sync.latest_sync_status, 'not_synced') AS latest_sync_status,
          COALESCE(inv.source_item_count, 0) AS source_item_count
        FROM cases c
        LEFT JOIN (
          SELECT si.case_id, COUNT(*) AS source_item_count
          FROM source_items si
          GROUP BY si.case_id
        ) inv ON inv.case_id = c.id
        LEFT JOIN (
          SELECT
            sr.case_id,
            sc.status,
            ROW_NUMBER() OVER (PARTITION BY sr.case_id ORDER BY sr.started_at DESC) AS rn
          FROM sync_runs sr
          JOIN source_connections sc ON sc.id = sr.source_connection_id
          WHERE sc.provider = 'box'
        ) conn ON conn.case_id = c.id AND conn.rn = 1
        LEFT JOIN (
          SELECT
            sr.case_id,
            sr.status AS latest_sync_status,
            ROW_NUMBER() OVER (PARTITION BY sr.case_id ORDER BY sr.started_at DESC) AS rn
          FROM sync_runs sr
          JOIN source_connections sc ON sc.id = sr.source_connection_id
          WHERE sc.provider = 'box'
        ) sync ON sync.case_id = c.id AND sync.rn = 1
        ORDER BY COALESCE(c.updated_at, c.created_at) DESC
      `
    )
    .all();

  return { cases };
});

app.post("/api/cases", async (request, reply) => {
  const body = request.body as
    | {
        case_id?: string;
        name?: string;
        case_type?: string;
        pp_matter_id?: string;
        box_root_folder_id?: string;
        employee_name?: string;
        employer_name?: string;
        insurer_name?: string;
        hearing_date?: string;
      }
    | undefined;

  if (!body?.name?.trim()) {
    return reply.code(400).send({ ok: false, error: "name is required" });
  }

  const scaffold = ensureCaseScaffold(db, {
    caseId: body.case_id,
    name: body.name.trim(),
    caseType: body.case_type,
    ppMatterId: body.pp_matter_id ?? null,
    boxRootFolderId: body.box_root_folder_id ?? null,
    employeeName: body.employee_name ?? null,
    employerName: body.employer_name ?? null,
    insurerName: body.insurer_name ?? null,
    hearingDate: body.hearing_date ?? null
  });

  const row = db
    .prepare(
      `
        SELECT id, name, case_type, status, employee_name, employer_name, insurer_name, hearing_date, pp_matter_id, box_root_folder_id, created_at, updated_at
        FROM cases
        WHERE id = ?
        LIMIT 1
      `
    )
    .get(scaffold.caseId);

  return { ok: true, case: row, issue_id: scaffold.issueId, branch_instance_id: scaffold.branchInstanceId };
});

app.get("/api/cases/:caseId", async (request, reply) => {
  const { caseId } = request.params as { caseId: string };
  const row = db
    .prepare(
      `
        SELECT id, name, case_type, status, employee_name, employer_name, insurer_name, hearing_date, pp_matter_id, box_root_folder_id, created_at, updated_at
        FROM cases
        WHERE id = ?
        LIMIT 1
      `
    )
    .get(caseId);

  if (!row) {
    return reply.code(404).send({ ok: false, error: "case not found" });
  }

  return { ok: true, case: row };
});

app.patch("/api/cases/:caseId", async (request, reply) => {
  const { caseId } = request.params as { caseId: string };
  const body = request.body as
    | {
        name?: string;
        case_type?: string;
        pp_matter_id?: string | null;
        box_root_folder_id?: string | null;
        employee_name?: string | null;
        employer_name?: string | null;
        insurer_name?: string | null;
        hearing_date?: string | null;
      }
    | undefined;

  const existing = db.prepare(`SELECT id FROM cases WHERE id = ? LIMIT 1`).get(caseId) as
    | { id: string }
    | undefined;
  if (!existing) {
    return reply.code(404).send({ ok: false, error: "case not found" });
  }

  ensureCaseScaffold(db, {
    caseId,
    name: body?.name,
    caseType: body?.case_type,
    ppMatterId: body?.pp_matter_id ?? null,
    boxRootFolderId: body?.box_root_folder_id ?? null,
    employeeName: body?.employee_name ?? null,
    employerName: body?.employer_name ?? null,
    insurerName: body?.insurer_name ?? null,
    hearingDate: body?.hearing_date ?? null
  });

  const row = db
    .prepare(
      `
        SELECT id, name, case_type, status, employee_name, employer_name, insurer_name, hearing_date, pp_matter_id, box_root_folder_id, created_at, updated_at
        FROM cases
        WHERE id = ?
        LIMIT 1
      `
    )
    .get(caseId);

  return { ok: true, case: row };
});

app.post("/dev/cases", async (request) => {
  const body = request.body as
    | {
        case_id?: string;
        name?: string;
        case_type?: string;
        pp_matter_id?: string;
        box_root_folder_id?: string;
        employee_name?: string;
        employer_name?: string;
        insurer_name?: string;
        hearing_date?: string;
      }
    | undefined;

  const scaffold = ensureCaseScaffold(db, {
    caseId: body?.case_id,
    name: body?.name,
    caseType: body?.case_type,
    ppMatterId: body?.pp_matter_id ?? null,
    boxRootFolderId: body?.box_root_folder_id ?? null,
    employeeName: body?.employee_name ?? null,
    employerName: body?.employer_name ?? null,
    insurerName: body?.insurer_name ?? null,
    hearingDate: body?.hearing_date ?? null
  });

  return { case_id: scaffold.caseId, issue_id: scaffold.issueId, branch_instance_id: scaffold.branchInstanceId };
});

app.post("/api/connectors/box/auth/start", async (request, reply) => {
  const spec = getSourceConnectorSpec("box");
  const body = request.body as { account_label?: string; scopes?: string[] } | undefined;
  const connection = beginSourceConnectionAuth(db, {
    provider: spec.provider,
    accountLabel: body?.account_label ?? spec.defaultAccountLabel,
    scopes: body?.scopes
  });

  reply.send({
    ok: true,
    provider: spec.provider,
    connection_id: connection.id,
    auth_mode: connection.auth_mode,
    status: connection.status,
    authorization_url: connection.authorization_url,
    callback_state: connection.callback_state,
    scopes: connection.scopes
  });
});

app.post("/api/connectors/box/auth/jwt", async (request, reply) => {
  const spec = getSourceConnectorSpec("box");
  const body = request.body as { connection_id?: string | null; account_label?: string | null } | undefined;
  const config = resolveBoxProviderConfig();
  if (!config) {
    return reply.code(400).send({
      ok: false,
      error: "BOX_JWT_CONFIG_JSON or BOX_JWT_CONFIG_FILE must be configured"
    });
  }

  const connection = ensureSourceConnection(db, {
    provider: spec.provider,
    accountLabel: body?.account_label ?? spec.defaultAccountLabel
  });

  const probe = await authenticateBoxConnection(
    db,
    body?.connection_id ?? connection.id,
    config
  );

  return {
    ok: true,
    connection_id: body?.connection_id ?? connection.id,
    probe
  };
});

app.get("/api/connectors/box/folders/:folderId/items", async (request, reply) => {
  const config = resolveBoxProviderConfig();
  if (!config) {
    return reply.code(400).send({
      ok: false,
      error: "BOX_JWT_CONFIG_JSON or BOX_JWT_CONFIG_FILE must be configured"
    });
  }

  const { folderId } = request.params as { folderId: string };
  const marker = typeof request.query === "object" && request.query !== null
    ? ((request.query as { marker?: string }).marker ?? null)
    : null;

  const { client } = createBoxClient(config);
  const inventory = await fetchBoxFolderInventory(client, folderId, {
    marker,
    limit: 1000
  });

  return {
    ok: true,
    folder_id: folderId,
    next_marker: inventory.nextMarker,
    total_count: inventory.totalCount,
    files: inventory.files
  };
});

/**
 * Full authoritative sync: walk all subfolders under root (matter "Client File" or similar),
 * then persist via hydrateBoxInventory. Requires JWT env config.
 */
app.post("/api/connectors/practicepanther/sync", async (_request, reply) => {
  if (!isPracticePantherProductionSyncConfigured()) {
    return reply.code(501).send({
      ok: false,
      error: PRACTICE_PANTHER_SYNC_DEFERRED_MESSAGE,
      configured: false
    });
  }
  const pp = readPracticePantherConfig();
  return reply.code(501).send({
    ok: false,
    error:
      "PP_API_BASE_URL and PP_CLIENT_ID are set but sync orchestration is not implemented yet. Next: OAuth authorization code flow, store refresh_token on source_connections, then call PracticePanther REST (see fetchPracticePantherMatters stub in pp-provider).",
    configured: true,
    oauth_env_ready: isPracticePantherOAuthReady(),
    pp_api_base_url: pp.apiBaseUrl
  });
});

app.post("/api/connectors/box/sync", async (request, reply) => {
  const config = resolveBoxProviderConfig();
  if (!config) {
    return reply.code(400).send({
      ok: false,
      error: "BOX_JWT_CONFIG_JSON or BOX_JWT_CONFIG_FILE must be configured"
    });
  }

  const body = request.body as
    | {
        case_id?: string;
        root_folder_id?: string | null;
        account_label?: string | null;
        cursor_after?: string | null;
        max_files?: number;
        max_folders?: number;
      }
    | undefined;

  if (!body?.case_id?.trim()) {
    return reply.code(400).send({ ok: false, error: "case_id is required" });
  }

  const caseRow = db
    .prepare(
      `
        SELECT id, box_root_folder_id
        FROM cases
        WHERE id = ?
        LIMIT 1
      `
    )
    .get(body.case_id.trim()) as { id: string; box_root_folder_id: string | null } | undefined;

  if (!caseRow) {
    return reply.code(404).send({ ok: false, error: "case not found" });
  }

  const rootFolderId =
    (typeof body.root_folder_id === "string" && body.root_folder_id.trim().length > 0
      ? body.root_folder_id.trim()
      : null) ?? caseRow.box_root_folder_id;

  if (!rootFolderId) {
    return reply.code(400).send({
      ok: false,
      error: "root_folder_id is required (pass body.root_folder_id or set cases.box_root_folder_id)"
    });
  }

  const maxFiles = Math.min(Math.max(body.max_files ?? 50_000, 1), 200_000);
  const maxFolders = Math.min(Math.max(body.max_folders ?? 25_000, 1), 200_000);

  const { client } = createBoxClient(config);
  const collected = await collectBoxRecursiveFileInventory(client, rootFolderId, {
    maxFiles,
    maxFoldersVisited: maxFolders
  });

  const cursorAfter =
    body.cursor_after !== undefined
      ? body.cursor_after
      : `box_full_sync:${rootFolderId}:${new Date().toISOString()}`;

  const inventory = hydrateBoxInventory(db, {
    caseId: caseRow.id,
    accountLabel: body.account_label ?? null,
    cursorAfter: cursorAfter ?? undefined,
    files: collected.files
  });

  return {
    ok: true,
    box_sync: {
      root_folder_id: rootFolderId,
      files_discovered: collected.files.length,
      folders_visited: collected.foldersVisited,
      truncated: collected.truncated
    },
    inventory
  };
});

app.post("/api/connectors/practicepanther/auth/start", async (request, reply) => {
  const spec = getSourceConnectorSpec("practicepanther");
  const body = request.body as { account_label?: string; scopes?: string[] } | undefined;
  const connection = beginSourceConnectionAuth(db, {
    provider: spec.provider,
    accountLabel: body?.account_label ?? spec.defaultAccountLabel,
    scopes: body?.scopes
  });

  reply.send({
    ok: true,
    provider: spec.provider,
    connection_id: connection.id,
    auth_mode: connection.auth_mode,
    status: connection.status,
    authorization_url: connection.authorization_url,
    callback_state: connection.callback_state,
    scopes: connection.scopes
  });
});

app.post("/api/connectors/:provider/auth/complete", async (request, reply) => {
  const body = request.body as
    | {
        connection_id?: string | null;
        callback_state?: string | null;
        account_label?: string | null;
        auth_mode?: string | null;
        external_account_id?: string | null;
        metadata_json?: Record<string, unknown> | null;
      }
    | undefined;
  const { provider } = request.params as { provider: string };

  if (provider !== "box" && provider !== "practicepanther") {
    return reply.code(400).send({ ok: false, error: "unsupported provider" });
  }

  const result = completeSourceConnectionAuth(db, {
    provider,
    connectionId: body?.connection_id ?? null,
    callbackState: body?.callback_state ?? null,
    accountLabel: body?.account_label ?? null,
    authMode: body?.auth_mode ?? "development_local_process",
    externalAccountId: body?.external_account_id ?? null,
    metadata: body?.metadata_json ?? null
  });

  if (!result.ok) {
    return reply.code(404).send(result);
  }

  return result;
});

app.get("/api/files/:sourceItemId/content", async (request, reply) => {
  const config = resolveBoxProviderConfig();
  if (!config) {
    return reply.code(400).send({
      ok: false,
      error: "BOX_JWT_CONFIG_JSON or BOX_JWT_CONFIG_FILE must be configured"
    });
  }

  const { sourceItemId } = request.params as { sourceItemId: string };
  const sourceItem = db
    .prepare(
      `
        SELECT provider, remote_id, title, mime_type
        FROM source_items
        WHERE id = ?
        LIMIT 1
      `
    )
    .get(sourceItemId) as
    | {
        provider: string;
        remote_id: string;
        title: string | null;
        mime_type: string | null;
      }
    | undefined;

  if (!sourceItem) {
    return reply.code(404).send({ ok: false, error: "source item not found" });
  }
  if (sourceItem.provider !== "box") {
    return reply.code(400).send({ ok: false, error: "source item is not a Box file" });
  }

  const { client } = createBoxClient(config);
  const buffer = await downloadBoxFileContent(client, sourceItem.remote_id);
  reply.header("content-type", sourceItem.mime_type ?? "application/octet-stream");
  reply.header(
    "content-disposition",
    `inline; filename="${encodeURIComponent(sourceItem.title ?? `${sourceItem.remote_id}.bin`)}"`
  );
  return reply.send(Buffer.from(buffer));
});

app.post("/api/connectors/box/development/hydrate", async (request, reply) => {
  const body = request.body as
    | {
        case_id?: string;
        account_label?: string;
        cursor_after?: string;
        files?: Array<{
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
        }>;
      }
    | undefined;

  if (!body?.case_id || !body.files?.length) {
    return reply.code(400).send({ ok: false, error: "case_id and at least one file are required" });
  }

  return hydrateBoxInventory(db, {
    caseId: body.case_id,
    accountLabel: body.account_label ?? null,
    cursorAfter: body.cursor_after ?? null,
    files: body.files
  });
});

app.post("/api/connectors/practicepanther/development/hydrate", async (request, reply) => {
  const body = request.body as
    | {
        case_id?: string;
        account_label?: string;
        cursor_after?: string;
        entities?: Array<{
          entity_type: string;
          pp_entity_id: string;
          title?: string | null;
          source_updated_at?: string | null;
          raw_json?: Record<string, unknown>;
          custom_fields?: Array<{
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
          }>;
        }>;
      }
    | undefined;

  if (!body?.case_id || !body.entities?.length) {
    return reply.code(400).send({ ok: false, error: "case_id and at least one entity are required" });
  }

  return hydratePracticePantherState(db, {
    caseId: body.case_id,
    accountLabel: body.account_label ?? null,
    cursorAfter: body.cursor_after ?? null,
    entities: body.entities
  });
});

app.post("/dev/source-items", async (request, reply) => {
  const body = request.body as
    | {
        case_id?: string;
        provider?: "box" | "practicepanther";
        remote_id?: string;
        source_kind?: string;
        title?: string;
        raw_json?: Record<string, unknown>;
      }
    | undefined;

  if (!body?.case_id || !body?.provider || !body?.remote_id || !body?.source_kind) {
    return reply.code(400).send({ ok: false, error: "case_id, provider, remote_id, and source_kind are required" });
  }

  if (body.provider === "box") {
    const result = hydrateBoxInventory(db, {
      caseId: body.case_id,
      files: [
        {
          remote_id: body.remote_id,
          title: body.title ?? null,
          filename: body.title ?? null,
          mime_type:
            typeof body.raw_json?.mime_type === "string" ? (body.raw_json.mime_type as string) : null,
          parent_folder_id:
            typeof body.raw_json?.parent_folder_id === "string"
              ? (body.raw_json.parent_folder_id as string)
              : null,
          raw_json: body.raw_json ?? {}
        }
      ]
    });

    const sourceItem = db
      .prepare(`SELECT id FROM source_items WHERE provider = 'box' AND remote_id = ? LIMIT 1`)
      .get(body.remote_id) as { id: string } | undefined;

    return { ok: true, source_item_id: sourceItem?.id ?? null, snapshot_id: result.snapshot_id };
  }

  const result = hydratePracticePantherState(db, {
    caseId: body.case_id,
    entities: [
      {
        entity_type: body.source_kind,
        pp_entity_id: body.remote_id,
        title: body.title ?? null,
        raw_json: body.raw_json ?? {}
      }
    ]
  });

  const sourceItem = db
    .prepare(
      `SELECT id FROM source_items WHERE provider = 'practicepanther' AND remote_id = ? LIMIT 1`
    )
    .get(`${body.source_kind}:${body.remote_id}`) as { id: string } | undefined;

  return { ok: true, source_item_id: sourceItem?.id ?? null, snapshot_id: result.snapshot_id };
});

app.post("/api/source-items/:sourceItemId/classify", async (request, reply) => {
  const body = request.body as { filename?: string } | undefined;
  const { sourceItemId } = request.params as { sourceItemId: string };

  const sourceItem = db
    .prepare(`SELECT title FROM source_items WHERE id = ? LIMIT 1`)
    .get(sourceItemId) as { title: string | null } | undefined;

  const filename = body?.filename ?? sourceItem?.title ?? null;
  if (!filename) {
    return reply.code(400).send({ ok: false, error: "filename is required when the source item has no title" });
  }

  const result = classifySourceItemByFilename(db, {
    sourceItemId,
    filename
  });

  if (!result.ok) {
    return reply.code(404).send(result);
  }

  return result;
});

app.patch("/api/source-items/:sourceItemId/classification", async (request, reply) => {
  const { sourceItemId } = request.params as { sourceItemId: string };
  const body = request.body as
    | {
        document_type_id?: string | null;
        clear?: boolean;
      }
    | undefined;

  const sourceItem = db
    .prepare(`SELECT id, case_id FROM source_items WHERE id = ? LIMIT 1`)
    .get(sourceItemId) as { id: string; case_id: string } | undefined;
  if (!sourceItem) {
    return reply.code(404).send({ ok: false, error: "source item not found" });
  }

  if (body?.clear === true) {
    db.prepare(
      `
        UPDATE source_items
        SET document_type_id = NULL,
            document_type_name = NULL,
            classification_method = 'manual_clear',
            classification_confidence = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
    ).run(sourceItemId);

    evaluateMedicalRequestBranch(db, sourceItem.case_id);
    return { ok: true, source_item_id: sourceItemId, classification_method: "manual_clear" };
  }

  if (!body?.document_type_id) {
    return reply.code(400).send({ ok: false, error: "document_type_id is required unless clear=true" });
  }

  const documentType = db
    .prepare(`SELECT id, canonical_name FROM document_types WHERE id = ? LIMIT 1`)
    .get(body.document_type_id) as { id: string; canonical_name: string } | undefined;
  if (!documentType) {
    return reply.code(404).send({ ok: false, error: "document type not found" });
  }

  db.prepare(
    `
      UPDATE source_items
      SET document_type_id = ?,
          document_type_name = ?,
          classification_method = 'manual_override',
          classification_confidence = 1.0,
          raw_json = json_set(
            COALESCE(raw_json, '{}'),
            '$.document_type_id', ?,
            '$.document_type_name', ?,
            '$.classification_method', 'manual_override'
          ),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
  ).run(
    documentType.id,
    documentType.canonical_name,
    documentType.id,
    documentType.canonical_name,
    sourceItemId
  );

  evaluateMedicalRequestBranch(db, sourceItem.case_id);

  return {
    ok: true,
    source_item_id: sourceItemId,
    document_type_id: documentType.id,
    document_type_name: documentType.canonical_name,
    classification_method: "manual_override"
  };
});

app.post("/dev/classify-source-item", async (request, reply) => {
  const body = request.body as { source_item_id?: string; filename?: string } | undefined;
  if (!body?.source_item_id || !body?.filename) {
    return reply.code(400).send({ ok: false, error: "source_item_id and filename are required" });
  }

  const result = classifySourceItemByFilename(db, {
    sourceItemId: body.source_item_id,
    filename: body.filename
  });

  if (!result.ok) {
    return reply.code(404).send(result);
  }

  return result;
});

app.post("/dev/source-items/:sourceItemId/normalize", async (request, reply) => {
  const body = request.body as { stub_page_count?: number; stubPageCount?: number } | undefined;
  const { sourceItemId } = request.params as { sourceItemId: string };

  const result = normalizeSourceItemDocumentSpine(db, {
    sourceItemId,
    stubPageCount: body?.stub_page_count ?? body?.stubPageCount ?? null
  });

  if (!result.ok) {
    const statusCode = result.error === "source item not found" ? 404 : 400;
    return reply.code(statusCode).send(result);
  }

  return result;
});

app.post("/dev/cases/:caseId/normalize-documents", async (request, reply) => {
  const body = request.body as
    | {
        source_item_ids?: string[];
        stub_page_count?: number;
        stubPageCount?: number;
      }
    | undefined;
  const { caseId } = request.params as { caseId: string };

  const caseExists = db.prepare(`SELECT id FROM cases WHERE id = ? LIMIT 1`).get(caseId) as
    | { id: string }
    | undefined;
  if (!caseExists) {
    return reply.code(404).send({ ok: false, error: "case not found" });
  }

  return normalizeCaseDocumentSpine(db, {
    caseId,
    sourceItemIds: body?.source_item_ids,
    stubPageCount: body?.stub_page_count ?? body?.stubPageCount ?? null
  });
});

app.post("/api/cases/:caseId/normalize-documents", async (request, reply) => {
  const body = request.body as
    | {
        source_item_ids?: string[];
        stub_page_count?: number;
        stubPageCount?: number;
      }
    | undefined;
  const { caseId } = request.params as { caseId: string };

  const caseExists = db.prepare(`SELECT id FROM cases WHERE id = ? LIMIT 1`).get(caseId) as
    | { id: string }
    | undefined;
  if (!caseExists) {
    return reply.code(404).send({ ok: false, error: "case not found" });
  }

  return normalizeCaseDocumentSpine(db, {
    caseId,
    sourceItemIds: body?.source_item_ids,
    stubPageCount: body?.stub_page_count ?? body?.stubPageCount ?? null
  });
});

app.get("/api/cases/:caseId/review-queue", async (request, reply) => {
  const { caseId } = request.params as { caseId: string };
  const caseExists = db.prepare(`SELECT id FROM cases WHERE id = ? LIMIT 1`).get(caseId) as
    | { id: string }
    | undefined;
  if (!caseExists) {
    return reply.code(404).send({ ok: false, error: "case not found" });
  }

  const ocrReviews = db
    .prepare(
      `
        SELECT
          cp.id AS canonical_page_id,
          cp.page_number_in_doc AS page_number,
          cp.raw_text,
          cp.ocr_method,
          cp.ocr_confidence,
          cp.ocr_status,
          cp.extraction_status,
          cd.id AS canonical_document_id,
          cd.title AS canonical_document_title,
          si.id AS source_item_id,
          si.title AS source_item_title,
          si.document_type_name,
          rq.id AS review_id,
          rq.severity,
          rq.review_status,
          rq.review_note,
          rq.blocker_for_branch,
          rq.blocker_for_preset
        FROM ocr_review_queue rq
        JOIN canonical_pages cp ON cp.id = rq.canonical_page_id
        JOIN canonical_documents cd ON cd.id = cp.canonical_doc_id
        LEFT JOIN logical_documents ld ON ld.id = cd.logical_document_id
        LEFT JOIN source_items si ON si.id = ld.source_item_id
        WHERE rq.case_id = ?
          AND rq.review_status IN ('pending', 'in_review')
        ORDER BY rq.created_at ASC, cd.created_at ASC, cp.page_number_in_doc ASC
      `
    )
    .all(caseId);

  const unclassifiedDocuments = db
    .prepare(
      `
        SELECT
          si.id AS source_item_id,
          si.title,
          si.provider,
          si.source_kind,
          si.updated_at,
          json_extract(si.raw_json, '$.canonical_document_id') AS canonical_document_id
        FROM source_items si
        WHERE si.case_id = ?
          AND si.document_type_id IS NULL
          AND si.document_type_name IS NULL
        ORDER BY si.created_at ASC
      `
    )
    .all(caseId);

  const missingProof = db
    .prepare(
      `
        SELECT
          pr.id AS proof_requirement_id,
          pr.issue_id,
          pr.requirement_key,
          pr.requirement_policy,
          pr.rationale,
          i.issue_type
        FROM proof_requirements pr
        JOIN issues i ON i.id = pr.issue_id
        WHERE i.case_id = ?
          AND COALESCE(pr.satisfied, 0) = 0
        ORDER BY i.priority ASC, pr.requirement_key ASC
      `
    )
    .all(caseId);

  return {
    ok: true,
    case_id: caseId,
    ocr_reviews: ocrReviews,
    unclassified_documents: unclassifiedDocuments,
    missing_proof: missingProof
  };
});

app.post("/api/cases/:caseId/ocr/queue", async (request, reply) => {
  const body = request.body as
    | {
        canonical_document_id?: string | null;
        canonical_page_ids?: string[];
        preferred_engine?: string | null;
        force_rerun?: boolean;
      }
    | undefined;
  const { caseId } = request.params as { caseId: string };

  const caseExists = db.prepare(`SELECT id FROM cases WHERE id = ? LIMIT 1`).get(caseId) as
    | { id: string }
    | undefined;
  if (!caseExists) {
    return reply.code(404).send({ ok: false, error: "case not found" });
  }

  return db.transaction(() =>
    queueCaseOcrWork(db, {
      caseId,
      canonicalDocumentId: body?.canonical_document_id ?? null,
      canonicalPageIds: body?.canonical_page_ids,
      preferredEngine: body?.preferred_engine ?? null,
      forceRerun: body?.force_rerun === true
    })
  )();
});

app.post("/api/cases/:caseId/extractions/run-heuristics", async (request, reply) => {
  const { caseId } = request.params as { caseId: string };
  const body = request.body as { skip_if_exists?: boolean } | undefined;

  const caseExists = db.prepare(`SELECT id FROM cases WHERE id = ? LIMIT 1`).get(caseId) as
    | { id: string }
    | undefined;
  if (!caseExists) {
    return reply.code(404).send({ ok: false, error: "case not found" });
  }

  const result = db.transaction(() =>
    runCaseHeuristicExtractions(db, {
      caseId,
      skipIfExists: body?.skip_if_exists !== false
    })
  )();

  return result;
});

app.post("/api/canonical-pages/:canonicalPageId/ocr-review/resolve", async (request, reply) => {
  const { canonicalPageId } = request.params as { canonicalPageId: string };
  const body = request.body as { accept_empty?: boolean; resolution_note?: string | null } | undefined;

  const result = db.transaction(() =>
    resolveCanonicalPageOcrReview(db, {
      canonicalPageId,
      acceptEmpty: body?.accept_empty === true,
      resolutionNote: body?.resolution_note ?? null
    })
  )();

  if (!result.ok) {
    const code = result.error === "canonical page not found" ? 404 : 400;
    return reply.code(code).send(result);
  }

  return result;
});

app.post("/api/canonical-pages/:canonicalPageId/ocr-attempts", async (request, reply) => {
  const body = request.body as
    | {
        engine?: string;
        status?: string;
        confidence?: number | null;
        output_text?: string | null;
        metadata_json?: unknown;
      }
    | undefined;
  const { canonicalPageId } = request.params as { canonicalPageId: string };

  if (!body?.engine || !body?.status) {
    return reply.code(400).send({ ok: false, error: "engine and status are required" });
  }

  const engine = body.engine;
  const status = body.status;

  const result = db.transaction(() =>
    recordCanonicalPageOcrAttempt(db, {
      canonicalPageId,
      engine,
      status,
      confidence: body.confidence ?? null,
      outputText: body.output_text ?? null,
      metadataJson: body.metadata_json
    })
  )();

  if (!result.ok) {
    return reply.code(404).send(result);
  }

  return result;
});

app.post("/api/canonical-pages/:canonicalPageId/extractions", async (request, reply) => {
  const body = request.body as
    | {
        schema_key?: string;
        extractor_version?: string;
        payload?: Record<string, unknown>;
        confidence?: number | null;
      }
    | undefined;
  const { canonicalPageId } = request.params as { canonicalPageId: string };

  if (!body?.schema_key?.trim() || !body?.extractor_version?.trim() || !body?.payload || typeof body.payload !== "object") {
    return reply.code(400).send({
      ok: false,
      error: "schema_key, extractor_version, and payload object are required"
    });
  }

  const result = appendPageExtraction(db, {
    canonicalPageId,
    schemaKey: body.schema_key.trim(),
    extractorVersion: body.extractor_version.trim(),
    payload: body.payload,
    confidence: body.confidence ?? null
  });

  if (!result.ok) {
    return reply.code(404).send(result);
  }

  return { ok: true, extraction_id: result.extraction_id };
});

app.get("/api/cases/:caseId/projection", async (request, reply) => {
  const { caseId } = request.params as { caseId: string };
  const projection = buildCaseProjection(db, caseId);
  if (!projection) {
    return reply.code(404).send({ ok: false, error: "case not found" });
  }

  return projection;
});

app.post("/api/cases/:caseId/regression-checks", async (request, reply) => {
  const { caseId } = request.params as { caseId: string };
  const body = request.body as
    | {
        check_type?: string;
        passed?: boolean;
        message?: string;
        details_json?: unknown;
        artifact_id?: string | null;
        bates_run_id?: string | null;
      }
    | undefined;

  if (!body?.check_type || typeof body.passed !== "boolean") {
    return reply.code(400).send({ ok: false, error: "check_type and passed are required" });
  }

  const recorded = recordRegressionCheck(db, {
    caseId,
    checkType: body.check_type,
    passed: body.passed,
    message: body.message ?? null,
    detailsJson: body.details_json,
    artifactId: body.artifact_id ?? null,
    batesRunId: body.bates_run_id ?? null
  });

  return {
    ok: true,
    regression_id: recorded.regressionId,
    summary: buildRegressionSummary(db, caseId)
  };
});

app.post("/api/cases/:caseId/run-manifests", async (request) => {
  const { caseId } = request.params as { caseId: string };
  const body = request.body as
    | {
        product_preset_id?: string | null;
        source_snapshot_id?: string | null;
        rulepack_version?: string | null;
        bates_run_id?: string | null;
        artifact_ids?: string[];
      }
    | undefined;

  const manifest = createRunManifest(db, {
    caseId,
    productPresetId: body?.product_preset_id ?? null,
    sourceSnapshotId: body?.source_snapshot_id ?? null,
    rulepackVersion: body?.rulepack_version ?? null,
    batesRunId: body?.bates_run_id ?? null,
    artifactIds: body?.artifact_ids ?? []
  });

  return {
    ok: true,
    manifest_id: manifest.manifestId,
    regression_summary: manifest.summary
  };
});

app.post("/dev/regression-check", async (request, reply) => {
  const body = request.body as
    | {
        case_id?: string;
        check_type?: string;
        passed?: boolean;
        message?: string;
        details_json?: unknown;
      }
    | undefined;
  if (!body?.case_id || !body?.check_type || typeof body?.passed !== "boolean") {
    return reply.code(400).send({ ok: false, error: "case_id, check_type, and passed are required" });
  }

  const recorded = recordRegressionCheck(db, {
    caseId: body.case_id,
    checkType: body.check_type,
    passed: body.passed,
    message: body.message ?? null,
    detailsJson: body.details_json
  });

  const manifest = createRunManifest(db, {
    caseId: body.case_id
  });

  return {
    ok: true,
    regression_id: recorded.regressionId,
    manifest_id: manifest.manifestId,
    regression_summary: manifest.summary
  };
});

const port = Number(process.env.PORT ?? 4000);
const host = process.env.WC_API_HOST?.trim() || "127.0.0.1";
try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
