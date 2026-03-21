import multipart from "@fastify/multipart";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { openDatabase } from "./db.js";
import {
  addExhibitItem,
  createExhibit,
  createExhibitPacket,
  createExhibitSection,
  deleteExhibit,
  deleteExhibitSection,
  finalizeExhibitPacket,
  getCaseExhibitWorkspace,
  getPacketCaseId,
  getPacketHistory,
  getPacketPreview,
  getSectionCaseId,
  getPacketSuggestions,
  removeExhibitItem,
  reorderExhibitsInSection,
  reorderExhibitSections,
  resolveExhibitSuggestion,
  updateExhibit,
  updateExhibitItemPageRules,
  updateExhibitPacket,
  updateExhibitSection
} from "./exhibits.js";
import {
  getPacketExportRow,
  listPacketExportsForPacket,
  parsePacketPdfExportOptions,
  resolveExportAbsolutePath,
  runPacketPdfExport
} from "./packet-pdf.js";
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
  buildPracticePantherAuthorizationUrl,
  buildPracticePantherMatterPatch,
  buildPracticePantherSyncCursorValue,
  exchangePracticePantherAuthorizationCode,
  extractPracticePantherCustomFields,
  fetchPracticePantherAccountById,
  fetchPracticePantherCallLogs,
  fetchPracticePantherContacts,
  fetchPracticePantherCurrentUser,
  fetchPracticePantherEmails,
  fetchPracticePantherEvents,
  fetchPracticePantherMatterById,
  fetchPracticePantherMatters,
  fetchPracticePantherNotes,
  fetchPracticePantherRelationships,
  fetchPracticePantherTasks,
  isPracticePantherOAuthReady,
  isPracticePantherProductionSyncConfigured,
  mergePracticePantherConnectionMetadata,
  parsePracticePantherConnectionMetadata,
  refreshPracticePantherAccessToken,
  readPracticePantherConfig
} from "./pp-provider.js";
import { seedFoundation } from "./seed.js";
import { readSyncCursorValue } from "./sync-lifecycle.js";
import { readWorkerHealth } from "./worker-health.js";
import {
  deleteAIEventConfig,
  isAIConfigured,
  listAIEventConfigs,
  listAIJobs,
  recordClassificationSignal,
  runAIAssemblyJob,
  upsertAIEventConfig,
  getAIEventConfig,
  runPackageWorker,
  listPackageRunsForPacket,
  getPackageRun,
  updatePackageRunDraft
} from "./ai-service.js";
import { markdownishToDocxBuffer } from "./docx-export.js";
import { persistCaseUploadAndIngest } from "./matter-upload.js";
import {
  buildPackageBundle,
  gatherDocumentSummaries,
  getFullCanonicalTextForSourceItem,
  getPageChunks
} from "./retrieval.js";
import {
  MAX_TEMPLATE_BODY_MARKDOWN,
  buildFieldsForRender,
  createUserDocumentTemplate,
  deleteTemplateFill,
  deleteUserDocumentTemplate,
  getTemplateFill,
  getUserDocumentTemplate,
  listTemplateFills,
  listUserDocumentTemplates,
  renderUserTemplate,
  saveTemplateFill,
  serializeUserDocumentFill,
  serializeUserDocumentTemplate,
  updateTemplateFill,
  updateUserDocumentTemplate,
  validateValuesPayload
} from "./document-templates.js";

const db = openDatabase();
seedFoundation(db);

async function fetchBoxPdfBytesForSourceItem(sourceItemId: string): Promise<Buffer> {
  const config = resolveBoxProviderConfig();
  if (!config) {
    throw new Error("BOX_JWT_CONFIG_JSON or BOX_JWT_CONFIG_FILE must be configured");
  }
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
    throw new Error(`source item not found: ${sourceItemId}`);
  }
  if (sourceItem.provider !== "box") {
    throw new Error("packet PDF export currently supports Box source files only");
  }
  const { client } = createBoxClient(config);
  const buffer = await downloadBoxFileContent(client, sourceItem.remote_id);
  return Buffer.from(buffer);
}

const app = Fastify({ logger: true });
app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  reply.code(500).send({
    ok: false,
    error: error instanceof Error ? error.message : "Internal server error"
  });
});

const configuredOrigins = process.env.WC_CORS_ORIGIN?.split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);
await app.register(cors, {
  origin: configuredOrigins && configuredOrigins.length > 0 ? configuredOrigins : ["http://127.0.0.1:5173", "http://localhost:5173"]
});
await app.register(multipart, {
  limits: {
    fileSize: Number(process.env.WC_UPLOAD_MAX_BYTES ?? 45 * 1024 * 1024)
  }
});

const WC_API_KEY = process.env.WC_API_KEY?.trim();
if (WC_API_KEY) {
  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0] ?? "";
    if (
      request.method === "OPTIONS" ||
      path === "/health" ||
      path === "/api/connectors/practicepanther/callback"
    ) {
      return;
    }
    const auth = request.headers.authorization;
    if (auth !== `Bearer ${WC_API_KEY}`) {
      return reply.code(401).send({ ok: false, error: "Unauthorized" });
    }
  });
}

const ENABLE_DEV_ROUTES =
  process.env.WC_ENABLE_DEV_ROUTES === "1" || process.env.NODE_ENV !== "production";

function parseMetadataRecord(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readSourceConnectionByProvider(provider: "box" | "practicepanther") {
  return db
    .prepare(
      `
        SELECT
          id,
          provider,
          account_label,
          auth_mode,
          status,
          scopes,
          callback_state,
          authorization_url,
          metadata_json,
          external_account_id,
          last_error_message,
          last_verified_at,
          updated_at,
          created_at
        FROM source_connections
        WHERE provider = ?
        ORDER BY created_at ASC
        LIMIT 1
      `
    )
    .get(provider) as
    | {
        id: string;
        provider: string;
        account_label: string | null;
        auth_mode: string;
        status: string;
        scopes: string | null;
        callback_state: string | null;
        authorization_url: string | null;
        metadata_json: string | null;
        external_account_id: string | null;
        last_error_message: string | null;
        last_verified_at: string | null;
        updated_at: string | null;
        created_at: string | null;
      }
    | undefined;
}

function readSourceConnectionByCallbackState(provider: "box" | "practicepanther", callbackState: string) {
  return db
    .prepare(
      `
        SELECT
          id,
          provider,
          account_label,
          auth_mode,
          status,
          scopes,
          callback_state,
          authorization_url,
          metadata_json,
          external_account_id,
          last_error_message,
          last_verified_at,
          updated_at,
          created_at
        FROM source_connections
        WHERE provider = ?
          AND callback_state = ?
        LIMIT 1
      `
    )
    .get(provider, callbackState) as
    | {
        id: string;
        provider: string;
        account_label: string | null;
        auth_mode: string;
        status: string;
        scopes: string | null;
        callback_state: string | null;
        authorization_url: string | null;
        metadata_json: string | null;
        external_account_id: string | null;
        last_error_message: string | null;
        last_verified_at: string | null;
        updated_at: string | null;
        created_at: string | null;
      }
    | undefined;
}

function updateSourceConnectionMetadata(connectionId: string, metadata: Record<string, unknown>) {
  db.prepare(
    `
      UPDATE source_connections
      SET metadata_json = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
  ).run(JSON.stringify(metadata), connectionId);
}

function updatePracticePantherAuthStart(connectionId: string, authorizationUrl: string, metadata: Record<string, unknown>) {
  db.prepare(
    `
      UPDATE source_connections
      SET auth_mode = 'oauth_browser',
          status = 'auth_pending',
          authorization_url = ?,
          metadata_json = ?,
          last_error_message = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
  ).run(authorizationUrl, JSON.stringify(metadata), connectionId);
}

function markPracticePantherConnectionError(connectionId: string, message: string) {
  db.prepare(
    `
      UPDATE source_connections
      SET status = 'error',
          last_error_message = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
  ).run(message, connectionId);
}

function completePracticePantherConnection(
  connectionId: string,
  input: {
    accountLabel?: string | null;
    externalAccountId?: string | null;
    metadata: Record<string, unknown>;
  }
) {
  db.prepare(
    `
      UPDATE source_connections
      SET account_label = COALESCE(?, account_label),
          auth_mode = 'oauth_browser',
          status = 'active',
          external_account_id = COALESCE(?, external_account_id),
          metadata_json = ?,
          last_verified_at = CURRENT_TIMESTAMP,
          callback_state = NULL,
          authorization_url = NULL,
          last_error_message = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
  ).run(input.accountLabel ?? null, input.externalAccountId ?? null, JSON.stringify(input.metadata), connectionId);
}

const ALLOWED_REDIRECT_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  ...(process.env.WC_CORS_ORIGIN?.split(",").map((o) => o.trim()).filter(Boolean) ?? [])
]);

function isAllowedRedirectOrigin(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_REDIRECT_ORIGINS.has(parsed.origin);
  } catch {
    return false;
  }
}

