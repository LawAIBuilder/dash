import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  deleteAIEventConfig,
  isAIConfigured,
  listAIEventConfigs,
  listAIJobs,
  runAIAssemblyJob,
  runPackageWorker,
  listPackageRunsForPacket,
  getPackageRun,
  updatePackageRunDraft,
  approvePackageRun,
  upsertAIEventConfig
} from "../ai-service.js";
import { markdownishToDocxBuffer } from "../docx-export.js";
import { buildHearingPrepSnapshot } from "../hearing-runner.js";
import {
  buildHistoricalCaseFlow,
  recommendNextHistoricalEvents,
  summarizeHistoricalCaseFlows
} from "../historical-indexer.js";
import { persistCaseUploadAndIngest } from "../matter-upload.js";
import { buildCaseProjection } from "../projection.js";
import {
  buildPackageBundle,
  gatherDocumentSummaries,
  getFullCanonicalTextForSourceItemInCase,
  getPageChunksInCase
} from "../retrieval.js";
import type { CaseRouteReply, HeaderRouteReply } from "./types.js";

export interface RegisterPackageWorkbenchRoutesInput {
  app: FastifyInstance;
  db: Database.Database;
  aiAssembleDailyLimit: number;
  packageExportDailyLimit: number;
  packageRunDailyLimit: number;
  assertCaseExists: (caseId: string, reply: CaseRouteReply) => boolean;
  assertPackageRuleBelongsToCase: (caseId: string, ruleId: string, reply: CaseRouteReply) => boolean;
  assertPackageRunBelongsToCase: (caseId: string, runId: string, reply: CaseRouteReply) => boolean;
  assertPacketBelongsToCase: (caseId: string, packetId: string, reply: CaseRouteReply) => boolean;
  assertSourceItemBelongsToCase: (caseId: string, sourceItemId: string, reply: CaseRouteReply) => boolean;
  assertSourceItemsBelongToCase: (caseId: string, sourceItemIds: string[], reply: CaseRouteReply) => boolean;
  enforceCaseDailyUsageLimit: (
    reply: HeaderRouteReply,
    input: {
      caseId: string;
      counterKey: string;
      limit: number;
      label: string;
    }
  ) => boolean;
  enforceExpensiveRouteRateLimit: (
    request: { ip: string },
    reply: HeaderRouteReply,
    bucket: string
  ) => boolean;
}

function resolvePackageExportDir() {
  const env = process.env.WC_EXPORT_DIR?.trim();
  if (env) return env;
  return join(process.cwd(), "data", "exports");
}

