import { afterEach, describe, expect, it } from "vitest";
import { runCaseHeuristicExtractions } from "../extraction-runner.js";
import { hydrateBoxInventory, normalizeCaseDocumentSpine } from "../runtime.js";
import { createSeededTestDb } from "./test-helpers.js";

describe("runCaseHeuristicExtractions", () => {
  const openDbs: Array<{ close: () => void }> = [];

  afterEach(() => {
    for (const db of openDbs.splice(0)) {
      db.close();
    }
  });

  it("inserts heuristic rows when raw_text is present and skips on second run", () => {
    const db = createSeededTestDb();
    openDbs.push(db);

    hydrateBoxInventory(db, {
      caseId: "case-heuristics-runner",
      files: [{ remote_id: "box-heur-1", filename: "clinical note.pdf" }]
    });
    normalizeCaseDocumentSpine(db, { caseId: "case-heuristics-runner", stubPageCount: 1 });

    const page = db.prepare(`SELECT id FROM canonical_pages LIMIT 1`).get() as { id: string };
    db.prepare(`UPDATE canonical_pages SET raw_text = ? WHERE id = ?`).run(
      "RE: Follow-up visit MRN: LONGID12345 Account # ACC-998877 on 03/02/2024",
      page.id
    );

    const first = db.transaction(() =>
      runCaseHeuristicExtractions(db, { caseId: "case-heuristics-runner", skipIfExists: true })
    )();
    expect(first.extractions_inserted).toBe(2);

    const second = db.transaction(() =>
      runCaseHeuristicExtractions(db, { caseId: "case-heuristics-runner", skipIfExists: true })
    )();
    expect(second.extractions_inserted).toBe(0);
    expect(second.extractions_skipped).toBe(2);

    const keys = db
      .prepare(`SELECT DISTINCT schema_key FROM page_extractions WHERE canonical_page_id = ? ORDER BY schema_key`)
      .all(page.id) as Array<{ schema_key: string }>;
    expect(keys.map((k) => k.schema_key)).toEqual(["wc_letterhead_dates.v1", "wc_medical_identifiers.v1"]);
  });
});
