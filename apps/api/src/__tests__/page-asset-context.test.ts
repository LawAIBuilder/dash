import { afterEach, describe, expect, it } from "vitest";
import {
  hydrateBoxInventory,
  normalizeCaseDocumentSpine,
  resolvePageAssetContext
} from "../runtime.js";
import { createSeededTestDb } from "./test-helpers.js";

describe("resolvePageAssetContext", () => {
  const openDbs: Array<{ close: () => void }> = [];

  afterEach(() => {
    for (const db of openDbs.splice(0)) {
      db.close();
    }
  });

  it("joins canonical_page through logical_document to box source_item", () => {
    const db = createSeededTestDb();
    openDbs.push(db);

    hydrateBoxInventory(db, {
      caseId: "case-asset-ctx",
      files: [{ remote_id: "box-remote-99", filename: "notice.pdf", mime_type: "application/pdf" }]
    });
    normalizeCaseDocumentSpine(db, { caseId: "case-asset-ctx", stubPageCount: 1 });

    const pageId = db
      .prepare(`SELECT id FROM canonical_pages LIMIT 1`)
      .get() as { id: string } | undefined;
    expect(pageId).toBeDefined();

    const ctx = resolvePageAssetContext(db, pageId!.id);
    expect(ctx).not.toBeNull();
    expect(ctx?.provider).toBe("box");
    expect(ctx?.remoteId).toBe("box-remote-99");
    expect(ctx?.mimeType).toBe("application/pdf");
    expect(ctx?.pageNumberInDoc).toBe(1);
    expect(ctx?.authoritativeAssetUri === null || typeof ctx?.authoritativeAssetUri === "string").toBe(true);
  });
});