export function registerPackageWorkbenchRoutes(input: RegisterPackageWorkbenchRoutesInput) {
  const {
    app,
    db,
    aiAssembleDailyLimit,
    packageExportDailyLimit,
    packageRunDailyLimit,
    assertCaseExists,
    assertPackageRuleBelongsToCase,
    assertPackageRunBelongsToCase,
    assertPacketBelongsToCase,
    assertSourceItemBelongsToCase,
    assertSourceItemsBelongToCase,
    enforceCaseDailyUsageLimit,
    enforceExpensiveRouteRateLimit
  } = input;

  app.post("/api/cases/:caseId/uploads", async (request, reply) => {
    if (!enforceExpensiveRouteRateLimit(request, reply, "case-upload")) return;
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

  app.get("/api/cases/:caseId/activity", async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    if (!assertCaseExists(caseId, reply)) return;
    const events = db
      .prepare(
        `
          SELECT id, branch_instance_id, preset_id, event_name, source_type, source_id, occurred_at, payload_json, created_at
          FROM case_events
          WHERE case_id = ?
          ORDER BY occurred_at DESC, created_at DESC
          LIMIT 100
        `
      )
      .all(caseId);
    return { ok: true, events };
  });

  app.get("/api/cases/:caseId/hearing-prep", async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const query = request.query as { packet_id?: string } | undefined;
    if (!assertCaseExists(caseId, reply)) return;
    const snapshot = buildHearingPrepSnapshot(db, {
      caseId,
      packetId: query?.packet_id?.trim() || null
    });
    if (!snapshot) {
      return reply.code(404).send({ ok: false, error: "hearing prep snapshot unavailable" });
    }
    return { ok: true, case_id: caseId, snapshot };
  });

  app.get("/api/cases/:caseId/historical-flow", async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    if (!assertCaseExists(caseId, reply)) return;
    return {
      ok: true,
      case_id: caseId,
      events: buildHistoricalCaseFlow(db, caseId)
    };
  });

  app.get("/api/cases/:caseId/historical-recommendations", async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    if (!assertCaseExists(caseId, reply)) return;
    return {
      ok: true,
      case_id: caseId,
      ...recommendNextHistoricalEvents(db, caseId)
    };
  });

  app.get("/api/intelligence/historical-flow-summary", async () => ({
    ok: true,
    summary: summarizeHistoricalCaseFlows(db)
  }));

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

  app.patch("/api/cases/:caseId/package-rules/:ruleId", async (request, reply) => {
    const { caseId, ruleId } = request.params as { caseId: string; ruleId: string };
    const body = request.body as {
      rule_label?: string;
      instructions?: string;
      sort_order?: number;
    };
    if (!assertCaseExists(caseId, reply)) return;
    if (!assertPackageRuleBelongsToCase(caseId, ruleId, reply)) return;
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

  app.delete("/api/cases/:caseId/package-rules/:ruleId", async (request, reply) => {
    const { caseId, ruleId } = request.params as { caseId: string; ruleId: string };
    if (!assertCaseExists(caseId, reply)) return;
    if (!assertPackageRuleBelongsToCase(caseId, ruleId, reply)) return;
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

  app.delete("/api/cases/:caseId/golden-examples/:exampleId", async (request, reply) => {
    const { caseId, exampleId } = request.params as { caseId: string; exampleId: string };
    if (!assertCaseExists(caseId, reply)) return;
    const run = db.prepare(`DELETE FROM golden_examples WHERE id = ? AND case_id = ?`).run(exampleId, caseId);
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
      if (!assertSourceItemBelongsToCase(caseId, body.source_item_id, reply)) {
        return;
      }
    }
    if (mode === "document" && body.source_item_id) {
      const full = getFullCanonicalTextForSourceItemInCase(db, caseId, body.source_item_id);
      return { ok: true, mode, document: full };
    }
    if (mode === "chunk" && body.source_item_id && body.page_start && body.page_end) {
      const chunks = getPageChunksInCase(db, {
        caseId,
        sourceItemId: body.source_item_id,
        pageStart: body.page_start,
        pageEnd: body.page_end
      });
      return { ok: true, mode, chunks };
    }
    if (mode === "bundle") {
      if (body.source_item_id && !assertSourceItemsBelongToCase(caseId, [body.source_item_id], reply)) {
        return;
      }
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
    if (!enforceExpensiveRouteRateLimit(request, reply, "package-run")) return;
    const { caseId, packetId } = request.params as { caseId: string; packetId: string };
    const body = request.body as { whole_file_source_item_ids?: string[] } | undefined;
    if (!assertCaseExists(caseId, reply)) return;
    if (!assertPacketBelongsToCase(caseId, packetId, reply)) return;
    if (body?.whole_file_source_item_ids?.length && !assertSourceItemsBelongToCase(caseId, body.whole_file_source_item_ids, reply)) {
      return;
    }
    if (
      !enforceCaseDailyUsageLimit(reply, {
        caseId,
        counterKey: "package_run",
        limit: packageRunDailyLimit,
        label: "package runs"
      })
    ) {
      return;
    }
    const run = await runPackageWorker(db, {
      caseId,
      packetId,
      wholeFileSourceItemIds: body?.whole_file_source_item_ids
    });
    return { ok: true, run };
  });

  app.get("/api/cases/:caseId/exhibit-packets/:packetId/package-runs", async (request, reply) => {
    const { caseId, packetId } = request.params as { caseId: string; packetId: string };
    if (!assertCaseExists(caseId, reply)) return;
    if (!assertPacketBelongsToCase(caseId, packetId, reply)) return;
    return { ok: true, runs: listPackageRunsForPacket(db, packetId) };
  });

  app.get("/api/cases/:caseId/package-runs/:runId", async (request, reply) => {
    const { caseId, runId } = request.params as { caseId: string; runId: string };
    if (!assertCaseExists(caseId, reply)) return;
    if (!assertPackageRunBelongsToCase(caseId, runId, reply)) return;
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

  app.patch("/api/cases/:caseId/package-runs/:runId", async (request, reply) => {
    const { caseId, runId } = request.params as { caseId: string; runId: string };
    const body = request.body as { markdown?: string } | undefined;
    if (!assertCaseExists(caseId, reply)) return;
    if (!assertPackageRunBelongsToCase(caseId, runId, reply)) return;
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

  app.post("/api/cases/:caseId/package-runs/:runId/approve", async (request, reply) => {
    const { caseId, runId } = request.params as { caseId: string; runId: string };
    const body = request.body as { note?: string } | undefined;
    if (!assertCaseExists(caseId, reply)) return;
    if (!assertPackageRunBelongsToCase(caseId, runId, reply)) return;
    const approvedByHeader = request.headers["x-wc-actor"];
    const approvedBy = typeof approvedByHeader === "string" && approvedByHeader.trim() ? approvedByHeader.trim() : null;
    const updated = approvePackageRun(db, {
      runId,
      approvedBy,
      note: body?.note ?? null
    });
    if (!updated) {
      return reply.code(400).send({ ok: false, error: "run not approvable" });
    }
    return { ok: true, run: updated };
  });

  app.post("/api/cases/:caseId/package-runs/:runId/export-docx", async (request, reply) => {
    if (!enforceExpensiveRouteRateLimit(request, reply, "package-export-docx")) return;
    const { caseId, runId } = request.params as { caseId: string; runId: string };
    if (!assertCaseExists(caseId, reply)) return;
    if (!assertPackageRunBelongsToCase(caseId, runId, reply)) return;
    const run = getPackageRun(db, runId);
    if (!run || !run.output_json) {
      return reply.code(404).send({ ok: false, error: "run not found or incomplete" });
    }
    if (run.approval_status !== "approved") {
      return reply.code(409).send({ ok: false, error: "run must be approved before DOCX export" });
    }
    if (
      !enforceCaseDailyUsageLimit(reply, {
        caseId,
        counterKey: "package_docx_export",
        limit: packageExportDailyLimit,
        label: "package DOCX exports"
      })
    ) {
      return;
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
    db.prepare(
      `
        UPDATE package_runs
        SET latest_export_format = 'docx',
            latest_export_path = ?,
            latest_export_bytes = ?,
            latest_exported_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
    ).run(abs, buf.length, runId);
    return {
      ok: true,
      path: abs,
      filename,
      bytes: buf.length
    };
  });

  app.get("/api/ai/status", async () => ({
    ok: true,
    configured: isAIConfigured()
  }));

  app.get("/api/cases/:caseId/ai/event-configs", async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    if (!assertCaseExists(caseId, reply)) return;
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
    if (!assertCaseExists(caseId, reply)) return;
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
    const { caseId, configId } = request.params as { caseId: string; configId: string };
    if (!deleteAIEventConfig(db, caseId, configId)) {
      return reply.code(404).send({ ok: false, error: "config not found" });
    }
    return { ok: true };
  });

  app.post("/api/cases/:caseId/ai/assemble", async (request, reply) => {
    if (!enforceExpensiveRouteRateLimit(request, reply, "ai-assemble")) return;
    const { caseId } = request.params as { caseId: string };
    const body = request.body as { event_type?: string } | undefined;
    if (!assertCaseExists(caseId, reply)) return;
    const assemblyEventType = body?.event_type?.trim();
    if (!assemblyEventType) return reply.code(400).send({ ok: false, error: "event_type is required" });

    const configs = listAIEventConfigs(db, caseId);
    const config = configs.find((row) => row.event_type === assemblyEventType);
    if (!config) return reply.code(404).send({ ok: false, error: "no config for this event type" });
    if (
      !enforceCaseDailyUsageLimit(reply, {
        caseId,
        counterKey: "ai_assemble",
        limit: aiAssembleDailyLimit,
        label: "AI assembly jobs"
      })
    ) {
      return;
    }

    const job = await runAIAssemblyJob(db, { caseId, eventType: assemblyEventType, config });
    return { ok: true, job };
  });

  app.get("/api/cases/:caseId/ai/jobs", async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    if (!assertCaseExists(caseId, reply)) return;
    return { ok: true, jobs: listAIJobs(db, caseId) };
  });
}
