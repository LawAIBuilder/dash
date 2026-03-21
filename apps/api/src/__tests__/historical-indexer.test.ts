import { describe, expect, it } from "vitest";
import { createSeededTestDb } from "./test-helpers.js";
import { hydrateBoxInventory } from "../runtime.js";
import {
  buildHistoricalCaseFlow,
  recommendNextHistoricalEvents,
  summarizeHistoricalCaseFlows
} from "../historical-indexer.js";

describe("historical indexer", () => {
  it("infers ordered event candidates from source item titles", () => {
    const db = createSeededTestDb();

    hydrateBoxInventory(db, {
      caseId: "case-flow-1",
      files: [
        { remote_id: "box-1", filename: "Claim Petition 01.05.26.pdf" },
        { remote_id: "box-2", filename: "Narrative Request Dr Smith 01.12.26.pdf" },
        { remote_id: "box-3", filename: "Pretrial Statement 03.01.26.pdf" }
      ]
    });

    const flow = buildHistoricalCaseFlow(db, "case-flow-1");
    expect(flow.map((item) => item.event_type)).toEqual([
      "claim_petition",
      "narrative_request",
      "pretrial_statement"
    ]);

    db.close();
  });

  it("summarizes event and transition counts across cases", () => {
    const db = createSeededTestDb();

    hydrateBoxInventory(db, {
      caseId: "case-flow-a",
      files: [
        { remote_id: "box-a1", filename: "Claim Petition.pdf" },
        { remote_id: "box-a2", filename: "Pretrial Statement.pdf" }
      ]
    });
    hydrateBoxInventory(db, {
      caseId: "case-flow-b",
      files: [
        { remote_id: "box-b1", filename: "Claim Petition.pdf" },
        { remote_id: "box-b2", filename: "Narrative Request.pdf" }
      ]
    });

    const summary = summarizeHistoricalCaseFlows(db);
    expect(summary.case_count).toBeGreaterThanOrEqual(2);
    expect(summary.event_counts.claim_petition).toBeGreaterThanOrEqual(2);
    expect(summary.transition_counts["claim_petition->pretrial_statement"]).toBeGreaterThanOrEqual(1);
    expect(summary.transition_counts["claim_petition->narrative_request"]).toBeGreaterThanOrEqual(1);

    db.close();
  });

  it("recommends likely next events from historical transitions", () => {
    const db = createSeededTestDb();

    hydrateBoxInventory(db, {
      caseId: "case-flow-r1",
      files: [
        { remote_id: "box-r1-1", filename: "Claim Petition.pdf" },
        { remote_id: "box-r1-2", filename: "Pretrial Statement.pdf" }
      ]
    });
    hydrateBoxInventory(db, {
      caseId: "case-flow-r2",
      files: [
        { remote_id: "box-r2-1", filename: "Claim Petition.pdf" },
        { remote_id: "box-r2-2", filename: "Narrative Request.pdf" }
      ]
    });

    const recommendations = recommendNextHistoricalEvents(db, "case-flow-r1");
    expect(recommendations.current_event).toBe("pretrial_statement");

    const coldStart = recommendNextHistoricalEvents(db, "missing-case");
    expect(coldStart.current_event).toBeNull();

    db.close();
  });
});
