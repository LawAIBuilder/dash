import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { buildPackageBundle, DEFAULT_MAX_RETRIEVAL_CHARS, gatherDocumentSummaries } from "./retrieval.js";

const DEFAULT_MODEL = "gpt-4o";

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

export function deleteAIEventConfig(db: Database.Database, configId: string): boolean {
  return db.prepare(`DELETE FROM ai_event_configs WHERE id = ?`).run(configId).changes > 0;
}

export interface AIJob {
  id: string;
  case_id: string;
  event_type: string;
  status: string;
  input_json: string | null;
  output_json: string | null;
  error_message: string | null;
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
      `INSERT INTO ai_jobs (id, case_id, event_type, status, error_message, model) VALUES (?, ?, ?, 'failed', ?, ?)`
    ).run(jobId, input.caseId, input.eventType, "OPENAI_API_KEY not configured", model);
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
    const message = error instanceof Error ? error.message : "AI call failed";
    db.prepare(
      `UPDATE ai_jobs SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(message, jobId);
  }

  return db.prepare(`SELECT * FROM ai_jobs WHERE id = ?`).get(jobId) as AIJob;
}

export interface PackageRunRow {
  id: string;
  packet_id: string;
  status: string;
  input_json: string | null;
  output_json: string | null;
  citations_json: string | null;
  error_message: string | null;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  retrieval_warnings_json: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export function listPackageRunsForPacket(db: Database.Database, packetId: string): PackageRunRow[] {
  return db
    .prepare(`SELECT * FROM package_runs WHERE packet_id = ? ORDER BY created_at DESC LIMIT 100`)
    .all(packetId) as PackageRunRow[];
}

export function getPackageRun(db: Database.Database, runId: string): PackageRunRow | null {
  return (db.prepare(`SELECT * FROM package_runs WHERE id = ?`).get(runId) as PackageRunRow | undefined) ?? null;
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

function packetWorkerSystemPrompt(packageType: string): string {
  if (packageType === "claim_petition") {
    return `You are a Minnesota workers' compensation paralegal/attorney assistant. The Workers' Compensation Court of Appeals (WCCA) and Office of Administrative Hearings (OAH) filing context applies. Draft ONLY from the retrieval bundle JSON (case_summary, document_summaries, full_documents, pp_context, package_rules). Do not invent facts, dates, providers, or docket numbers.

Output a single JSON object with keys:
- draft_markdown (string): combined draft in markdown with sections --- Cover letter ---, --- Claim petition ---, and optional --- Intervention notice ---, --- Affidavit of service --- when rules/package_rules indicate.
- citations (array of { claim: string, source_item_id: string|null, canonical_page_id: string|null, page_text_excerpt: string }): one entry per material factual assertion tied to a source.
- qa_checklist (array of { check_id: string, label: string, status: "pass"|"fail"|"warn", detail: string }): include medical_causation_document_present (warn if no treating/narrative support found), required_filing_elements (pass/fail), intervention_if_applicable, affidavit_if_required.
- assembly_recommendations (array of { title: string, source_item_ids: string[], rationale: string }): suggested exhibits to attach.
- missing_proof (array of { item: string, severity: "blocker"|"warn" }): e.g. missing medical causation narrative, missing NOID, etc.

Use Minnesota WC practice framing (not California). Cite every factual claim.`;
  }
  if (packageType === "discovery_response") {
    return `You are a Minnesota workers' compensation attorney assistant. The uploaded interrogatories or requests for production appear as full text in the retrieval bundle (full_documents). Use ONLY the bundle for facts; flag gaps honestly.

Output a single JSON object with keys:
- draft_markdown (string): markdown with a clear subsection per numbered interrogatory/request (use the same numbering as the discovery set). For each, give a concise proposed response and standard objections where appropriate (relevance, privilege, overbreadth, vagueness) when supported by the rules and facts.
- interrogatory_parse (array of { index: number, label: string, summary: string }): mirror the machine-parsed list you receive in the user message; refine labels if needed.
- citations (same shape as claim_petition).
- qa_checklist (array of { check_id, label, status: "pass"|"fail"|"warn", detail }): include per-request weak_support flags.
- assembly_recommendations (same shape as claim_petition).
- objection_flags (array of { request_index: number, objection: string, basis: string }).

Mark weakly supported answers with qa_checklist status "warn".`;
  }
  return `You are a Minnesota workers' compensation legal assistant helping prepare exhibit/hearing packets. Output valid JSON with keys: exhibits (array of { exhibit_label, title, source_item_ids, rationale }), citations (array of { claim, source_item_id, canonical_page_id, page_text_excerpt }), qa_checklist (array of { check_id, label, status: pass|fail|warn, detail }), draft_markdown (optional hearing summary or exhibit overview). Ground answers in the retrieval bundle only.`;
}

