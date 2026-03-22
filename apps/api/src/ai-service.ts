import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import {
  getBlueprintPromptText,
  getBlueprintRetrievalMaxChars,
  isBlueprintRetrievalFlagEnabled,
  resolveBlueprintVersionForPackageType
} from "./blueprints.js";
import { buildPackageBundle, gatherDocumentSummaries } from "./retrieval.js";
import { buildCaseProjection } from "./projection.js";
import { getPacketPreview } from "./exhibits.js";

const DEFAULT_MODEL = "gpt-4o";

function classifyAIError(
  error: unknown,
  fallbackMessage: string
): {
  message: string;
  code: string;
} {
  const message = error instanceof Error && error.message.trim() ? error.message : fallbackMessage;
  const lowerMessage = message.toLowerCase();
  const status =
    error && typeof error === "object" && "status" in error && typeof error.status === "number"
      ? error.status
      : null;
  const providerCode =
    error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code.toLowerCase()
      : null;
  const errorName =
    error && typeof error === "object" && "name" in error && typeof error.name === "string"
      ? error.name.toLowerCase()
      : "";

  if (lowerMessage.includes("openai_api_key not configured")) {
    return { message, code: "missing_api_key" };
  }
  if (
    status === 429 ||
    providerCode === "rate_limit_exceeded" ||
    lowerMessage.includes("rate limit")
  ) {
    return { message, code: "provider_rate_limited" };
  }
  if (
    status === 401 ||
    status === 403 ||
    providerCode === "invalid_api_key" ||
    lowerMessage.includes("incorrect api key") ||
    lowerMessage.includes("unauthorized")
  ) {
    return { message, code: "provider_auth_failed" };
  }
  if (
    providerCode === "context_length_exceeded" ||
    lowerMessage.includes("context length") ||
    lowerMessage.includes("maximum context length")
  ) {
    return { message, code: "context_length_exceeded" };
  }
  if (
    status === 408 ||
    providerCode === "etimedout" ||
    providerCode === "econnreset" ||
    providerCode === "econnrefused" ||
    lowerMessage.includes("timed out") ||
    lowerMessage.includes("connection error") ||
    errorName.includes("apiconnectionerror")
  ) {
    return { message, code: "provider_connection_error" };
  }
  if (status !== null && status >= 500) {
    return { message, code: "provider_server_error" };
  }
  if (status === 400) {
    return { message, code: "invalid_request" };
  }
  return { message, code: "unknown_ai_error" };
}

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

