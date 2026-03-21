import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

describe("package run routes", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "wc-legal-prep-package-run-test-"));
  const dbPath = join(tmpDir, "authoritative.sqlite");

  let app: FastifyInstance;
  let db: Database.Database;

  beforeAll(async () => {
    vi.resetModules();
    process.env.WC_SKIP_LISTEN = "1";
    process.env.WC_SQLITE_PATH = dbPath;
    process.env.WC_EXPORT_DIR = join(tmpDir, "package_exports");
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

  it("requires approval before package DOCX export and records export metadata after approval", async () => {
    const caseId = await createCase("Package Approval Matter");

    const packetRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-packets`,
      payload: { packet_name: "Discovery Packet", package_type: "discovery_response" }
    });
    expect(packetRes.statusCode).toBe(200);
    const packetId = packetRes.json<{ packet: { id: string } }>().packet.id;

    db.prepare(
      `
        INSERT INTO package_runs
          (id, packet_id, status, output_json, model, completed_at, approval_status)
        VALUES
          (?, ?, 'completed', ?, 'gpt-4o', CURRENT_TIMESTAMP, 'pending')
      `
    ).run(
      "run-approval-1",
      packetId,
      JSON.stringify({
        draft_markdown: "# Draft\n\nApproved content.",
        citations: [],
        qa_checklist: []
      })
    );

    const exportBefore = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/package-runs/run-approval-1/export-docx`
    });
    expect(exportBefore.statusCode).toBe(409);

    const approve = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/package-runs/run-approval-1/approve`,
      headers: { "x-wc-actor": "attorney@example.com" },
      payload: { note: "Reviewed" }
    });
    expect(approve.statusCode).toBe(200);
    const approved = approve.json<{ run: { approval_status: string; approved_by: string | null } }>().run;
    expect(approved.approval_status).toBe("approved");
    expect(approved.approved_by).toBe("attorney@example.com");

    const patchAfterApproval = await app.inject({
      method: "PATCH",
      url: `/api/cases/${caseId}/package-runs/run-approval-1`,
      payload: { markdown: "# Edited After Approval" }
    });
    expect(patchAfterApproval.statusCode).toBe(400);

    const exportAfter = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/package-runs/run-approval-1/export-docx`
    });
    expect(exportAfter.statusCode).toBe(200);

    const exported = db
      .prepare(
        `
          SELECT latest_export_format, latest_export_path, latest_export_bytes, latest_exported_at
          FROM package_runs
          WHERE id = ?
        `
      )
      .get("run-approval-1") as
      | {
          latest_export_format: string | null;
          latest_export_path: string | null;
          latest_export_bytes: number | null;
          latest_exported_at: string | null;
        }
      | undefined;

    expect(exported?.latest_export_format).toBe("docx");
    expect(exported?.latest_export_path).toContain("run-approval-1");
    expect((exported?.latest_export_bytes ?? 0) > 0).toBe(true);
    expect(exported?.latest_exported_at).toBeTruthy();
  });

  it("returns historical flow and recommendation routes", async () => {
    const caseId = await createCase("Historical Flow Matter");

    const hydrate = await app.inject({
      method: "POST",
      url: "/api/connectors/box/development/hydrate",
      payload: {
        case_id: caseId,
        files: [
          { remote_id: "hist-1", filename: "Claim Petition.pdf" },
          { remote_id: "hist-2", filename: "Pretrial Statement.pdf" }
        ]
      }
    });
    expect(hydrate.statusCode).toBe(200);

    const flowRes = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/historical-flow`
    });
    expect(flowRes.statusCode).toBe(200);
    const flow = flowRes.json<{ events: Array<{ event_type: string }> }>().events;
    expect(flow.map((row) => row.event_type)).toEqual(["claim_petition", "pretrial_statement"]);

    const recommendationsRes = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/historical-recommendations`
    });
    expect(recommendationsRes.statusCode).toBe(200);
    const recommendations = recommendationsRes.json<{
      current_event: string | null;
      recommendations: Array<{ event_type: string; sample_size: number }>;
    }>();
    expect(recommendations.current_event).toBe("pretrial_statement");

    const summaryRes = await app.inject({
      method: "GET",
      url: "/api/intelligence/historical-flow-summary"
    });
    expect(summaryRes.statusCode).toBe(200);
    const summary = summaryRes.json<{ summary: { case_count: number } }>().summary;
    expect(summary.case_count).toBeGreaterThan(0);
  });

  it("rejects package run access through a different case id", async () => {
    const caseId = await createCase("Scoped Package Matter");
    const otherCaseId = await createCase("Wrong Case Matter");

    const packetRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-packets`,
      payload: { packet_name: "Scoped Packet", package_type: "hearing_packet" }
    });
    expect(packetRes.statusCode).toBe(200);
    const packetId = packetRes.json<{ packet: { id: string } }>().packet.id;

    const createRunRes = await app.inject({
      method: "POST",
      url: `/api/cases/${otherCaseId}/exhibit-packets/${packetId}/package-runs`
    });
    expect(createRunRes.statusCode).toBe(404);

    const createdRuns = db
      .prepare(`SELECT COUNT(*) as count FROM package_runs WHERE packet_id = ?`)
      .get(packetId) as { count: number };
    expect(createdRuns.count).toBe(0);

    db.prepare(
      `
        INSERT INTO package_runs
          (id, packet_id, status, output_json, model, completed_at, approval_status)
        VALUES
          (?, ?, 'completed', ?, 'gpt-4o', CURRENT_TIMESTAMP, 'pending')
      `
    ).run(
      "run-scope-1",
      packetId,
      JSON.stringify({
        draft_markdown: "# Scoped",
        citations: [],
        qa_checklist: []
      })
    );

    const listRes = await app.inject({
      method: "GET",
      url: `/api/cases/${otherCaseId}/exhibit-packets/${packetId}/package-runs`
    });
    expect(listRes.statusCode).toBe(404);

    const runRes = await app.inject({
      method: "GET",
      url: `/api/cases/${otherCaseId}/package-runs/run-scope-1`
    });
    expect(runRes.statusCode).toBe(404);

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/cases/${otherCaseId}/package-runs/run-scope-1`,
      payload: { markdown: "# Wrong Case Edit" }
    });
    expect(patchRes.statusCode).toBe(404);

    const approveRes = await app.inject({
      method: "POST",
      url: `/api/cases/${otherCaseId}/package-runs/run-scope-1/approve`,
      headers: { "x-wc-actor": "attorney@example.com" }
    });
    expect(approveRes.statusCode).toBe(404);

    const exportRes = await app.inject({
      method: "POST",
      url: `/api/cases/${otherCaseId}/package-runs/run-scope-1/export-docx`
    });
    expect(exportRes.statusCode).toBe(404);
  });

  it("rejects package-run whole-file source items from another case", async () => {
    const caseId = await createCase("Package Source Scope Matter");
    const otherCaseId = await createCase("Other Source Scope Matter");

    const packetRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-packets`,
      payload: { packet_name: "Scoped Packet", package_type: "hearing_packet" }
    });
    expect(packetRes.statusCode).toBe(200);
    const packetId = packetRes.json<{ packet: { id: string } }>().packet.id;

    const hydrateOther = await app.inject({
      method: "POST",
      url: "/api/connectors/box/development/hydrate",
      payload: {
        case_id: otherCaseId,
        files: [{ remote_id: "other-run-source-1", filename: "other-case-source.pdf" }]
      }
    });
    expect(hydrateOther.statusCode).toBe(200);

    const otherSourceItem = db
      .prepare(`SELECT id FROM source_items WHERE case_id = ? LIMIT 1`)
      .get(otherCaseId) as { id: string } | undefined;
    expect(otherSourceItem?.id).toBeTruthy();

    const createRunRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-packets/${packetId}/package-runs`,
      payload: { whole_file_source_item_ids: [otherSourceItem!.id] }
    });
    expect(createRunRes.statusCode).toBe(404);

    const createdRuns = db
      .prepare(`SELECT COUNT(*) as count FROM package_runs WHERE packet_id = ?`)
      .get(packetId) as { count: number };
    expect(createdRuns.count).toBe(0);
  });
});
