import multipart from "@fastify/multipart";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Fastify from "fastify";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { openDatabase } from "./db.js";
import { registerCaseDataRoutes } from "./routes/case-data-routes.js";
import { registerConnectorRoutes } from "./routes/connectors-routes.js";
import { registerPackageWorkbenchRoutes } from "./routes/package-workbench-routes.js";
import {
  addExhibitItem,
  createExhibit,
  createExhibitPacket,
  createExhibitSection,
  deleteExhibit,
  deleteExhibitSection,
  finalizeExhibitPacket,
  getCaseExhibitWorkspace,
  getExhibitCaseId,
  getExhibitItemCaseId,
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
  reconcileStalePacketExports,
  resolveExportAbsolutePath,
  runPacketPdfExport
} from "./packet-pdf.js";
import { appendPageExtraction } from "./extraction.js";
import { runCaseHeuristicExtractions } from "./extraction-runner.js";
import {
  createBoxClient,
  downloadBoxFileContent,
  resolveBoxProviderConfig
} from "./box-provider.js";
import { buildCaseProjection } from "./projection.js";
import {
  buildRegressionSummary,
  classifySourceItemByFilename,
  createRunManifest,
  evaluateMedicalRequestBranch,
  ensureCaseScaffold,
  hydrateBoxInventory,
  hydratePracticePantherState,
  normalizeCaseDocumentSpine,
  normalizeSourceItemDocumentSpine,
  queueCaseOcrWork,
  recordCanonicalPageOcrAttempt,
  recordRegressionCheck,
  resolveCanonicalPageOcrReview
} from "./runtime.js";
import { seedFoundation } from "./seed.js";
import { reconcileStaleSyncRuns } from "./sync-lifecycle.js";
import { readWorkerHealth } from "./worker-health.js";
import { buildHearingPrepSnapshot } from "./hearing-runner.js";
import {
  buildHistoricalCaseFlow,
  recommendNextHistoricalEvents,
  summarizeHistoricalCaseFlows
} from "./historical-indexer.js";
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
  updatePackageRunDraft,
  approvePackageRun
} from "./ai-service.js";
import { persistCaseUploadAndIngest } from "./matter-upload.js";
import {
  buildPackageBundle,
  gatherDocumentSummaries,
  getFullCanonicalTextForSourceItemInCase,
  listSourceItemsMissingFromCase,
  getPageChunksInCase
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
import {
  readBooleanEnv,
  readDevRoutesEnabled,
  readPortEnv,
  readPositiveIntegerEnv
} from "./env.js";
import { buildApiErrorResponse } from "./error-response.js";
import { createFixedWindowRateLimiter } from "./rate-limit.js";
import { consumeDailyUsageQuota } from "./usage-counters.js";

const db = openDatabase();
seedFoundation(db);
const startupRecovery = {
  stale_sync_runs_reconciled: reconcileStaleSyncRuns(db),
  stale_packet_exports_reconciled: reconcileStalePacketExports(db)
};

function isPdfLikeAsset(title: string | null, mimeType: string | null, authoritativeAssetUri: string | null) {
  const normalizedMime = mimeType?.trim().toLowerCase() ?? "";
  if (normalizedMime === "application/pdf") {
    return true;
  }
  if (/\.pdf$/i.test(title ?? "")) {
    return true;
  }
  return authoritativeAssetUri?.toLowerCase().includes(".pdf") ?? false;
}

function readSourceItemBinaryContext(sourceItemId: string) {
  return db
    .prepare(
      `
        SELECT
          si.id,
          si.case_id,
          si.provider,
          si.remote_id,
          si.source_kind,
          si.title,
          si.mime_type,
          (
            SELECT sv.authoritative_asset_uri
            FROM source_versions sv
            WHERE sv.source_item_id = si.id
              AND (si.latest_version_token IS NULL OR sv.version_token = si.latest_version_token)
            ORDER BY sv.created_at DESC
            LIMIT 1
          ) AS authoritative_asset_uri
        FROM source_items si
        WHERE si.id = ?
        LIMIT 1
      `
    )
    .get(sourceItemId) as
    | {
        id: string;
        case_id: string;
        provider: string;
        remote_id: string;
        source_kind: string;
        title: string | null;
        mime_type: string | null;
        authoritative_asset_uri: string | null;
      }
    | undefined;
}

async function fetchPdfBytesForSourceItem(sourceItemId: string): Promise<Buffer> {
  const sourceItem = readSourceItemBinaryContext(sourceItemId);
  if (!sourceItem) {
    throw new Error(`source item not found: ${sourceItemId}`);
  }
  if (!isPdfLikeAsset(sourceItem.title, sourceItem.mime_type, sourceItem.authoritative_asset_uri)) {
    throw new Error(`source item "${sourceItem.title ?? sourceItem.id}" is not a PDF and cannot be rendered`);
  }

  if (sourceItem.provider === "box") {
    const config = resolveBoxProviderConfig();
    if (!config) {
      throw new Error("BOX_JWT_CONFIG_JSON or BOX_JWT_CONFIG_FILE must be configured");
    }
    const { client } = createBoxClient(config);
    const buffer = await downloadBoxFileContent(client, sourceItem.remote_id);
    return Buffer.from(buffer);
  }

  if (sourceItem.provider === "matter_upload") {
    if (!sourceItem.authoritative_asset_uri?.startsWith("file:")) {
      throw new Error(`upload source item is missing a readable file asset: ${sourceItem.id}`);
    }
    const buffer = await readFile(new URL(sourceItem.authoritative_asset_uri));
    return Buffer.from(buffer);
  }

  throw new Error(`source item provider "${sourceItem.provider}" is not supported for PDF rendering`);
}

const TRUST_PROXY = readBooleanEnv("WC_TRUST_PROXY", false);
const app = Fastify({ logger: true, trustProxy: TRUST_PROXY });
app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  const response = buildApiErrorResponse(error);
  reply.code(response.statusCode).send(response.body);
});

