import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

describe("case and review routes", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "wc-legal-prep-route-test-"));
  const dbPath = join(tmpDir, "authoritative.sqlite");

  let app: FastifyInstance;
  let db: Database.Database;

  beforeAll(async () => {
    vi.resetModules();
    process.env.WC_SKIP_LISTEN = "1";
    process.env.WC_SQLITE_PATH = dbPath;
    const mod = await import("../server.js");
    app = mod.app;
    db = new Database(dbPath);
  });

  afterAll(async () => {
    await app.close();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.WC_SKIP_LISTEN;
    delete process.env.WC_SQLITE_PATH;
  });

  it("creates and lists cases", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/cases",
      payload: {
        name: "Route Test Matter",
        case_type: "wc",
        box_root_folder_id: "folder-123",
        hearing_date: "2026-04-01"
      }
    });
    expect(createRes.statusCode).toBe(200);
    const created = createRes.json<{ ok: true; case: { id: string; name: string } }>();
    expect(created.ok).toBe(true);
    expect(created.case.name).toBe("Route Test Matter");

    const listRes = await app.inject({
      method: "GET",
      url: "/api/cases"
    });
    expect(listRes.statusCode).toBe(200);
    const listed = listRes.json<{ cases: Array<{ id: string; name: string }> }>();
    expect(listed.cases.some((item) => item.id === created.case.id && item.name === "Route Test Matter")).toBe(true);
  });

  it("allows nullable case fields to be explicitly cleared", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/cases",
      payload: {
        name: "Clear Fields Matter",
        box_root_folder_id: "folder-abc",
        pp_matter_id: "pp-123",
        hearing_date: "2026-05-02"
      }
    });
    const created = createRes.json<{ case: { id: string } }>();

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/cases/${created.case.id}`,
      payload: {
        box_root_folder_id: null,
        pp_matter_id: null,
        hearing_date: null
      }
    });
    expect(patchRes.statusCode).toBe(200);

    const row = db
      .prepare(`SELECT box_root_folder_id, pp_matter_id, hearing_date FROM cases WHERE id = ? LIMIT 1`)
      .get(created.case.id) as
      | {
          box_root_folder_id: string | null;
          pp_matter_id: string | null;
          hearing_date: string | null;
        }
      | undefined;

    expect(row).toEqual({
      box_root_folder_id: null,
      pp_matter_id: null,
      hearing_date: null
    });
  });

  it("normalizes through the production alias route", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/cases",
      payload: { name: "Normalize Route Matter" }
    });
    const created = createRes.json<{ case: { id: string } }>();

    await app.inject({
      method: "POST",
      url: "/api/connectors/box/development/hydrate",
      payload: {
        case_id: created.case.id,
        files: [{ remote_id: "route-box-1", filename: "left knee treatment order.pdf" }]
      }
    });

    const normalizeRes = await app.inject({
      method: "POST",
      url: `/api/cases/${created.case.id}/normalize-documents`,
      payload: {}
    });
    expect(normalizeRes.statusCode).toBe(200);
    const normalized = normalizeRes.json<{ normalized_count: number; canonical_page_count: number }>();
    expect(normalized.normalized_count).toBe(1);
    expect(normalized.canonical_page_count).toBe(1);
  });

  it("returns review queue data and supports manual classification override", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/cases",
      payload: { name: "Review Queue Matter" }
    });
    const created = createRes.json<{ case: { id: string } }>();

    const hydrateRes = await app.inject({
      method: "POST",
      url: "/api/connectors/box/development/hydrate",
      payload: {
        case_id: created.case.id,
        files: [{ remote_id: "route-box-2", filename: "miscellaneous correspondence.pdf" }]
      }
    });
    expect(hydrateRes.statusCode).toBe(200);

    const sourceItem = db
      .prepare(`SELECT id FROM source_items WHERE case_id = ? LIMIT 1`)
      .get(created.case.id) as { id: string } | undefined;
    expect(sourceItem).toBeDefined();

    const reviewRes = await app.inject({
      method: "GET",
      url: `/api/cases/${created.case.id}/review-queue`
    });
    expect(reviewRes.statusCode).toBe(200);
    const review = reviewRes.json<{
      unclassified_documents: Array<{ source_item_id: string }>;
    }>();
    expect(review.unclassified_documents.some((item) => item.source_item_id === sourceItem!.id)).toBe(true);

    const documentType = db
      .prepare(`SELECT id FROM document_types WHERE canonical_name = 'Treatment Order' LIMIT 1`)
      .get() as { id: string } | undefined;
    expect(documentType).toBeDefined();

    const classifyRes = await app.inject({
      method: "PATCH",
      url: `/api/source-items/${sourceItem!.id}/classification`,
      payload: { document_type_id: documentType!.id }
    });
    expect(classifyRes.statusCode).toBe(200);

    const updated = db
      .prepare(
        `SELECT document_type_id, document_type_name, classification_method FROM source_items WHERE id = ? LIMIT 1`
      )
      .get(sourceItem!.id) as
      | {
          document_type_id: string | null;
          document_type_name: string | null;
          classification_method: string | null;
        }
      | undefined;

    expect(updated).toEqual({
      document_type_id: documentType!.id,
      document_type_name: "Treatment Order",
      classification_method: "manual_override"
    });
  });
});
