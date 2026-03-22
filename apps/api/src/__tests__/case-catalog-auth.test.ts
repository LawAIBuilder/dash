import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { createPasswordDigest } from "../auth.js";

describe.sequential("case catalog auth", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "wc-legal-prep-case-catalog-auth-test-"));
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

  it("filters case list by membership for non-admin sessions while preserving admin and api-key visibility", async () => {
    const reviewerCaseId = await createCase(reviewerSessionCookie, "Reviewer catalog matter");
    const adminCaseId = await createCase(adminSessionCookie, "Admin catalog matter");

    const reviewerList = await app.inject({
      method: "GET",
      url: "/api/cases",
      headers: sessionHeaders(reviewerSessionCookie)
    });
    expect(reviewerList.statusCode).toBe(200);
    const reviewerCases = reviewerList.json<{ cases: Array<{ id: string }> }>().cases;
    expect(reviewerCases.some((item) => item.id === reviewerCaseId)).toBe(true);
    expect(reviewerCases.some((item) => item.id === adminCaseId)).toBe(false);

    const adminList = await app.inject({
      method: "GET",
      url: "/api/cases",
      headers: sessionHeaders(adminSessionCookie)
    });
    expect(adminList.statusCode).toBe(200);
    const adminCases = adminList.json<{ cases: Array<{ id: string }> }>().cases;
    expect(adminCases.some((item) => item.id === reviewerCaseId)).toBe(true);
    expect(adminCases.some((item) => item.id === adminCaseId)).toBe(true);

    const apiKeyList = await app.inject({
      method: "GET",
      url: "/api/cases",
      headers: apiKeyHeaders()
    });
    expect(apiKeyList.statusCode).toBe(200);
    const apiKeyCases = apiKeyList.json<{ cases: Array<{ id: string }> }>().cases;
    expect(apiKeyCases.some((item) => item.id === reviewerCaseId)).toBe(true);
    expect(apiKeyCases.some((item) => item.id === adminCaseId)).toBe(true);

    await grantReviewerAccess(adminCaseId, "reviewer");

    const reviewerListAfterGrant = await app.inject({
      method: "GET",
      url: "/api/cases",
      headers: sessionHeaders(reviewerSessionCookie)
    });
    expect(reviewerListAfterGrant.statusCode).toBe(200);
    const reviewerCasesAfterGrant = reviewerListAfterGrant.json<{ cases: Array<{ id: string }> }>().cases;
    expect(reviewerCasesAfterGrant.some((item) => item.id === adminCaseId)).toBe(true);
  });

  it("requires membership to read and patch individual cases for non-admin sessions", async () => {
    const adminCaseId = await createCase(adminSessionCookie, "Catalog detail admin matter");

    const reviewerGet = await app.inject({
      method: "GET",
      url: `/api/cases/${adminCaseId}`,
      headers: sessionHeaders(reviewerSessionCookie)
    });
    expect(reviewerGet.statusCode).toBe(403);

    const reviewerPatch = await app.inject({
      method: "PATCH",
      url: `/api/cases/${adminCaseId}`,
      headers: sessionHeaders(reviewerSessionCookie),
      payload: { employer_name: "Forbidden Employer" }
    });
    expect(reviewerPatch.statusCode).toBe(403);

    const adminGet = await app.inject({
      method: "GET",
      url: `/api/cases/${adminCaseId}`,
      headers: sessionHeaders(adminSessionCookie)
    });
    expect(adminGet.statusCode).toBe(200);

    await grantReviewerAccess(adminCaseId, "operator");

    const reviewerGetAfterGrant = await app.inject({
      method: "GET",
      url: `/api/cases/${adminCaseId}`,
      headers: sessionHeaders(reviewerSessionCookie)
    });
    expect(reviewerGetAfterGrant.statusCode).toBe(200);

    const reviewerPatchAfterGrant = await app.inject({
      method: "PATCH",
      url: `/api/cases/${adminCaseId}`,
      headers: sessionHeaders(reviewerSessionCookie),
      payload: { employer_name: "Allowed Employer" }
    });
    expect(reviewerPatchAfterGrant.statusCode).toBe(200);

    const row = db
      .prepare(`SELECT employer_name FROM cases WHERE id = ? LIMIT 1`)
      .get(adminCaseId) as { employer_name: string | null } | undefined;
    expect(row?.employer_name).toBe("Allowed Employer");
  });
});
