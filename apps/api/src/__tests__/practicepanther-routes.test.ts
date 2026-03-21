import Database from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

describe("practicepanther production routes", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "wc-legal-prep-pp-route-test-"));
  const dbPath = join(tmpDir, "authoritative.sqlite");

  let app: FastifyInstance;
  let db: Database.Database;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    vi.resetModules();
    process.env.WC_SKIP_LISTEN = "1";
    process.env.WC_SQLITE_PATH = dbPath;
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
            custom_field_values: [
              {
                custom_field_ref: { id: "cf-hearing", label: "Hearing Date", value_type: "Date" },
                value_date_time: "2026-06-01T00:00:00+00:00"
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("/api/v2/matters")) {
        return new Response(
          JSON.stringify([
            {
              id: "pp-matter-1",
              display_name: "Hagberg v. Employer",
              name: "Hagberg v. Employer",
              status: "Open",
              updated_at: "2026-03-21T00:00:00Z",
              account_ref: { id: "pp-account-1", display_name: "Gayle Hagberg" }
            }
          ]),
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
          JSON.stringify([
            {
              id: "pp-contact-1",
              display_name: "Gayle Hagberg",
              updated_at: "2026-03-19T00:00:00Z",
              custom_field_values: []
            }
          ]),
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
      throw new Error(`Unhandled fetch URL in test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const mod = await import("../server.js");
    app = mod.app;
    db = new Database(dbPath);
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
    delete process.env.PP_CLIENT_ID;
    delete process.env.PP_CLIENT_SECRET;
    delete process.env.PP_API_BASE_URL;
    delete process.env.PP_REDIRECT_URI;
    vi.unstubAllGlobals();
  });

  it("starts auth with a real redirect URL and callback state", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/connectors/practicepanther/auth/start",
      payload: { return_to: "http://localhost:5173/cases/case-123/connections" }
    });
    expect(res.statusCode).toBe(200);
    const payload = res.json<{
      authorization_url: string;
      redirect_uri: string;
      callback_state: string;
    }>();
    expect(payload.redirect_uri).toBe("https://wc-legal-prep-production.up.railway.app/api/connectors/practicepanther/callback");
    expect(payload.authorization_url).toContain("https://app.practicepanther.com/oauth/authorize");
    expect(payload.authorization_url).toContain(`state=${encodeURIComponent(payload.callback_state)}`);
  });

  it("completes callback, persists oauth metadata, lists matters, and syncs production PP data", async () => {
    const start = await app.inject({
      method: "POST",
      url: "/api/connectors/practicepanther/auth/start",
      payload: { return_to: "http://localhost:5173/cases/case-pp/connections" }
    });
    const callbackState = start.json<{ callback_state: string }>().callback_state;

    const callback = await app.inject({
      method: "GET",
      url: `/api/connectors/practicepanther/callback?state=${encodeURIComponent(callbackState)}&code=pp-code-123`
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toContain("pp_auth=success");

    const status = await app.inject({
      method: "GET",
      url: "/api/connectors/practicepanther/status"
    });
    expect(status.statusCode).toBe(200);
    const statusPayload = status.json<{
      connection: { status: string; external_account_id?: string | null; metadata_json?: string | null } | null;
    }>();
    expect(statusPayload.connection?.status).toBe("active");
    expect(statusPayload.connection?.external_account_id).toBe("user-pp-1");
    expect(statusPayload.connection?.metadata_json).toBeUndefined();

    const matters = await app.inject({
      method: "GET",
      url: "/api/connectors/practicepanther/matters"
    });
    expect(matters.statusCode).toBe(200);
    expect(matters.json<{ matters: Array<{ id: string }> }>().matters[0]?.id).toBe("pp-matter-1");

    const createCase = await app.inject({
      method: "POST",
      url: "/api/cases",
      payload: { name: "PP Sync Matter" }
    });
    const caseId = createCase.json<{ case: { id: string } }>().case.id;

    const sync = await app.inject({
      method: "POST",
      url: "/api/connectors/practicepanther/sync",
      payload: { case_id: caseId, pp_matter_id: "pp-matter-1" }
    });
    expect(sync.statusCode).toBe(200);
    const syncPayload = sync.json<{ counts: Record<string, number> }>();
    expect(syncPayload.counts.contacts).toBe(1);
    expect(syncPayload.counts.notes).toBe(1);
    expect(syncPayload.counts.tasks).toBe(1);

    const caseRow = db
      .prepare(`SELECT pp_matter_id FROM cases WHERE id = ? LIMIT 1`)
      .get(caseId) as { pp_matter_id: string | null } | undefined;
    expect(caseRow?.pp_matter_id).toBe("pp-matter-1");

    const sourceKinds = db
      .prepare(`SELECT source_kind FROM source_items WHERE case_id = ? AND provider = 'practicepanther' ORDER BY source_kind ASC`)
      .all(caseId) as Array<{ source_kind: string }>;
    expect(sourceKinds.map((row) => row.source_kind)).toEqual([
      "account",
      "calllog",
      "contact",
      "email",
      "event",
      "matter",
      "note",
      "relationship",
      "task"
    ]);
  });
});
