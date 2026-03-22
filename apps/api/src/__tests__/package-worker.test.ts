import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSeededTestDb, createTestDb, seedCase } from "./test-helpers.js";
import { createExhibitPacket } from "../exhibits.js";
import { parseInterrogatoryRequests, runPackageWorker, updatePackageRunDraft } from "../ai-service.js";

describe("package worker helpers", () => {
  it("parseInterrogatoryRequests splits INTERROGATORY NO. blocks", () => {
    const text = `
INTERROGATORY NO. 1
State your full name.

INTERROGATORY NO. 2
List all employers in the last five years.
`;
    const parts = parseInterrogatoryRequests(text);
    expect(parts.length).toBe(2);
    expect(parts[0]).toContain("INTERROGATORY NO. 1");
    expect(parts[1]).toContain("INTERROGATORY NO. 2");
  });

  it("updatePackageRunDraft merges edited markdown into output_json", () => {
    const db = createTestDb();
    const caseId = randomUUID();
    seedCase(db, { caseId, name: "Pkg Test" });
    const created = createExhibitPacket(db, {
      caseId,
      packetName: "Petition",
      packageType: "claim_petition"
    });
    expect(created.ok).toBe(true);
    const packetId = created.packet?.id;
    if (!packetId) throw new Error("packet id");

    const runId = randomUUID();
    const output = JSON.stringify({
      draft_markdown: "# Hello",
      qa_checklist: [],
      citations: []
    });
    db.prepare(
      `
      INSERT INTO package_runs (id, packet_id, status, output_json, model, completed_at)
      VALUES (?, ?, 'completed', ?, 'gpt-4o', CURRENT_TIMESTAMP)
    `
    ).run(runId, packetId, output);

    const updated = updatePackageRunDraft(db, runId, "# Hello\n\nEdited paragraph.");
    expect(updated).not.toBeNull();
    const parsed = JSON.parse(updated!.output_json!);
    expect(parsed.edited_draft_markdown).toContain("Edited paragraph");
    expect(parsed.draft_markdown).toBe("# Hello");
  });

  it("updatePackageRunDraft refuses to edit approved runs", () => {
    const db = createTestDb();
    const caseId = randomUUID();
    seedCase(db, { caseId, name: "Pkg Approved Test" });
    const created = createExhibitPacket(db, {
      caseId,
      packetName: "Petition",
      packageType: "claim_petition"
    });
    expect(created.ok).toBe(true);
    const packetId = created.packet?.id;
    if (!packetId) throw new Error("packet id");

    const runId = randomUUID();
    db.prepare(
      `
      INSERT INTO package_runs (id, packet_id, status, output_json, model, completed_at, approval_status)
      VALUES (?, ?, 'completed', ?, 'gpt-4o', CURRENT_TIMESTAMP, 'approved')
    `
    ).run(
      runId,
      packetId,
      JSON.stringify({
        draft_markdown: "# Approved",
        qa_checklist: [],
        citations: []
      })
    );

    const updated = updatePackageRunDraft(db, runId, "# Approved\n\nTampered.");
    expect(updated).toBeNull();
  });

  it("claim_petition structured output shape can be round-tripped", () => {
    const sample = {
      draft_markdown: "## Cover\n\nx",
      citations: [{ claim: "Employee name", source_item_id: "s1", canonical_page_id: null, page_text_excerpt: "..." }],
      qa_checklist: [{ check_id: "med", label: "Medical", status: "warn", detail: "none" }],
      assembly_recommendations: [],
      missing_proof: []
    };
    const s = JSON.stringify(sample);
    const back = JSON.parse(s) as typeof sample;
    expect(back.qa_checklist[0]?.status).toBe("warn");
    expect(Array.isArray(back.citations)).toBe(true);
  });

  it("binds blueprint metadata onto packets and package runs before provider execution", async () => {
    const db = createSeededTestDb();
    const caseId = randomUUID();
    seedCase(db, { caseId, name: "Blueprint Package Test" });
    const previousApiKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const created = createExhibitPacket(db, {
        caseId,
        packetName: "Claim Petition Packet",
        packageType: "claim_petition"
      });
      expect(created.ok).toBe(true);
      expect(created.packet?.blueprint_key).toBe("claim_petition_default");
      expect(created.packet?.blueprint_version).toBe("v1");
      expect(created.packet?.blueprint_execution_engine).toBe("package_worker");

      const run = await runPackageWorker(db, {
        caseId,
        packetId: created.packet!.id
      });

      expect(run.status).toBe("failed");
      expect(run.error_code).toBe("missing_api_key");
      expect(run.blueprint_version_id).toBeTruthy();
      expect(run.blueprint_key).toBe("claim_petition_default");
      expect(run.blueprint_version).toBe("v1");
      expect(run.blueprint_name).toBe("Claim Petition");
      expect(run.blueprint_execution_engine).toBe("package_worker");
    } finally {
      if (previousApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousApiKey;
      }
    }
  });
});