export function isAIConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export interface AIEventConfig {
  id: string;
  case_id: string | null;
  event_type: string;
  event_label: string;
  instructions: string;
  exhibit_strategy_json: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export function listAIEventConfigs(db: Database.Database, caseId: string): AIEventConfig[] {
  return db
    .prepare(
      `
        SELECT * FROM ai_event_configs
        WHERE case_id = ? OR case_id IS NULL
        ORDER BY event_type ASC
      `
    )
    .all(caseId) as AIEventConfig[];
}

export function getAIEventConfig(db: Database.Database, configId: string): AIEventConfig | null {
  return (
    (db.prepare(`SELECT * FROM ai_event_configs WHERE id = ?`).get(configId) as AIEventConfig | undefined) ?? null
  );
}

export function upsertAIEventConfig(
  db: Database.Database,
  input: {
    caseId: string;
    eventType: string;
    eventLabel: string;
    instructions: string;
    exhibitStrategyJson?: string | null;
    enabled?: boolean;
  }
): AIEventConfig {
  const existing = db
    .prepare(`SELECT id FROM ai_event_configs WHERE case_id = ? AND event_type = ?`)
    .get(input.caseId, input.eventType) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `
        UPDATE ai_event_configs
        SET event_label = ?, instructions = ?, exhibit_strategy_json = ?,
            enabled = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
    ).run(
      input.eventLabel,
      input.instructions,
      input.exhibitStrategyJson ?? null,
      input.enabled !== false ? 1 : 0,
      existing.id
    );
    return getAIEventConfig(db, existing.id)!;
  }

  const id = randomUUID();
  db.prepare(
    `
      INSERT INTO ai_event_configs (id, case_id, event_type, event_label, instructions, exhibit_strategy_json, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
  ).run(id, input.caseId, input.eventType, input.eventLabel, input.instructions, input.exhibitStrategyJson ?? null, 1);
  return getAIEventConfig(db, id)!;
}

export function deleteAIEventConfig(db: Database.Database, caseId: string, configId: string): boolean {
  return (
    db.prepare(`DELETE FROM ai_event_configs WHERE id = ? AND case_id = ?`).run(configId, caseId).changes > 0
  );
}

export interface AIJob {
  id: string;
  case_id: string;
  event_type: string;
  status: string;
  input_json: string | null;
  output_json: string | null;
  error_message: string | null;
  error_code: string | null;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export function listAIJobs(db: Database.Database, caseId: string): AIJob[] {
  return db
    .prepare(`SELECT * FROM ai_jobs WHERE case_id = ? ORDER BY created_at DESC LIMIT 50`)
    .all(caseId) as AIJob[];
}

export async function runAIAssemblyJob(
  db: Database.Database,
  input: {
    caseId: string;
    eventType: string;
    config: AIEventConfig;
  }
): Promise<AIJob> {
  const jobId = randomUUID();
  const model = DEFAULT_MODEL;
  const client = getOpenAIClient();

  if (!client) {
    db.prepare(
      `INSERT INTO ai_jobs (id, case_id, event_type, status, error_message, error_code, model) VALUES (?, ?, ?, 'failed', ?, ?, ?)`
    ).run(jobId, input.caseId, input.eventType, "OPENAI_API_KEY not configured", "missing_api_key", model);
    return db.prepare(`SELECT * FROM ai_jobs WHERE id = ?`).get(jobId) as AIJob;
  }

  const caseRow = db
    .prepare(`SELECT name, employee_name, employer_name, insurer_name, hearing_date FROM cases WHERE id = ?`)
    .get(input.caseId) as {
    name: string;
    employee_name: string | null;
    employer_name: string | null;
    insurer_name: string | null;
    hearing_date: string | null;
  } | undefined;

  const documents = gatherDocumentSummaries(db, input.caseId);

  const documentList = documents
    .map(
      (d, i) =>
        `${i + 1}. [${d.source_item_id}] "${d.title}" — type: ${d.document_type_name ?? "unclassified"}, category: ${d.document_category ?? "unknown"}, folder: ${d.folder_path ?? "root"}${d.ocr_text_preview ? `\n   First 200 chars: ${d.ocr_text_preview.slice(0, 200)}` : ""}`
    )
    .join("\n");

  const systemPrompt = `You are a workers' compensation legal assistant helping prepare exhibit packets.

Case: ${caseRow?.name ?? "Unknown"}
Employee: ${caseRow?.employee_name ?? "Unknown"}
Employer: ${caseRow?.employer_name ?? "Unknown"}
Insurer: ${caseRow?.insurer_name ?? "Unknown"}
Hearing date: ${caseRow?.hearing_date ?? "Not set"}
Event type: ${input.eventType} (${input.config.event_label})

Available documents (${documents.length} total):
${documentList}

Your task: Based on the attorney's instructions below, recommend which documents should be assembled as exhibits and in what order. Return a JSON array of exhibit recommendations.

Each recommendation should have:
- "exhibit_label": letter label (A, B, C, ...)
- "title": descriptive exhibit title
- "source_item_ids": array of source_item_id strings to include
- "rationale": brief explanation of why this document is relevant

Only include documents that are genuinely relevant to the event type. Order by importance.`;

  const userPrompt = `Attorney instructions for "${input.config.event_label}":

${input.config.instructions}

${input.config.exhibit_strategy_json ? `\nExhibit strategy: ${input.config.exhibit_strategy_json}` : ""}

Recommend exhibits now. Return only valid JSON: { "exhibits": [...] }`;

  db.prepare(
    `INSERT INTO ai_jobs (id, case_id, event_type, status, input_json, model, started_at)
     VALUES (?, ?, ?, 'running', ?, ?, CURRENT_TIMESTAMP)`
  ).run(jobId, input.caseId, input.eventType, JSON.stringify({ system: systemPrompt, user: userPrompt }), model);

  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 4096
    });

    const content = completion.choices[0]?.message?.content ?? "{}";
    const usage = completion.usage;

    db.prepare(
      `UPDATE ai_jobs
       SET status = 'completed', output_json = ?,
           prompt_tokens = ?, completion_tokens = ?,
           completed_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(content, usage?.prompt_tokens ?? null, usage?.completion_tokens ?? null, jobId);
  } catch (error) {
    const classified = classifyAIError(error, "AI call failed");
    db.prepare(
      `UPDATE ai_jobs SET status = 'failed', error_message = ?, error_code = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(classified.message, classified.code, jobId);
  }

  return db.prepare(`SELECT * FROM ai_jobs WHERE id = ?`).get(jobId) as AIJob;
}

