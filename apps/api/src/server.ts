import multipart from "@fastify/multipart";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Fastify from "fastify";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { openDatabase } from "./db.js";
import { createCaseRouteGuards } from "./routes/case-guards.js";
import { registerCaseDataRoutes } from "./routes/case-data-routes.js";
import { registerConnectorRoutes } from "./routes/connectors-routes.js";
import { registerDocumentTemplateRoutes } from "./routes/document-template-routes.js";
import { registerExhibitRoutes } from "./routes/exhibit-routes.js";
import { registerPackageWorkbenchRoutes } from "./routes/package-workbench-routes.js";
import { reconcileStalePacketExports } from "./packet-pdf.js";
import {
  createBoxClient,
  downloadBoxFileContent,
  resolveBoxProviderConfig
} from "./box-provider.js";
import { ensureCaseScaffold } from "./runtime.js";
import { seedFoundation } from "./seed.js";
import { reconcileStaleSyncRuns } from "./sync-lifecycle.js";
import { readWorkerHealth } from "./worker-health.js";
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

const {
  assertCanonicalPageBelongsToCase,
  assertCaseExists,
  assertExhibitBelongsToCase,
  assertExhibitItemBelongsToCase,
  assertPackageRuleBelongsToCase,
  assertPackageRunBelongsToCase,
  assertPacketBelongsToCase,
  assertSectionBelongsToCase,
  assertSourceItemBelongsToCase,
  assertSourceItemsBelongToCase
} = createCaseRouteGuards(db);

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

registerExhibitRoutes({
  app,
  db,
  packetPdfExportDailyLimit: PACKET_PDF_EXPORT_DAILY_LIMIT,
  assertCaseExists,
  assertPacketBelongsToCase,
  assertSectionBelongsToCase,
  assertExhibitBelongsToCase,
  assertExhibitItemBelongsToCase,
  enforceCaseDailyUsageLimit,
  enforceExpensiveRouteRateLimit,
  fetchPdfBytesForSourceItem
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

registerDocumentTemplateRoutes({
  app,
  db,
  assertCaseExists
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
