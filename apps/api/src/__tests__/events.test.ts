import { describe, expect, it } from "vitest";
import { createSeededTestDb, seedCase } from "./test-helpers.js";
import { writeCaseEvent } from "../events.js";

describe("writeCaseEvent", () => {
  it("persists a case-level event even when no branch instance exists", () => {
    const db = createSeededTestDb();
    seedCase(db, { caseId: "case-event-only" });

    const event = writeCaseEvent(db, {
      caseId: "case-event-only",
      eventName: "snapshot.created",
      sourceType: "system",
      sourceId: "source-1",
      payload: { kind: "test" }
    });

    expect(event).not.toBeNull();

    const caseEvents = db.prepare(`SELECT COUNT(*) AS count FROM case_events WHERE case_id = ?`).get("case-event-only") as {
      count: number;
    };
    const branchEvents = db.prepare(`SELECT COUNT(*) AS count FROM branch_events`).get() as {
      count: number;
    };

    expect(caseEvents.count).toBe(1);
    expect(branchEvents.count).toBe(0);

    db.close();
  });

  it("rolls back case_events when branch_events insert fails", () => {
    const db = createSeededTestDb();
    seedCase(db, { caseId: "case-event-tx" });

    const preset = db.prepare(`SELECT id FROM product_presets LIMIT 1`).get() as { id: string } | undefined;
    const branchTemplate = db.prepare(`SELECT id FROM branch_templates LIMIT 1`).get() as { id: string } | undefined;

    expect(preset?.id).toBeTruthy();
    expect(branchTemplate?.id).toBeTruthy();

    db.prepare(
      `
        INSERT INTO matter_branch_instances (id, case_id, product_preset_id, branch_template_id, status, priority)
        VALUES (?, ?, ?, ?, 'active', 1)
      `
    ).run("branch-instance-tx", "case-event-tx", preset!.id, branchTemplate!.id);

    db.exec(`
      CREATE TRIGGER fail_branch_event_insert
      BEFORE INSERT ON branch_events
      BEGIN
        SELECT RAISE(ABORT, 'branch event insert blocked');
      END;
    `);

    expect(() =>
      writeCaseEvent(db, {
        caseId: "case-event-tx",
        branchInstanceId: "branch-instance-tx",
        eventName: "snapshot.created",
        sourceType: "system",
        sourceId: "source-rollback",
        payload: { kind: "rollback-test" }
      })
    ).toThrow(/branch event insert blocked/);

    const caseEvents = db.prepare(`SELECT COUNT(*) AS count FROM case_events WHERE case_id = ?`).get("case-event-tx") as {
      count: number;
    };
    const branchEvents = db.prepare(`SELECT COUNT(*) AS count FROM branch_events WHERE matter_branch_instance_id = ?`).get(
      "branch-instance-tx"
    ) as { count: number };

    expect(caseEvents.count).toBe(0);
    expect(branchEvents.count).toBe(0);

    db.close();
  });
});
