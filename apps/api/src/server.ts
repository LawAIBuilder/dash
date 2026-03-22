import multipart from "@fastify/multipart";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Fastify from "fastify";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { openDatabase } from "./db.js";
import { registerCaseCatalogRoutes } from "./routes/case-catalog-routes.js";
import { createCaseRouteGuards } from "./routes/case-guards.js";
import { registerCaseDataRoutes } from "./routes/case-data-routes.js";
import { registerConnectorRoutes } from "./routes/connectors-routes.js";
import { registerDocumentTemplateRoutes } from "./routes/document-template-routes.js";
import { registerExhibitRoutes } from "./routes/exhibit-routes.js";
import { registerOpsRoutes } from "./routes/ops-routes.js";
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

registerOpsRoutes({
  app,
  db,
  startupRecovery
});

registerConnectorRoutes({
  app,
  db,
  enableDevRoutes: ENABLE_DEV_ROUTES,
  enforceExpensiveRouteRateLimit
});

registerCaseCatalogRoutes({
  app,
  db,
  assertCaseExists,
  ensureCaseScaffold
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
