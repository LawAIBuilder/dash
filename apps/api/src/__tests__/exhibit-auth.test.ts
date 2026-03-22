import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPasswordDigest } from "../auth.js";

describe.sequential("exhibit auth routes", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "wc-legal-prep-exhibit-auth-test-"));
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

  async function createNormalizedCase(name: string, remoteId: string) {
    const caseId = await createCase(adminSessionCookie, name);

    const hydrateRes = await app.inject({
      method: "POST",
      url: "/api/connectors/box/development/hydrate",
      headers: sessionHeaders(adminSessionCookie),
      payload: {
        case_id: caseId,
        files: [{ remote_id: remoteId, filename: "hearing notice.pdf" }]
      }
    });
    expect(hydrateRes.statusCode).toBe(200);

    const normalizeRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/normalize-documents`,
      headers: sessionHeaders(adminSessionCookie),
      payload: {}
    });
    expect(normalizeRes.statusCode).toBe(200);

    return caseId;
  }

  async function createPacket(caseId: string, headers: Record<string, string>) {
    const res = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-packets`,
      headers,
      payload: { packet_name: "Auth Test Packet" }
    });
    expect(res.statusCode).toBe(200);
    return res.json<{ packet: { id: string } }>().packet.id;
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

  it("blocks non-members from exhibit reads and writes while allowing admin override", async () => {
    const caseId = await createNormalizedCase("Exhibit auth admin matter", "exhibit-auth-box-1");
    const packetId = await createPacket(caseId, sessionHeaders(adminSessionCookie));

    const reviewerList = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/exhibit-packets`,
      headers: sessionHeaders(reviewerSessionCookie)
    });
    expect(reviewerList.statusCode).toBe(403);

    const reviewerCreate = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-packets`,
      headers: sessionHeaders(reviewerSessionCookie),
      payload: { packet_name: "Forbidden Packet" }
    });
    expect(reviewerCreate.statusCode).toBe(403);

    const reviewerSuggestions = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/exhibit-packets/${packetId}/suggestions`,
      headers: sessionHeaders(reviewerSessionCookie)
    });
    expect(reviewerSuggestions.statusCode).toBe(403);

    const adminList = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/exhibit-packets`,
      headers: sessionHeaders(adminSessionCookie)
    });
    expect(adminList.statusCode).toBe(200);
  });

  it("allows exhibit access after membership is granted", async () => {
    const caseId = await createNormalizedCase("Exhibit auth reviewer matter", "exhibit-auth-box-2");
    const packetId = await createPacket(caseId, sessionHeaders(adminSessionCookie));
    await grantReviewerAccess(caseId, "reviewer");

    const reviewerList = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/exhibit-packets`,
      headers: sessionHeaders(reviewerSessionCookie)
    });
    expect(reviewerList.statusCode).toBe(200);

    const reviewerCreate = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-packets`,
      headers: sessionHeaders(reviewerSessionCookie),
      payload: { packet_name: "Reviewer Packet", package_type: "claim_petition" }
    });
    expect(reviewerCreate.statusCode).toBe(200);

    const reviewerSuggestions = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/exhibit-packets/${packetId}/suggestions`,
      headers: sessionHeaders(reviewerSessionCookie)
    });
    expect(reviewerSuggestions.statusCode).toBe(200);
  });

  it("keeps api-key fallback working for transitional exhibit access", async () => {
    const caseId = await createNormalizedCase("Exhibit auth API-key matter", "exhibit-auth-box-3");
    const packetId = await createPacket(caseId, sessionHeaders(adminSessionCookie));

    const apiKeyList = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/exhibit-packets`,
      headers: apiKeyHeaders()
    });
    expect(apiKeyList.statusCode).toBe(200);

    const apiKeySuggestions = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/exhibit-packets/${packetId}/suggestions`,
      headers: apiKeyHeaders()
    });
    expect(apiKeySuggestions.statusCode).toBe(200);
  });
});

describe.sequential("exhibit auth routes in open dev mode", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "wc-legal-prep-exhibit-open-dev-test-"));
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

  it("preserves current open-dev exhibit access when no auth mode is configured", async () => {
    const createCaseRes = await app.inject({
      method: "POST",
      url: "/api/cases",
      payload: { name: "Open dev exhibit matter" }
    });
    expect(createCaseRes.statusCode).toBe(200);
    const caseId = createCaseRes.json<{ case: { id: string } }>().case.id;

    const hydrateRes = await app.inject({
      method: "POST",
      url: "/api/connectors/box/development/hydrate",
      payload: {
        case_id: caseId,
        files: [{ remote_id: "open-dev-exhibit-box-1", filename: "open dev.pdf" }]
      }
    });
    expect(hydrateRes.statusCode).toBe(200);

    const normalizeRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/normalize-documents`,
      payload: {}
    });
    expect(normalizeRes.statusCode).toBe(200);

    const listRes = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/exhibit-packets`
    });
    expect(listRes.statusCode).toBe(200);

    const createPacketRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-packets`,
      payload: { packet_name: "Open Dev Packet" }
    });
    expect(createPacketRes.statusCode).toBe(200);
  });
});
