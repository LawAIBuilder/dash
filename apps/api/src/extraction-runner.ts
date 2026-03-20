import type Database from "better-sqlite3";
import { appendPageExtraction } from "./extraction.js";
import {
  extractLetterheadDatesPayload,
  extractMedicalIdentifiersPayload,
  HEURISTIC_EXTRACTOR_VERSION,
  SCHEMA_WC_LETTERHEAD_DATES,
  SCHEMA_WC_MEDICAL_IDENTIFIERS
} from "./extraction-heuristics.js";

export interface RunCaseHeuristicExtractionsInput {
  caseId: string;
  /** Skip insert when this schema+version already exists for the page */
  skipIfExists?: boolean;
}

export interface RunCaseHeuristicExtractionsResult {
  ok: true;
  case_id: string;
  pages_scanned: number;
  extractions_inserted: number;
  extractions_skipped: number;
}

function hasExistingExtraction(
  db: Database.Database,
  canonicalPageId: string,
  schemaKey: string,
  extractorVersion: string
): boolean {
  const row = db
    .prepare(
      `
        SELECT 1 AS x
        FROM page_extractions
        WHERE canonical_page_id = ?
          AND schema_key = ?
          AND extractor_version = ?
        LIMIT 1
      `
    )
    .get(canonicalPageId, schemaKey, extractorVersion) as { x: number } | undefined;
  return row !== undefined;
}

function heuristicConfidence(payload: Record<string, unknown>): number {
  const dates = payload.dates;
  const mrns = payload.mrns;
  let score = 0;
  if (Array.isArray(dates) && dates.length > 0) {
    score += 0.5;
  }
  if (Array.isArray(payload.re_subjects) && payload.re_subjects.length > 0) {
    score += 0.2;
  }
  if (Array.isArray(mrns) && mrns.length > 0) {
    score += 0.5;
  }
  if (Array.isArray(payload.account_numbers) && payload.account_numbers.length > 0) {
    score += 0.2;
  }
  if (Array.isArray(payload.patient_ids) && payload.patient_ids.length > 0) {
    score += 0.2;
  }
  return Math.min(1, score || 0.05);
}

/**
 * Runs built-in heuristic extractors for every canonical page in the case that has raw_text.
 */
export function runCaseHeuristicExtractions(
  db: Database.Database,
  input: RunCaseHeuristicExtractionsInput
): RunCaseHeuristicExtractionsResult {
  const skipIfExists = input.skipIfExists !== false;
  const caseRow = db.prepare(`SELECT id FROM cases WHERE id = ? LIMIT 1`).get(input.caseId) as { id: string } | undefined;
  if (!caseRow) {
    throw new Error("case not found");
  }

  const pages = db
    .prepare(
      `
        SELECT cp.id, cp.raw_text
        FROM canonical_pages cp
        JOIN canonical_documents cd ON cd.id = cp.canonical_doc_id
        WHERE cd.case_id = ?
          AND cp.raw_text IS NOT NULL
          AND LENGTH(TRIM(cp.raw_text)) > 0
      `
    )
    .all(input.caseId) as Array<{ id: string; raw_text: string }>;

  let inserted = 0;
  let skipped = 0;

  const schemas: Array<{ key: string; build: (t: string) => Record<string, unknown> }> = [
    { key: SCHEMA_WC_LETTERHEAD_DATES, build: extractLetterheadDatesPayload },
    { key: SCHEMA_WC_MEDICAL_IDENTIFIERS, build: extractMedicalIdentifiersPayload }
  ];

  for (const page of pages) {
    const text = page.raw_text;
    for (const { key, build } of schemas) {
      if (skipIfExists && hasExistingExtraction(db, page.id, key, HEURISTIC_EXTRACTOR_VERSION)) {
        skipped += 1;
        continue;
      }
      const payload = build(text);
      const conf = heuristicConfidence(payload);
      const res = appendPageExtraction(db, {
        canonicalPageId: page.id,
        schemaKey: key,
        extractorVersion: HEURISTIC_EXTRACTOR_VERSION,
        payload,
        confidence: conf
      });
      if (res.ok) {
        inserted += 1;
      }
    }
  }

  return {
    ok: true,
    case_id: input.caseId,
    pages_scanned: pages.length,
    extractions_inserted: inserted,
    extractions_skipped: skipped
  };
}
