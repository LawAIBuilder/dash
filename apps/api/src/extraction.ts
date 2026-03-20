import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export interface AppendPageExtractionInput {
  canonicalPageId: string;
  schemaKey: string;
  extractorVersion: string;
  payload: Record<string, unknown>;
  confidence?: number | null;
}

export function appendPageExtraction(db: Database.Database, input: AppendPageExtractionInput) {
  const page = db
    .prepare(`SELECT id FROM canonical_pages WHERE id = ? LIMIT 1`)
    .get(input.canonicalPageId) as { id: string } | undefined;
  if (!page) {
    return { ok: false as const, error: "canonical page not found" as const };
  }

  const id = randomUUID();
  db.prepare(
    `
      INSERT INTO page_extractions
        (id, canonical_page_id, schema_key, extractor_version, payload_json, confidence)
      VALUES
        (?, ?, ?, ?, ?, ?)
    `
  ).run(
    id,
    input.canonicalPageId,
    input.schemaKey,
    input.extractorVersion,
    JSON.stringify(input.payload),
    input.confidence ?? null
  );

  return { ok: true as const, extraction_id: id };
}