function buildPracticePantherCallbackRedirect(returnTo: string | null | undefined, success: boolean, message?: string) {
  let target: string;
  if (returnTo && /^https?:\/\//i.test(returnTo) && isAllowedRedirectOrigin(returnTo)) {
    target = returnTo;
  } else if (returnTo && returnTo.startsWith("/")) {
    target = returnTo;
  } else {
    target = "/cases";
  }

  const url = new URL(target, target.startsWith("http") ? undefined : "http://localhost");
  if (success) {
    url.searchParams.set("pp_auth", "success");
  } else {
    url.searchParams.set("pp_auth", "error");
    if (message) {
      url.searchParams.set("pp_error", message);
    }
  }
  return target.startsWith("http") ? url.toString() : `${url.pathname}${url.search}`;
}

async function getValidPracticePantherAccessToken(connection: {
  id: string;
  metadata_json: string | null;
}) {
  const config = readPracticePantherConfig();
  if (!isPracticePantherOAuthReady()) {
    throw new Error(PRACTICE_PANTHER_SYNC_DEFERRED_MESSAGE);
  }

  const metadata = parsePracticePantherConnectionMetadata(connection.metadata_json);
  const oauth = metadata.oauth;
  if (!oauth?.refresh_token) {
    throw new Error("PracticePanther connection is missing refresh_token");
  }

  const expiresAt = oauth.expires_at ? new Date(oauth.expires_at).getTime() : 0;
  const now = Date.now();
  if (oauth.access_token && expiresAt > now + 30_000) {
    return {
      accessToken: oauth.access_token,
      metadata
    };
  }

  const refreshed = await refreshPracticePantherAccessToken(config, oauth.refresh_token);
  const merged = mergePracticePantherConnectionMetadata(connection.metadata_json, {
    oauth: {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      token_type: refreshed.token_type,
      expires_at: new Date(Date.now() + Math.max(0, refreshed.expires_in - 300) * 1000).toISOString()
    }
  });
  updateSourceConnectionMetadata(connection.id, merged as Record<string, unknown>);
  return {
    accessToken: refreshed.access_token,
    metadata: merged
  };
}

app.addHook("onRequest", async (request, reply) => {
  const path = request.url.split("?")[0] ?? "";
  if (!ENABLE_DEV_ROUTES && path.startsWith("/dev/")) {
    return reply.code(404).send({ ok: false, error: "Not found" });
  }
});

app.get("/health", async () => ({
  ok: true,
  service: "wc-authoritative-api",
  seeded_at_startup: true
}));

app.get("/api/workers/ocr/health", async () => {
  const health = readWorkerHealth(db, "ocr");
  const now = Date.now();
  const heartbeatTime = health ? new Date(health.last_heartbeat_at).getTime() : 0;
  const ageMs = heartbeatTime > 0 ? Math.max(0, now - heartbeatTime) : null;
  const stale = ageMs === null ? true : ageMs > 45_000;

  return {
    ok: true,
    worker: health,
    stale,
    age_ms: ageMs
  };
});

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

