import { afterEach, describe, expect, it } from "vitest";
import { hydrateBoxInventory, normalizeCaseDocumentSpine } from "../runtime.js";
import { createSeededTestDb, createThrowingJsonValue } from "./test-helpers.js";

describe("hydrateBoxInventory", () => {
  const openDbs: Array<{ close: () => void }> = [];

  afterEach(() => {
    for (const db of openDbs.splice(0)) {
      db.close();
    }
  });

  it("creates source items with classification and updates branch proof state", () => {
    const db = createSeededTestDb();
    openDbs.push(db);

    const result = hydrateBoxInventory(db, {
      caseId: "case-box-classification",
      files: [
        { remote_id: "box-1", filename: "left knee treatment order.pdf" },
        { remote_id: "box-2", filename: "treating narrative report dr smith.pdf" },
        { remote_id: "box-3", filename: "miscellaneous correspondence.pdf" }
      ]
    });

    const counts = db.prepare(
      `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN document_type_name IS NOT NULL THEN 1 ELSE 0 END) AS classified,
          SUM(CASE WHEN document_type_name IS NULL THEN 1 ELSE 0 END) AS unclassified
        FROM source_items
        WHERE case_id = ?
      `
    ).get("case-box-classification") as {
      total: number;
      classified: number;
      unclassified: number;
    };

    expect(counts).toEqual({
      total: 3,
      classified: 2,
      unclassified: 1
    });
    expect(result.branch_state?.currentStageKey).toBe("core_treating_proof_located");

    const proofRows = db.prepare(
      `
        SELECT requirement_key, satisfied
        FROM proof_requirements pr
        JOIN issues i ON i.id = pr.issue_id
        WHERE i.case_id = ?
        ORDER BY requirement_key ASC
      `
    ).all("case-box-classification") as Array<{
      requirement_key: string;
      satisfied: number;
    }>;

    expect(proofRows).toEqual([
      { requirement_key: "Narrative Report", satisfied: 1 },
      { requirement_key: "Office Note", satisfied: 0 },
      { requirement_key: "Treatment Order", satisfied: 1 }
    ]);
  });

  it("normalizes through to canonical spine with OCR queued", () => {
    const db = createSeededTestDb();
    openDbs.push(db);

    hydrateBoxInventory(db, {
      caseId: "case-box-normalize",
      files: [{ remote_id: "box-1", filename: "left knee treatment order.pdf" }]
    });

    const normalizeResult = normalizeCaseDocumentSpine(db, {
      caseId: "case-box-normalize",
      stubPageCount: 2
    });

    expect(normalizeResult.normalized_count).toBe(1);

    const counts = db.prepare(
      `
        SELECT
          (SELECT COUNT(*) FROM logical_documents WHERE case_id = ?) AS logical_count,
          (SELECT COUNT(*) FROM canonical_documents WHERE case_id = ?) AS canonical_count,
          (SELECT COUNT(*)
             FROM canonical_pages cp
             JOIN canonical_documents cd ON cd.id = cp.canonical_doc_id
            WHERE cd.case_id = ?) AS page_count
      `
    ).get("case-box-normalize", "case-box-normalize", "case-box-normalize") as {
      logical_count: number;
      canonical_count: number;
      page_count: number;
    };

    expect(counts).toEqual({
      logical_count: 1,
      canonical_count: 1,
      page_count: 2
    });

    const pageStatuses = db.prepare(
      `
        SELECT cp.ocr_status, cp.extraction_status
        FROM canonical_pages cp
        JOIN canonical_documents cd ON cd.id = cp.canonical_doc_id
        WHERE cd.case_id = ?
        ORDER BY cp.page_number_in_doc ASC
      `
    ).all("case-box-normalize") as Array<{
      ocr_status: string;
      extraction_status: string;
    }>;

    expect(pageStatuses).toEqual([
      { ocr_status: "queued", extraction_status: "pending" },
      { ocr_status: "queued", extraction_status: "pending" }
    ]);

    const documentStatus = db.prepare(
      `
        SELECT ocr_status, ingestion_status, page_count
        FROM canonical_documents
        WHERE case_id = ?
        LIMIT 1
      `
    ).get("case-box-normalize") as
      | {
          ocr_status: string;
          ingestion_status: string;
          page_count: number;
        }
      | undefined;

    expect(documentStatus).toEqual({
      ocr_status: "queued",
      ingestion_status: "ocr_in_progress",
      page_count: 2
    });
  });

  it("advances the Box sync cursor", () => {
    const db = createSeededTestDb();
    openDbs.push(db);

    const result = hydrateBoxInventory(db, {
      caseId: "case-box-cursor",
      cursorAfter: "offset-100",
      files: [{ remote_id: "box-1", filename: "left knee treatment order.pdf" }]
    });

    const cursor = db.prepare(
      `
        SELECT cursor_value
        FROM sync_cursors
        WHERE source_connection_id = ?
          AND case_id = ?
          AND cursor_key = 'box_inventory_cursor'
        LIMIT 1
      `
    ).get(result.source_connection_id, "case-box-cursor") as { cursor_value: string } | undefined;

    expect(cursor?.cursor_value).toBe("offset-100");

    const syncRun = db.prepare(
      `
        SELECT status, cursor_after
        FROM sync_runs
        WHERE id = ?
        LIMIT 1
      `
    ).get(result.sync_run_id) as
      | {
          status: string;
          cursor_after: string | null;
        }
      | undefined;

    expect(syncRun).toEqual({
      status: "success",
      cursor_after: "offset-100"
    });
  });

  it("records a partial failure snapshot on orchestrator error", () => {
    const db = createSeededTestDb();
    openDbs.push(db);

    expect(() =>
      hydrateBoxInventory(db, {
        caseId: "case-box-failure",
        files: [
          { remote_id: "box-1", filename: "left knee treatment order.pdf" },
          {
            remote_id: "box-2",
            filename: "treating narrative report dr smith.pdf",
            raw_json: {
              explode: createThrowingJsonValue("Box persistence failure")
            }
          }
        ]
      })
    ).toThrow("Box persistence failure");

    const syncRun = db.prepare(
      `
        SELECT status, error_message
        FROM sync_runs
        WHERE case_id = ?
        ORDER BY started_at DESC
        LIMIT 1
      `
    ).get("case-box-failure") as
      | {
          status: string;
          error_message: string | null;
        }
      | undefined;

    expect(syncRun?.status).toBe("failed");
    expect(syncRun?.error_message).toBe("Box persistence failure");

    const connection = db.prepare(
      `
        SELECT status, last_error_message
        FROM source_connections
        WHERE provider = 'box'
        LIMIT 1
      `
    ).get() as
      | {
          status: string;
          last_error_message: string | null;
        }
      | undefined;

    expect(connection?.status).toBe("error");
    expect(connection?.last_error_message).toBe("Box persistence failure");

    const snapshots = db.prepare(
      `
        SELECT snapshot_type, manifest_json
        FROM source_snapshots
        WHERE case_id = ?
        ORDER BY created_at ASC
      `
    ).all("case-box-failure") as Array<{
      snapshot_type: string;
      manifest_json: string;
    }>;

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.snapshot_type).toBe("box_inventory");

    const manifest = JSON.parse(snapshots[0]?.manifest_json ?? "{}") as {
      item_count: number;
      items: Array<{ remote_id: string }>;
      partial: boolean;
      error_message: string;
    };

    expect(manifest.item_count).toBe(1);
    expect(manifest.items).toEqual([{ remote_id: "box-1", source_item_id: expect.any(String), title: "left knee treatment order.pdf" }]);
    expect(manifest.partial).toBe(true);
    expect(manifest.error_message).toBe("Box persistence failure");
  });
});
