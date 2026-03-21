import type Database from "better-sqlite3";

/** Soft cap for a single retrieval payload (chars); warn when exceeded */
export const DEFAULT_MAX_RETRIEVAL_CHARS = 120_000;
export const DEFAULT_MAX_PAGES_WHOLE_FILE = 80;

export type RetrievalMode = "summary" | "document" | "chunk" | "bundle";

export interface RetrievalWarning {
  code: string;
  message: string;
}

export interface DocumentSummaryRow {
  source_item_id: string;
  title: string | null;
  document_type_name: string | null;
  document_category: string | null;
  folder_path: string | null;
  ocr_text_preview: string | null;
}

export interface FullDocumentText {
  source_item_id: string;
  title: string | null;
  full_text: string;
  page_count: number;
  truncated: boolean;
}

export interface ChunkRetrievalResult {
  source_item_id: string;
  canonical_page_id: string;
  page_number: number;
  text: string;
}

export interface PpContextBundle {
  contacts: Array<Record<string, unknown>>;
  notes_tasks_events: Array<Record<string, unknown>>;
}

export interface PackageBundlePayload {
  case_summary: Record<string, unknown>;
  document_summaries: DocumentSummaryRow[];
  full_documents: FullDocumentText[];
  chunks: ChunkRetrievalResult[];
  pp_context: PpContextBundle | null;
  package_rules: Array<Record<string, unknown>>;
  golden_example: Record<string, unknown> | null;
  warnings: RetrievalWarning[];
  approx_char_count: number;
}

function extractFolderPath(rawJsonStr: string | null, rootFolderId: string | null): string | null {
  if (!rawJsonStr) return null;
  try {
    const raw = JSON.parse(rawJsonStr) as Record<string, unknown>;
    const pc = raw.path_collection as { entries?: Array<{ id?: string; name?: string }> } | undefined;
    if (!pc?.entries?.length) return null;
    const entries = pc.entries.filter((e) => e.id !== "0" && (!rootFolderId || e.id !== rootFolderId));
    if (entries.length === 0) return null;
    return entries.map((e) => e.name ?? e.id ?? "").join("/");
  } catch {
    return null;
  }
}

