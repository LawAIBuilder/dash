import { describe, expect, it } from "vitest";
import { createSeededTestDb } from "./test-helpers.js";
import { hydrateBoxInventory, normalizeCaseDocumentSpine } from "../runtime.js";
import {
  buildPackageBundle,
  gatherDocumentSummaries,
  getFullCanonicalTextForSourceItem,
  getFullCanonicalTextForSourceItemInCase,
  getPageChunks,
  getPageChunksInCase
} from "../retrieval.js";

describe("gatherDocumentSummaries", () => {
  it("returns OCR preview text from canonical_pages", () => {
    const db = createSeededTestDb();

    hydrateBoxInventory(db, {
      caseId: "case-retrieval-preview",
      files: [{ remote_id: "box-1", filename: "left knee treatment order.pdf" }]
    });

    normalizeCaseDocumentSpine(db, {
      caseId: "case-retrieval-preview",
      stubPageCount: 1
    });

    const canonicalPage = db.prepare(
      `
        SELECT cp.id
        FROM canonical_pages cp
        JOIN canonical_documents cd ON cd.id = cp.canonical_doc_id
        WHERE cd.case_id = ?
        LIMIT 1
      `
    ).get("case-retrieval-preview") as { id: string } | undefined;

    expect(canonicalPage?.id).toBeTruthy();

    db.prepare(`UPDATE canonical_pages SET raw_text = ? WHERE id = ?`).run(
      "This treatment order supports the requested relief and should appear in retrieval summaries.",
      canonicalPage!.id
    );

    const summaries = gatherDocumentSummaries(db, "case-retrieval-preview");
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.ocr_text_preview).toContain("requested relief");

    db.close();
  });

  it("skips whole-file source items from other cases when building package bundles", () => {
    const db = createSeededTestDb();

    hydrateBoxInventory(db, {
      caseId: "case-bundle-a",
      files: [{ remote_id: "bundle-a-1", filename: "employee report.pdf" }]
    });
    hydrateBoxInventory(db, {
      caseId: "case-bundle-b",
      files: [{ remote_id: "bundle-b-1", filename: "other case report.pdf" }]
    });

    normalizeCaseDocumentSpine(db, {
      caseId: "case-bundle-a",
      stubPageCount: 1
    });
    normalizeCaseDocumentSpine(db, {
      caseId: "case-bundle-b",
      stubPageCount: 1
    });

    const otherCaseSourceItem = db
      .prepare(`SELECT id FROM source_items WHERE case_id = ? LIMIT 1`)
      .get("case-bundle-b") as { id: string } | undefined;

    expect(otherCaseSourceItem?.id).toBeTruthy();

    const bundle = buildPackageBundle(db, {
      caseId: "case-bundle-a",
      packageType: "hearing_packet",
      wholeFileSourceItemIds: [otherCaseSourceItem!.id]
    });

    expect(bundle.full_documents).toHaveLength(0);
    expect(bundle.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "skipped_source_item_case_mismatch"
        })
      ])
    );

    db.close();
  });

  it("enforces case ownership in the retrieval helper and only expands owned documents", () => {
    const db = createSeededTestDb();

    hydrateBoxInventory(db, {
      caseId: "case-owned-document",
      files: [{ remote_id: "owned-doc-1", filename: "owned report.pdf" }]
    });
    hydrateBoxInventory(db, {
      caseId: "case-other-document",
      files: [{ remote_id: "other-doc-1", filename: "other report.pdf" }]
    });

    normalizeCaseDocumentSpine(db, {
      caseId: "case-owned-document",
      stubPageCount: 1
    });
    normalizeCaseDocumentSpine(db, {
      caseId: "case-other-document",
      stubPageCount: 1
    });

    const ownedSourceItem = db
      .prepare(`SELECT id FROM source_items WHERE case_id = ? LIMIT 1`)
      .get("case-owned-document") as { id: string } | undefined;
    const otherSourceItem = db
      .prepare(`SELECT id FROM source_items WHERE case_id = ? LIMIT 1`)
      .get("case-other-document") as { id: string } | undefined;

    expect(ownedSourceItem?.id).toBeTruthy();
    expect(otherSourceItem?.id).toBeTruthy();

    const unconstrainedRead = getFullCanonicalTextForSourceItem(db, otherSourceItem!.id);
    expect(unconstrainedRead?.source_item_id).toBe(otherSourceItem!.id);

    const blockedRead = getFullCanonicalTextForSourceItemInCase(db, "case-owned-document", otherSourceItem!.id);
    expect(blockedRead).toBeNull();

    const allowedRead = getFullCanonicalTextForSourceItemInCase(db, "case-owned-document", ownedSourceItem!.id);
    expect(allowedRead?.source_item_id).toBe(ownedSourceItem!.id);

    const bundle = buildPackageBundle(db, {
      caseId: "case-owned-document",
      packageType: "hearing_packet",
      wholeFileSourceItemIds: [ownedSourceItem!.id, otherSourceItem!.id]
    });

    expect(bundle.full_documents).toHaveLength(1);
    expect(bundle.full_documents[0]?.source_item_id).toBe(ownedSourceItem!.id);
    expect(bundle.full_documents.some((doc) => doc.source_item_id === otherSourceItem!.id)).toBe(false);
    expect(bundle.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "skipped_source_item_case_mismatch"
        })
      ])
    );

    db.close();
  });

  it("normalizes reversed page ranges when chunk retrieval bounds are swapped", () => {
    const db = createSeededTestDb();

    hydrateBoxInventory(db, {
      caseId: "case-chunk-range",
      files: [{ remote_id: "chunk-range-1", filename: "multi page report.pdf" }]
    });

    normalizeCaseDocumentSpine(db, {
      caseId: "case-chunk-range",
      stubPageCount: 3
    });

    const sourceItem = db
      .prepare(`SELECT id FROM source_items WHERE case_id = ? LIMIT 1`)
      .get("case-chunk-range") as { id: string } | undefined;
    expect(sourceItem?.id).toBeTruthy();

    const pages = db
      .prepare(
        `
          SELECT cp.id, cp.page_number_in_doc
          FROM canonical_pages cp
          JOIN canonical_documents cd ON cd.id = cp.canonical_doc_id
          WHERE cd.case_id = ?
          ORDER BY cp.page_number_in_doc ASC
        `
      )
      .all("case-chunk-range") as Array<{ id: string; page_number_in_doc: number }>;
    expect(pages).toHaveLength(3);

    for (const page of pages) {
      db.prepare(`UPDATE canonical_pages SET raw_text = ? WHERE id = ?`).run(`Page ${page.page_number_in_doc} body`, page.id);
    }

    const chunks = getPageChunks(db, {
      sourceItemId: sourceItem!.id,
      pageStart: 3,
      pageEnd: 2
    });

    expect(chunks.map((chunk) => chunk.page_number)).toEqual([2, 3]);
    expect(chunks.map((chunk) => chunk.text)).toEqual(["Page 2 body", "Page 3 body"]);

    db.close();
  });

  it("blocks page chunk retrieval across case boundaries in the in-case helper", () => {
    const db = createSeededTestDb();

    hydrateBoxInventory(db, {
      caseId: "case-owned-chunk",
      files: [{ remote_id: "owned-chunk-1", filename: "owned chunk report.pdf" }]
    });
    hydrateBoxInventory(db, {
      caseId: "case-other-chunk",
      files: [{ remote_id: "other-chunk-1", filename: "other chunk report.pdf" }]
    });

    normalizeCaseDocumentSpine(db, {
      caseId: "case-owned-chunk",
      stubPageCount: 2
    });
    normalizeCaseDocumentSpine(db, {
      caseId: "case-other-chunk",
      stubPageCount: 2
    });

    const otherSourceItem = db
      .prepare(`SELECT id FROM source_items WHERE case_id = ? LIMIT 1`)
      .get("case-other-chunk") as { id: string } | undefined;
    expect(otherSourceItem?.id).toBeTruthy();

    const unconstrainedChunks = getPageChunks(db, {
      sourceItemId: otherSourceItem!.id,
      pageStart: 1,
      pageEnd: 1
    });
    expect(unconstrainedChunks).toHaveLength(1);

    const blockedChunks = getPageChunksInCase(db, {
      caseId: "case-owned-chunk",
      sourceItemId: otherSourceItem!.id,
      pageStart: 1,
      pageEnd: 1
    });
    expect(blockedChunks).toHaveLength(0);

    db.close();
  });
});
