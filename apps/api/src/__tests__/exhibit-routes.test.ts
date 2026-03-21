import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { PDFDocument } from "pdf-lib";

describe("exhibit workspace routes", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "wc-legal-prep-exhibit-test-"));
  const dbPath = join(tmpDir, "authoritative.sqlite");

  let app: FastifyInstance;
  let db: Database.Database;

  beforeAll(async () => {
    vi.resetModules();
    process.env.WC_SKIP_LISTEN = "1";
    process.env.WC_SQLITE_PATH = dbPath;
    const mod = await import("../server.js");
    app = mod.app;
    db = new Database(dbPath);
  });

  afterAll(async () => {
    await app.close();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.WC_SKIP_LISTEN;
    delete process.env.WC_SQLITE_PATH;
  });

  async function createNormalizedCase(name: string, remoteId: string, filename = "treatment order.pdf") {
    const createCaseRes = await app.inject({
      method: "POST",
      url: "/api/cases",
      payload: { name }
    });
    expect(createCaseRes.statusCode).toBe(200);
    const caseId = createCaseRes.json<{ case: { id: string } }>().case.id;

    const hydrateRes = await app.inject({
      method: "POST",
      url: "/api/connectors/box/development/hydrate",
      payload: {
        case_id: caseId,
        files: [{ remote_id: remoteId, filename }]
      }
    });
    expect(hydrateRes.statusCode).toBe(200);

    const normalizeRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/normalize-documents`,
      payload: {}
    });
    expect(normalizeRes.statusCode).toBe(200);

    return { caseId };
  }

  it("creates an exhibit packet, slot, item assignment, page rules, suggestions, and finalize preview", async () => {
    const { caseId } = await createNormalizedCase("Exhibit Route Matter", "exhibit-box-1");

    const createPacketRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-packets`,
      payload: { packet_name: "Test Packet", packet_mode: "full" }
    });
    expect(createPacketRes.statusCode).toBe(200);
    const packet = createPacketRes.json<{ packet: { id: string; sections: Array<{ id: string; section_key: string }> } }>().packet;
    expect(packet.id).toBeTruthy();
    expect(packet.sections.length).toBe(1);

    const employeeSection = packet.sections.find((section) => section.section_key === "employee");
    expect(employeeSection).toBeDefined();
    expect((employeeSection as { exhibits?: unknown[] })?.exhibits?.length).toBeGreaterThanOrEqual(5);

    const createSlotRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-sections/${employeeSection!.id}/exhibits`,
      payload: { title: "Medical Records" }
    });
    expect(createSlotRes.statusCode).toBe(200);
    const slotPacket = createSlotRes.json<{
      packet: { sections: Array<{ section_key: string; exhibits: Array<{ id: string }> }> };
    }>().packet;
    const slotId = slotPacket.sections.find((section) => section.section_key === "employee")!.exhibits[0]!.id;

    const sourceItem = db
      .prepare(`SELECT id FROM source_items WHERE case_id = ? LIMIT 1`)
      .get(caseId) as { id: string } | undefined;
    expect(sourceItem).toBeDefined();

    const addItemRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibits/${slotId}/items`,
      payload: { source_item_id: sourceItem!.id }
    });
    expect(addItemRes.statusCode).toBe(200);
    const itemPacket = addItemRes.json<{
      packet: {
        sections: Array<{
          section_key: string;
          exhibits: Array<{ items: Array<{ id: string; canonical_document_id?: string | null }> }>;
        }>;
      };
    }>().packet;
    const item = itemPacket.sections.find((section) => section.section_key === "employee")!.exhibits[0]!.items[0]!;
    expect(item.id).toBeTruthy();

    const page = db
      .prepare(`SELECT id FROM canonical_pages LIMIT 1`)
      .get() as { id: string } | undefined;
    expect(page).toBeDefined();

    const pageRulesRes = await app.inject({
      method: "PATCH",
      url: `/api/cases/${caseId}/exhibit-items/${item.id}/page-rules`,
      payload: { exclude_canonical_page_ids: [page!.id] }
    });
    expect(pageRulesRes.statusCode).toBe(200);

    const suggestionsRes = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/exhibit-packets/${packet.id}/suggestions`
    });
    expect(suggestionsRes.statusCode).toBe(200);
    const suggestions = suggestionsRes.json<{ suggestions: Array<{ id: string }> }>().suggestions;
    expect(Array.isArray(suggestions)).toBe(true);

    const finalizeRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-packets/${packet.id}/finalize`,
      payload: {}
    });
    expect(finalizeRes.statusCode).toBe(200);
    const finalized = finalizeRes.json<{
      packet: { status: string };
      preview: { total_exhibits: number; total_items: number };
    }>();
    expect(finalized.packet.status).not.toBe("draft");
    expect(finalized.preview.total_exhibits).toBeGreaterThanOrEqual(1);
    expect(finalized.preview.total_items).toBeGreaterThanOrEqual(1);
  });

  it("exports a combined packet PDF using stored exhibit order", async () => {
    process.env.WC_EXHIBIT_EXPORT_DIR = join(tmpDir, "exhibit_exports");
    const { caseId } = await createNormalizedCase("PDF Export Matter", "pdf-export-unique-1");

    const createPacketRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-packets`,
      payload: { packet_name: "Test Packet", packet_mode: "full" }
    });
    expect(createPacketRes.statusCode).toBe(200);
    const packet = createPacketRes.json<{ packet: { id: string; sections: Array<{ section_key: string; id: string }> } }>().packet;

    const employeeSection = packet.sections.find((section) => section.section_key === "employee")!;
    const createSlotRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-sections/${employeeSection.id}/exhibits`,
      payload: { title: "Medical Records" }
    });
    expect(createSlotRes.statusCode).toBe(200);
    const slotPacket = createSlotRes.json<{
      packet: { sections: Array<{ section_key: string; exhibits: Array<{ id: string }> }> };
    }>().packet;
    const slotId = slotPacket.sections.find((section) => section.section_key === "employee")!.exhibits[0]!.id;

    const sourceItem = db
      .prepare(`SELECT id FROM source_items WHERE case_id = ? LIMIT 1`)
      .get(caseId) as { id: string };

    const addItemRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibits/${slotId}/items`,
      payload: { source_item_id: sourceItem.id }
    });
    expect(addItemRes.statusCode).toBe(200);

    const finalizeRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-packets/${packet.id}/finalize`,
      payload: {}
    });
    expect(finalizeRes.statusCode).toBe(200);
    expect(finalizeRes.json<{ packet: { status: string } }>().packet.status).not.toBe("draft");

    const doc = await PDFDocument.create();
    doc.addPage();
    const pdfBytes = Buffer.from(await doc.save());

    const { runPacketPdfExport } = await import("../packet-pdf.js");
    const result = await runPacketPdfExport(db, packet.id, async () => pdfBytes);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pageCount).toBeGreaterThanOrEqual(1);
      expect(result.exportId.length).toBeGreaterThan(10);
    }
  });

  it("rejects HTTP packet PDF export when packet is not finalized", async () => {
    const { caseId } = await createNormalizedCase("Draft Export Matter", "draft-export-1");

    const createPacketRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-packets`,
      payload: { packet_name: "Draft Packet" }
    });
    expect(createPacketRes.statusCode).toBe(200);
    const packetId = createPacketRes.json<{ packet: { id: string } }>().packet.id;

    const exportRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-packets/${packetId}/exports/packet-pdf`,
      payload: {}
    });
    expect(exportRes.statusCode).toBe(400);
    expect(exportRes.json<{ ok: false; error: string }>().error).toContain("export-ready");
  });

  it("rejects target document source items that belong to another case", async () => {
    const { caseId } = await createNormalizedCase("Packet Target Matter", "target-doc-1");
    const { caseId: otherCaseId } = await createNormalizedCase("Packet Other Target Matter", "target-doc-2");

    const otherSourceItem = db
      .prepare(`SELECT id FROM source_items WHERE case_id = ? LIMIT 1`)
      .get(otherCaseId) as { id: string } | undefined;
    expect(otherSourceItem?.id).toBeTruthy();

    const createPacketRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-packets`,
      payload: {
        packet_name: "Targeted Packet",
        target_document_source_item_id: otherSourceItem!.id
      }
    });
    expect(createPacketRes.statusCode).toBe(400);
    expect(createPacketRes.json<{ ok: false; error: string }>().error).toContain("target document source item");

    const validPacketRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-packets`,
      payload: { packet_name: "Valid Target Packet" }
    });
    expect(validPacketRes.statusCode).toBe(200);
    const packetId = validPacketRes.json<{ packet: { id: string } }>().packet.id;

    const updatePacketRes = await app.inject({
      method: "PATCH",
      url: `/api/cases/${caseId}/exhibit-packets/${packetId}`,
      payload: {
        target_document_source_item_id: otherSourceItem!.id
      }
    });
    expect(updatePacketRes.statusCode).toBe(400);
    expect(updatePacketRes.json<{ ok: false; error: string }>().error).toContain("target document source item");
  });

  it("rejects a second active packet for the same case", async () => {
    const { caseId } = await createNormalizedCase("Single Packet Matter", "single-packet-1");

    const first = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-packets`,
      payload: { packet_name: "First Packet" }
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-packets`,
      payload: { packet_name: "Second Packet" }
    });
    expect(second.statusCode).toBe(400);
    expect(second.json()).toEqual({
      ok: false,
      error: "an active hearing_packet package already exists for this case"
    });
  });

  it("rejects duplicate section keys and packet-wide duplicate source assignment", async () => {
    const { caseId } = await createNormalizedCase("Duplicate Guards Matter", "duplicate-guard-1");

    const createPacketRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-packets`,
      payload: { packet_name: "Guard Packet" }
    });
    const packet = createPacketRes.json<{
      packet: { id: string; sections: Array<{ id: string; section_key: string; exhibits: Array<{ id: string }> }> };
    }>().packet;

    const duplicateSectionRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-packets/${packet.id}/sections`,
      payload: { section_key: "employee", section_label: "Duplicate Employee" }
    });
    expect(duplicateSectionRes.statusCode).toBe(400);

    const employeeSection = packet.sections.find((section) => section.section_key === "employee")!;

    const addSectionRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-packets/${packet.id}/sections`,
      payload: { section_key: "other", section_label: "Other Exhibits" }
    });
    expect(addSectionRes.statusCode).toBe(200);
    const otherSection = addSectionRes.json<{
      packet: { sections: Array<{ id: string; section_key: string }> };
    }>().packet.sections.find((s) => s.section_key === "other")!;

    const employeeSlotId = employeeSection.exhibits?.[0]?.id ?? (() => { throw new Error("no starter slot"); })();

    const otherSlotRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-sections/${otherSection.id}/exhibits`,
      payload: { title: "Other Slot" }
    });
    const otherSlotId = otherSlotRes.json<{
      packet: { sections: Array<{ section_key: string; exhibits: Array<{ id: string }> }> };
    }>().packet.sections.find((section) => section.section_key === "other")!.exhibits[0]!.id;

    const sourceItem = db
      .prepare(`SELECT id FROM source_items WHERE case_id = ? LIMIT 1`)
      .get(caseId) as { id: string };

    const firstAssign = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibits/${employeeSlotId}/items`,
      payload: { source_item_id: sourceItem.id }
    });
    expect(firstAssign.statusCode).toBe(200);

    const duplicateAssign = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibits/${otherSlotId}/items`,
      payload: { source_item_id: sourceItem.id }
    });
    expect(duplicateAssign.statusCode).toBe(400);
    expect(duplicateAssign.json<{ ok: false; error: string }>().error).toContain("source item already assigned to exhibit");
  });

  it("reorders sections and exhibits through explicit reorder endpoints", async () => {
    const { caseId } = await createNormalizedCase("Reorder Matter", "reorder-1");
    const packetRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-packets`,
      payload: { packet_name: "Reorder Packet" }
    });
    const packet = packetRes.json<{ packet: { id: string; sections: Array<{ id: string; section_key: string }> } }>().packet;

    const employeeSection = packet.sections.find((section) => section.section_key === "employee")!;

    const addSec1 = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-packets/${packet.id}/sections`,
      payload: { section_key: "employer", section_label: "Employer Exhibits" }
    });
    expect(addSec1.statusCode).toBe(200);
    const employerSection = addSec1.json<{
      packet: { sections: Array<{ id: string; section_key: string }> };
    }>().packet.sections.find((s) => s.section_key === "employer")!;

    const sectionReorderRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-packets/${packet.id}/sections/reorder`,
      payload: { section_ids: [employerSection.id, employeeSection.id] }
    });
    expect(sectionReorderRes.statusCode).toBe(200);
    const sectionRows = db
      .prepare(`SELECT id, sort_order FROM exhibit_sections WHERE exhibit_packet_id = ? ORDER BY sort_order ASC`)
      .all(packet.id) as Array<{ id: string; sort_order: number }>;
    expect(sectionRows[0]!.id).toBe(employerSection.id);

    const starterExhibits = db
      .prepare(`SELECT id FROM exhibits WHERE exhibit_section_id = ? ORDER BY sort_order ASC`)
      .all(employeeSection.id) as Array<{ id: string }>;
    expect(starterExhibits.length).toBeGreaterThanOrEqual(2);

    const exhibitReorderRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-sections/${employeeSection.id}/exhibits/reorder`,
      payload: { exhibit_ids: [starterExhibits[1]!.id, starterExhibits[0]!.id, ...starterExhibits.slice(2).map((e) => e.id)] }
    });
    expect(exhibitReorderRes.statusCode).toBe(200);
    const exhibitRows = db
      .prepare(`SELECT id, sort_order FROM exhibits WHERE exhibit_section_id = ? ORDER BY sort_order ASC`)
      .all(employeeSection.id) as Array<{ id: string; sort_order: number }>;
    expect(exhibitRows[0]!.id).toBe(starterExhibits[1]!.id);
  });

  it("enforces case ownership on case-scoped exhibit routes", async () => {
    const first = await createNormalizedCase("Ownership Matter A", "ownership-a");
    const second = await createNormalizedCase("Ownership Matter B", "ownership-b");

    const packetRes = await app.inject({
      method: "POST",
      url: `/api/cases/${first.caseId}/exhibit-packets`,
      payload: { packet_name: "Owned Packet" }
    });
    const packet = packetRes.json<{ packet: { id: string; sections: Array<{ id: string; section_key: string }> } }>().packet;
    const sectionId = packet.sections.find((section) => section.section_key === "employee")!.id;

    const crossCaseExhibit = await app.inject({
      method: "POST",
      url: `/api/cases/${second.caseId}/exhibits`,
      payload: { section_id: sectionId, title: "Should Fail" }
    });
    expect(crossCaseExhibit.statusCode).toBe(404);

    const crossCasePreview = await app.inject({
      method: "POST",
      url: `/api/cases/${second.caseId}/packet-preview`,
      payload: { packet_id: packet.id }
    });
    expect(crossCasePreview.statusCode).toBe(404);

    const crossCaseExhibitList = await app.inject({
      method: "POST",
      url: `/api/cases/${second.caseId}/exhibit-list/generate`,
      payload: { packet_id: packet.id }
    });
    expect(crossCaseExhibitList.statusCode).toBe(404);
  });

  it("uses effective included page counts in packet preview and markdown exhibit list", async () => {
    const { caseId } = await createNormalizedCase("Effective Count Matter", "effective-count-1");

    const packetRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-packets`,
      payload: { packet_name: "Count Packet" }
    });
    const packet = packetRes.json<{ packet: { id: string; sections: Array<{ id: string; section_key: string }> } }>().packet;
    const employeeSection = packet.sections.find((section) => section.section_key === "employee")!;

    const slotRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-sections/${employeeSection.id}/exhibits`,
      payload: { title: "Paged Slot" }
    });
    const slotId = slotRes.json<{
      packet: { sections: Array<{ section_key: string; exhibits: Array<{ id: string }> }> };
    }>().packet.sections.find((section) => section.section_key === "employee")!.exhibits[0]!.id;

    const sourceItem = db
      .prepare(`SELECT id FROM source_items WHERE case_id = ? LIMIT 1`)
      .get(caseId) as { id: string };
    const addItemRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibits/${slotId}/items`,
      payload: { source_item_id: sourceItem.id }
    });
    const addedItem = addItemRes.json<{
      packet: { sections: Array<{ section_key: string; exhibits: Array<{ items: Array<{ id: string }> }> }> };
    }>().packet.sections.find((section) => section.section_key === "employee")!.exhibits[0]!.items[0]!;
    const itemId = addedItem.id;
    const canonicalDocumentId = db
      .prepare(`SELECT canonical_document_id FROM exhibit_items WHERE id = ? LIMIT 1`)
      .get(itemId) as { canonical_document_id: string | null } | undefined;
    expect(canonicalDocumentId?.canonical_document_id).toBeTruthy();

    const pageIds = (
      db
        .prepare(`SELECT id FROM canonical_pages WHERE canonical_doc_id = ? ORDER BY page_number_in_doc ASC`)
        .all(canonicalDocumentId!.canonical_document_id) as Array<{ id: string }>
    ).map((row) => row.id);
    expect(pageIds.length).toBeGreaterThan(0);

    await app.inject({
      method: "PATCH",
      url: `/api/cases/${caseId}/exhibit-items/${itemId}/page-rules`,
      payload: { exclude_canonical_page_ids: [pageIds[0]!] }
    });

    const previewRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/packet-preview`,
      payload: { packet_id: packet.id }
    });
    expect(previewRes.statusCode).toBe(200);
    const preview = previewRes.json<{
      preview: { sections: Array<{ exhibits: Array<{ page_count_estimate: number; excluded_page_count: number }> }> };
    }>().preview;
    const exhibit = preview.sections[0]!.exhibits[0]!;
    expect(exhibit.excluded_page_count).toBe(1);
    expect(exhibit.page_count_estimate).toBe(0);

    const listRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-list/generate`,
      payload: { packet_id: packet.id }
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json<{ markdown: string }>().markdown).toContain("(0 pages)");
  });

  it("supports suggestion resolution and packet history retrieval", async () => {
    const { caseId } = await createNormalizedCase("Suggestion History Matter", "suggest-history-1");

    const packetRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-packets`,
      payload: { packet_name: "Suggestion Packet" }
    });
    const packet = packetRes.json<{ packet: { id: string } }>().packet;

    const suggestionsRes = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/exhibit-packets/${packet.id}/suggestions`
    });
    expect(suggestionsRes.statusCode).toBe(200);
    const suggestions = suggestionsRes.json<{ suggestions: Array<{ id: string }> }>().suggestions;
    expect(suggestions.length).toBeGreaterThan(0);

    const resolveRes = await app.inject({
      method: "POST",
      url: `/api/cases/${caseId}/exhibit-packets/${packet.id}/suggestions/${encodeURIComponent(suggestions[0]!.id)}/resolve`,
      payload: { action: "dismiss" }
    });
    expect(resolveRes.statusCode).toBe(200);

    const suggestionsAfter = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/exhibit-packets/${packet.id}/suggestions`
    });
    const nextSuggestions = suggestionsAfter.json<{ suggestions: Array<{ id: string }> }>().suggestions;
    expect(nextSuggestions.some((row) => row.id === suggestions[0]!.id)).toBe(false);

    const historyRes = await app.inject({
      method: "GET",
      url: `/api/cases/${caseId}/exhibit-packets/${packet.id}/history`
    });
    expect(historyRes.statusCode).toBe(200);
    expect(historyRes.json<{ history: Array<{ action_type: string }> }>().history.some((row) => row.action_type === "suggestion_resolved")).toBe(true);
  });
});