export function gatherDocumentSummaries(db: Database.Database, caseId: string): DocumentSummaryRow[] {
  const caseRow = db.prepare(`SELECT box_root_folder_id FROM cases WHERE id = ?`).get(caseId) as
    | { box_root_folder_id: string | null }
    | undefined;
  const boxRoot = caseRow?.box_root_folder_id ?? null;

  const rows = db
    .prepare(
      `
        SELECT
          si.id AS source_item_id,
          si.title,
          si.document_type_name,
          dt.category AS document_category,
          si.raw_json,
          (
            SELECT SUBSTR(cp.raw_text, 1, 500)
            FROM canonical_documents cd
            JOIN canonical_pages cp ON cp.canonical_document_id = cd.id
            WHERE json_extract(si.raw_json, '$.canonical_document_id') = cd.id
            ORDER BY cp.page_number_in_doc ASC
            LIMIT 1
          ) AS ocr_text_preview
        FROM source_items si
        LEFT JOIN document_types dt ON dt.id = si.document_type_id
        WHERE si.case_id = ?
          AND si.source_kind IN ('file', 'attachment', 'upload')
        ORDER BY si.title ASC
      `
    )
    .all(caseId) as Array<{
    source_item_id: string;
    title: string | null;
    document_type_name: string | null;
    document_category: string | null;
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
      } catch {
        folderPath = extractFolderPath(row.raw_json, boxRoot);
      }
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

export function getFullCanonicalTextForSourceItem(
  db: Database.Database,
  sourceItemId: string,
  options?: { maxChars?: number }
): FullDocumentText | null {
  const maxChars = options?.maxChars ?? DEFAULT_MAX_RETRIEVAL_CHARS;
  const meta = db
    .prepare(
      `
        SELECT si.id AS source_item_id, si.title, json_extract(si.raw_json, '$.canonical_document_id') AS canonical_document_id
        FROM source_items si
        WHERE si.id = ?
        LIMIT 1
      `
    )
    .get(sourceItemId) as
    | { source_item_id: string; title: string | null; canonical_document_id: string | null }
    | undefined;
  if (!meta?.canonical_document_id) {
    return null;
  }

  const pages = db
    .prepare(
      `
        SELECT cp.id AS canonical_page_id, cp.page_number_in_doc AS page_number, cp.raw_text
        FROM canonical_pages cp
        WHERE cp.canonical_doc_id = ?
        ORDER BY cp.page_number_in_doc ASC
      `
    )
    .all(meta.canonical_document_id) as Array<{
    canonical_page_id: string;
    page_number: number;
    raw_text: string | null;
  }>;

  const parts: string[] = [];
  let truncated = false;
  let total = 0;
  for (const p of pages) {
    const chunk = `\n--- Page ${p.page_number} ---\n${p.raw_text ?? ""}`;
    if (total + chunk.length > maxChars) {
      const remain = maxChars - total;
      if (remain > 0) {
        parts.push(chunk.slice(0, remain));
      }
      truncated = true;
      break;
    }
    parts.push(chunk);
    total += chunk.length;
  }

  return {
    source_item_id: meta.source_item_id,
    title: meta.title,
    full_text: parts.join("").trim(),
    page_count: pages.length,
    truncated
  };
}

export function getPageChunks(
  db: Database.Database,
  input: { sourceItemId: string; pageStart: number; pageEnd: number }
): ChunkRetrievalResult[] {
  const docId = db
    .prepare(`SELECT json_extract(raw_json, '$.canonical_document_id') AS cid FROM source_items WHERE id = ?`)
    .get(input.sourceItemId) as { cid: string | null } | undefined;
  if (!docId?.cid) {
    return [];
  }
  const rows = db
    .prepare(
      `
        SELECT cp.id AS canonical_page_id, cp.page_number_in_doc AS page_number, cp.raw_text
        FROM canonical_pages cp
        WHERE cp.canonical_doc_id = ?
          AND cp.page_number_in_doc >= ?
          AND cp.page_number_in_doc <= ?
        ORDER BY cp.page_number_in_doc ASC
      `
    )
    .all(docId.cid, input.pageStart, input.pageEnd) as Array<{
    canonical_page_id: string;
    page_number: number;
    raw_text: string | null;
  }>;
  return rows.map((r) => ({
    source_item_id: input.sourceItemId,
    canonical_page_id: r.canonical_page_id,
    page_number: r.page_number,
    text: r.raw_text ?? ""
  }));
}

export function loadPpContextBundle(db: Database.Database, caseId: string): PpContextBundle {
  const people = db
    .prepare(
      `
        SELECT id, name, role, organization, phone, email, notes, pp_contact_id, created_at
        FROM case_people
        WHERE case_id = ?
        ORDER BY name ASC
      `
    )
    .all(caseId) as Array<Record<string, unknown>>;

  const entities = db
    .prepare(
      `
        SELECT id, entity_type, pp_entity_id, source_updated_at, synced_at,
               substr(raw_json, 1, 8000) AS raw_json_preview
        FROM pp_entities_raw
        WHERE case_id = ?
        ORDER BY COALESCE(source_updated_at, synced_at) DESC
        LIMIT 200
      `
    )
    .all(caseId) as Array<Record<string, unknown>>;

  return {
    contacts: people,
    notes_tasks_events: entities
  };
}

export function findClosestGoldenExample(
  db: Database.Database,
  packageType: string,
  caseId: string
): Record<string, unknown> | null {
  const row = db
    .prepare(
      `
        SELECT id, case_id, package_type, label, summary, source_item_ids_json, metadata_json, created_at
        FROM golden_examples
        WHERE package_type = ?
          AND (case_id IS NULL OR case_id = ? OR case_id = '')
        ORDER BY
          CASE WHEN case_id = ? THEN 0 ELSE 1 END,
          updated_at DESC
        LIMIT 1
      `
    )
    .get(packageType, caseId, caseId) as Record<string, unknown> | undefined;
  return row ?? null;
}

export function loadPackageRulesForCase(db: Database.Database, caseId: string, packageType: string) {
  return db
    .prepare(
      `
        SELECT id, case_id, package_type, rule_key, rule_label, instructions, sort_order, created_at, updated_at
        FROM package_rules
        WHERE case_id = ? AND package_type = ?
        ORDER BY sort_order ASC, rule_key ASC
      `
    )
    .all(caseId, packageType) as Array<Record<string, unknown>>;
}

export interface BuildPackageBundleInput {
  caseId: string;
  packageType: string;
  /** For document mode: which source items to expand fully */
  wholeFileSourceItemIds?: string[];
  /** Page ranges per source item for chunk mode */
  chunkRequests?: Array<{ sourceItemId: string; pageStart: number; pageEnd: number }>;
  maxChars?: number;
}

export function buildPackageBundle(db: Database.Database, input: BuildPackageBundleInput): PackageBundlePayload {
  const warnings: RetrievalWarning[] = [];
  const maxChars = input.maxChars ?? DEFAULT_MAX_RETRIEVAL_CHARS;

  const caseRow = db
    .prepare(
      `
        SELECT id, name, employee_name, employer_name, insurer_name, hearing_date, status, pp_matter_id
        FROM cases WHERE id = ?
      `
    )
    .get(input.caseId) as Record<string, unknown> | undefined;

  const summaries = gatherDocumentSummaries(db, input.caseId);
  const fullDocuments: FullDocumentText[] = [];
  let charBudget = maxChars;

  for (const sid of input.wholeFileSourceItemIds ?? []) {
    const perDocCap = Math.min(charBudget, DEFAULT_MAX_RETRIEVAL_CHARS);
    const doc = getFullCanonicalTextForSourceItem(db, sid, { maxChars: perDocCap });
    if (doc) {
      fullDocuments.push(doc);
      charBudget -= doc.full_text.length;
      if (doc.truncated) {
        warnings.push({ code: "truncated_document", message: `Document ${sid} truncated to fit context budget` });
      }
    }
    if (charBudget <= 0) {
      warnings.push({ code: "context_budget", message: "Context character budget exhausted" });
      break;
    }
  }

  const chunks: ChunkRetrievalResult[] = [];
  for (const req of input.chunkRequests ?? []) {
    chunks.push(...getPageChunks(db, req));
  }

  const pp_context = loadPpContextBundle(db, input.caseId);
  const package_rules = loadPackageRulesForCase(db, input.caseId, input.packageType);
  const golden_example = findClosestGoldenExample(db, input.packageType, input.caseId);

  const approx =
    JSON.stringify(summaries).length +
    fullDocuments.reduce((s, d) => s + d.full_text.length, 0) +
    chunks.reduce((s, c) => s + c.text.length, 0) +
    JSON.stringify(pp_context).length +
    JSON.stringify(package_rules).length +
    (golden_example ? JSON.stringify(golden_example).length : 0);

  if (approx > maxChars) {
    warnings.push({
      code: "bundle_large",
      message: `Estimated bundle size ${approx} chars exceeds target ${maxChars}`
    });
  }

  return {
    case_summary: caseRow ?? {},
    document_summaries: summaries,
    full_documents: fullDocuments,
    chunks,
    pp_context,
    package_rules,
    golden_example,
    warnings,
    approx_char_count: approx
  };
}
