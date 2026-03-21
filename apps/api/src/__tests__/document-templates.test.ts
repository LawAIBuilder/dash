import { describe, expect, it } from "vitest";
import {
  extractPlaceholderNames,
  inferFieldsFromBody,
  mergeFieldDefs,
  renderUserTemplate
} from "../document-templates.js";

describe("document-templates", () => {
  it("extracts placeholder names", () => {
    expect(extractPlaceholderNames("Hello {{name}} and {{other_name}}")).toEqual(["name", "other_name"]);
  });

  it("renders with values", () => {
    const { rendered_markdown, missing_placeholders } = renderUserTemplate("To: {{recipient}}", { recipient: "X" });
    expect(rendered_markdown).toBe("To: X");
    expect(missing_placeholders).toEqual([]);
  });

  it("reports missing placeholders when no default", () => {
    const { rendered_markdown, missing_placeholders } = renderUserTemplate(
      "{{a}} {{b}}",
      { a: "1" },
      [
        { name: "a", default: "" },
        { name: "b", default: "" }
      ]
    );
    expect(rendered_markdown).toBe("1 {{b}}");
    expect(missing_placeholders).toEqual(["b"]);
  });

  it("uses field default when value missing", () => {
    const { rendered_markdown, missing_placeholders } = renderUserTemplate(
      "Hello {{x}}",
      {},
      [{ name: "x", label: "X", default: "DEF" }]
    );
    expect(rendered_markdown).toBe("Hello DEF");
    expect(missing_placeholders).toEqual([]);
  });

  it("infers fields from body", () => {
    const fields = inferFieldsFromBody("{{matter_name}}");
    expect(fields.map((f) => f.name)).toEqual(["matter_name"]);
  });

  it("merges explicit field metadata", () => {
    const inferred = inferFieldsFromBody("{{x}}");
    const merged = mergeFieldDefs(inferred, [{ name: "x", label: "Custom", default: "d" }]);
    expect(merged.find((f) => f.name === "x")?.label).toBe("Custom");
    expect(merged.find((f) => f.name === "x")?.default).toBe("d");
  });
});
