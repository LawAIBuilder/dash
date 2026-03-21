import { describe, expect, it } from "vitest";
import { createSeededTestDb } from "./test-helpers.js";
import { ensureCaseScaffold } from "../runtime.js";

describe("ensureCaseScaffold", () => {
  it("rejects unsafe caller-supplied case ids", () => {
    const db = createSeededTestDb();

    expect(() =>
      ensureCaseScaffold(db, {
        caseId: "../escaped/path",
        name: "Unsafe Matter"
      })
    ).toThrow(/case_id contains unsupported characters/);

    const count = db.prepare(`SELECT COUNT(*) AS count FROM cases`).get() as { count: number };
    expect(count.count).toBe(0);

    db.close();
  });
});