export interface PackageRunRow {
  id: string;
  packet_id: string;
  blueprint_version_id: string | null;
  blueprint_version: string | null;
  blueprint_key: string | null;
  blueprint_name: string | null;
  blueprint_execution_engine: string | null;
  status: string;
  approval_status: string | null;
  approved_at: string | null;
  approved_by: string | null;
  approved_by_user_id: string | null;
  approval_note: string | null;
  input_json: string | null;
  output_json: string | null;
  citations_json: string | null;
  error_message: string | null;
  error_code: string | null;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  retrieval_warnings_json: string | null;
  started_at: string | null;
  completed_at: string | null;
  latest_export_format: string | null;
  latest_export_path: string | null;
  latest_export_bytes: number | null;
  latest_exported_at: string | null;
  created_at: string;
}

const PACKAGE_RUN_SELECT = `
  SELECT
    pr.id,
    pr.packet_id,
    pr.blueprint_version_id,
    pr.status,
    pr.approval_status,
    pr.approved_at,
    pr.approved_by,
    pr.approved_by_user_id,
    pr.approval_note,
    pr.input_json,
    pr.output_json,
    pr.citations_json,
    pr.error_message,
    pr.error_code,
    pr.model,
    pr.prompt_tokens,
    pr.completion_tokens,
    pr.retrieval_warnings_json,
    pr.started_at,
    pr.completed_at,
    pr.latest_export_format,
    pr.latest_export_path,
    pr.latest_export_bytes,
    pr.latest_exported_at,
    pr.created_at,
    bv.version AS blueprint_version,
    b.blueprint_key,
    b.name AS blueprint_name,
    b.execution_engine AS blueprint_execution_engine
  FROM package_runs pr
  LEFT JOIN blueprint_versions bv ON bv.id = pr.blueprint_version_id
  LEFT JOIN blueprints b ON b.id = bv.blueprint_id
`;

export function listPackageRunsForPacket(db: Database.Database, packetId: string): PackageRunRow[] {
  return db
    .prepare(`${PACKAGE_RUN_SELECT} WHERE pr.packet_id = ? ORDER BY pr.created_at DESC LIMIT 100`)
    .all(packetId) as PackageRunRow[];
}

export function getPackageRun(db: Database.Database, runId: string): PackageRunRow | null {
  return (db.prepare(`${PACKAGE_RUN_SELECT} WHERE pr.id = ?`).get(runId) as PackageRunRow | undefined) ?? null;
}

