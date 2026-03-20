import { afterEach, describe, expect, it } from "vitest";
import { buildCaseProjection } from "../projection.js";
import { hydrateBoxInventory, normalizeCaseDocumentSpine } from "../runtime.js";
import { createSeededTestDb } from "./test-helpers.js";

describe("buildCaseProjection", () => {
  const openDbs: Array<{ close: () => void }> = [];

  afterEach(() => {
    for (const db of openDbs.splice(0)) {
      db.close();
    }
  });

  it("includes source connection state", () => {
    const db = createSeededTestDb();
    openDbs.push(db);

    hydrateBoxInventory(db, {
      caseId: "case-projection-connection",
      cursorAfter: "offset-100",
      files: [{ remote_id: "box-1", filename: "left knee treatment order.pdf" }]
    });

    const projection = buildCaseProjection(db, "case-projection-connection");
    expect(projection).not.toBeNull();

    const connection = projection?.slices.source_connection_slice?.connections[0];
    expect(connection?.provider).toBe("box");
    expect(connection?.status).toBe("active");
    expect(connection?.latest_sync_status).toBe("success");
    expect(connection?.source_item_count).toBe(1);
    expect(connection?.snapshot_count).toBe(1);
  });

  it("reflects canonical spine OCR state", () => {
    const db = createSeededTestDb();
    openDbs.push(db);

    hydrateBoxInventory(db, {
      caseId: "case-projection-canonical",
      files: [{ remote_id: "box-1", filename: "left knee treatment order.pdf" }]
    });
    normalizeCaseDocumentSpine(db, {
      caseId: "case-projection-canonical",
      stubPageCount: 2
    });

    const projection = buildCaseProjection(db, "case-projection-canonical");
    expect(projection).not.toBeNull();

    expect(projection?.slices.canonical_spine_slice?.documents).toHaveLength(1);
    expect(projection?.slices.canonical_spine_slice?.pages).toHaveLength(2);

    const document = projection?.slices.canonical_spine_slice?.documents[0];
    expect(document?.ocr_status).toBe("queued");
    expect(document?.page_count).toBe(2);

    const pages = projection?.slices.canonical_spine_slice?.pages ?? [];
    expect(pages.map((page) => ({ ocr_status: page.ocr_status, extraction_status: page.extraction_status }))).toEqual([
      { ocr_status: "queued", extraction_status: "pending" },
      { ocr_status: "queued", extraction_status: "pending" }
    ]);

    expect(projection?.slices.canonical_spine_slice?.state_summary?.page_state_counts).toEqual({
      processing: 2
    });
  });

  it("reflects classification summary", () => {
    const db = createSeededTestDb();
    openDbs.push(db);

    hydrateBoxInventory(db, {
      caseId: "case-projection-classification",
      files: [
        { remote_id: "box-1", filename: "left knee treatment order.pdf" },
        { remote_id: "box-2", filename: "treating narrative report dr smith.pdf" },
        { remote_id: "box-3", filename: "miscellaneous correspondence.pdf" }
      ]
    });

    const projection = buildCaseProjection(db, "case-projection-classification");
    const summary = projection?.slices.document_inventory_slice.classification_summary;

    expect(summary).toEqual({
      total: 3,
      classified: 2,
      unclassified: 1,
      by_method: {
        alias_match: 2,
        unclassified: 1
      },
      by_category: {
        medical_records: 2,
        uncategorized: 1
      },
      by_hearing_relevance: {
        critical: 2,
        unrated: 1
      },
      exhibit_eligible_count: 2,
      critical_ocr_required: 0
    });
  });

  it("changes the matter version token when source or canonical state changes", () => {
    const db = createSeededTestDb();
    openDbs.push(db);

    hydrateBoxInventory(db, {
      caseId: "case-projection-version",
      files: [{ remote_id: "box-1", filename: "left knee treatment order.pdf" }]
    });

    const firstProjection = buildCaseProjection(db, "case-projection-version");
    expect(firstProjection).not.toBeNull();

    normalizeCaseDocumentSpine(db, {
      caseId: "case-projection-version",
      stubPageCount: 2
    });

    const secondProjection = buildCaseProjection(db, "case-projection-version");
    expect(secondProjection).not.toBeNull();

    expect(secondProjection?.matter_version_token).not.toBe(firstProjection?.matter_version_token);
  });
});
