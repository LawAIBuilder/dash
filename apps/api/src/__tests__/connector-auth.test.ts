import Database from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { createPasswordDigest } from "../auth.js";

describe("connector auth routes", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "wc-legal-prep-connector-auth-test-"));
  const dbPath = join(tmpDir, "authoritative.sqlite");
  const apiKey = "operator-secret";
  const reviewerEmail = "reviewer@example.com";
  const reviewerPassword = "reviewer-password-123";
  const reviewerUserId = "reviewer-user-1";

  let app: FastifyInstance;
  let db: Database.Database;
  let fetchMock: ReturnType<typeof vi.fn>;
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
    process.env.PP_CLIENT_ID = "pp-client";
    process.env.PP_CLIENT_SECRET = "pp-secret";
    process.env.PP_API_BASE_URL = "https://app.practicepanther.com";
    process.env.PP_REDIRECT_URI = "https://wc-legal-prep-production.up.railway.app/api/connectors/practicepanther/callback";

    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/oauth/token")) {
        const body = init?.body instanceof URLSearchParams ? init.body : new URLSearchParams(String(init?.body ?? ""));
        const grantType = body.get("grant_type");
        return new Response(
          JSON.stringify({
            access_token: grantType === "refresh_token" ? "pp-access-refreshed" : "pp-access-initial",
            token_type: "bearer",
            expires_in: 86399,
            refresh_token: grantType === "refresh_token" ? "pp-refresh-next" : "pp-refresh-initial"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.endsWith("/api/v2/users/me")) {
        return new Response(JSON.stringify({ id: "user-pp-1", display_name: "PP User", email: "pp@example.com" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/api/v2/matters/pp-matter-1")) {
        return new Response(
          JSON.stringify({
            id: "pp-matter-1",
            display_name: "Hagberg v. Employer",
            name: "Hagberg v. Employer",
            updated_at: "2026-03-21T00:00:00Z",
            account_ref: { id: "pp-account-1", display_name: "Gayle Hagberg" },
            custom_field_values: []
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("/api/v2/accounts/pp-account-1")) {
        return new Response(
          JSON.stringify({
            id: "pp-account-1",
            display_name: "Gayle Hagberg",
            company_name: null,
            updated_at: "2026-03-20T00:00:00Z"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("/api/v2/contacts")) {
        return new Response(
          JSON.stringify([{ id: "pp-contact-1", display_name: "Gayle Hagberg", updated_at: "2026-03-19T00:00:00Z" }]),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("/api/v2/notes")) {
        return new Response(JSON.stringify([{ id: "pp-note-1", subject: "Client note", updated_at: "2026-03-18T00:00:00Z" }]), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/api/v2/tasks")) {
        return new Response(JSON.stringify([{ id: "pp-task-1", subject: "Call client", updated_at: "2026-03-18T00:00:00Z" }]), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/api/v2/events")) {
        return new Response(JSON.stringify([{ id: "pp-event-1", subject: "Conference", updated_at: "2026-03-18T00:00:00Z" }]), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/api/v2/emails")) {
        return new Response(JSON.stringify([{ id: "pp-email-1", subject: "Email subject", updated_at: "2026-03-18T00:00:00Z" }]), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/api/v2/calllogs")) {
        return new Response(JSON.stringify([{ id: "pp-call-1", subject: "Call subject", updated_at: "2026-03-18T00:00:00Z" }]), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/api/v2/relationships")) {
        return new Response(JSON.stringify([{ id: "pp-rel-1", name: "QRC", updated_at: "2026-03-18T00:00:00Z" }]), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      throw new Error(`Unhandled fetch URL in connector auth test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

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

  beforeEach(() => {
    fetchMock.mockClear();
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
    delete process.env.PP_CLIENT_ID;
    delete process.env.PP_CLIENT_SECRET;
    delete process.env.PP_API_BASE_URL;
    delete process.env.PP_REDIRECT_URI;
    vi.unstubAllGlobals();
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

  async function grantReviewerAccess(caseId: string) {
    const grant = await app.inject({
      method: "PUT",
      url: `/api/cases/${caseId}/memberships/${reviewerUserId}`,
      headers: sessionHeaders(adminSessionCookie),
      payload: { role: "operator" }
    });
    expect(grant.statusCode).toBe(200);
  }

  it("keeps tenant-level connector routes admin-only for session users while preserving api-key fallback", async () => {
    const reviewerStatus = await app.inject({
      method: "GET",
      url: "/api/connectors/practicepanther/status",
      headers: sessionHeaders(reviewerSessionCookie)
    });
    expect(reviewerStatus.statusCode).toBe(403);

    const reviewerStart = await app.inject({
      method: "POST",
      url: "/api/connectors/practicepanther/auth/start",
      headers: sessionHeaders(reviewerSessionCookie),
      payload: { return_to: "http://localhost:5173/cases/case-123/connections" }
    });
    expect(reviewerStart.statusCode).toBe(403);

    const adminStatus = await app.inject({
      method: "GET",
      url: "/api/connectors/practicepanther/status",
      headers: sessionHeaders(adminSessionCookie)
    });
    expect(adminStatus.statusCode).toBe(200);

    const adminStart = await app.inject({
      method: "POST",
      url: "/api/connectors/practicepanther/auth/start",
      headers: sessionHeaders(adminSessionCookie),
      payload: { return_to: "http://localhost:5173/cases/case-123/connections" }
    });
    expect(adminStart.statusCode).toBe(200);

    const apiKeyStatus = await app.inject({
      method: "GET",
      url: "/api/connectors/practicepanther/status",
      headers: apiKeyHeaders()
    });
    expect(apiKeyStatus.statusCode).toBe(200);
  });

  it("keeps oauth callback exempt and requires case access for practicepanther sync", async () => {
    const start = await app.inject({
      method: "POST",
      url: "/api/connectors/practicepanther/auth/start",
      headers: sessionHeaders(adminSessionCookie),
      payload: { return_to: "http://localhost:5173/cases/case-pp/connections" }
    });
    expect(start.statusCode).toBe(200);
    const callbackState = start.json<{ callback_state: string }>().callback_state;

    const callback = await app.inject({
      method: "GET",
      url: `/api/connectors/practicepanther/callback?state=${encodeURIComponent(callbackState)}&code=pp-code-123`
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toContain("pp_auth=success");

    const caseId = await createCase(adminSessionCookie, "Connector auth matter");

    const reviewerSync = await app.inject({
      method: "POST",
      url: "/api/connectors/practicepanther/sync",
      headers: sessionHeaders(reviewerSessionCookie),
      payload: { case_id: caseId, pp_matter_id: "pp-matter-1" }
    });
    expect(reviewerSync.statusCode).toBe(403);

    const apiKeySync = await app.inject({
      method: "POST",
      url: "/api/connectors/practicepanther/sync",
      headers: apiKeyHeaders(),
      payload: { case_id: caseId, pp_matter_id: "pp-matter-1" }
    });
    expect(apiKeySync.statusCode).toBe(200);

    await grantReviewerAccess(caseId);

    const reviewerSyncAfterGrant = await app.inject({
      method: "POST",
      url: "/api/connectors/practicepanther/sync",
      headers: sessionHeaders(reviewerSessionCookie),
      payload: { case_id: caseId, pp_matter_id: "pp-matter-1" }
    });
    expect(reviewerSyncAfterGrant.statusCode).toBe(200);
    expect(reviewerSyncAfterGrant.json<{ counts: Record<string, number> }>()).toEqual(
      expect.objectContaining({
        counts: expect.objectContaining({
          contacts: 1,
          notes: 1,
          tasks: 1
        })
      })
    );
  });
});
