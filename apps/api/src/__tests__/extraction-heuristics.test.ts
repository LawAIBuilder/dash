import { describe, expect, it } from "vitest";
import { extractLetterheadDatesPayload, extractMedicalIdentifiersPayload } from "../extraction-heuristics.js";

describe("extraction-heuristics", () => {
  it("extracts ISO dates and RE subjects", () => {
    const text = "RE: Treatment authorization\nService date 2024-03-15\n";
    const p = extractLetterheadDatesPayload(text);
    expect(p.dates).toContain("2024-03-15");
    expect(p.re_subjects).toContain("Treatment authorization");
  });

  it("extracts MRN and patient id style tokens", () => {
    const text = "MRN: ABC-12345\nPatient ID P-99999\nAccount # ACC887766";
    const p = extractMedicalIdentifiersPayload(text);
    expect(p.mrns).toContain("ABC-12345");
    expect(p.patient_ids).toContain("P-99999");
    expect(p.account_numbers).toContain("ACC887766");
  });
});