const configuredOrigins = process.env.WC_CORS_ORIGIN?.split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);
await app.register(cors, {
  origin: configuredOrigins && configuredOrigins.length > 0 ? configuredOrigins : ["http://127.0.0.1:5173", "http://localhost:5173"]
});
await app.register(helmet, {
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
});
await app.register(multipart, {
  limits: {
    fileSize: readPositiveIntegerEnv("WC_UPLOAD_MAX_BYTES", 45 * 1024 * 1024, { min: 1 })
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

const ENABLE_DEV_ROUTES = readDevRoutesEnabled();
const EXPENSIVE_ROUTE_LIMIT_MAX = readPositiveIntegerEnv("WC_EXPENSIVE_ROUTE_LIMIT_MAX", 25, {
  min: 1,
  max: 100
});
const EXPENSIVE_ROUTE_LIMIT_WINDOW_MS = readPositiveIntegerEnv("WC_EXPENSIVE_ROUTE_LIMIT_WINDOW_MS", 60_000, {
  min: 1_000,
  max: 15 * 60_000
});
const AI_ASSEMBLE_DAILY_LIMIT = readPositiveIntegerEnv("WC_AI_ASSEMBLE_DAILY_LIMIT", 25, {
  min: 1,
  max: 1_000
});
const PACKAGE_RUN_DAILY_LIMIT = readPositiveIntegerEnv("WC_PACKAGE_RUN_DAILY_LIMIT", 40, {
  min: 1,
  max: 1_000
});
const PACKAGE_EXPORT_DAILY_LIMIT = readPositiveIntegerEnv("WC_PACKAGE_EXPORT_DAILY_LIMIT", 60, {
  min: 1,
  max: 2_000
});
const PACKET_PDF_EXPORT_DAILY_LIMIT = readPositiveIntegerEnv("WC_PACKET_PDF_EXPORT_DAILY_LIMIT", 40, {
  min: 1,
  max: 2_000
});
const expensiveRouteLimiter = createFixedWindowRateLimiter({
  max: EXPENSIVE_ROUTE_LIMIT_MAX,
  windowMs: EXPENSIVE_ROUTE_LIMIT_WINDOW_MS
});

function enforceExpensiveRouteRateLimit(
  request: { ip: string },
  reply: { header: (name: string, value: string | number) => unknown; code: (c: number) => { send: (b: unknown) => unknown } },
  bucket: string
): boolean {
  const result = expensiveRouteLimiter.check(`${bucket}:${request.ip}`);
  reply.header("x-rate-limit-limit", result.limit);
  reply.header("x-rate-limit-remaining", result.remaining);
  if (!result.allowed) {
    reply.header("retry-after", result.retryAfterSeconds);
    void reply.code(429).send({
      ok: false,
      error: "Too many expensive requests. Please retry shortly."
    });
    return false;
  }
  return true;
}

function enforceCaseDailyUsageLimit(
  reply: {
    header: (name: string, value: string | number) => unknown;
    code: (c: number) => { send: (b: unknown) => unknown };
  },
  input: {
    caseId: string;
    counterKey: string;
    limit: number;
    label: string;
  }
): boolean {
  const result = consumeDailyUsageQuota(db, {
    caseId: input.caseId,
    counterKey: input.counterKey,
    limit: input.limit
  });
  reply.header("x-case-usage-limit", result.limit);
  reply.header("x-case-usage-remaining", result.remaining);
  if (!result.allowed) {
    reply.header("retry-after", result.retryAfterSeconds);
    void reply.code(429).send({
      ok: false,
      code: "daily_case_quota_exceeded",
      error: `Daily case quota reached for ${input.label}. Please retry tomorrow.`
    });
    return false;
  }
  return true;
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
  seeded_at_startup: true,
  startup_recovery: startupRecovery
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

registerConnectorRoutes({
  app,
  db,
  enableDevRoutes: ENABLE_DEV_ROUTES,
  enforceExpensiveRouteRateLimit
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

function requirePacketForCase(
  caseId: string,
  packetId: string,
  reply: { code: (n: number) => { send: (b: unknown) => unknown } }
) {
  const packetCase = getPacketCaseId(db, packetId);
  if (!packetCase || packetCase.case_id !== caseId) {
    reply.code(404).send({ ok: false, error: "packet not found" });
    return false;
  }
  return true;
}

function requireSectionForCase(
  caseId: string,
  sectionId: string,
  reply: { code: (n: number) => { send: (b: unknown) => unknown } }
) {
  const sectionCase = getSectionCaseId(db, sectionId);
  if (!sectionCase || sectionCase.case_id !== caseId) {
    reply.code(404).send({ ok: false, error: "section not found" });
    return false;
  }
  return true;
}

function requireExhibitForCase(
  caseId: string,
  exhibitId: string,
  reply: { code: (n: number) => { send: (b: unknown) => unknown } }
) {
  const exhibitCase = getExhibitCaseId(db, exhibitId);
  if (!exhibitCase || exhibitCase.case_id !== caseId) {
    reply.code(404).send({ ok: false, error: "exhibit not found" });
    return false;
  }
  return true;
}

function requireExhibitItemForCase(
  caseId: string,
  itemId: string,
  reply: { code: (n: number) => { send: (b: unknown) => unknown } }
) {
  const itemCase = getExhibitItemCaseId(db, itemId);
  if (!itemCase || itemCase.case_id !== caseId) {
    reply.code(404).send({ ok: false, error: "exhibit item not found" });
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

app.patch("/api/cases/:caseId/exhibit-packets/:packetId", async (request, reply) => {
  const { caseId, packetId } = request.params as { caseId: string; packetId: string };
  if (!requirePacketForCase(caseId, packetId, reply)) return;
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
    const statusCode = updated.error === "packet not found" ? 404 : 400;
    return reply.code(statusCode).send({ ok: false, error: updated.error });
  }
  if (!updated) {
    return reply.code(404).send({ ok: false, error: "packet not found" });
  }

  return { ok: true, packet: updated };
});

app.post("/api/cases/:caseId/exhibit-packets/:packetId/sections", async (request, reply) => {
  const { caseId, packetId } = request.params as { caseId: string; packetId: string };
  if (!requirePacketForCase(caseId, packetId, reply)) return;
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

app.post("/api/cases/:caseId/exhibit-packets/:packetId/sections/reorder", async (request, reply) => {
  const { caseId, packetId } = request.params as { caseId: string; packetId: string };
  if (!requirePacketForCase(caseId, packetId, reply)) return;
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

app.post("/api/cases/:caseId/exhibit-sections/:sectionId/exhibits/reorder", async (request, reply) => {
  const { caseId, sectionId } = request.params as { caseId: string; sectionId: string };
  if (!requireSectionForCase(caseId, sectionId, reply)) return;
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

app.patch("/api/cases/:caseId/exhibit-sections/:sectionId", async (request, reply) => {
  const { caseId, sectionId } = request.params as { caseId: string; sectionId: string };
  if (!requireSectionForCase(caseId, sectionId, reply)) return;
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

app.delete("/api/cases/:caseId/exhibit-sections/:sectionId", async (request, reply) => {
  const { caseId, sectionId } = request.params as { caseId: string; sectionId: string };
  if (!requireSectionForCase(caseId, sectionId, reply)) return;
  const packet = deleteExhibitSection(db, sectionId);
  if (!packet) {
    return reply.code(404).send({ ok: false, error: "section not found" });
  }
  return { ok: true, packet };
});

app.post("/api/cases/:caseId/exhibit-sections/:sectionId/exhibits", async (request, reply) => {
  const { caseId, sectionId } = request.params as { caseId: string; sectionId: string };
  if (!requireSectionForCase(caseId, sectionId, reply)) return;
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

app.patch("/api/cases/:caseId/exhibits/:exhibitId", async (request, reply) => {
  const { caseId, exhibitId } = request.params as { caseId: string; exhibitId: string };
  if (!requireExhibitForCase(caseId, exhibitId, reply)) return;
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

app.delete("/api/cases/:caseId/exhibits/:exhibitId", async (request, reply) => {
  const { caseId, exhibitId } = request.params as { caseId: string; exhibitId: string };
  if (!requireExhibitForCase(caseId, exhibitId, reply)) return;
  const packet = deleteExhibit(db, exhibitId);
  if (!packet) {
    return reply.code(404).send({ ok: false, error: "exhibit not found" });
  }
  return { ok: true, packet };
});

app.post("/api/cases/:caseId/exhibits/:exhibitId/items", async (request, reply) => {
  const { caseId, exhibitId } = request.params as { caseId: string; exhibitId: string };
  if (!requireExhibitForCase(caseId, exhibitId, reply)) return;
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

app.delete("/api/cases/:caseId/exhibit-items/:itemId", async (request, reply) => {
  const { caseId, itemId } = request.params as { caseId: string; itemId: string };
  if (!requireExhibitItemForCase(caseId, itemId, reply)) return;
  const packet = removeExhibitItem(db, itemId);
  if (!packet) {
    return reply.code(404).send({ ok: false, error: "exhibit item not found" });
  }
  return { ok: true, packet };
});

app.patch("/api/cases/:caseId/exhibit-items/:itemId/page-rules", async (request, reply) => {
  const { caseId, itemId } = request.params as { caseId: string; itemId: string };
  if (!requireExhibitItemForCase(caseId, itemId, reply)) return;
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

app.get("/api/cases/:caseId/exhibit-packets/:packetId/suggestions", async (request, reply) => {
  const { caseId, packetId } = request.params as { caseId: string; packetId: string };
  if (!requirePacketForCase(caseId, packetId, reply)) return;
  const suggestions = getPacketSuggestions(db, packetId);
  if (!suggestions) {
    return reply.code(404).send({ ok: false, error: "packet not found" });
  }
  return { ok: true, suggestions };
});

app.get("/api/cases/:caseId/exhibit-packets/:packetId/history", async (request, reply) => {
  const { caseId, packetId } = request.params as { caseId: string; packetId: string };
  if (!requirePacketForCase(caseId, packetId, reply)) return;
  const history = getPacketHistory(db, packetId);
  if (!history) {
    return reply.code(404).send({ ok: false, error: "packet not found" });
  }
  return { ok: true, history };
});

app.post("/api/cases/:caseId/exhibit-packets/:packetId/suggestions/:suggestionId/resolve", async (request, reply) => {
  const { caseId, packetId, suggestionId } = request.params as { caseId: string; packetId: string; suggestionId: string };
  if (!requirePacketForCase(caseId, packetId, reply)) return;
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

app.post("/api/cases/:caseId/exhibit-packets/:packetId/finalize", async (request, reply) => {
  const { caseId, packetId } = request.params as { caseId: string; packetId: string };
  if (!requirePacketForCase(caseId, packetId, reply)) return;
  const result = finalizeExhibitPacket(db, packetId);
  if (!result) {
    return reply.code(404).send({ ok: false, error: "packet not found" });
  }
  return { ok: true, packet: result.packet, suggestions: result.suggestions, preview: result.preview };
});

app.post("/api/cases/:caseId/exhibit-packets/:packetId/exports/packet-pdf", async (request, reply) => {
  if (!enforceExpensiveRouteRateLimit(request, reply, "packet-pdf-export")) return;
  const { caseId, packetId } = request.params as { caseId: string; packetId: string };
  const packetCase = getPacketCaseId(db, packetId);
  if (!packetCase || packetCase.case_id !== caseId) {
    return reply.code(404).send({ ok: false, error: "packet not found" });
  }
  if (
    !enforceCaseDailyUsageLimit(reply, {
      caseId,
      counterKey: "packet_pdf_export",
      limit: PACKET_PDF_EXPORT_DAILY_LIMIT,
      label: "packet PDF exports"
    })
  ) {
    return;
  }
  const layout = parsePacketPdfExportOptions(request.body);
  try {
    const result = await runPacketPdfExport(db, packetId, fetchPdfBytesForSourceItem, layout);
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

app.get("/api/cases/:caseId/exhibit-packets/:packetId/exports", async (request, reply) => {
  const { caseId, packetId } = request.params as { caseId: string; packetId: string };
  const packetCase = getPacketCaseId(db, packetId);
  if (!packetCase || packetCase.case_id !== caseId) {
    return reply.code(404).send({ ok: false, error: "packet not found" });
  }
  return { ok: true, exports: listPacketExportsForPacket(db, packetId) };
});

app.get("/api/cases/:caseId/exhibit-packet-exports/:exportId", async (request, reply) => {
  const { caseId, exportId } = request.params as { caseId: string; exportId: string };
  const row = getPacketExportRow(db, exportId);
  if (!row || row.case_id !== caseId) {
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

app.get("/api/cases/:caseId/exhibit-packet-exports/:exportId/pdf", async (request, reply) => {
  const { caseId, exportId } = request.params as { caseId: string; exportId: string };
  const row = getPacketExportRow(db, exportId);
  if (!row || row.case_id !== caseId || row.status !== "complete" || !row.pdf_relative_path) {
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

function assertPacketBelongsToCase(
  caseId: string,
  packetId: string,
  reply: { code: (c: number) => { send: (b: unknown) => unknown } }
): boolean {
  const packetCaseId = getPacketCaseId(db, packetId);
  if (!packetCaseId || packetCaseId.case_id !== caseId) {
    void reply.code(404).send({ ok: false, error: "packet not found for this case" });
    return false;
  }
  return true;
}

function resolvePackageRunCaseId(runId: string): string | null {
  const row = db
    .prepare(
      `
        SELECT ep.case_id
        FROM package_runs pr
        JOIN exhibit_packets ep ON ep.id = pr.packet_id
        WHERE pr.id = ?
        LIMIT 1
      `
    )
    .get(runId) as { case_id: string } | undefined;
  return row?.case_id ?? null;
}

function assertPackageRunBelongsToCase(
  caseId: string,
  runId: string,
  reply: { code: (c: number) => { send: (b: unknown) => unknown } }
): boolean {
  const runCaseId = resolvePackageRunCaseId(runId);
  if (!runCaseId || runCaseId !== caseId) {
    void reply.code(404).send({ ok: false, error: "package run not found for this case" });
    return false;
  }
  return true;
}

function resolvePackageRuleCaseId(ruleId: string): string | null {
  const row = db.prepare(`SELECT case_id FROM package_rules WHERE id = ? LIMIT 1`).get(ruleId) as
    | { case_id: string }
    | undefined;
  return row?.case_id ?? null;
}

function assertPackageRuleBelongsToCase(
  caseId: string,
  ruleId: string,
  reply: { code: (c: number) => { send: (b: unknown) => unknown } }
): boolean {
  const ruleCaseId = resolvePackageRuleCaseId(ruleId);
  if (!ruleCaseId || ruleCaseId !== caseId) {
    void reply.code(404).send({ ok: false, error: "rule not found for this case" });
    return false;
  }
  return true;
}

function assertSourceItemsBelongToCase(
  caseId: string,
  sourceItemIds: string[],
  reply: { code: (c: number) => { send: (b: unknown) => unknown } }
): boolean {
  const missingIds = listSourceItemsMissingFromCase(db, caseId, sourceItemIds);
  if (missingIds.length > 0) {
    void reply.code(404).send({ ok: false, error: "source item not found for this case" });
    return false;
  }
  return true;
}

function resolveSourceItemCaseId(sourceItemId: string): string | null {
  const row = db.prepare(`SELECT case_id FROM source_items WHERE id = ? LIMIT 1`).get(sourceItemId) as
    | { case_id: string }
    | undefined;
  return row?.case_id ?? null;
}

function assertSourceItemBelongsToCase(
  caseId: string,
  sourceItemId: string,
  reply: { code: (c: number) => { send: (b: unknown) => unknown } }
): boolean {
  const sourceItemCaseId = resolveSourceItemCaseId(sourceItemId);
  if (!sourceItemCaseId || sourceItemCaseId !== caseId) {
    void reply.code(404).send({ ok: false, error: "source item not found for this case" });
    return false;
  }
  return true;
}

function resolveCanonicalPageCaseId(canonicalPageId: string): string | null {
  const row = db
    .prepare(
      `
        SELECT cd.case_id
        FROM canonical_pages cp
        JOIN canonical_documents cd ON cd.id = cp.canonical_doc_id
        WHERE cp.id = ?
        LIMIT 1
      `
    )
    .get(canonicalPageId) as { case_id: string } | undefined;
  return row?.case_id ?? null;
}

function assertCanonicalPageBelongsToCase(
  caseId: string,
  canonicalPageId: string,
  reply: { code: (c: number) => { send: (b: unknown) => unknown } }
): boolean {
  const canonicalPageCaseId = resolveCanonicalPageCaseId(canonicalPageId);
  if (!canonicalPageCaseId || canonicalPageCaseId !== caseId) {
    void reply.code(404).send({ ok: false, error: "canonical page not found for this case" });
    return false;
  }
  return true;
}

registerPackageWorkbenchRoutes({
  app,
  db,
  aiAssembleDailyLimit: AI_ASSEMBLE_DAILY_LIMIT,
  packageExportDailyLimit: PACKAGE_EXPORT_DAILY_LIMIT,
  packageRunDailyLimit: PACKAGE_RUN_DAILY_LIMIT,
  assertCaseExists,
  assertPackageRuleBelongsToCase,
  assertPackageRunBelongsToCase,
  assertPacketBelongsToCase,
  assertSourceItemBelongsToCase,
  assertSourceItemsBelongToCase,
  enforceCaseDailyUsageLimit,
  enforceExpensiveRouteRateLimit
});

registerCaseDataRoutes({
  app,
  db,
  assertCanonicalPageBelongsToCase,
  assertCaseExists,
  assertSourceItemBelongsToCase,
  enforceExpensiveRouteRateLimit,
  fetchPdfBytesForSourceItem,
  isPdfLikeAsset,
  readSourceItemBinaryContext
});

const port = readPortEnv(4000);
const host = process.env.WC_API_HOST?.trim() || "127.0.0.1";

export { app };

if (process.env.WC_SKIP_LISTEN !== "1") {
  try {
    await app.listen({ port, host });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}
