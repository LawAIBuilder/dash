import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";

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

interface DocumentSummary {
  source_item_id: string;
  title: string | null;
  document_type_name: string | null;
  document_category: string | null;
  folder_path: string | null;
  ocr_text_preview: string | null;
}

function gatherCaseDocumentSummaries(db: Database.Database, caseId: string): DocumentSummary[] {
  const rows = db
    .prepare(
      `
        SELECT
          si.id AS source_item_id,
          si.title,
          si.document_type_name,
          dt.category AS document_category,
          si.parent_remote_id,
          si.raw_json,
          (
            SELECT SUBSTR(cp.raw_text, 1, 500)
            FROM canonical_documents cd
            JOIN canonical_pages cp ON cp.canonical_document_id = cd.id
            WHERE json_extract(si.raw_json, '$.canonical_document_id') = cd.id
            ORDER BY cp.page_number ASC
            LIMIT 1
          ) AS ocr_text_preview
        FROM source_items si
        LEFT JOIN document_types dt ON dt.id = si.document_type_id
        WHERE si.case_id = ? AND si.source_kind = 'file'
        ORDER BY si.title ASC
      `
    )
    .all(caseId) as Array<{
    source_item_id: string;
    title: string | null;
    document_type_name: string | null;
    document_category: string | null;
    parent_remote_id: string | null;
    raw_json: string | null;
    ocr_text_preview: string | null;
  }>;

  return rows.map((row) => {
    let folderPath: string | null = null;
    if (row.raw_json) {
      try {
        const raw = JSON.parse(row.raw_json);
        const pc = raw?.path_collection?.entries;
        if (Array.isArray(pc)) {
          folderPath = pc
            .filter((e: { id?: string; name?: string }) => e.id !== "0")
            .map((e: { name?: string; id?: string }) => e.name ?? e.id ?? "")
            .join("/");
        }
      } catch {}
    }
    return {
      source_item_id: row.source_item_id,
      title: row.title,
      document_type_name: row.document_type_name,
      document_category: row.document_category,
      folder_path: folderPath,
      ocr_text_preview: row.ocr_text_preview
    };
  });
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

  const documents = gatherCaseDocumentSummaries(db, input.caseId);

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
