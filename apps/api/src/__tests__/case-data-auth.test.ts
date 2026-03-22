import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { FastifyInstance } from "fastify";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPasswordDigest } from "../auth.js";

const UPLOAD_CONNECTION_ID = "a0000001-0000-4000-8000-000000000001";

describe.sequential("case data auth routes", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "wc-legal-prep-case-data-auth-test-"));
  const dbPath = join(tmpDir, "authoritative.sqlite");
  const apiKey = "operator-secret";
  const reviewerEmail = "reviewer@example.com";
  const reviewerPassword = "reviewer-password-123";
  const reviewerUserId = "reviewer-user-1";

  let app: FastifyInstance;
  let db: Database.Database;
  let adminSessionCookie: string;
  let reviewerSessionCookie: string;

  beforeAll(async () => {
    vi.resetModules();
    process.env.WC_SKIP_LISTEN = "1";
    process.env.WC_SQLITE_PATH = dbPath;
    process.env.WC_SESSION_SECRET = "test-session-secret";
    process.env.WC_API_KEY = apiKey;
    process.env.WC_BOOTSTRAP_ADMIN_EMAIL = "admin@example.com";
    process.env.WC_BOOTSTRAP_ADMIN_PASSWORD = "admin-password-123";
    process.env.WC_BOOTSTRAP_ADMIN_NAME = "Admin User";

    const mod = await import("../server.js");
    app = mod.app;
    db = new Database(dbPath);

    const digest = createPasswordDigest(reviewerPassword);
    db.prepare(
      `
        INSERT INTO users (id, email, display_name, role, password_salt, password_hash, active)
        VALUES (?, ?, ?, 'reviewer', ?, ?, 1)
      `
    ).run(reviewerUserId, reviewerEmail, "Reviewer User", digest.salt, digest.hash);

    const adminLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "admin@example.com",
        password: "admin-password-123"
      }
    });
    expect(adminLogin.statusCode).toBe(200);
    adminSessionCookie = (adminLogin.headers["set-cookie"] as string).split(";")[0];

    const reviewerLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: reviewerEmail,
        password: reviewerPassword
      }
    });
    expect(reviewerLogin.statusCode).toBe(200);
    reviewerSessionCookie = (reviewerLogin.headers["set-cookie"] as string).split(";")[0];
  });

  afterAll(async () => {
    await app.close();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.WC_SKIP_LISTEN;
    delete process.env.WC_SQLITE_PATH;
    delete process.env.WC_SESSION_SECRET;
    delete process.env.WC_API_KEY;
    delete process.env.WC_BOOTSTRAP_ADMIN_EMAIL;
    delete process.env.WC_BOOTSTRAP_ADMIN_PASSWORD;
    delete process.env.WC_BOOTSTRAP_ADMIN_NAME;
  });

  function sessionHeaders(cookie: string, headers?: Record<string, string>) {
    return {
      cookie,
      ...(headers ?? {})
    };
  }

  function apiKeyHeaders(headers?: Record<string, string>) {
    return {
      authorization: `Bearer ${apiKey}`,
      ...(headers ?? {})
    };
  }

  async function createCase(cookie: string, name: string) {
    const res = await app.inject({
      method: "POST",
      url: "/api/cases",
      headers: sessionHeaders(cookie),
      payload: { name }
    });
    expect(res.statusCode).toBe(200);
    return res.json<{ case: { id: string } }>().case.id;
  }

  async function grantReviewerAccess(caseId: string, role: "operator" | "reviewer" | "approver" | "admin" = "operator") {
    const grant = await app.inject({
      method: "PUT",
      url: `/api/cases/${caseId}/memberships/${reviewerUserId}`,
      headers: sessionHeaders(adminSessionCookie),
      payload: { role }
    });
    expect(grant.statusCode).toBe(200);
  }

  it("blocks non-members from case-data reads and writes while allowing admin override", async () => {
    const caseId = await createCase(adminSessionCookie, "Admin-owned case data matter");

    const reviewerProjection = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/projection`,
      headers: sessionHeaders(reviewerSessionCookie)
    });
    expect(reviewerProjection.statusCode).toBe(403);

    const reviewerReviewQueue = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/review-queue`,
      headers: sessionHeaders(reviewerSessionCookie)
    });
    expect(reviewerReviewQueue.statusCode).toBe(403);

    const reviewerNormalize = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/normalize-documents`,
      headers: sessionHeaders(reviewerSessionCookie),
      payload: {}
    });
    expect(reviewerNormalize.statusCode).toBe(403);

    const adminProjection = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/projection`,
      headers: sessionHeaders(adminSessionCookie)
    });
    expect(adminProjection.statusCode).toBe(200);
  });

  it("allows case-data access after membership is granted", async () => {
    const caseId = await createCase(adminSessionCookie, "Granted case data matter");
    await grantReviewerAccess(caseId, "reviewer");

    const projection = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/projection`,
      headers: sessionHeaders(reviewerSessionCookie)
    });
    expect(projection.statusCode).toBe(200);

    const reviewQueue = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/review-queue`,
      headers: sessionHeaders(reviewerSessionCookie)
    });
    expect(reviewQueue.statusCode).toBe(200);
    expect(reviewQueue.json<{ ok: boolean }>()).toEqual(expect.objectContaining({ ok: true }));

    const normalize = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/normalize-documents`,
      headers: sessionHeaders(reviewerSessionCookie),
      payload: {}
    });
    expect(normalize.statusCode).toBe(200);
  });

  it("keeps source-item preview behind case access in session mode", async () => {
    const caseId = await createCase(adminSessionCookie, "Case data preview matter");

    const pdf = await PDFDocument.create();
    pdf.addPage();
    const pdfBytes = Buffer.from(await pdf.save());
    const pdfPath = join(tmpDir, `preview-${randomUUID()}.pdf`);
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

    const forbiddenPreview = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/source-items/${sourceItemId}/content`,
      headers: sessionHeaders(reviewerSessionCookie)
    });
    expect(forbiddenPreview.statusCode).toBe(403);

    await grantReviewerAccess(caseId);

    const allowedPreview = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/source-items/${sourceItemId}/content`,
      headers: sessionHeaders(reviewerSessionCookie)
    });
    expect(allowedPreview.statusCode).toBe(200);
    expect(allowedPreview.headers["content-type"]).toContain("application/pdf");
  });

  it("keeps api-key fallback working for transitional case-data access", async () => {
    const caseId = await createCase(adminSessionCookie, "API-key case data matter");

    const projection = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/projection`,
      headers: apiKeyHeaders()
    });
    expect(projection.statusCode).toBe(200);

    const reviewQueue = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/review-queue`,
      headers: apiKeyHeaders()
    });
    expect(reviewQueue.statusCode).toBe(200);
  });
});

describe.sequential("case data auth routes in open dev mode", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "wc-legal-prep-case-data-open-dev-test-"));
  const dbPath = join(tmpDir, "authoritative.sqlite");

  let app: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();
    process.env.WC_SKIP_LISTEN = "1";
    process.env.WC_SQLITE_PATH = dbPath;
    delete process.env.WC_SESSION_SECRET;
    delete process.env.WC_API_KEY;
    delete process.env.WC_BOOTSTRAP_ADMIN_EMAIL;
    delete process.env.WC_BOOTSTRAP_ADMIN_PASSWORD;
    delete process.env.WC_BOOTSTRAP_ADMIN_NAME;

    const mod = await import("../server.js");
    app = mod.app;
  });

  afterAll(async () => {
    await app.close();
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.WC_SKIP_LISTEN;
    delete process.env.WC_SQLITE_PATH;
  });

  it("preserves current open-dev access when no auth mode is configured", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/cases",
      payload: { name: "Open dev case data matter" }
    });
    expect(createRes.statusCode).toBe(200);
    const caseId = createRes.json<{ case: { id: string } }>().case.id;

    const projection = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/projection`
    });
    expect(projection.statusCode).toBe(200);

    const reviewQueue = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/review-queue`
    });
    expect(reviewQueue.statusCode).toBe(200);
  });
});