/** Split uploaded interrogatory / RFP text into individual numbered requests (heuristic). Exported for tests. */
export function parseInterrogatoryRequests(text: string): string[] {
  const t = text.replace(/\r\n/g, "\n").trim();
  if (!t) return [];

  const blockSplit = t.split(
    /\n(?=\s*(?:INTERROGATORY\s+NO\.?\s*\d+|INTERROGATORY\s*#\s*\d+|RQ\s*#?\s*\d+|REQUEST\s+NO\.?\s*\d+|\d+\.\s*(?:State|Define|Identify|Describe|List|Produce|Admit|INTERROGATORY|QUESTION)))/gi
  );
  const chunks = blockSplit.map((s) => s.trim()).filter(Boolean);
  if (chunks.length > 1) return chunks;

  const alt = t.split(/\n(?=\s*\d+\.\s+)/);
  const altChunks = alt.map((s) => s.trim()).filter((s) => s.length > 12);
  if (altChunks.length > 1) return altChunks;

  return [t];
}

export function updatePackageRunDraft(db: Database.Database, runId: string, editedMarkdown: string): PackageRunRow | null {
  const run = getPackageRun(db, runId);
  if (!run || run.status !== "completed" || !run.output_json || run.approval_status === "approved") {
    return null;
  }
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(run.output_json) as Record<string, unknown>;
  } catch {
    return null;
  }
  obj.edited_draft_markdown = editedMarkdown;
  db.prepare(`UPDATE package_runs SET output_json = ? WHERE id = ?`).run(JSON.stringify(obj), runId);
  return getPackageRun(db, runId);
}

export function approvePackageRun(
  db: Database.Database,
  input: { runId: string; approvedBy?: string | null; approvedByUserId?: string | null; note?: string | null }
): PackageRunRow | null {
  const run = getPackageRun(db, input.runId);
  if (!run || run.status !== "completed" || !run.output_json) {
    return null;
  }
  db.prepare(
    `
      UPDATE package_runs
      SET approval_status = 'approved',
          approved_at = CURRENT_TIMESTAMP,
          approved_by = ?,
          approved_by_user_id = ?,
          approval_note = ?
      WHERE id = ?
    `
  ).run(input.approvedBy ?? null, input.approvedByUserId ?? null, input.note?.trim() || null, input.runId);
  return getPackageRun(db, input.runId);
}

export async function runPackageWorker(
  db: Database.Database,
  input: {
    caseId: string;
    packetId: string;
    /** Optional: extra source items to include as whole-file context */
    wholeFileSourceItemIds?: string[];
  }
): Promise<PackageRunRow> {
  const runId = randomUUID();
  const client = getOpenAIClient();

  const packet = db
    .prepare(
      `
        SELECT id, case_id, package_type, package_label, target_document_source_item_id, packet_name, blueprint_version_id
        FROM exhibit_packets WHERE id = ? LIMIT 1
      `
    )
    .get(input.packetId) as
    | {
        id: string;
        case_id: string;
        package_type: string;
        package_label: string | null;
        target_document_source_item_id: string | null;
        packet_name: string;
        blueprint_version_id: string | null;
      }
    | undefined;

  if (!packet || packet.case_id !== input.caseId) {
    db.prepare(
      `INSERT INTO package_runs (id, packet_id, status, error_message, error_code, model, completed_at)
       VALUES (?, ?, 'failed', ?, ?, ?, CURRENT_TIMESTAMP)`
    ).run(runId, input.packetId, "packet not found for case", "packet_case_mismatch", DEFAULT_MODEL);
    return getPackageRun(db, runId) as PackageRunRow;
  }

  const blueprint = resolveBlueprintVersionForPackageType(db, packet.package_type, packet.blueprint_version_id);
  const targetId = packet.target_document_source_item_id;
  const wholeIds = [...(input.wholeFileSourceItemIds ?? [])];
  if (
    targetId &&
    isBlueprintRetrievalFlagEnabled(blueprint, "prepend_target_document", true) &&
    !wholeIds.includes(targetId)
  ) {
    wholeIds.unshift(targetId);
  }
  const model = blueprint?.default_model?.trim() || DEFAULT_MODEL;
  const retrievalMaxChars = getBlueprintRetrievalMaxChars(blueprint);
  const bundle = buildPackageBundle(db, {
    caseId: input.caseId,
    packageType: packet.package_type,
    wholeFileSourceItemIds: wholeIds,
    maxChars: retrievalMaxChars,
    includeCaseSummary: isBlueprintRetrievalFlagEnabled(blueprint, "include_case_summary", true),
    includeDocumentSummaries: isBlueprintRetrievalFlagEnabled(blueprint, "include_document_summaries", true),
    includeFullDocuments: isBlueprintRetrievalFlagEnabled(blueprint, "include_full_documents", true),
    includeChunks: isBlueprintRetrievalFlagEnabled(blueprint, "include_chunks", true),
    includePpContext: isBlueprintRetrievalFlagEnabled(blueprint, "include_pp_context", true),
    includePackageRules: isBlueprintRetrievalFlagEnabled(blueprint, "include_package_rules", true),
    includeGoldenExample: isBlueprintRetrievalFlagEnabled(blueprint, "include_golden_example", true)
  });

  const bundleJson = JSON.stringify(bundle);

  if (!client) {
    db.prepare(
      `INSERT INTO package_runs (id, packet_id, blueprint_version_id, status, input_json, error_message, error_code, model, retrieval_warnings_json, completed_at)
       VALUES (?, ?, ?, 'failed', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).run(
      runId,
      input.packetId,
      blueprint?.blueprint_version_id ?? null,
      JSON.stringify({
        packet_id: input.packetId,
        package_type: packet.package_type,
        blueprint_version_id: blueprint?.blueprint_version_id ?? null,
        blueprint_key: blueprint?.blueprint_key ?? null,
        blueprint_version: blueprint?.blueprint_version ?? null
      }),
      "OPENAI_API_KEY not configured",
      "missing_api_key",
      model,
      JSON.stringify(bundle.warnings)
    );
    return getPackageRun(db, runId) as PackageRunRow;
  }

  const systemPrompt = getBlueprintPromptText(blueprint, packet.package_type);
  let discoveryAux = "";
  if (isBlueprintRetrievalFlagEnabled(blueprint, "include_discovery_parse", packet.package_type === "discovery_response")) {
    const joined = bundle.full_documents.map((d) => d.full_text).join("\n\n");
    const parsed = parseInterrogatoryRequests(joined);
    discoveryAux = `\n\nParsed interrogatory/request segments (${parsed.length} segments, heuristic): ${JSON.stringify(parsed.slice(0, 200))}`;
  }
  let hearingAux = "";
  if (isBlueprintRetrievalFlagEnabled(blueprint, "include_hearing_context", packet.package_type === "hearing_packet")) {
    const projection = buildCaseProjection(db, input.caseId);
    const packetPreview = getPacketPreview(db, input.packetId);
    const hearingContext = {
      packet_preview: packetPreview,
      branch_instances: projection?.slices.branch_state_slice?.branch_instances ?? [],
      proof_requirements: projection?.slices.issue_proof_slice?.proof_requirements ?? [],
      people: projection?.slices.case_people_slice?.people ?? [],
      timeline: (projection?.slices.case_timeline_slice?.entries ?? []).slice(0, 40)
    };
    hearingAux = `\n\nHearing packet context (JSON):\n${JSON.stringify(hearingContext).slice(
      0,
      Math.min(JSON.stringify(hearingContext).length, Math.floor(retrievalMaxChars / 2))
    )}`;
  }
  const userPrompt = `Package: ${packet.packet_name} (${packet.package_type})
${packet.package_label ? `Label: ${packet.package_label}\n` : ""}
${blueprint ? `Blueprint: ${blueprint.blueprint_name} (${blueprint.blueprint_version})\n` : ""}Retrieval bundle (JSON):\n${bundleJson.slice(0, Math.min(bundleJson.length, retrievalMaxChars))}${discoveryAux}${hearingAux}`;

  db.prepare(
    `INSERT INTO package_runs (id, packet_id, blueprint_version_id, status, input_json, model, started_at, retrieval_warnings_json)
     VALUES (?, ?, ?, 'running', ?, ?, CURRENT_TIMESTAMP, ?)`
  ).run(
    runId,
    input.packetId,
    blueprint?.blueprint_version_id ?? null,
    JSON.stringify({
      packet_id: input.packetId,
      package_type: packet.package_type,
      blueprint_version_id: blueprint?.blueprint_version_id ?? null,
      blueprint_key: blueprint?.blueprint_key ?? null,
      blueprint_version: blueprint?.blueprint_version ?? null,
      bundle_chars: bundle.approx_char_count
    }),
    model,
    JSON.stringify(bundle.warnings)
  );

  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 8192
    });

    const content = completion.choices[0]?.message?.content ?? "{}";
    const usage = completion.usage;

    let citationsJson: string | null = null;
    try {
      const parsed = JSON.parse(content) as { citations?: unknown };
      citationsJson = parsed.citations !== undefined ? JSON.stringify(parsed.citations) : null;
    } catch {
      citationsJson = null;
    }

    db.prepare(
      `UPDATE package_runs SET status = 'completed', output_json = ?, citations_json = ?,
         prompt_tokens = ?, completion_tokens = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(content, citationsJson, usage?.prompt_tokens ?? null, usage?.completion_tokens ?? null, runId);

    db.prepare(`UPDATE exhibit_packets SET run_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
      "completed",
      input.packetId
    );
  } catch (error) {
    const classified = classifyAIError(error, "package worker failed");
    db.prepare(
      `UPDATE package_runs SET status = 'failed', error_message = ?, error_code = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(classified.message, classified.code, runId);
    db.prepare(`UPDATE exhibit_packets SET run_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
      "failed",
      input.packetId
    );
  }

  return getPackageRun(db, runId) as PackageRunRow;
}

export function recordClassificationSignal(
  db: Database.Database,
  input: {
    sourceItemId: string;
    signalType: string;
    folderPath?: string | null;
    filename?: string | null;
    documentTypeId?: string | null;
    documentTypeName?: string | null;
    exhibitLabel?: string | null;
    actor?: string | null;
  }
) {
  db.prepare(
    `INSERT INTO classification_signals
       (id, source_item_id, signal_type, folder_path, filename, document_type_id, document_type_name, exhibit_label, actor)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    input.sourceItemId,
    input.signalType,
    input.folderPath ?? null,
    input.filename ?? null,
    input.documentTypeId ?? null,
    input.documentTypeName ?? null,
    input.exhibitLabel ?? null,
    input.actor ?? null
  );
}