export function updatePackageRunDraft(db: Database.Database, runId: string, editedMarkdown: string): PackageRunRow | null {
  const run = getPackageRun(db, runId);
  if (!run || run.status !== "completed" || !run.output_json) {
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

export async function runPackageWorker(
  db: Database.Database,
  input: {
    caseId: string;
    packetId: string;
    /** Optional: extra source items to include as whole-file context */
    wholeFileSourceItemIds?: string[];
  }
): Promise<PackageRunRow> {
  const model = DEFAULT_MODEL;
  const runId = randomUUID();
  const client = getOpenAIClient();

  const packet = db
    .prepare(
      `
        SELECT id, case_id, package_type, package_label, target_document_source_item_id, packet_name
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
      }
    | undefined;

  if (!packet || packet.case_id !== input.caseId) {
    db.prepare(
      `INSERT INTO package_runs (id, packet_id, status, error_message, model, completed_at)
       VALUES (?, ?, 'failed', ?, ?, CURRENT_TIMESTAMP)`
    ).run(runId, input.packetId, "packet not found for case", model);
    return db.prepare(`SELECT * FROM package_runs WHERE id = ?`).get(runId) as PackageRunRow;
  }

  const targetId = packet.target_document_source_item_id;
  const wholeIds = [...(input.wholeFileSourceItemIds ?? [])];
  if (targetId && !wholeIds.includes(targetId)) {
    wholeIds.unshift(targetId);
  }

  const bundle = buildPackageBundle(db, {
    caseId: input.caseId,
    packageType: packet.package_type,
    wholeFileSourceItemIds: wholeIds,
    maxChars: DEFAULT_MAX_RETRIEVAL_CHARS
  });

  const bundleJson = JSON.stringify(bundle);

  if (!client) {
    db.prepare(
      `INSERT INTO package_runs (id, packet_id, status, input_json, error_message, model, retrieval_warnings_json, completed_at)
       VALUES (?, ?, 'failed', ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).run(
      runId,
      input.packetId,
      JSON.stringify({ packet_id: input.packetId, package_type: packet.package_type }),
      "OPENAI_API_KEY not configured",
      model,
      JSON.stringify(bundle.warnings)
    );
    return db.prepare(`SELECT * FROM package_runs WHERE id = ?`).get(runId) as PackageRunRow;
  }

  const systemPrompt = packetWorkerSystemPrompt(packet.package_type);
  let discoveryAux = "";
  if (packet.package_type === "discovery_response") {
    const joined = bundle.full_documents.map((d) => d.full_text).join("\n\n");
    const parsed = parseInterrogatoryRequests(joined);
    discoveryAux = `\n\nParsed interrogatory/request segments (${parsed.length} segments, heuristic): ${JSON.stringify(parsed.slice(0, 200))}`;
  }
  const userPrompt = `Package: ${packet.packet_name} (${packet.package_type})
${packet.package_label ? `Label: ${packet.package_label}\n` : ""}
Retrieval bundle (JSON):\n${bundleJson.slice(0, Math.min(bundleJson.length, DEFAULT_MAX_RETRIEVAL_CHARS))}${discoveryAux}`;

  db.prepare(
    `INSERT INTO package_runs (id, packet_id, status, input_json, model, started_at, retrieval_warnings_json)
     VALUES (?, ?, 'running', ?, ?, CURRENT_TIMESTAMP, ?)`
  ).run(
    runId,
    input.packetId,
    JSON.stringify({ packet_id: input.packetId, package_type: packet.package_type, bundle_chars: bundle.approx_char_count }),
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
    const message = error instanceof Error ? error.message : "package worker failed";
    db.prepare(
      `UPDATE package_runs SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(message, runId);
    db.prepare(`UPDATE exhibit_packets SET run_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
      "failed",
      input.packetId
    );
  }

  return db.prepare(`SELECT * FROM package_runs WHERE id = ?`).get(runId) as PackageRunRow;
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
