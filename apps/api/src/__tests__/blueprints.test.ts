import { describe, expect, it } from "vitest";
import { listActiveBlueprintVersions, resolveBlueprintVersionForPackageType } from "../blueprints.js";
import { createSeededTestDb } from "./test-helpers.js";

describe("blueprint seeds", () => {
  it("seeds one active blueprint version for each initial package type", () => {
    const db = createSeededTestDb();
    const active = listActiveBlueprintVersions(db);

    expect(active.map((row) => row.package_type)).toEqual([
      "claim_petition",
      "discovery_response",
      "hearing_packet"
    ]);
    expect(active.map((row) => row.blueprint_key)).toEqual([
      "claim_petition_default",
      "discovery_response_default",
      "hearing_packet_default"
    ]);
    expect(active.every((row) => row.blueprint_version === "v1")).toBe(true);
    expect(active.every((row) => row.execution_engine === "package_worker")).toBe(true);
  });

  it("links the hearing blueprint to the current hearing prep preset machinery", () => {
    const db = createSeededTestDb();
    const hearing = resolveBlueprintVersionForPackageType(db, "hearing_packet");

    expect(hearing).not.toBeNull();
    expect(hearing?.blueprint_key).toBe("hearing_packet_default");
    expect(hearing?.product_preset_key).toBe("hearing_prep");
    expect(hearing?.linked_workflow_states.length).toBeGreaterThan(0);
    expect(hearing?.linked_approval_gates.length).toBeGreaterThan(0);
    expect(hearing?.linked_artifact_templates.length).toBeGreaterThan(0);
    expect(hearing?.output_contract.schema).toBe("hearing_packet_output_v1");
    expect(hearing?.retrieval_profile.schema).toBe("package_worker_retrieval_profile_v1");
  });
});
