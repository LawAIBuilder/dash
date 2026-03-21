import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { FastifyInstance } from "fastify";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const UPLOAD_CONNECTION_ID = "a0000001-0000-4000-8000-000000000001";

describe("source item content routes", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "wc-legal-prep-file-content-test-"));
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

  async function createCase(name: string) {
    const res = await app.inject({
      method: "POST",
      url: "/api/cases",
      payload: { name }
    });
    expect(res.statusCode).toBe(200);
    return res.json<{ case: { id: string } }>().case.id;
  }

  it("requires the preview source item to belong to the requested case", async () => {
    const caseId = await createCase("Preview Owner Matter");
    const otherCaseId = await createCase("Preview Wrong Matter");

    const pdf = await PDFDocument.create();
    pdf.addPage();
    const pdfBytes = Buffer.from(await pdf.save());
    const pdfPath = join(tmpDir, "preview-source.pdf");
    writeFileSync(pdfPath, pdfBytes);

    const sourceItemId = randomUUID();
    const versionToken = "v1";

    db.prepare(
      `
        INSERT INTO source_items
          (id, case_id, source_connection_id, provider, remote_id, source_kind, title, mime_type, latest_version_token, raw_json)
        VALUES
          (?, ?, ?, 'matter_upload', ?, 'upload', ?, 'application/pdf', ?, '{}')
      `
    ).run(sourceItemId, caseId, UPLOAD_CONNECTION_ID, `upload-${sourceItemId}`, "preview-source.pdf", versionToken);

    db.prepare(
      `
        INSERT INTO source_versions
          (id, source_item_id, version_token, authoritative_asset_uri, raw_json)
        VALUES
          (?, ?, ?, ?, '{}')
      `
    ).run(randomUUID(), sourceItemId, versionToken, pathToFileURL(pdfPath).toString());

    const wrongCasePreview = await app.inject({
      method: "GET",
      url: `/api/cases/${otherCaseId}/source-items/${sourceItemId}/content`
    });
    expect(wrongCasePreview.statusCode).toBe(404);

    const correctCasePreview = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/source-items/${sourceItemId}/content`
    });
    expect(correctCasePreview.statusCode).toBe(200);
    expect(correctCasePreview.headers["content-type"]).toContain("application/pdf");
    expect(Buffer.byteLength(correctCasePreview.body)).toBeGreaterThan(0);
  });
});
