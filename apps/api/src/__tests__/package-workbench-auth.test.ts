import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { createPasswordDigest } from "../auth.js";

describe("package workbench auth", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "wc-legal-prep-package-workbench-auth-test-"));
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
    process.env.WC_EXPORT_DIR = join(tmpDir, "package_exports");
    process.env.WC_API_KEY = apiKey;
    process.env.WC_SESSION_SECRET = "test-session-secret";
    process.env.WC_BOOTSTRAP_ADMIN_EMAIL = "admin@example.com";
    process.env.WC_BOOTSTRAP_ADMIN_PASSWORD = "admin-password-123";
    process.env.WC_BOOTSTRAP_ADMIN_NAME = "Admin User";
    mkdirSync(process.env.WC_EXPORT_DIR, { recursive: true });

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
    delete process.env.WC_EXPORT_DIR;
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

  it("auto-creates case memberships for session-created cases and blocks non-members from package workbench routes", async () => {
    const adminCaseId = await createCase(adminSessionCookie, "Admin-only package workbench case");

    const forbidden = await app.inject({
      method: "GET",
      url: `/api/cases/${adminCaseId}/package-rules?package_type=hearing_packet`,
      headers: sessionHeaders(reviewerSessionCookie)
    });
    expect(forbidden.statusCode).toBe(403);

    const reviewerCaseId = await createCase(reviewerSessionCookie, "Reviewer-owned package workbench case");

    const membership = db
      .prepare(
        `
          SELECT case_id, user_id, role
          FROM case_memberships
          WHERE case_id = ? AND user_id = ?
          LIMIT 1
        `
      )
      .get(reviewerCaseId, reviewerUserId) as
      | {
          case_id: string;
          user_id: string;
          role: string;
        }
      | undefined;

    expect(membership).toEqual({
      case_id: reviewerCaseId,
      user_id: reviewerUserId,
      role: "reviewer"
    });

    const allowed = await app.inject({
      method: "GET",
      url: `/api/cases/${reviewerCaseId}/package-rules?package_type=hearing_packet`,
      headers: sessionHeaders(reviewerSessionCookie)
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json<{ ok: boolean; rules: unknown[] }>()).toEqual(
      expect.objectContaining({
        ok: true,
        rules: expect.any(Array)
      })
    );
  });

  it("stamps package rule writes with session principals and explicit API-key fallback actors", async () => {
    const reviewerCaseId = await createCase(reviewerSessionCookie, "Reviewer rule write case");

    const createRule = await app.inject({
      method: "POST",
      url: `/api/cases/${reviewerCaseId}/package-rules`,
      headers: sessionHeaders(reviewerSessionCookie),
      payload: {
        package_type: "hearing_packet",
        rule_key: "medical_summary",
        rule_label: "Medical summary",
        instructions: "Lead with treating records.",
        sort_order: 5
      }
    });
    expect(createRule.statusCode).toBe(200);
    const createdRule = createRule.json<{
      rule: {
        id: string;
        created_by: string | null;
        created_by_user_id: string | null;
        updated_by: string | null;
        updated_by_user_id: string | null;
      };
    }>().rule;
    expect(createdRule.created_by).toBe(reviewerEmail);
    expect(createdRule.created_by_user_id).toBe(reviewerUserId);
    expect(createdRule.updated_by).toBe(reviewerEmail);
    expect(createdRule.updated_by_user_id).toBe(reviewerUserId);

    const patchRule = await app.inject({
      method: "PATCH",
      url: `/api/cases/${reviewerCaseId}/package-rules/${createdRule.id}`,
      headers: sessionHeaders(reviewerSessionCookie),
      payload: {
        instructions: "Lead with treating records and the latest IME.",
        sort_order: 10
      }
    });
    expect(patchRule.statusCode).toBe(200);
    const patchedRule = patchRule.json<{
      rule: {
        created_by: string | null;
        created_by_user_id: string | null;
        updated_by: string | null;
        updated_by_user_id: string | null;
        instructions: string;
        sort_order: number;
      };
    }>().rule;
    expect(patchedRule.created_by).toBe(reviewerEmail);
    expect(patchedRule.created_by_user_id).toBe(reviewerUserId);
    expect(patchedRule.updated_by).toBe(reviewerEmail);
    expect(patchedRule.updated_by_user_id).toBe(reviewerUserId);
    expect(patchedRule.instructions).toBe("Lead with treating records and the latest IME.");
    expect(patchedRule.sort_order).toBe(10);

    const fallbackCaseId = await createCase(adminSessionCookie, "Fallback rule write case");

    const missingFallbackActor = await app.inject({
      method: "POST",
      url: `/api/cases/${fallbackCaseId}/package-rules`,
      headers: apiKeyHeaders(),
      payload: {
        package_type: "discovery_response",
        rule_key: "timeline_precision",
        rule_label: "Timeline precision"
      }
    });
    expect(missingFallbackActor.statusCode).toBe(400);

    const fallbackCreate = await app.inject({
      method: "POST",
      url: `/api/cases/${fallbackCaseId}/package-rules`,
      headers: apiKeyHeaders({
        "x-wc-actor": "ops-automation@example.com"
      }),
      payload: {
        package_type: "discovery_response",
        rule_key: "timeline_precision",
        rule_label: "Timeline precision"
      }
    });
    expect(fallbackCreate.statusCode).toBe(200);
    expect(
      fallbackCreate.json<{
        rule: {
          created_by: string | null;
          created_by_user_id: string | null;
          updated_by: string | null;
          updated_by_user_id: string | null;
        };
      }>().rule
    ).toEqual(
      expect.objectContaining({
        created_by: "ops-automation@example.com",
        created_by_user_id: null,
        updated_by: "ops-automation@example.com",
        updated_by_user_id: null
      })
    );
  });
});