app.get("/api/document-types", async () => {
  const rows = db
    .prepare(
      `
        SELECT id, canonical_name, category, hearing_relevance, exhibit_policy, exhibit_eligible, mandatory_vlm_ocr
        FROM document_types
        WHERE active = 1
        ORDER BY category ASC, canonical_name ASC
      `
    )
    .all();

  return { document_types: rows };
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

  if (body?.case_id) {
    return reply.code(400).send({ ok: false, error: "case_id may not be supplied by clients" });
  }

  if (!body?.name?.trim()) {
    return reply.code(400).send({ ok: false, error: "name is required" });
  }

  const scaffold = ensureCaseScaffold(db, {
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

  const patch = body ?? {};
  const updates: string[] = [];
  const params: Array<string | null> = [];

  if (Object.hasOwn(patch, "name")) {
    const nextName = patch.name?.trim();
    if (!nextName) {
      return reply.code(400).send({ ok: false, error: "name cannot be empty" });
    }
    updates.push("name = ?");
    params.push(nextName);
  }
  if (Object.hasOwn(patch, "case_type")) {
    const nextType = patch.case_type?.trim();
    if (!nextType) {
      return reply.code(400).send({ ok: false, error: "case_type cannot be empty" });
    }
    updates.push("case_type = ?");
    params.push(nextType);
  }
  if (Object.hasOwn(patch, "pp_matter_id")) {
    updates.push("pp_matter_id = ?");
    params.push(patch.pp_matter_id ?? null);
  }
  if (Object.hasOwn(patch, "box_root_folder_id")) {
    updates.push("box_root_folder_id = ?");
    params.push(patch.box_root_folder_id ?? null);
  }
  if (Object.hasOwn(patch, "employee_name")) {
    updates.push("employee_name = ?");
    params.push(patch.employee_name ?? null);
  }
  if (Object.hasOwn(patch, "employer_name")) {
    updates.push("employer_name = ?");
    params.push(patch.employer_name ?? null);
  }
  if (Object.hasOwn(patch, "insurer_name")) {
    updates.push("insurer_name = ?");
    params.push(patch.insurer_name ?? null);
  }
  if (Object.hasOwn(patch, "hearing_date")) {
    updates.push("hearing_date = ?");
    params.push(patch.hearing_date ?? null);
  }

  if (updates.length > 0) {
    db.prepare(
      `
        UPDATE cases
        SET ${updates.join(", ")},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
    ).run(...params, caseId);
  }

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

app.get("/api/cases/:caseId/exhibit-packets", async (request, reply) => {
  const { caseId } = request.params as { caseId: string };
  const caseExists = db.prepare(`SELECT id FROM cases WHERE id = ? LIMIT 1`).get(caseId) as
    | { id: string }
    | undefined;
  if (!caseExists) {
    return reply.code(404).send({ ok: false, error: "case not found" });
  }

  return {
    ok: true,
    case_id: caseId,
    packets: getCaseExhibitWorkspace(db, caseId)
  };
});

app.get("/api/cases/:caseId/exhibits", async (request, reply) => {
  const { caseId } = request.params as { caseId: string };
  const caseExists = db.prepare(`SELECT id FROM cases WHERE id = ? LIMIT 1`).get(caseId) as
    | { id: string }
    | undefined;
  if (!caseExists) {
    return reply.code(404).send({ ok: false, error: "case not found" });
  }

  return {
    ok: true,
    case_id: caseId,
    packets: getCaseExhibitWorkspace(db, caseId)
  };
});

function requireCase(caseId: string, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
  const caseExists = db.prepare(`SELECT id FROM cases WHERE id = ? LIMIT 1`).get(caseId) as { id: string } | undefined;
  if (!caseExists) {
    reply.code(404).send({ ok: false, error: "case not found" });
    return false;
  }
  return true;
}

app.get("/api/cases/:caseId/document-templates", async (request, reply) => {
  const { caseId } = request.params as { caseId: string };
  if (!requireCase(caseId, reply)) {
    return;
  }
  const rows = listUserDocumentTemplates(db, caseId);
  return {
    ok: true,
    case_id: caseId,
    templates: rows.map(serializeUserDocumentTemplate)
  };
});

app.post("/api/cases/:caseId/document-templates", async (request, reply) => {
  const { caseId } = request.params as { caseId: string };
  if (!requireCase(caseId, reply)) {
    return;
  }
  const body = request.body as
    | {
        name?: string;
        description?: string | null;
        body_markdown?: string;
        fields?: Array<{ name: string; label?: string; default?: string | null }>;
        ai_hints?: string | null;
      }
    | undefined;
  const bodyMarkdown = typeof body?.body_markdown === "string" ? body.body_markdown : "";
  if (!bodyMarkdown.trim()) {
    return reply.code(400).send({ ok: false, error: "body_markdown is required" });
  }
  if (bodyMarkdown.length > MAX_TEMPLATE_BODY_MARKDOWN) {
    return reply.code(400).send({ ok: false, error: "body_markdown is too large" });
  }
  const row = createUserDocumentTemplate(db, {
    caseId,
    name: body?.name ?? "Untitled template",
    description: body?.description,
    body_markdown: bodyMarkdown,
    fields: body?.fields,
    ai_hints: body?.ai_hints
  });
  return { ok: true, case_id: caseId, template: row ? serializeUserDocumentTemplate(row) : null };
});

app.get("/api/cases/:caseId/document-templates/:templateId", async (request, reply) => {
  const { caseId, templateId } = request.params as { caseId: string; templateId: string };
  if (!requireCase(caseId, reply)) {
    return;
  }
  const row = getUserDocumentTemplate(db, templateId, caseId);
  if (!row) {
    return reply.code(404).send({ ok: false, error: "template not found" });
  }
  return { ok: true, case_id: caseId, template: serializeUserDocumentTemplate(row) };
});

app.patch("/api/cases/:caseId/document-templates/:templateId", async (request, reply) => {
  const { caseId, templateId } = request.params as { caseId: string; templateId: string };
  if (!requireCase(caseId, reply)) {
    return;
  }
  const body = request.body as
    | {
        name?: string | null;
        description?: string | null;
        body_markdown?: string | null;
        fields?: Array<{ name: string; label?: string; default?: string | null }> | null;
        ai_hints?: string | null;
      }
    | undefined;
  if (typeof body?.body_markdown === "string" && body.body_markdown.length > MAX_TEMPLATE_BODY_MARKDOWN) {
    return reply.code(400).send({ ok: false, error: "body_markdown is too large" });
  }
  const row = updateUserDocumentTemplate(db, {
    templateId,
    caseId,
    name: body?.name,
    description: body?.description,
    body_markdown: body?.body_markdown,
    fields: body?.fields,
    ai_hints: body?.ai_hints
  });
  if (!row) {
    return reply.code(404).send({ ok: false, error: "template not found" });
  }
  return { ok: true, case_id: caseId, template: serializeUserDocumentTemplate(row) };
});

app.delete("/api/cases/:caseId/document-templates/:templateId", async (request, reply) => {
  const { caseId, templateId } = request.params as { caseId: string; templateId: string };
  if (!requireCase(caseId, reply)) {
    return;
  }
  const deleted = deleteUserDocumentTemplate(db, templateId, caseId);
  if (!deleted) {
    return reply.code(404).send({ ok: false, error: "template not found" });
  }
  return { ok: true, case_id: caseId };
});

app.post("/api/cases/:caseId/document-templates/:templateId/render", async (request, reply) => {
  const { caseId, templateId } = request.params as { caseId: string; templateId: string };
  if (!requireCase(caseId, reply)) {
    return;
  }
  const template = getUserDocumentTemplate(db, templateId, caseId);
  if (!template) {
    return reply.code(404).send({ ok: false, error: "template not found" });
  }
  const body = request.body as
    | {
        values?: Record<string, string>;
        body_markdown?: string | null;
        save?: boolean;
        source_item_id?: string | null;
        status?: string | null;
      }
    | undefined;
  const values = body?.values && typeof body.values === "object" && !Array.isArray(body.values) ? body.values : {};
  const validated = validateValuesPayload(values);
  if (!validated.ok) {
    return reply.code(400).send({ ok: false, error: validated.error });
  }
  const bodyToRender =
    typeof body?.body_markdown === "string" ? body.body_markdown : template.body_markdown;
  if (bodyToRender.length > MAX_TEMPLATE_BODY_MARKDOWN) {
    return reply.code(400).send({ ok: false, error: "body_markdown is too large" });
  }
  const fieldsForRender = buildFieldsForRender(template, bodyToRender);
  const { rendered_markdown, missing_placeholders } = renderUserTemplate(bodyToRender, values, fieldsForRender);
  let fill = null;
  if (body?.save) {
    const saved = saveTemplateFill(db, {
      templateId,
      caseId,
      values,
      rendered_markdown,
      source_item_id: body?.source_item_id,
      status: body?.status ?? undefined
    });
    if (!saved.ok) {
      return reply.code(400).send({ ok: false, error: saved.error });
    }
    fill = serializeUserDocumentFill(saved.row);
  }
  return {
    ok: true,
    case_id: caseId,
    template_id: templateId,
    rendered_markdown,
    missing_placeholders,
    fill
  };
});

app.get("/api/cases/:caseId/document-template-fills", async (request, reply) => {
  const { caseId } = request.params as { caseId: string };
  if (!requireCase(caseId, reply)) {
    return;
  }
  const q = request.query as { template_id?: string };
  const templateId = typeof q.template_id === "string" && q.template_id.trim() ? q.template_id.trim() : undefined;
  const rows = listTemplateFills(db, caseId, templateId);
  return {
    ok: true,
    case_id: caseId,
    fills: rows.map(serializeUserDocumentFill)
  };
});

app.get("/api/cases/:caseId/document-template-fills/:fillId", async (request, reply) => {
  const { caseId, fillId } = request.params as { caseId: string; fillId: string };
  if (!requireCase(caseId, reply)) {
    return;
  }
  const row = getTemplateFill(db, fillId, caseId);
  if (!row) {
    return reply.code(404).send({ ok: false, error: "fill not found" });
  }
  return { ok: true, case_id: caseId, fill: serializeUserDocumentFill(row) };
});

app.patch("/api/cases/:caseId/document-template-fills/:fillId", async (request, reply) => {
  const { caseId, fillId } = request.params as { caseId: string; fillId: string };
  if (!requireCase(caseId, reply)) {
    return;
  }
  const body = request.body as
    | {
        values?: Record<string, string> | null;
        rendered_markdown?: string | null;
        status?: string | null;
      }
    | undefined;
  if (body?.values && typeof body.values === "object" && !Array.isArray(body.values)) {
    const validated = validateValuesPayload(body.values);
    if (!validated.ok) {
      return reply.code(400).send({ ok: false, error: validated.error });
    }
  }
  if (typeof body?.rendered_markdown === "string" && body.rendered_markdown.length > MAX_TEMPLATE_BODY_MARKDOWN) {
    return reply.code(400).send({ ok: false, error: "rendered_markdown is too large" });
  }
  const row = updateTemplateFill(db, {
    fillId,
    caseId,
    values: body?.values,
    rendered_markdown: body?.rendered_markdown,
    status: body?.status
  });
  if (!row) {
    return reply.code(404).send({ ok: false, error: "fill not found" });
  }
  return { ok: true, case_id: caseId, fill: serializeUserDocumentFill(row) };
});

app.delete("/api/cases/:caseId/document-template-fills/:fillId", async (request, reply) => {
  const { caseId, fillId } = request.params as { caseId: string; fillId: string };
  if (!requireCase(caseId, reply)) {
    return;
  }
  const deleted = deleteTemplateFill(db, fillId, caseId);
  if (!deleted) {
    return reply.code(404).send({ ok: false, error: "fill not found" });
  }
  return { ok: true, case_id: caseId };
});

app.post("/api/cases/:caseId/exhibit-packets", async (request, reply) => {
  const { caseId } = request.params as { caseId: string };
  const body = request.body as
    | {
        packet_name?: string;
        packet_mode?: "compact" | "full";
        naming_scheme?: string;
        package_type?: string;
        package_label?: string;
        target_document_source_item_id?: string;
        starter_slot_count?: number;
      }
    | undefined;
  const caseExists = db.prepare(`SELECT id FROM cases WHERE id = ? LIMIT 1`).get(caseId) as
    | { id: string }
    | undefined;
  if (!caseExists) {
    return reply.code(404).send({ ok: false, error: "case not found" });
  }

  const pkgType = body?.package_type?.trim() ?? "hearing_packet";
  const starterSlots =
    body?.starter_slot_count !== undefined
      ? body.starter_slot_count
      : pkgType === "hearing_packet"
        ? undefined
        : 0;

  const packet = createExhibitPacket(db, {
    caseId,
    packetName: body?.packet_name ?? null,
    packetMode: body?.packet_mode ?? null,
    namingScheme: body?.naming_scheme ?? null,
    packageType: pkgType,
    packageLabel: body?.package_label ?? null,
    targetDocumentSourceItemId: body?.target_document_source_item_id ?? null,
    starterSlotCount: starterSlots
  });
  if (!packet.ok) {
    return reply.code(400).send({ ok: false, error: packet.error });
  }

  return { ok: true, case_id: caseId, packet: packet.packet };
});

app.patch("/api/exhibit-packets/:packetId", async (request, reply) => {
  const { packetId } = request.params as { packetId: string };
  const body = request.body as
    | {
        packet_name?: string | null;
        packet_mode?: "compact" | "full" | null;
        naming_scheme?: string | null;
        status?: "draft" | "needs_review" | "ready" | "finalized" | "exported" | "archived" | null;
        package_type?: string | null;
        package_label?: string | null;
        target_document_source_item_id?: string | null;
        run_status?: string | null;
      }
    | undefined;

  const updated = updateExhibitPacket(db, {
    packetId,
    packetName: body?.packet_name,
    packetMode: body?.packet_mode ?? undefined,
    namingScheme: body?.naming_scheme,
    status: body?.status ?? undefined,
    packageType: body?.package_type,
    packageLabel: body?.package_label,
    targetDocumentSourceItemId: body?.target_document_source_item_id,
    runStatus: body?.run_status
  });
  if (updated && typeof updated === "object" && "ok" in updated && updated.ok === false) {
    return reply.code(404).send({ ok: false, error: updated.error });
  }
  if (!updated) {
    return reply.code(404).send({ ok: false, error: "packet not found" });
  }

  return { ok: true, packet: updated };
});

app.post("/api/exhibit-packets/:packetId/sections", async (request, reply) => {
  const { packetId } = request.params as { packetId: string };
  const body = request.body as { section_key?: string; section_label?: string } | undefined;
  const packet = createExhibitSection(db, {
    packetId,
    sectionKey: body?.section_key ?? null,
    sectionLabel: body?.section_label ?? null
  });
  if (!packet.ok) {
    const code = /already exists/i.test(packet.error) ? 400 : 404;
    return reply.code(code).send({ ok: false, error: packet.error });
  }
  return { ok: true, packet: packet.packet };
});

app.post("/api/exhibit-packets/:packetId/sections/reorder", async (request, reply) => {
  const { packetId } = request.params as { packetId: string };
  const body = request.body as { section_ids?: string[] } | undefined;
  if (!body?.section_ids?.length) {
    return reply.code(400).send({ ok: false, error: "section_ids are required" });
  }
  const result = reorderExhibitSections(db, packetId, body.section_ids);
  if (!result.ok) {
    const code = /not found/i.test(result.error) ? 404 : 400;
    return reply.code(code).send({ ok: false, error: result.error });
  }
  return { ok: true, packet: result.packet };
});

app.post("/api/exhibit-sections/:sectionId/exhibits/reorder", async (request, reply) => {
  const { sectionId } = request.params as { sectionId: string };
  const body = request.body as { exhibit_ids?: string[] } | undefined;
  if (!body?.exhibit_ids?.length) {
    return reply.code(400).send({ ok: false, error: "exhibit_ids are required" });
  }
  const result = reorderExhibitsInSection(db, sectionId, body.exhibit_ids);
  if (!result.ok) {
    const code = /not found/i.test(result.error) ? 404 : 400;
    return reply.code(code).send({ ok: false, error: result.error });
  }
  return { ok: true, packet: result.packet };
});

app.patch("/api/exhibit-sections/:sectionId", async (request, reply) => {
  const { sectionId } = request.params as { sectionId: string };
  const body = request.body as { section_label?: string | null; sort_order?: number | null } | undefined;
  const packet = updateExhibitSection(db, {
    sectionId,
    sectionLabel: body?.section_label,
    sortOrder: body?.sort_order ?? undefined
  });
  if (!packet) {
    return reply.code(404).send({ ok: false, error: "section not found" });
  }
  return { ok: true, packet };
});

app.delete("/api/exhibit-sections/:sectionId", async (request, reply) => {
  const { sectionId } = request.params as { sectionId: string };
  const packet = deleteExhibitSection(db, sectionId);
  if (!packet) {
    return reply.code(404).send({ ok: false, error: "section not found" });
  }
  return { ok: true, packet };
});

app.post("/api/exhibit-sections/:sectionId/exhibits", async (request, reply) => {
  const { sectionId } = request.params as { sectionId: string };
  const body = request.body as
    | {
        exhibit_label?: string | null;
        title?: string | null;
        purpose?: string | null;
        objection_risk?: string | null;
        notes?: string | null;
      }
    | undefined;
  const packet = createExhibit(db, {
    sectionId,
    exhibitLabel: body?.exhibit_label ?? null,
    title: body?.title ?? null,
    purpose: body?.purpose ?? null,
    objectionRisk: body?.objection_risk ?? null,
    notes: body?.notes ?? null
  });
  if (!packet) {
    return reply.code(404).send({ ok: false, error: "section not found" });
  }
  return { ok: true, packet };
});

app.post("/api/cases/:caseId/exhibits", async (request, reply) => {
  const { caseId } = request.params as { caseId: string };
  const body = request.body as
    | {
        section_id?: string;
        exhibit_label?: string | null;
        title?: string | null;
        purpose?: string | null;
        objection_risk?: string | null;
        notes?: string | null;
      }
    | undefined;
  const caseExists = db.prepare(`SELECT id FROM cases WHERE id = ? LIMIT 1`).get(caseId) as
    | { id: string }
    | undefined;
  if (!caseExists) {
    return reply.code(404).send({ ok: false, error: "case not found" });
  }
  if (!body?.section_id) {
    return reply.code(400).send({ ok: false, error: "section_id is required" });
  }
  const sectionCase = getSectionCaseId(db, body.section_id);
  if (!sectionCase || sectionCase.case_id !== caseId) {
    return reply.code(404).send({ ok: false, error: "section not found for case" });
  }
  const packet = createExhibit(db, {
    sectionId: body.section_id,
    exhibitLabel: body.exhibit_label ?? null,
    title: body.title ?? null,
    purpose: body.purpose ?? null,
    objectionRisk: body.objection_risk ?? null,
    notes: body.notes ?? null
  });
  if (!packet) {
    return reply.code(404).send({ ok: false, error: "section not found" });
  }
  return { ok: true, packet };
});

app.patch("/api/exhibits/:exhibitId", async (request, reply) => {
  const { exhibitId } = request.params as { exhibitId: string };
  const body = request.body as
    | {
        exhibit_label?: string | null;
        title?: string | null;
        status?: string | null;
        purpose?: string | null;
        objection_risk?: string | null;
        notes?: string | null;
        sort_order?: number | null;
      }
    | undefined;
  const packet = updateExhibit(db, {
    exhibitId,
    exhibitLabel: body?.exhibit_label,
    title: body?.title,
    status: body?.status,
    purpose: body?.purpose,
    objectionRisk: body?.objection_risk,
    notes: body?.notes,
    sortOrder: body?.sort_order ?? undefined
  });
  if (!packet) {
    return reply.code(404).send({ ok: false, error: "exhibit not found" });
  }
  return { ok: true, packet };
});

app.delete("/api/exhibits/:exhibitId", async (request, reply) => {
  const { exhibitId } = request.params as { exhibitId: string };
  const packet = deleteExhibit(db, exhibitId);
  if (!packet) {
    return reply.code(404).send({ ok: false, error: "exhibit not found" });
  }
  return { ok: true, packet };
});

app.post("/api/exhibits/:exhibitId/items", async (request, reply) => {
  const { exhibitId } = request.params as { exhibitId: string };
  const body = request.body as { source_item_id?: string; notes?: string | null } | undefined;
  if (!body?.source_item_id) {
    return reply.code(400).send({ ok: false, error: "source_item_id is required" });
  }
  const result = addExhibitItem(db, {
    exhibitId,
    sourceItemId: body.source_item_id,
    notes: body.notes ?? null
  });
  if (!result.ok) {
    const code = /not found/i.test(result.error) ? 404 : 400;
    return reply.code(code).send({ ok: false, error: result.error });
  }
  return { ok: true, packet: result.packet };
});

app.delete("/api/exhibit-items/:itemId", async (request, reply) => {
  const { itemId } = request.params as { itemId: string };
  const packet = removeExhibitItem(db, itemId);
  if (!packet) {
    return reply.code(404).send({ ok: false, error: "exhibit item not found" });
  }
  return { ok: true, packet };
});

app.patch("/api/exhibit-items/:itemId/page-rules", async (request, reply) => {
  const { itemId } = request.params as { itemId: string };
  const body = request.body as { exclude_canonical_page_ids?: string[] } | undefined;
  if (body?.exclude_canonical_page_ids && body.exclude_canonical_page_ids.length > 1000) {
    return reply.code(400).send({ ok: false, error: "exclude_canonical_page_ids may not exceed 1000 items" });
  }
  const result = updateExhibitItemPageRules(db, {
    exhibitItemId: itemId,
    excludeCanonicalPageIds: body?.exclude_canonical_page_ids ?? []
  });
  if (!result.ok) {
    const code = /not found/i.test(result.error) ? 404 : 400;
    return reply.code(code).send({ ok: false, error: result.error });
  }
  return { ok: true, packet: result.packet };
});

app.get("/api/exhibit-packets/:packetId/suggestions", async (request, reply) => {
  const { packetId } = request.params as { packetId: string };
  const suggestions = getPacketSuggestions(db, packetId);
  if (!suggestions) {
    return reply.code(404).send({ ok: false, error: "packet not found" });
  }
  return { ok: true, suggestions };
});

app.get("/api/exhibit-packets/:packetId/history", async (request, reply) => {
  const { packetId } = request.params as { packetId: string };
  const history = getPacketHistory(db, packetId);
  if (!history) {
    return reply.code(404).send({ ok: false, error: "packet not found" });
  }
  return { ok: true, history };
});

app.post("/api/exhibit-packets/:packetId/suggestions/:suggestionId/resolve", async (request, reply) => {
  const { packetId, suggestionId } = request.params as { packetId: string; suggestionId: string };
  const body = request.body as { action?: "accept" | "dismiss"; note?: string | null } | undefined;
  if (body?.action !== "accept" && body?.action !== "dismiss") {
    return reply.code(400).send({ ok: false, error: "action must be accept or dismiss" });
  }
  const result = resolveExhibitSuggestion(db, {
    packetId,
    suggestionId,
    action: body.action,
    note: body.note ?? null
  });
  if (!result.ok) {
    const code = /not found/i.test(result.error) ? 404 : 400;
    return reply.code(code).send({ ok: false, error: result.error });
  }
  return { ok: true, packet: result.packet };
});

app.post("/api/exhibit-packets/:packetId/finalize", async (request, reply) => {
  const { packetId } = request.params as { packetId: string };
  const result = finalizeExhibitPacket(db, packetId);
  if (!result) {
    return reply.code(404).send({ ok: false, error: "packet not found" });
  }
  return { ok: true, packet: result.packet, suggestions: result.suggestions, preview: result.preview };
});

app.post("/api/exhibit-packets/:packetId/exports/packet-pdf", async (request, reply) => {
  const { packetId } = request.params as { packetId: string };
  const packetCase = getPacketCaseId(db, packetId);
  if (!packetCase) {
    return reply.code(404).send({ ok: false, error: "packet not found" });
  }
  const layout = parsePacketPdfExportOptions(request.body);
  try {
    const result = await runPacketPdfExport(db, packetId, fetchBoxPdfBytesForSourceItem, layout);
    if (!result.ok) {
      const code = /not found/i.test(result.error) ? 404 : 400;
      return reply.code(code).send({
        ok: false,
        error: result.error,
        export_id: result.exportId ?? null,
        manifest: result.manifest ?? null
      });
    }
    return {
      ok: true,
      export_id: result.exportId,
      page_count: result.pageCount,
      manifest: result.manifest,
      pdf_relative_path: result.relativePdfPath
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return reply.code(500).send({ ok: false, error: message });
  }
});

app.get("/api/exhibit-packets/:packetId/exports", async (request, reply) => {
  const { packetId } = request.params as { packetId: string };
  if (!getPacketCaseId(db, packetId)) {
    return reply.code(404).send({ ok: false, error: "packet not found" });
  }
  return { ok: true, exports: listPacketExportsForPacket(db, packetId) };
});

app.get("/api/exhibit-packet-exports/:exportId", async (request, reply) => {
  const { exportId } = request.params as { exportId: string };
  const row = getPacketExportRow(db, exportId);
  if (!row) {
    return reply.code(404).send({ ok: false, error: "export not found" });
  }
  let manifest: unknown = null;
  if (row.manifest_json) {
    try {
      manifest = JSON.parse(row.manifest_json) as unknown;
    } catch {
      manifest = row.manifest_json;
    }
  }
  return {
    ok: true,
    export: {
      ...row,
      manifest
    }
  };
});

app.get("/api/exhibit-packet-exports/:exportId/pdf", async (request, reply) => {
  const { exportId } = request.params as { exportId: string };
  const row = getPacketExportRow(db, exportId);
  if (!row || row.status !== "complete" || !row.pdf_relative_path) {
    return reply.code(404).send({ ok: false, error: "export PDF not available" });
  }
  const abs = resolveExportAbsolutePath(row.pdf_relative_path);
  try {
    const buf = await readFile(abs);
    reply.header("content-type", "application/pdf");
    reply.header("content-disposition", `attachment; filename="exhibit-packet-${exportId.slice(0, 8)}.pdf"`);
    return reply.send(buf);
  } catch {
    return reply.code(404).send({ ok: false, error: "export file missing on disk" });
  }
});

app.post("/api/cases/:caseId/packet-preview", async (request, reply) => {
  const { caseId } = request.params as { caseId: string };
  const body = request.body as { packet_id?: string } | undefined;
  const caseExists = db.prepare(`SELECT id FROM cases WHERE id = ? LIMIT 1`).get(caseId) as
    | { id: string }
    | undefined;
  if (!caseExists) {
    return reply.code(404).send({ ok: false, error: "case not found" });
  }
  if (!body?.packet_id) {
    return reply.code(400).send({ ok: false, error: "packet_id is required" });
  }
  const packetCase = getPacketCaseId(db, body.packet_id);
  if (!packetCase || packetCase.case_id !== caseId) {
    return reply.code(404).send({ ok: false, error: "packet not found for case" });
  }
  const preview = getPacketPreview(db, body.packet_id);
  if (!preview) {
    return reply.code(404).send({ ok: false, error: "packet not found" });
  }
  return { ok: true, preview };
});

app.post("/api/cases/:caseId/exhibit-list/generate", async (request, reply) => {
  const { caseId } = request.params as { caseId: string };
  const body = request.body as { packet_id?: string } | undefined;
  const caseExists = db.prepare(`SELECT id FROM cases WHERE id = ? LIMIT 1`).get(caseId) as
    | { id: string }
    | undefined;
  if (!caseExists) {
    return reply.code(404).send({ ok: false, error: "case not found" });
  }
  if (!body?.packet_id) {
    return reply.code(400).send({ ok: false, error: "packet_id is required" });
  }
  const packetCase = getPacketCaseId(db, body.packet_id);
  if (!packetCase || packetCase.case_id !== caseId) {
    return reply.code(404).send({ ok: false, error: "packet not found for case" });
  }
  const preview = getPacketPreview(db, body.packet_id);
  if (!preview) {
    return reply.code(404).send({ ok: false, error: "packet not found" });
  }
  const lines = preview.sections.flatMap((section) => {
    const header = `## ${section.section_label}`;
    const entries = section.exhibits.map((exhibit) => {
      const title = exhibit.title?.trim() || "Untitled Exhibit";
      return `- Exhibit ${exhibit.exhibit_label}: ${title} (${exhibit.page_count_estimate} pages)`;
    });
    return [header, ...entries];
  });
  return {
    ok: true,
    packet_id: body.packet_id,
    markdown: lines.join("\n")
  };
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
    files: inventory.files,
    subfolders: inventory.subfolders
  };
});

/**
 * Full authoritative sync: walk all subfolders under root (matter "Client File" or similar),
 * then persist via hydrateBoxInventory. Requires JWT env config.
 */
app.get("/api/connectors/practicepanther/status", async () => {
  const connection = readSourceConnectionByProvider("practicepanther");
  const sanitized = connection
    ? {
        id: connection.id,
        provider: connection.provider,
        account_label: connection.account_label,
        auth_mode: connection.auth_mode,
        status: connection.status,
        external_account_id: connection.external_account_id,
        last_error_message: connection.last_error_message,
        last_verified_at: connection.last_verified_at,
        updated_at: connection.updated_at,
        created_at: connection.created_at
      }
    : null;
  return {
    ok: true,
    configured: isPracticePantherOAuthReady(),
    api_base_url: readPracticePantherConfig().apiBaseUrl,
    redirect_uri: readPracticePantherConfig().redirectUri,
    connection: sanitized
  };
});

app.get("/api/connectors/practicepanther/matters", async (request, reply) => {
  const connection = readSourceConnectionByProvider("practicepanther");
  if (!connection) {
    return reply.code(404).send({ ok: false, error: "practicepanther connection not found" });
  }
  try {
    const { accessToken } = await getValidPracticePantherAccessToken(connection);
    const config = readPracticePantherConfig();
    const query =
      typeof request.query === "object" && request.query !== null ? (request.query as { search_text?: string }).search_text : undefined;
    const matters = await fetchPracticePantherMatters(config, accessToken, {
      searchText: query ?? null
    });
    return { ok: true, matters };
  } catch (error) {
    const message = error instanceof Error ? error.message : "PracticePanther matter list failed";
    markPracticePantherConnectionError(connection.id, message);
    return reply.code(400).send({ ok: false, error: message });
  }
});

app.get("/api/connectors/practicepanther/callback", async (request, reply) => {
  const query = (request.query ?? {}) as { code?: string; state?: string; error?: string; error_description?: string };
  if (!query.state) {
    return reply.code(400).send({ ok: false, error: "state is required" });
  }

  const connection = readSourceConnectionByCallbackState("practicepanther", query.state);
  if (!connection) {
    return reply.code(404).send({ ok: false, error: "source connection not found" });
  }

  const currentMetadata = parsePracticePantherConnectionMetadata(connection.metadata_json);
  const returnTo = currentMetadata.return_to ?? null;

  if (query.error) {
    const message = query.error_description ?? query.error;
    markPracticePantherConnectionError(connection.id, message);
    return reply.redirect(buildPracticePantherCallbackRedirect(returnTo, false, message));
  }
  if (!query.code) {
    markPracticePantherConnectionError(connection.id, "authorization code is required");
    return reply.redirect(buildPracticePantherCallbackRedirect(returnTo, false, "authorization code is required"));
  }

  try {
    const config = readPracticePantherConfig();
    const tokens = await exchangePracticePantherAuthorizationCode(config, query.code);
    const oauthMetadata = mergePracticePantherConnectionMetadata(connection.metadata_json, {
      oauth: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_type: tokens.token_type,
        expires_at: new Date(Date.now() + Math.max(0, tokens.expires_in - 300) * 1000).toISOString()
      }
    });
    const me = await fetchPracticePantherCurrentUser(config, tokens.access_token);
    const finalMetadata = mergePracticePantherConnectionMetadata(JSON.stringify(oauthMetadata), {
      user: {
        id: typeof me.id === "string" ? me.id : null,
        display_name: typeof me.display_name === "string" ? me.display_name : null,
        email: typeof me.email === "string" ? me.email : null
      },
      return_to: null
    });
    completePracticePantherConnection(connection.id, {
      accountLabel: connection.account_label,
      externalAccountId: typeof me.id === "string" ? me.id : null,
      metadata: finalMetadata as Record<string, unknown>
    });
    return reply.redirect(buildPracticePantherCallbackRedirect(returnTo, true));
  } catch (error) {
    const message = error instanceof Error ? error.message : "PracticePanther OAuth callback failed";
    markPracticePantherConnectionError(connection.id, message);
    return reply.redirect(buildPracticePantherCallbackRedirect(returnTo, false, message));
  }
});

