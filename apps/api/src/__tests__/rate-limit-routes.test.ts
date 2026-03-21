import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

describe("expensive route rate limiting", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "wc-legal-prep-rate-limit-test-"));
  const dbPath = join(tmpDir, "authoritative.sqlite");

  let app: FastifyInstance;
  let db: Database.Database;

  beforeAll(async () => {
    vi.resetModules();
    process.env.WC_SKIP_LISTEN = "1";
    process.env.WC_SQLITE_PATH = dbPath;
    process.env.WC_EXPENSIVE_ROUTE_LIMIT_MAX = "1";
    process.env.WC_EXPENSIVE_ROUTE_LIMIT_WINDOW_MS = "60000";
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
    delete process.env.WC_EXPENSIVE_ROUTE_LIMIT_MAX;
    delete process.env.WC_EXPENSIVE_ROUTE_LIMIT_WINDOW_MS;
  });

  it("returns 429 when normalize-documents exceeds the configured limit", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/cases",
      payload: { name: "Rate Limited Matter" }
    });
    expect(createRes.statusCode).toBe(200);
    const caseId = createRes.json<{ case: { id: string } }>().case.id;

    const first = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/normalize-documents`,
      payload: {}
    });
    expect(first.statusCode).toBe(200);
    expect(first.headers["x-rate-limit-limit"]).toBe("1");
    expect(first.headers["x-rate-limit-remaining"]).toBe("0");

    const second = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/normalize-documents`,
      payload: {}
    });
    expect(second.statusCode).toBe(429);
    expect(second.headers["retry-after"]).toBe("60");
    expect(second.json()).toEqual({
      ok: false,
      error: "Too many expensive requests. Please retry shortly."
    });
  });
});
