import { afterEach, describe, expect, it } from "vitest";
import { appendPageExtraction } from "../extraction.js";
import { buildCaseProjection } from "../projection.js";
import { hydrateBoxInventory, normalizeCaseDocumentSpine } from "../runtime.js";
import { createSeededTestDb } from "./test-helpers.js";

describe("page_extractions", () => {
  const openDbs: Array<{ close: () => void }> = [];

  afterEach(() => {
    for (const db of openDbs.splice(0)) {
      db.close();
    }
  });

  it("appears on projection extraction_slice", () => {
    const db = createSeededTestDb();
    openDbs.push(db);

    hydrateBoxInventory(db, {
      caseId: "case-extraction",
      files: [{ remote_id: "box-x", filename: "left knee treatment order.pdf" }]
    });
    normalizeCaseDocumentSpine(db, { caseId: "case-extraction", stubPageCount: 1 });

    const page = db.prepare(`SELECT id FROM canonical_pages LIMIT 1`).get() as { id: string };

    const ins = appendPageExtraction(db, {
      canonicalPageId: page.id,
      schemaKey: "wc_stub.v1",
      extractorVersion: "test-1",
      payload: { note: "hello" },
      confidence: 0.9
    });
    expect(ins.ok).toBe(true);

    const projection = buildCaseProjection(db, "case-extraction");
    const rows = projection?.slices.extraction_slice?.extractions ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.schema_key).toBe("wc_stub.v1");
    expect(rows[0]?.payload).toEqual({ note: "hello" });
    expect(projection?.slices.extraction_slice?.summary?.total).toBe(1);
  });
});
