import { afterEach, describe, expect, it } from "vitest";
import { reconcileStalePacketExports } from "../packet-pdf.js";
import { createSeededTestDb, seedCase } from "./test-helpers.js";

describe("packet PDF export lifecycle", () => {
  const openDbs: Array<{ close: () => void }> = [];

  afterEach(() => {
    for (const db of openDbs.splice(0)) {
      db.close();
    }
  });

  it("reconciles stale pending packet exports as failed", () => {
    const db = createSeededTestDb();
    openDbs.push(db);

    seedCase(db, {
      caseId: "case-packet-export-stale",
      name: "Packet Export Stale Matter"
    });

    db.prepare(
      `
        INSERT INTO exhibit_packets (id, case_id, packet_name, status)
        VALUES (?, ?, ?, ?)
      `
    ).run("packet-export-stale-1", "case-packet-export-stale", "Stale Packet", "finalized");

    db.prepare(
      `
        INSERT INTO exhibit_packet_exports
          (id, case_id, packet_id, status, export_type, created_at)
        VALUES
          (?, ?, ?, 'pending', 'packet_pdf', datetime('now', '-90 minutes'))
      `
    ).run("packet-export-row-1", "case-packet-export-stale", "packet-export-stale-1");

    const reconciled = reconcileStalePacketExports(db, {
      staleAfterMinutes: 30,
      errorText: "Recovered stale packet export"
    });
    expect(reconciled).toBe(1);

    const row = db
      .prepare(`SELECT status, error_text, completed_at FROM exhibit_packet_exports WHERE id = ? LIMIT 1`)
      .get("packet-export-row-1") as
      | {
          status: string;
          error_text: string | null;
          completed_at: string | null;
        }
      | undefined;
    expect(row?.status).toBe("failed");
    expect(row?.error_text).toBe("Recovered stale packet export");
    expect(row?.completed_at).not.toBeNull();
  });
});