app.post("/api/connectors/practicepanther/sync", async (request, reply) => {
  if (!isPracticePantherProductionSyncConfigured()) {
    return reply.code(400).send({
      ok: false,
      error: PRACTICE_PANTHER_SYNC_DEFERRED_MESSAGE,
      configured: false
    });
  }
  const body = request.body as
    | {
        case_id?: string;
        pp_matter_id?: string | null;
        search_text?: string | null;
      }
    | undefined;
  if (!body?.case_id?.trim()) {
    return reply.code(400).send({ ok: false, error: "case_id is required" });
  }

  const caseRow = db
    .prepare(
      `
        SELECT id, pp_matter_id
        FROM cases
        WHERE id = ?
        LIMIT 1
      `
    )
    .get(body.case_id.trim()) as { id: string; pp_matter_id: string | null } | undefined;
  if (!caseRow) {
    return reply.code(404).send({ ok: false, error: "case not found" });
  }

  const connection = readSourceConnectionByProvider("practicepanther");
  if (!connection) {
    return reply.code(404).send({ ok: false, error: "practicepanther connection not found" });
  }

  try {
    const { accessToken } = await getValidPracticePantherAccessToken(connection);
    const config = readPracticePantherConfig();
    const targetMatterId = body.pp_matter_id?.trim() || caseRow.pp_matter_id;
    if (!targetMatterId) {
      return reply.code(400).send({ ok: false, error: "pp_matter_id is required (body or case field)" });
    }

    const matter = await fetchPracticePantherMatterById(config, accessToken, targetMatterId);
    const matterPatch = buildPracticePantherMatterPatch(matter as Record<string, unknown>);

    const patchUpdates: string[] = [];
    const patchParams: unknown[] = [];
    if (matterPatch.ppMatterId) {
      patchUpdates.push("pp_matter_id = ?");
      patchParams.push(matterPatch.ppMatterId);
    }
    if (matterPatch.hearingDate) {
      patchUpdates.push("hearing_date = ?");
      patchParams.push(matterPatch.hearingDate);
    }
    if (matterPatch.employeeName) {
      patchUpdates.push("employee_name = COALESCE(NULLIF(employee_name, ''), ?)");
      patchParams.push(matterPatch.employeeName);
    }
    if (matterPatch.employerName) {
      patchUpdates.push("employer_name = COALESCE(NULLIF(employer_name, ''), ?)");
      patchParams.push(matterPatch.employerName);
    }
    if (matterPatch.insurerName) {
      patchUpdates.push("insurer_name = COALESCE(NULLIF(insurer_name, ''), ?)");
      patchParams.push(matterPatch.insurerName);
    }
    if (patchUpdates.length > 0) {
      patchUpdates.push("updated_at = CURRENT_TIMESTAMP");
      patchParams.push(caseRow.id);
      db.prepare(`UPDATE cases SET ${patchUpdates.join(", ")} WHERE id = ?`).run(...patchParams);
    }

    const matterRecord = matter as Record<string, unknown>;
    const accountId =
      matterRecord.account_ref && typeof matterRecord.account_ref === "object" && matterRecord.account_ref !== null
        ? ((matterRecord.account_ref as { id?: unknown }).id as string | undefined)
        : undefined;

    const ppSpec = getSourceConnectorSpec("practicepanther");
    const previousCursor = readSyncCursorValue(db, {
      sourceConnectionId: connection.id,
      caseId: caseRow.id,
      cursorKey: ppSpec.cursorKey
    });
    const cursorAfter = buildPracticePantherSyncCursorValue();

    const account = accountId ? await fetchPracticePantherAccountById(config, accessToken, accountId) : null;
    const [contacts, notes, tasks, events, emails, callLogs, relationships] = await Promise.all([
      accountId ? fetchPracticePantherContacts(config, accessToken, accountId) : Promise.resolve([]),
      fetchPracticePantherNotes(config, accessToken, targetMatterId, previousCursor),
      fetchPracticePantherTasks(config, accessToken, targetMatterId, previousCursor),
      fetchPracticePantherEvents(config, accessToken, targetMatterId, previousCursor),
      fetchPracticePantherEmails(config, accessToken, targetMatterId, previousCursor),
      fetchPracticePantherCallLogs(config, accessToken, targetMatterId, previousCursor),
      fetchPracticePantherRelationships(config, accessToken, targetMatterId, previousCursor)
    ]);

    const entities = [
      {
        entity_type: "matter",
        pp_entity_id: String(matter.id),
        title:
          (typeof matter.display_name === "string" && matter.display_name) ||
          (typeof matter.name === "string" && matter.name) ||
          null,
        source_updated_at: typeof matter.updated_at === "string" ? matter.updated_at : null,
        raw_json: {
          ...matter,
          name:
            (typeof matter.name === "string" && matter.name) ||
            (typeof matter.display_name === "string" ? matter.display_name : null),
          pp_matter_id: typeof matter.id === "string" ? matter.id : targetMatterId
        },
        custom_fields: extractPracticePantherCustomFields("matter", matter as Record<string, unknown>)
      },
      ...(account
        ? [
            {
              entity_type: "account",
              pp_entity_id: String(account.id),
              title:
                (typeof account.display_name === "string" && account.display_name) ||
                (typeof account.company_name === "string" ? account.company_name : null),
              source_updated_at: typeof account.updated_at === "string" ? account.updated_at : null,
              raw_json: account,
              custom_fields: extractPracticePantherCustomFields("company", account)
            }
          ]
        : []),
      ...contacts.map((contact) => ({
        entity_type: "contact",
        pp_entity_id: String(contact.id),
        title:
          (typeof contact.display_name === "string" && contact.display_name) ||
          (typeof contact.first_name === "string" ? contact.first_name : null),
        source_updated_at: typeof contact.updated_at === "string" ? contact.updated_at : null,
        raw_json: contact,
        custom_fields: extractPracticePantherCustomFields("contact", contact)
      })),
      ...notes.map((note) => ({
        entity_type: "note",
        pp_entity_id: String(note.id),
        title: typeof note.subject === "string" ? note.subject : null,
        source_updated_at: typeof note.updated_at === "string" ? note.updated_at : null,
        raw_json: note
      })),
      ...tasks.map((task) => ({
        entity_type: "task",
        pp_entity_id: String(task.id),
        title: typeof task.subject === "string" ? task.subject : null,
        source_updated_at: typeof task.updated_at === "string" ? task.updated_at : null,
        raw_json: task
      })),
      ...events.map((event) => ({
        entity_type: "event",
        pp_entity_id: String(event.id),
        title: typeof event.subject === "string" ? event.subject : null,
        source_updated_at: typeof event.updated_at === "string" ? event.updated_at : null,
        raw_json: event
      })),
      ...emails.map((email) => ({
        entity_type: "email",
        pp_entity_id: String(email.id),
        title: typeof email.subject === "string" ? email.subject : null,
        source_updated_at: typeof email.updated_at === "string" ? email.updated_at : null,
        raw_json: email
      })),
      ...callLogs.map((callLog) => ({
        entity_type: "calllog",
        pp_entity_id: String(callLog.id),
        title: typeof callLog.subject === "string" ? callLog.subject : null,
        source_updated_at: typeof callLog.updated_at === "string" ? callLog.updated_at : null,
        raw_json: callLog
      })),
      ...relationships.map((relationship) => ({
        entity_type: "relationship",
        pp_entity_id: String(relationship.id),
        title: typeof relationship.name === "string" ? relationship.name : null,
        source_updated_at: typeof relationship.updated_at === "string" ? relationship.updated_at : null,
        raw_json: relationship
      }))
    ];

    const sync = hydratePracticePantherState(db, {
      caseId: caseRow.id,
      accountLabel: connection.account_label ?? "PracticePanther",
      cursorAfter,
      entities
    });

    let contactsPromoted = 0;
    for (const contact of contacts) {
      const c = contact as Record<string, unknown>;
      const ppContactId = typeof c.id === "string" ? c.id : null;
      const displayName = typeof c.display_name === "string" ? c.display_name : null;
      const email = typeof c.email === "string" ? c.email : null;
      const phone = typeof c.phone === "string" ? c.phone : null;
      const company = typeof c.company_name === "string" ? c.company_name : null;
      if (!ppContactId || !displayName) continue;

      const existing = db
        .prepare(`SELECT id FROM case_people WHERE case_id = ? AND pp_contact_id = ? LIMIT 1`)
        .get(caseRow.id, ppContactId) as { id: string } | undefined;
      if (existing) {
        db.prepare(
          `UPDATE case_people SET name = ?, email = COALESCE(?, email), phone = COALESCE(?, phone),
           organization = COALESCE(?, organization) WHERE id = ?`
        ).run(displayName, email, phone, company, existing.id);
      } else {
        db.prepare(
          `INSERT INTO case_people (id, case_id, name, role, organization, email, phone, pp_contact_id)
           VALUES (?, ?, ?, 'contact', ?, ?, ?, ?)`
        ).run(randomUUID(), caseRow.id, displayName, company, email, phone, ppContactId);
      }
      contactsPromoted++;
    }

    for (const rel of relationships) {
      const r = rel as Record<string, unknown>;
      const relName = typeof r.name === "string" ? r.name : typeof r.display_name === "string" ? r.display_name : null;
      const relRole = typeof r.relationship_type === "string" ? r.relationship_type.toLowerCase() : "relationship";
      if (!relName) continue;

      const existingRel = db
        .prepare(`SELECT id FROM case_people WHERE case_id = ? AND name = ? AND role = ? LIMIT 1`)
        .get(caseRow.id, relName, relRole) as { id: string } | undefined;
      if (!existingRel) {
        db.prepare(
          `INSERT INTO case_people (id, case_id, name, role) VALUES (?, ?, ?, ?)`
        ).run(randomUUID(), caseRow.id, relName, relRole);
      }
    }

    return {
      ok: true,
      connection_id: connection.id,
      case_id: caseRow.id,
      pp_matter_id: targetMatterId,
      sync,
      contacts_promoted: contactsPromoted,
      counts: {
        matter: 1,
        account: account ? 1 : 0,
        contacts: contacts.length,
        notes: notes.length,
        tasks: tasks.length,
        events: events.length,
        emails: emails.length,
        calllogs: callLogs.length,
        relationships: relationships.length
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "PracticePanther sync failed";
    markPracticePantherConnectionError(connection.id, message);
    return reply.code(400).send({ ok: false, error: message });
  }
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
  const body = request.body as
    | { account_label?: string; scopes?: string[]; return_to?: string | null }
    | undefined;
  if (!isPracticePantherOAuthReady()) {
    return reply.code(400).send({
      ok: false,
      error: PRACTICE_PANTHER_SYNC_DEFERRED_MESSAGE,
      redirect_uri: readPracticePantherConfig().redirectUri
    });
  }
  const connection = beginSourceConnectionAuth(db, {
    provider: spec.provider,
    accountLabel: body?.account_label ?? spec.defaultAccountLabel,
    scopes: body?.scopes,
    authMode: "oauth_browser"
  });

  const existing = readSourceConnectionByProvider("practicepanther");
  const config = readPracticePantherConfig();
  const authorizationUrl = buildPracticePantherAuthorizationUrl(config, connection.callback_state);
  const mergedMetadata = mergePracticePantherConnectionMetadata(existing?.metadata_json ?? null, {
    return_to: body?.return_to ?? null
  });
  updatePracticePantherAuthStart(connection.id, authorizationUrl, mergedMetadata as Record<string, unknown>);

  reply.send({
    ok: true,
    provider: spec.provider,
    connection_id: connection.id,
    auth_mode: connection.auth_mode,
    status: connection.status,
    authorization_url: authorizationUrl,
    callback_state: connection.callback_state,
    scopes: connection.scopes,
    redirect_uri: config.redirectUri
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
  if (body?.source_item_ids && body.source_item_ids.length > 1000) {
    return reply.code(400).send({ ok: false, error: "source_item_ids may not exceed 1000 items" });
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
  if (body?.canonical_page_ids && body.canonical_page_ids.length > 1000) {
    return reply.code(400).send({ ok: false, error: "canonical_page_ids may not exceed 1000 items" });
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

function resolvePackageExportDir() {
  const env = process.env.WC_EXPORT_DIR?.trim();
  if (env) return env;
  return join(process.cwd(), "data", "exports");
}

function assertCaseExists(
  caseId: string,
  reply: { code: (c: number) => { send: (b: unknown) => unknown } }
): boolean {
  const row = db.prepare(`SELECT id FROM cases WHERE id = ? LIMIT 1`).get(caseId) as { id: string } | undefined;
  if (!row) {
    void reply.code(404).send({ ok: false, error: "case not found" });
    return false;
  }
  return true;
}

// ── Package workbench: uploads, rules, golden examples, retrieval, package runs ─

app.post("/api/cases/:caseId/uploads", async (request, reply) => {
  const { caseId } = request.params as { caseId: string };
  if (!assertCaseExists(caseId, reply)) return;

  const file = await request.file();
  if (!file) {
    return reply.code(400).send({ ok: false, error: "file is required" });
  }
  const buffer = await file.toBuffer();
  const result = await persistCaseUploadAndIngest(db, {
    caseId,
    filename: file.filename || "upload",
    mimeType: file.mimetype,
    buffer
  });
  if (!result.ok) {
    return reply.code(400).send(result);
  }
  return {
    ok: true,
    case_id: caseId,
    source_item_id: result.source_item_id,
    normalization: result.normalization
  };
});

app.get("/api/cases/:caseId/people", async (request, reply) => {
  const { caseId } = request.params as { caseId: string };
  if (!assertCaseExists(caseId, reply)) return;
  const people = db
    .prepare(
      `
        SELECT id, name, role, organization, address, phone, email, pp_contact_id, notes, created_at
        FROM case_people
        WHERE case_id = ?
        ORDER BY name ASC
      `
    )
    .all(caseId);
  return { ok: true, people };
});

app.get("/api/cases/:caseId/timeline", async (request, reply) => {
  const { caseId } = request.params as { caseId: string };
  if (!assertCaseExists(caseId, reply)) return;
  const projection = buildCaseProjection(db, caseId);
  if (!projection) {
    return reply.code(404).send({ ok: false, error: "case not found" });
  }
  return {
    ok: true,
    entries: projection.slices.case_timeline_slice.entries,
    summary: projection.slices.case_timeline_slice.summary
  };
});

app.get("/api/cases/:caseId/package-rules", async (request, reply) => {
  const { caseId } = request.params as { caseId: string };
  const q = request.query as { package_type?: string };
  if (!assertCaseExists(caseId, reply)) return;
  if (!q?.package_type?.trim()) {
    return reply.code(400).send({ ok: false, error: "package_type query parameter is required" });
  }
  const rules = db
    .prepare(
      `
        SELECT * FROM package_rules
        WHERE case_id = ? AND package_type = ?
        ORDER BY sort_order ASC, rule_key ASC
      `
    )
    .all(caseId, q.package_type.trim());
  return { ok: true, rules };
});

app.post("/api/cases/:caseId/package-rules", async (request, reply) => {
  const { caseId } = request.params as { caseId: string };
  const body = request.body as
    | {
        package_type?: string;
        rule_key?: string;
        rule_label?: string;
        instructions?: string;
        sort_order?: number;
      }
    | undefined;
  if (!assertCaseExists(caseId, reply)) return;
  if (!body?.package_type?.trim() || !body.rule_key?.trim() || !body.rule_label?.trim()) {
    return reply.code(400).send({ ok: false, error: "package_type, rule_key, and rule_label are required" });
  }
  const id = randomUUID();
  try {
    db.prepare(
      `
        INSERT INTO package_rules (id, case_id, package_type, rule_key, rule_label, instructions, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      id,
      caseId,
      body.package_type.trim(),
      body.rule_key.trim(),
      body.rule_label.trim(),
      body.instructions?.trim() ?? "",
      body.sort_order ?? 0
    );
  } catch {
    return reply.code(400).send({ ok: false, error: "rule already exists or invalid" });
  }
  const row = db.prepare(`SELECT * FROM package_rules WHERE id = ?`).get(id);
  return { ok: true, rule: row };
});

app.patch("/api/package-rules/:ruleId", async (request, reply) => {
  const { ruleId } = request.params as { ruleId: string };
  const body = request.body as {
    rule_label?: string;
    instructions?: string;
    sort_order?: number;
  };
  const existing = db.prepare(`SELECT case_id FROM package_rules WHERE id = ?`).get(ruleId) as { case_id: string } | undefined;
  if (!existing) {
    return reply.code(404).send({ ok: false, error: "rule not found" });
  }
  const updates: string[] = [];
  const params: Array<string | number | null> = [];
  if (body.rule_label !== undefined) {
    updates.push("rule_label = ?");
    params.push(body.rule_label);
  }
  if (body.instructions !== undefined) {
    updates.push("instructions = ?");
    params.push(body.instructions);
  }
  if (body.sort_order !== undefined) {
    updates.push("sort_order = ?");
    params.push(body.sort_order);
  }
  if (updates.length === 0) {
    return reply.code(400).send({ ok: false, error: "no updates" });
  }
  updates.push("updated_at = CURRENT_TIMESTAMP");
  db.prepare(`UPDATE package_rules SET ${updates.join(", ")} WHERE id = ?`).run(...params, ruleId);
  return { ok: true, rule: db.prepare(`SELECT * FROM package_rules WHERE id = ?`).get(ruleId) };
});

app.delete("/api/package-rules/:ruleId", async (request, reply) => {
  const { ruleId } = request.params as { ruleId: string };
  const run = db.prepare(`DELETE FROM package_rules WHERE id = ?`).run(ruleId);
  if (run.changes === 0) {
    return reply.code(404).send({ ok: false, error: "rule not found" });
  }
  return { ok: true };
});

app.get("/api/cases/:caseId/golden-examples", async (request, reply) => {
  const { caseId } = request.params as { caseId: string };
  const q = request.query as { package_type?: string };
  if (!assertCaseExists(caseId, reply)) return;
  const where = q?.package_type?.trim()
    ? `WHERE (case_id IS NULL OR case_id = ?) AND package_type = ?`
    : `WHERE case_id IS NULL OR case_id = ?`;
  const rows = q?.package_type?.trim()
    ? db.prepare(`SELECT * FROM golden_examples ${where} ORDER BY updated_at DESC`).all(caseId, q.package_type.trim())
    : db.prepare(`SELECT * FROM golden_examples ${where} ORDER BY updated_at DESC`).all(caseId);
  return { ok: true, golden_examples: rows };
});

app.post("/api/cases/:caseId/golden-examples", async (request, reply) => {
  const { caseId } = request.params as { caseId: string };
  const body = request.body as {
    package_type?: string;
    label?: string;
    summary?: string;
    source_item_ids_json?: string;
    metadata_json?: string;
  };
  if (!assertCaseExists(caseId, reply)) return;
  if (!body.package_type?.trim()) {
    return reply.code(400).send({ ok: false, error: "package_type is required" });
  }
  const id = randomUUID();
  db.prepare(
    `
      INSERT INTO golden_examples (id, case_id, package_type, label, summary, source_item_ids_json, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    id,
    caseId,
    body.package_type.trim(),
    body.label?.trim() ?? null,
    body.summary?.trim() ?? null,
    body.source_item_ids_json ?? null,
    body.metadata_json ?? null
  );
  return { ok: true, golden_example: db.prepare(`SELECT * FROM golden_examples WHERE id = ?`).get(id) };
});

app.delete("/api/golden-examples/:exampleId", async (request, reply) => {
  const { exampleId } = request.params as { exampleId: string };
  const run = db.prepare(`DELETE FROM golden_examples WHERE id = ?`).run(exampleId);
  if (run.changes === 0) {
    return reply.code(404).send({ ok: false, error: "not found" });
  }
  return { ok: true };
});

app.post("/api/cases/:caseId/retrieval/test", async (request, reply) => {
  const { caseId } = request.params as { caseId: string };
  const body = request.body as {
    mode?: string;
    package_type?: string;
    source_item_id?: string;
    page_start?: number;
    page_end?: number;
  };
  if (!assertCaseExists(caseId, reply)) return;
  const mode = body.mode ?? "summary";
  const packageType = body.package_type?.trim() ?? "hearing_packet";

  if (mode === "summary") {
    return {
      ok: true,
      mode,
      summaries: gatherDocumentSummaries(db, caseId)
    };
  }
  if ((mode === "document" || mode === "chunk") && body.source_item_id) {
    const ownerCheck = db
      .prepare(`SELECT id FROM source_items WHERE id = ? AND case_id = ? LIMIT 1`)
      .get(body.source_item_id, caseId) as { id: string } | undefined;
    if (!ownerCheck) {
      return reply.code(404).send({ ok: false, error: "source item not found for this case" });
    }
  }
  if (mode === "document" && body.source_item_id) {
    const full = getFullCanonicalTextForSourceItem(db, body.source_item_id);
    return { ok: true, mode, document: full };
  }
  if (mode === "chunk" && body.source_item_id && body.page_start && body.page_end) {
    const chunks = getPageChunks(db, {
      sourceItemId: body.source_item_id,
      pageStart: body.page_start,
      pageEnd: body.page_end
    });
    return { ok: true, mode, chunks };
  }
  if (mode === "bundle") {
    const bundle = buildPackageBundle(db, {
      caseId,
      packageType,
      wholeFileSourceItemIds: body.source_item_id ? [body.source_item_id] : []
    });
    return { ok: true, mode, bundle };
  }
  return reply.code(400).send({ ok: false, error: "invalid mode or missing parameters" });
});

app.post("/api/cases/:caseId/exhibit-packets/:packetId/package-runs", async (request, reply) => {
  const { caseId, packetId } = request.params as { caseId: string; packetId: string };
  const body = request.body as { whole_file_source_item_ids?: string[] } | undefined;
  if (!assertCaseExists(caseId, reply)) return;
  const run = await runPackageWorker(db, {
    caseId,
    packetId,
    wholeFileSourceItemIds: body?.whole_file_source_item_ids
  });
  return { ok: true, run };
});

app.get("/api/exhibit-packets/:packetId/package-runs", async (request, reply) => {
  const { packetId } = request.params as { packetId: string };
  const packetCase = getPacketCaseId(db, packetId);
  if (!packetCase) {
    return reply.code(404).send({ ok: false, error: "packet not found" });
  }
  return { ok: true, runs: listPackageRunsForPacket(db, packetId) };
});

app.get("/api/package-runs/:runId", async (request, reply) => {
  const { runId } = request.params as { runId: string };
  const row = db
    .prepare(
      `
        SELECT pr.*, ep.case_id
        FROM package_runs pr
        JOIN exhibit_packets ep ON ep.id = pr.packet_id
        WHERE pr.id = ?
      `
    )
    .get(runId) as Record<string, unknown> | undefined;
  if (!row) {
    return reply.code(404).send({ ok: false, error: "run not found" });
  }
  return { ok: true, run: row };
});

app.patch("/api/package-runs/:runId", async (request, reply) => {
  const { runId } = request.params as { runId: string };
  const body = request.body as { markdown?: string } | undefined;
  if (typeof body?.markdown !== "string") {
    return reply.code(400).send({ ok: false, error: "markdown is required" });
  }
  const exists = db
    .prepare(`SELECT pr.id FROM package_runs pr WHERE pr.id = ?`)
    .get(runId) as { id: string } | undefined;
  if (!exists) {
    return reply.code(404).send({ ok: false, error: "run not found" });
  }
  const updated = updatePackageRunDraft(db, runId, body.markdown);
  if (!updated) {
    return reply.code(400).send({ ok: false, error: "run not editable or output is not valid JSON" });
  }
  return { ok: true, run: updated };
});

app.post("/api/package-runs/:runId/export-docx", async (request, reply) => {
  const { runId } = request.params as { runId: string };
  const run = getPackageRun(db, runId);
  if (!run || !run.output_json) {
    return reply.code(404).send({ ok: false, error: "run not found or incomplete" });
  }
  let draft = "";
  try {
    const parsed = JSON.parse(run.output_json) as { draft_markdown?: string; edited_draft_markdown?: string };
    draft = parsed.edited_draft_markdown ?? parsed.draft_markdown ?? run.output_json;
  } catch {
    draft = run.output_json;
  }
  const buf = await markdownishToDocxBuffer(draft);
  const dir = resolvePackageExportDir();
  await mkdir(dir, { recursive: true });
  const filename = `package-run-${runId}.docx`;
  const abs = join(dir, filename);
  await writeFile(abs, buf);
  return {
    ok: true,
    path: abs,
    filename,
    bytes: buf.length
  };
});

const port = Number(process.env.PORT ?? 4000);
const host = process.env.WC_API_HOST?.trim() || "127.0.0.1";

// ── AI event configs and jobs ──────────────────────────────────────────────────

app.get("/api/ai/status", async () => ({
  ok: true,
  configured: isAIConfigured()
}));

app.get("/api/cases/:caseId/ai/event-configs", async (request, reply) => {
  const { caseId } = request.params as { caseId: string };
  const caseExists = db.prepare(`SELECT id FROM cases WHERE id = ? LIMIT 1`).get(caseId);
  if (!caseExists) return reply.code(404).send({ ok: false, error: "case not found" });
  return { ok: true, configs: listAIEventConfigs(db, caseId) };
});

app.post("/api/cases/:caseId/ai/event-configs", async (request, reply) => {
  const { caseId } = request.params as { caseId: string };
  const body = request.body as {
    event_type?: string;
    event_label?: string;
    instructions?: string;
    exhibit_strategy_json?: string | null;
  } | undefined;
  const caseExists = db.prepare(`SELECT id FROM cases WHERE id = ? LIMIT 1`).get(caseId);
  if (!caseExists) return reply.code(404).send({ ok: false, error: "case not found" });
  if (!body?.event_type?.trim()) return reply.code(400).send({ ok: false, error: "event_type is required" });
  if (!body?.event_label?.trim()) return reply.code(400).send({ ok: false, error: "event_label is required" });

  const config = upsertAIEventConfig(db, {
    caseId,
    eventType: body.event_type.trim(),
    eventLabel: body.event_label.trim(),
    instructions: body.instructions?.trim() ?? "",
    exhibitStrategyJson: body.exhibit_strategy_json ?? null
  });
  return { ok: true, config };
});

app.delete("/api/cases/:caseId/ai/event-configs/:configId", async (request, reply) => {
  const { configId } = request.params as { configId: string };
  if (!deleteAIEventConfig(db, configId)) {
    return reply.code(404).send({ ok: false, error: "config not found" });
  }
  return { ok: true };
});

app.post("/api/cases/:caseId/ai/assemble", async (request, reply) => {
  const { caseId } = request.params as { caseId: string };
  const body = request.body as { event_type?: string } | undefined;
  const caseExists = db.prepare(`SELECT id FROM cases WHERE id = ? LIMIT 1`).get(caseId);
  if (!caseExists) return reply.code(404).send({ ok: false, error: "case not found" });
  const assemblyEventType = body?.event_type?.trim();
  if (!assemblyEventType) return reply.code(400).send({ ok: false, error: "event_type is required" });

  const configs = listAIEventConfigs(db, caseId);
  const config = configs.find((c) => c.event_type === assemblyEventType);
  if (!config) return reply.code(404).send({ ok: false, error: "no config for this event type" });

  const job = await runAIAssemblyJob(db, { caseId, eventType: assemblyEventType, config });
  return { ok: true, job };
});

app.get("/api/cases/:caseId/ai/jobs", async (request, reply) => {
  const { caseId } = request.params as { caseId: string };
  const caseExists = db.prepare(`SELECT id FROM cases WHERE id = ? LIMIT 1`).get(caseId);
  if (!caseExists) return reply.code(404).send({ ok: false, error: "case not found" });
  return { ok: true, jobs: listAIJobs(db, caseId) };
});

export { app };

if (process.env.WC_SKIP_LISTEN !== "1") {
  try {
    await app.listen({ port, host });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}
