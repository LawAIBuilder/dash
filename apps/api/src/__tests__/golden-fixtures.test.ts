import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type GoldenCaseManifest = {
  id: string;
  label: string;
  source_root: string;
  required_artifacts: string[];
  required_outputs: string[];
};

describe("desktop golden fixtures", () => {
  it("references available Desktop package artifacts", () => {
    const raw = readFileSync(
      "/Users/danielswenson/wc-legal-prep/docs/package-studio/fixtures/golden_cases.json",
      "utf8"
    );
    const parsed = JSON.parse(raw) as { cases: GoldenCaseManifest[] };

    expect(parsed.cases.length).toBeGreaterThanOrEqual(3);
    const requireLocalArtifacts = process.env.WC_ENABLE_LOCAL_GOLDEN_FIXTURES === "1";

    for (const entry of parsed.cases) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.required_artifacts.length).toBeGreaterThan(0);
      expect(entry.required_outputs.length).toBeGreaterThan(0);
      if (requireLocalArtifacts) {
        expect(existsSync(entry.source_root)).toBe(true);
        for (const artifact of entry.required_artifacts) {
          expect(existsSync(`${entry.source_root}/${artifact}`)).toBe(true);
        }
        for (const output of entry.required_outputs) {
          expect(existsSync(`${entry.source_root}/${output}`)).toBe(true);
        }
      }
    }
  });
});
