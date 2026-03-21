import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

describe("document template routes", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "wc-legal-prep-doc-tpl-test-"));
  const dbPath = join(tmpDir, "authoritative.sqlite");

  let app: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();
    process.env.WC_SKIP_LISTEN = "1";
    process.env.WC_SQLITE_PATH = dbPath;
    const mod = await import("../server.js");
    app = mod.app;
  });

  afterAll(async () => {
    await app.close();
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.WC_SKIP_LISTEN;
    delete process.env.WC_SQLITE_PATH;
  });

  it("creates template, renders with field default, saves fill, lists and deletes fill", async () => {
    const createCaseRes = await app.inject({
      method: "POST",
      url: "/api/cases",
      payload: { name: "Template route matter" }
    });
    expect(createCaseRes.statusCode).toBe(200);
    const caseId = createCaseRes.json<{ case: { id: string } }>().case.id;

    const createTpl = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/document-templates`,
      payload: {
        name: "Notice",
        body_markdown: "Carrier: {{insurer_name}}\nMatter: {{matter_name}}",
        fields: [
          { name: "insurer_name", label: "Insurer", default: "Default Insurer" },
          { name: "matter_name", label: "Matter", default: "" }
        ],
        ai_hints: "lien"
      }
    });
    expect(createTpl.statusCode).toBe(200);
    const templateId = createTpl.json<{ template: { id: string } }>().template.id;

    const renderRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/document-templates/${templateId}/render`,
      payload: {
        values: { matter_name: "Smith v. Acme" },
        body_markdown: "Carrier: {{insurer_name}}\nMatter: {{matter_name}}"
      }
    });
    expect(renderRes.statusCode).toBe(200);
    const renderJson = renderRes.json<{
      rendered_markdown: string;
      missing_placeholders: string[];
    }>();
    expect(renderJson.rendered_markdown).toContain("Default Insurer");
    expect(renderJson.rendered_markdown).toContain("Smith v. Acme");
    expect(renderJson.missing_placeholders).toEqual([]);

    const saveRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/document-templates/${templateId}/render`,
      payload: {
        values: { matter_name: "X" },
        save: true
      }
    });
    expect(saveRes.statusCode).toBe(200);
    const fillId = saveRes.json<{ fill: { id: string } | null }>().fill?.id;
    expect(fillId).toBeTruthy();

    const listRes = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/document-template-fills?template_id=${templateId}`
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json<{ fills: Array<{ id: string }> }>().fills.length).toBeGreaterThan(0);

    const getRes = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/document-template-fills/${fillId}`
    });
    expect(getRes.statusCode).toBe(200);

    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/cases/${caseId}/document-template-fills/${fillId}`
    });
    expect(delRes.statusCode).toBe(200);

    const listAfter = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/document-template-fills?template_id=${templateId}`
    });
    expect(listAfter.json<{ fills: unknown[] }>().fills.length).toBe(0);
  });

  it("rejects oversized body_markdown", async () => {
    const createCaseRes = await app.inject({
      method: "POST",
      url: "/api/cases",
      payload: { name: "Big body" }
    });
    const caseId = createCaseRes.json<{ case: { id: string } }>().case.id;

    const res = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/document-templates`,
      payload: {
        name: "X",
        body_markdown: "x".repeat(100_001)
      }
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects save fill when source_item_id is not in case", async () => {
    const createCaseRes = await app.inject({
      method: "POST",
      url: "/api/cases",
      payload: { name: "Source test" }
    });
    const caseId = createCaseRes.json<{ case: { id: string } }>().case.id;

    const createTpl = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/document-templates`,
      payload: {
        name: "T",
        body_markdown: "Hello {{a}}"
      }
    });
    const templateId = createTpl.json<{ template: { id: string } }>().template.id;

    const saveRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/document-templates/${templateId}/render`,
      payload: {
        values: { a: "1" },
        save: true,
        source_item_id: "00000000-0000-0000-0000-000000000001"
      }
    });
    expect(saveRes.statusCode).toBe(400);
    expect(saveRes.json<{ error?: string }>().error).toMatch(/source_item/i);
  });

  it("rejects empty body_markdown on create", async () => {
    const createCaseRes = await app.inject({
      method: "POST",
      url: "/api/cases",
      payload: { name: "Empty body case" }
    });
    const caseId = createCaseRes.json<{ case: { id: string } }>().case.id;

    const res = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/document-templates`,
      payload: { name: "X", body_markdown: "   " }
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET template, PATCH template, DELETE template, PATCH fill, value length limit, 404s", async () => {
    const createCaseRes = await app.inject({
      method: "POST",
      url: "/api/cases",
      payload: { name: "CRUD matter" }
    });
    const caseId = createCaseRes.json<{ case: { id: string } }>().case.id;

    const createTpl = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/document-templates`,
      payload: { name: "Alpha", body_markdown: "Hi {{x}}" }
    });
    const templateId = createTpl.json<{ template: { id: string } }>().template.id;

    const getTpl = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/document-templates/${templateId}`
    });
    expect(getTpl.statusCode).toBe(200);
    expect(getTpl.json<{ template: { name: string } }>().template.name).toBe("Alpha");

    const patchTpl = await app.inject({
      method: "PATCH",
      url: `/api/cases/${caseId}/document-templates/${templateId}`,
      payload: { name: "Beta", body_markdown: "Hi {{x}}" }
    });
    expect(patchTpl.statusCode).toBe(200);
    expect(patchTpl.json<{ template: { name: string } }>().template.name).toBe("Beta");

    const saveRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/document-templates/${templateId}/render`,
      payload: { values: { x: "1" }, save: true }
    });
    const fillId = saveRes.json<{ fill: { id: string } }>().fill!.id;

    const patchFill = await app.inject({
      method: "PATCH",
      url: `/api/cases/${caseId}/document-template-fills/${fillId}`,
      payload: { status: "final", rendered_markdown: "Hi 1" }
    });
    expect(patchFill.statusCode).toBe(200);
    expect(patchFill.json<{ fill: { status: string } }>().fill.status).toBe("final");

    const longVal = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/document-templates/${templateId}/render`,
      payload: { values: { x: "y".repeat(20_001) } }
    });
    expect(longVal.statusCode).toBe(400);

    const notFoundFill = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/document-template-fills/00000000-0000-0000-0000-000000000099`
    });
    expect(notFoundFill.statusCode).toBe(404);

    const delTpl = await app.inject({
      method: "DELETE",
      url: `/api/cases/${caseId}/document-templates/${templateId}`
    });
    expect(delTpl.statusCode).toBe(200);

    const getGone = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/document-templates/${templateId}`
    });
    expect(getGone.statusCode).toBe(404);
  });
});
