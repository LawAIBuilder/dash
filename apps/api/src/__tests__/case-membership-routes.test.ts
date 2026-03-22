import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { createPasswordDigest } from "../auth.js";

describe("case membership routes", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "wc-legal-prep-case-membership-test-"));
  const dbPath = join(tmpDir, "authoritative.sqlite");
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

  it("lets admins grant and remove case memberships and blocks non-admin management", async () => {
    const caseId = await createCase(adminSessionCookie, "Membership management case");

    const nonAdminList = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/memberships`,
      headers: sessionHeaders(reviewerSessionCookie)
    });
    expect(nonAdminList.statusCode).toBe(403);

    const grant = await app.inject({
      method: "PUT",
      url: `/api/cases/${caseId}/memberships/${reviewerUserId}`,
      headers: sessionHeaders(adminSessionCookie),
      payload: {
        role: "reviewer"
      }
    });
    expect(grant.statusCode).toBe(200);
    expect(
      grant.json<{
        membership: { user_id: string; role: string; user: { email: string; role: string } };
      }>().membership
    ).toEqual(
      expect.objectContaining({
        user_id: reviewerUserId,
        role: "reviewer",
        user: expect.objectContaining({
          email: reviewerEmail,
          role: "reviewer"
        })
      })
    );

    const list = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/memberships`,
      headers: sessionHeaders(adminSessionCookie)
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ memberships: Array<{ user_id: string }> }>().memberships).toEqual(
      expect.arrayContaining([expect.objectContaining({ user_id: reviewerUserId })])
    );

    const reviewerAccess = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/package-rules?package_type=hearing_packet`,
      headers: sessionHeaders(reviewerSessionCookie)
    });
    expect(reviewerAccess.statusCode).toBe(200);

    const remove = await app.inject({
      method: "DELETE",
      url: `/api/cases/${caseId}/memberships/${reviewerUserId}`,
      headers: sessionHeaders(adminSessionCookie)
    });
    expect(remove.statusCode).toBe(200);

    const reviewerAfterRemove = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/package-rules?package_type=hearing_packet`,
      headers: sessionHeaders(reviewerSessionCookie)
    });
    expect(reviewerAfterRemove.statusCode).toBe(403);
  });

  it("backfills active users as operators for a legacy case", async () => {
    const caseId = await createCase(adminSessionCookie, "Legacy case backfill");

    const before = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/package-rules?package_type=hearing_packet`,
      headers: sessionHeaders(reviewerSessionCookie)
    });
    expect(before.statusCode).toBe(403);

    const backfill = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/memberships/backfill`,
      headers: sessionHeaders(adminSessionCookie),
      payload: {}
    });
    expect(backfill.statusCode).toBe(200);
    const result = backfill.json<{
      inserted_count: number;
      memberships: Array<{ user_id: string; role: string }>;
    }>();
    expect(result.inserted_count).toBeGreaterThanOrEqual(1);
    expect(result.memberships).toEqual(
      expect.arrayContaining([expect.objectContaining({ user_id: reviewerUserId, role: "operator" })])
    );

    const after = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/package-rules?package_type=hearing_packet`,
      headers: sessionHeaders(reviewerSessionCookie)
    });
    expect(after.statusCode).toBe(200);
  });
});
