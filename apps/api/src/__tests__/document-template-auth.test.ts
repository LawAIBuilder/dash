import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { createPasswordDigest } from "../auth.js";

describe("document template auth", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "wc-legal-prep-document-template-auth-test-"));
  const dbPath = join(tmpDir, "authoritative.sqlite");
  const apiKey = "template-auth-secret";
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
    process.env.WC_API_KEY = apiKey;
    process.env.WC_SESSION_SECRET = "test-session-secret";
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
    delete process.env.WC_API_KEY;
    delete process.env.WC_SESSION_SECRET;
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

  it("blocks non-members from template routes and allows members to work with their own case templates", async () => {
    const adminCaseId = await createCase(adminSessionCookie, "Admin-only template case");

    const forbidden = await app.inject({
      method: "GET",
      url: `/api/cases/${adminCaseId}/document-templates`,
      headers: sessionHeaders(reviewerSessionCookie)
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json<{ error: string }>().error).toMatch(/do not have access/i);

    const reviewerCaseId = await createCase(reviewerSessionCookie, "Reviewer-owned template case");

    const createTemplate = await app.inject({
      method: "POST",
      url: `/api/cases/${reviewerCaseId}/document-templates`,
      headers: sessionHeaders(reviewerSessionCookie),
      payload: {
        name: "Cover letter",
        body_markdown: "Dear {{claimant_name}}",
        ai_hints: "narrative"
      }
    });
    expect(createTemplate.statusCode).toBe(200);
    const template = createTemplate.json<{
      template: {
        id: string;
        created_by: string | null;
        created_by_user_id: string | null;
        updated_by: string | null;
        updated_by_user_id: string | null;
      };
    }>().template;
    expect(template.created_by).toBe(reviewerEmail);
    expect(template.created_by_user_id).toBe(reviewerUserId);
    expect(template.updated_by).toBe(reviewerEmail);
    expect(template.updated_by_user_id).toBe(reviewerUserId);

    const saveFill = await app.inject({
      method: "POST",
      url: `/api/cases/${reviewerCaseId}/document-templates/${template.id}/render`,
      headers: sessionHeaders(reviewerSessionCookie),
      payload: {
        values: { claimant_name: "Jordan Smith" },
        save: true
      }
    });
    expect(saveFill.statusCode).toBe(200);
    expect(
      saveFill.json<{
        fill: {
          created_by: string | null;
          created_by_user_id: string | null;
          updated_by: string | null;
          updated_by_user_id: string | null;
        } | null;
      }>().fill
    ).toEqual(
      expect.objectContaining({
        created_by: reviewerEmail,
        created_by_user_id: reviewerUserId,
        updated_by: reviewerEmail,
        updated_by_user_id: reviewerUserId
      })
    );
  });

  it("requires explicit fallback actors for template writes under API-key mode", async () => {
    const fallbackCaseId = await createCase(adminSessionCookie, "Fallback template case");

    const missingFallbackActor = await app.inject({
      method: "POST",
      url: `/api/cases/${fallbackCaseId}/document-templates`,
      headers: apiKeyHeaders(),
      payload: {
        name: "Fallback template",
        body_markdown: "Hello {{x}}"
      }
    });
    expect(missingFallbackActor.statusCode).toBe(400);

    const fallbackCreate = await app.inject({
      method: "POST",
      url: `/api/cases/${fallbackCaseId}/document-templates`,
      headers: apiKeyHeaders({
        "x-wc-actor": "ops-automation@example.com"
      }),
      payload: {
        name: "Fallback template",
        body_markdown: "Hello {{x}}"
      }
    });
    expect(fallbackCreate.statusCode).toBe(200);
    const template = fallbackCreate.json<{
      template: {
        id: string;
        created_by: string | null;
        created_by_user_id: string | null;
        updated_by: string | null;
        updated_by_user_id: string | null;
      };
    }>().template;
    expect(template).toEqual(
      expect.objectContaining({
        created_by: "ops-automation@example.com",
        created_by_user_id: null,
        updated_by: "ops-automation@example.com",
        updated_by_user_id: null
      })
    );

    const fallbackPatch = await app.inject({
      method: "PATCH",
      url: `/api/cases/${fallbackCaseId}/document-templates/${template.id}`,
      headers: apiKeyHeaders({
        "x-wc-actor": "ops-automation@example.com"
      }),
      payload: {
        ai_hints: "updated"
      }
    });
    expect(fallbackPatch.statusCode).toBe(200);
    expect(
      fallbackPatch.json<{
        template: {
          updated_by: string | null;
          updated_by_user_id: string | null;
        };
      }>().template
    ).toEqual(
      expect.objectContaining({
        updated_by: "ops-automation@example.com",
        updated_by_user_id: null
      })
    );
  });
});
