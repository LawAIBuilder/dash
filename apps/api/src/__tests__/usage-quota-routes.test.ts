import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

describe("daily usage quota routes", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "wc-legal-prep-usage-quota-test-"));
  const dbPath = join(tmpDir, "authoritative.sqlite");

  let app: FastifyInstance;
  let db: Database.Database;

  beforeAll(async () => {
    vi.resetModules();
    process.env.WC_SKIP_LISTEN = "1";
    process.env.WC_SQLITE_PATH = dbPath;
    process.env.WC_EXPORT_DIR = join(tmpDir, "package_exports");
    mkdirSync(process.env.WC_EXPORT_DIR, { recursive: true });
    process.env.WC_AI_ASSEMBLE_DAILY_LIMIT = "1";
    process.env.WC_PACKAGE_RUN_DAILY_LIMIT = "1";
    delete process.env.OPENAI_API_KEY;
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
    delete process.env.WC_EXPORT_DIR;
    delete process.env.WC_AI_ASSEMBLE_DAILY_LIMIT;
    delete process.env.WC_PACKAGE_RUN_DAILY_LIMIT;
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

  it("limits package runs per case per day and records a structured missing-api-key error code", async () => {
    const caseId = await createCase("Quota Package Matter");

    const packetRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-packets`,
      payload: { packet_name: "Quota Packet", package_type: "hearing_packet" }
    });
    expect(packetRes.statusCode).toBe(200);
    const packetId = packetRes.json<{ packet: { id: string } }>().packet.id;

    const first = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-packets/${packetId}/package-runs`
    });
    expect(first.statusCode).toBe(200);
    const firstRun = first.json<{
      run: {
        status: string;
        error_code: string | null;
        error_message: string | null;
      };
    }>().run;
    expect(firstRun.status).toBe("failed");
    expect(firstRun.error_code).toBe("missing_api_key");
    expect(firstRun.error_message).toContain("OPENAI_API_KEY");

    const counter = db
      .prepare(
        `
          SELECT units
          FROM usage_counters
          WHERE case_id = ?
            AND counter_key = 'package_run'
          LIMIT 1
        `
      )
      .get(caseId) as { units: number } | undefined;
    expect(counter?.units).toBe(1);

    const second = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-packets/${packetId}/package-runs`
    });
    expect(second.statusCode).toBe(429);
    expect(Number(second.headers["retry-after"] ?? 0)).toBeGreaterThan(0);
    expect(second.json()).toEqual({
      ok: false,
      code: "daily_case_quota_exceeded",
      error: "Daily case quota reached for package runs. Please retry tomorrow."
    });
  });

  it("limits ai assembly jobs per case per day and records a structured missing-api-key error code", async () => {
    const caseId = await createCase("Quota AI Matter");

    const configRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/ai/event-configs`,
      payload: {
        event_type: "hearing_prep",
        event_label: "Hearing Prep",
        instructions: "Prepare a hearing exhibit set."
      }
    });
    expect(configRes.statusCode).toBe(200);

    const first = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/ai/assemble`,
      payload: { event_type: "hearing_prep" }
    });
    expect(first.statusCode).toBe(200);
    const firstJob = first.json<{
      job: {
        status: string;
        error_code: string | null;
        error_message: string | null;
      };
    }>().job;
    expect(firstJob.status).toBe("failed");
    expect(firstJob.error_code).toBe("missing_api_key");
    expect(firstJob.error_message).toContain("OPENAI_API_KEY");

    const second = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/ai/assemble`,
      payload: { event_type: "hearing_prep" }
    });
    expect(second.statusCode).toBe(429);
    expect(Number(second.headers["retry-after"] ?? 0)).toBeGreaterThan(0);
    expect(second.json()).toEqual({
      ok: false,
      code: "daily_case_quota_exceeded",
      error: "Daily case quota reached for AI assembly jobs. Please retry tomorrow."
    });
  });
});
