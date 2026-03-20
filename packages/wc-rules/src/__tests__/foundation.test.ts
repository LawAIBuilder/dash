import { describe, expect, it } from "vitest";
import {
  documentTypeAliasSeeds,
  documentTypeRuleSeeds,
  documentTypeSeeds,
  getDocumentTypeSeed,
  hearingPrepSeedBundle,
  matchDocumentTypeAlias,
  medicalRequestSeedBundle,
  medicalRequestTreatingSupportDocumentTypes,
  slice01RuleSeedBundle
} from "../index.js";

describe("wc-rules slice 01 seeds", () => {
  it("keeps alias and rule seeds attached to known document types", () => {
    const knownDocumentTypes = new Set(documentTypeSeeds.map((seed) => seed.canonical_name));

    expect(documentTypeAliasSeeds.length).toBeGreaterThan(0);
    expect(documentTypeRuleSeeds.length).toBeGreaterThan(0);

    for (const alias of documentTypeAliasSeeds) {
      expect(knownDocumentTypes.has(alias.canonical_name)).toBe(true);
    }

    for (const rule of documentTypeRuleSeeds) {
      expect(knownDocumentTypes.has(rule.canonical_name)).toBe(true);
    }
  });

  it("resolves filenames to the best matching shared alias", () => {
    const officeNoteMatch = matchDocumentTypeAlias("2026-02-10 Dr Smith office note.pdf");
    expect(officeNoteMatch?.canonical_name).toBe("Office Note");

    const treatmentOrderMatch = matchDocumentTypeAlias("medical request order - left knee.pdf");
    expect(treatmentOrderMatch?.canonical_name).toBe("Treatment Order");
    expect(treatmentOrderMatch?.alias.alias_pattern).toBe("medical request order");
  });

  it("exposes coherent hearing prep and medical request bundles", () => {
    expect(hearingPrepSeedBundle.preset.key).toBe("hearing_prep");
    expect(hearingPrepSeedBundle.workflows).toHaveLength(4);

    expect(medicalRequestSeedBundle.branchTemplate.key).toBe("medical_request");
    expect(medicalRequestTreatingSupportDocumentTypes).toEqual(["Narrative Report", "Office Note"]);

    const officeNoteRequirement = medicalRequestSeedBundle.stageRequirements.find(
      (requirement) => requirement.requirement_key === "Office Note"
    );
    expect(officeNoteRequirement?.requirement_policy).toContain("allowed_substitute_for");

    expect(getDocumentTypeSeed("NOID")?.exhibit_policy).toBe("reference_only");
    expect(slice01RuleSeedBundle.documentTypes).toHaveLength(documentTypeSeeds.length);
  });
});
