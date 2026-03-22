import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import {
  addExhibitItem,
  createExhibit,
  createExhibitPacket,
  createExhibitSection,
  deleteExhibit,
  deleteExhibitSection,
  finalizeExhibitPacket,
  getCaseExhibitWorkspace,
  getPacketHistory,
  getPacketPreview,
  getPacketSuggestions,
  removeExhibitItem,
  reorderExhibitsInSection,
  reorderExhibitSections,
  resolveExhibitSuggestion,
  updateExhibit,
  updateExhibitItemPageRules,
  updateExhibitPacket,
  updateExhibitSection
} from "../exhibits.js";
import {
  getPacketExportRow,
  listPacketExportsForPacket,
  parsePacketPdfExportOptions,
  resolveExportAbsolutePath,
  runPacketPdfExport
} from "../packet-pdf.js";
import type { CaseRouteReply, HeaderRouteReply } from "./types.js";

export interface RegisterExhibitRoutesInput {
  app: FastifyInstance;
  db: Database.Database;
  packetPdfExportDailyLimit: number;
  assertCaseExists: (caseId: string, reply: CaseRouteReply, errorMessage?: string) => boolean;
  assertPacketBelongsToCase: (
    caseId: string,
    packetId: string,
    reply: CaseRouteReply,
    errorMessage?: string
  ) => boolean;
  assertSectionBelongsToCase: (
    caseId: string,
    sectionId: string,
    reply: CaseRouteReply,
    errorMessage?: string
  ) => boolean;
  assertExhibitBelongsToCase: (
    caseId: string,
    exhibitId: string,
    reply: CaseRouteReply,
    errorMessage?: string
  ) => boolean;
  assertExhibitItemBelongsToCase: (
    caseId: string,
    itemId: string,
    reply: CaseRouteReply,
    errorMessage?: string
  ) => boolean;
  enforceCaseDailyUsageLimit: (
    reply: HeaderRouteReply,
    input: {
      caseId: string;
      counterKey: string;
      limit: number;
      label: string;
    }
  ) => boolean;
  enforceExpensiveRouteRateLimit: (
    request: { ip: string },
    reply: HeaderRouteReply,
    bucket: string
  ) => boolean;
  fetchPdfBytesForSourceItem: (sourceItemId: string) => Promise<Buffer>;
}

export function registerExhibitRoutes(input: RegisterExhibitRoutesInput) {
  const {
    app,
    db,
    packetPdfExportDailyLimit,
    assertCaseExists,
    assertPacketBelongsToCase,
    assertSectionBelongsToCase,
    assertExhibitBelongsToCase,
    assertExhibitItemBelongsToCase,
    enforceCaseDailyUsageLimit,
    enforceExpensiveRouteRateLimit,
    fetchPdfBytesForSourceItem
  } = input;

  app.get("/api/cases/:caseId/exhibit-packets", async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    if (!assertCaseExists(caseId, reply)) {
      return;
    }
    return {
      ok: true,
      case_id: caseId,
      packets: getCaseExhibitWorkspace(db, caseId)
    };
  });

  app.get("/api/cases/:caseId/exhibits", async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    if (!assertCaseExists(caseId, reply)) {
      return;
    }
    return {
      ok: true,
      case_id: caseId,
      packets: getCaseExhibitWorkspace(db, caseId)
    };
  });

  app.post("/api/cases/:caseId/exhibit-packets", async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const body = request.body as
      | {
          packet_name?: string;
          packet_mode?: "compact" | "full";
          naming_scheme?: string;
          package_type?: string;
          package_label?: string;
          target_document_source_item_id?: string;
          starter_slot_count?: number;
        }
      | undefined;
    if (!assertCaseExists(caseId, reply)) return;

    const pkgType = body?.package_type?.trim() ?? "hearing_packet";
    const starterSlots =
      body?.starter_slot_count !== undefined
        ? body.starter_slot_count
        : pkgType === "hearing_packet"
          ? undefined
          : 0;

    const packet = createExhibitPacket(db, {
      caseId,
      packetName: body?.packet_name ?? null,
      packetMode: body?.packet_mode ?? null,
      namingScheme: body?.naming_scheme ?? null,
      packageType: pkgType,
      packageLabel: body?.package_label ?? null,
      targetDocumentSourceItemId: body?.target_document_source_item_id ?? null,
      starterSlotCount: starterSlots
    });
    if (!packet.ok) {
      return reply.code(400).send({ ok: false, error: packet.error });
    }

    return { ok: true, case_id: caseId, packet: packet.packet };
  });

  app.patch("/api/cases/:caseId/exhibit-packets/:packetId", async (request, reply) => {
    const { caseId, packetId } = request.params as { caseId: string; packetId: string };
    if (!assertPacketBelongsToCase(caseId, packetId, reply, "packet not found")) return;
    const body = request.body as
      | {
          packet_name?: string | null;
          packet_mode?: "compact" | "full" | null;
          naming_scheme?: string | null;
          status?: "draft" | "needs_review" | "ready" | "finalized" | "exported" | "archived" | null;
          package_type?: string | null;
          package_label?: string | null;
          target_document_source_item_id?: string | null;
          run_status?: string | null;
        }
      | undefined;

    const updated = updateExhibitPacket(db, {
      packetId,
      packetName: body?.packet_name,
      packetMode: body?.packet_mode ?? undefined,
      namingScheme: body?.naming_scheme,
      status: body?.status ?? undefined,
      packageType: body?.package_type,
      packageLabel: body?.package_label,
      targetDocumentSourceItemId: body?.target_document_source_item_id,
      runStatus: body?.run_status
    });
    if (updated && typeof updated === "object" && "ok" in updated && updated.ok === false) {
      const statusCode = updated.error === "packet not found" ? 404 : 400;
      return reply.code(statusCode).send({ ok: false, error: updated.error });
    }
    if (!updated) {
      return reply.code(404).send({ ok: false, error: "packet not found" });
    }

    return { ok: true, packet: updated };
  });

  app.post("/api/cases/:caseId/exhibit-packets/:packetId/sections", async (request, reply) => {
    const { caseId, packetId } = request.params as { caseId: string; packetId: string };
    if (!assertPacketBelongsToCase(caseId, packetId, reply, "packet not found")) return;
    const body = request.body as { section_key?: string; section_label?: string } | undefined;
    const packet = createExhibitSection(db, {
      packetId,
      sectionKey: body?.section_key ?? null,
      sectionLabel: body?.section_label ?? null
    });
    if (!packet.ok) {
      const code = /already exists/i.test(packet.error) ? 400 : 404;
      return reply.code(code).send({ ok: false, error: packet.error });
    }
    return { ok: true, packet: packet.packet };
  });

  app.post("/api/cases/:caseId/exhibit-packets/:packetId/sections/reorder", async (request, reply) => {
    const { caseId, packetId } = request.params as { caseId: string; packetId: string };
    if (!assertPacketBelongsToCase(caseId, packetId, reply, "packet not found")) return;
    const body = request.body as { section_ids?: string[] } | undefined;
    if (!body?.section_ids?.length) {
      return reply.code(400).send({ ok: false, error: "section_ids are required" });
    }
    const result = reorderExhibitSections(db, packetId, body.section_ids);
    if (!result.ok) {
      const code = /not found/i.test(result.error) ? 404 : 400;
      return reply.code(code).send({ ok: false, error: result.error });
    }
    return { ok: true, packet: result.packet };
  });

  app.post("/api/cases/:caseId/exhibit-sections/:sectionId/exhibits/reorder", async (request, reply) => {
    const { caseId, sectionId } = request.params as { caseId: string; sectionId: string };
    if (!assertSectionBelongsToCase(caseId, sectionId, reply, "section not found")) return;
    const body = request.body as { exhibit_ids?: string[] } | undefined;
    if (!body?.exhibit_ids?.length) {
      return reply.code(400).send({ ok: false, error: "exhibit_ids are required" });
    }
    const result = reorderExhibitsInSection(db, sectionId, body.exhibit_ids);
    if (!result.ok) {
      const code = /not found/i.test(result.error) ? 404 : 400;
      return reply.code(code).send({ ok: false, error: result.error });
    }
    return { ok: true, packet: result.packet };
  });

  app.patch("/api/cases/:caseId/exhibit-sections/:sectionId", async (request, reply) => {
    const { caseId, sectionId } = request.params as { caseId: string; sectionId: string };
    if (!assertSectionBelongsToCase(caseId, sectionId, reply, "section not found")) return;
    const body = request.body as { section_label?: string | null; sort_order?: number | null } | undefined;
    const packet = updateExhibitSection(db, {
      sectionId,
      sectionLabel: body?.section_label,
      sortOrder: body?.sort_order ?? undefined
    });
    if (!packet) {
      return reply.code(404).send({ ok: false, error: "section not found" });
    }
    return { ok: true, packet };
  });

  app.delete("/api/cases/:caseId/exhibit-sections/:sectionId", async (request, reply) => {
    const { caseId, sectionId } = request.params as { caseId: string; sectionId: string };
    if (!assertSectionBelongsToCase(caseId, sectionId, reply, "section not found")) return;
    const packet = deleteExhibitSection(db, sectionId);
    if (!packet) {
      return reply.code(404).send({ ok: false, error: "section not found" });
    }
    return { ok: true, packet };
  });

  app.post("/api/cases/:caseId/exhibit-sections/:sectionId/exhibits", async (request, reply) => {
    const { caseId, sectionId } = request.params as { caseId: string; sectionId: string };
    if (!assertSectionBelongsToCase(caseId, sectionId, reply, "section not found")) return;
    const body = request.body as
      | {
          exhibit_label?: string | null;
          title?: string | null;
          purpose?: string | null;
          objection_risk?: string | null;
          notes?: string | null;
        }
      | undefined;
    const packet = createExhibit(db, {
      sectionId,
      exhibitLabel: body?.exhibit_label ?? null,
      title: body?.title ?? null,
      purpose: body?.purpose ?? null,
      objectionRisk: body?.objection_risk ?? null,
      notes: body?.notes ?? null
    });
    if (!packet) {
      return reply.code(404).send({ ok: false, error: "section not found" });
    }
    return { ok: true, packet };
  });

  app.post("/api/cases/:caseId/exhibits", async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const body = request.body as
      | {
          section_id?: string;
          exhibit_label?: string | null;
          title?: string | null;
          purpose?: string | null;
          objection_risk?: string | null;
          notes?: string | null;
        }
      | undefined;
    if (!assertCaseExists(caseId, reply)) return;
    if (!body?.section_id) {
      return reply.code(400).send({ ok: false, error: "section_id is required" });
    }
    if (!assertSectionBelongsToCase(caseId, body.section_id, reply, "section not found for case")) return;
    const packet = createExhibit(db, {
      sectionId: body.section_id,
      exhibitLabel: body.exhibit_label ?? null,
      title: body.title ?? null,
      purpose: body.purpose ?? null,
      objectionRisk: body.objection_risk ?? null,
      notes: body.notes ?? null
    });
    if (!packet) {
      return reply.code(404).send({ ok: false, error: "section not found" });
    }
    return { ok: true, packet };
  });

  app.patch("/api/cases/:caseId/exhibits/:exhibitId", async (request, reply) => {
    const { caseId, exhibitId } = request.params as { caseId: string; exhibitId: string };
    if (!assertExhibitBelongsToCase(caseId, exhibitId, reply, "exhibit not found")) return;
    const body = request.body as
      | {
          exhibit_label?: string | null;
          title?: string | null;
          status?: string | null;
          purpose?: string | null;
          objection_risk?: string | null;
          notes?: string | null;
          sort_order?: number | null;
        }
      | undefined;
    const packet = updateExhibit(db, {
      exhibitId,
      exhibitLabel: body?.exhibit_label,
      title: body?.title,
      status: body?.status,
      purpose: body?.purpose,
      objectionRisk: body?.objection_risk,
      notes: body?.notes,
      sortOrder: body?.sort_order ?? undefined
    });
    if (!packet) {
      return reply.code(404).send({ ok: false, error: "exhibit not found" });
    }
    return { ok: true, packet };
  });

  app.delete("/api/cases/:caseId/exhibits/:exhibitId", async (request, reply) => {
    const { caseId, exhibitId } = request.params as { caseId: string; exhibitId: string };
    if (!assertExhibitBelongsToCase(caseId, exhibitId, reply, "exhibit not found")) return;
    const packet = deleteExhibit(db, exhibitId);
    if (!packet) {
      return reply.code(404).send({ ok: false, error: "exhibit not found" });
    }
    return { ok: true, packet };
  });

  app.post("/api/cases/:caseId/exhibits/:exhibitId/items", async (request, reply) => {
    const { caseId, exhibitId } = request.params as { caseId: string; exhibitId: string };
    if (!assertExhibitBelongsToCase(caseId, exhibitId, reply, "exhibit not found")) return;
    const body = request.body as { source_item_id?: string; notes?: string | null } | undefined;
    if (!body?.source_item_id) {
      return reply.code(400).send({ ok: false, error: "source_item_id is required" });
    }
    const result = addExhibitItem(db, {
      exhibitId,
      sourceItemId: body.source_item_id,
      notes: body.notes ?? null
    });
    if (!result.ok) {
      const code = /not found/i.test(result.error) ? 404 : 400;
      return reply.code(code).send({ ok: false, error: result.error });
    }
    return { ok: true, packet: result.packet };
  });

  app.delete("/api/cases/:caseId/exhibit-items/:itemId", async (request, reply) => {
    const { caseId, itemId } = request.params as { caseId: string; itemId: string };
    if (!assertExhibitItemBelongsToCase(caseId, itemId, reply, "exhibit item not found")) return;
    const packet = removeExhibitItem(db, itemId);
    if (!packet) {
      return reply.code(404).send({ ok: false, error: "exhibit item not found" });
    }
    return { ok: true, packet };
  });

  app.patch("/api/cases/:caseId/exhibit-items/:itemId/page-rules", async (request, reply) => {
    const { caseId, itemId } = request.params as { caseId: string; itemId: string };
    if (!assertExhibitItemBelongsToCase(caseId, itemId, reply, "exhibit item not found")) return;
    const body = request.body as { exclude_canonical_page_ids?: string[] } | undefined;
    if (body?.exclude_canonical_page_ids && body.exclude_canonical_page_ids.length > 1000) {
      return reply.code(400).send({ ok: false, error: "exclude_canonical_page_ids may not exceed 1000 items" });
    }
    const result = updateExhibitItemPageRules(db, {
      exhibitItemId: itemId,
      excludeCanonicalPageIds: body?.exclude_canonical_page_ids ?? []
    });
    if (!result.ok) {
      const code = /not found/i.test(result.error) ? 404 : 400;
      return reply.code(code).send({ ok: false, error: result.error });
    }
    return { ok: true, packet: result.packet };
  });

  app.get("/api/cases/:caseId/exhibit-packets/:packetId/suggestions", async (request, reply) => {
    const { caseId, packetId } = request.params as { caseId: string; packetId: string };
    if (!assertPacketBelongsToCase(caseId, packetId, reply, "packet not found")) return;
    const suggestions = getPacketSuggestions(db, packetId);
    if (!suggestions) {
      return reply.code(404).send({ ok: false, error: "packet not found" });
    }
    return { ok: true, suggestions };
  });

  app.get("/api/cases/:caseId/exhibit-packets/:packetId/history", async (request, reply) => {
    const { caseId, packetId } = request.params as { caseId: string; packetId: string };
    if (!assertPacketBelongsToCase(caseId, packetId, reply, "packet not found")) return;
    const history = getPacketHistory(db, packetId);
    if (!history) {
      return reply.code(404).send({ ok: false, error: "packet not found" });
    }
    return { ok: true, history };
  });

  app.post("/api/cases/:caseId/exhibit-packets/:packetId/suggestions/:suggestionId/resolve", async (request, reply) => {
    const { caseId, packetId, suggestionId } = request.params as { caseId: string; packetId: string; suggestionId: string };
    if (!assertPacketBelongsToCase(caseId, packetId, reply, "packet not found")) return;
    const body = request.body as { action?: "accept" | "dismiss"; note?: string | null } | undefined;
    if (body?.action !== "accept" && body?.action !== "dismiss") {
      return reply.code(400).send({ ok: false, error: "action must be accept or dismiss" });
    }
    const result = resolveExhibitSuggestion(db, {
      packetId,
      suggestionId,
      action: body.action,
      note: body.note ?? null
    });
    if (!result.ok) {
      const code = /not found/i.test(result.error) ? 404 : 400;
      return reply.code(code).send({ ok: false, error: result.error });
    }
    return { ok: true, packet: result.packet };
  });

  app.post("/api/cases/:caseId/exhibit-packets/:packetId/finalize", async (request, reply) => {
    const { caseId, packetId } = request.params as { caseId: string; packetId: string };
    if (!assertPacketBelongsToCase(caseId, packetId, reply, "packet not found")) return;
    const result = finalizeExhibitPacket(db, packetId);
    if (!result) {
      return reply.code(404).send({ ok: false, error: "packet not found" });
    }
    return { ok: true, packet: result.packet, suggestions: result.suggestions, preview: result.preview };
  });

  app.post("/api/cases/:caseId/exhibit-packets/:packetId/exports/packet-pdf", async (request, reply) => {
    if (!enforceExpensiveRouteRateLimit(request, reply, "packet-pdf-export")) return;
    const { caseId, packetId } = request.params as { caseId: string; packetId: string };
    if (!assertPacketBelongsToCase(caseId, packetId, reply, "packet not found")) return;
    if (
      !enforceCaseDailyUsageLimit(reply, {
        caseId,
        counterKey: "packet_pdf_export",
        limit: packetPdfExportDailyLimit,
        label: "packet PDF exports"
      })
    ) {
      return;
    }
    const layout = parsePacketPdfExportOptions(request.body);
    try {
      const result = await runPacketPdfExport(db, packetId, fetchPdfBytesForSourceItem, layout);
      if (!result.ok) {
        const code = /not found/i.test(result.error) ? 404 : 400;
        return reply.code(code).send({
          ok: false,
          error: result.error,
          export_id: result.exportId ?? null,
          manifest: result.manifest ?? null
        });
      }
      return {
        ok: true,
        export_id: result.exportId,
        page_count: result.pageCount,
        manifest: result.manifest,
        pdf_relative_path: result.relativePdfPath
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ ok: false, error: message });
    }
  });

  app.get("/api/cases/:caseId/exhibit-packets/:packetId/exports", async (request, reply) => {
    const { caseId, packetId } = request.params as { caseId: string; packetId: string };
    if (!assertPacketBelongsToCase(caseId, packetId, reply, "packet not found")) return;
    return { ok: true, exports: listPacketExportsForPacket(db, packetId) };
  });

  app.get("/api/cases/:caseId/exhibit-packet-exports/:exportId", async (request, reply) => {
    const { caseId, exportId } = request.params as { caseId: string; exportId: string };
    const row = getPacketExportRow(db, exportId);
    if (!row || row.case_id !== caseId) {
      return reply.code(404).send({ ok: false, error: "export not found" });
    }
    let manifest: unknown = null;
    if (row.manifest_json) {
      try {
        manifest = JSON.parse(row.manifest_json) as unknown;
      } catch {
        manifest = row.manifest_json;
      }
    }
    return {
      ok: true,
      export: {
        ...row,
        manifest
      }
    };
  });

  app.get("/api/cases/:caseId/exhibit-packet-exports/:exportId/pdf", async (request, reply) => {
    const { caseId, exportId } = request.params as { caseId: string; exportId: string };
    const row = getPacketExportRow(db, exportId);
    if (!row || row.case_id !== caseId || row.status !== "complete" || !row.pdf_relative_path) {
      return reply.code(404).send({ ok: false, error: "export PDF not available" });
    }
    const abs = resolveExportAbsolutePath(row.pdf_relative_path);
    try {
      const buf = await readFile(abs);
      reply.header("content-type", "application/pdf");
      reply.header("content-disposition", `attachment; filename="exhibit-packet-${exportId.slice(0, 8)}.pdf"`);
      return reply.send(buf);
    } catch {
      return reply.code(404).send({ ok: false, error: "export file missing on disk" });
    }
  });

  app.post("/api/cases/:caseId/packet-preview", async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const body = request.body as { packet_id?: string } | undefined;
    if (!assertCaseExists(caseId, reply)) return;
    if (!body?.packet_id) {
      return reply.code(400).send({ ok: false, error: "packet_id is required" });
    }
    if (!assertPacketBelongsToCase(caseId, body.packet_id, reply, "packet not found for case")) return;
    const preview = getPacketPreview(db, body.packet_id);
    if (!preview) {
      return reply.code(404).send({ ok: false, error: "packet not found" });
    }
    return { ok: true, preview };
  });

  app.post("/api/cases/:caseId/exhibit-list/generate", async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const body = request.body as { packet_id?: string } | undefined;
    if (!assertCaseExists(caseId, reply)) return;
    if (!body?.packet_id) {
      return reply.code(400).send({ ok: false, error: "packet_id is required" });
    }
    if (!assertPacketBelongsToCase(caseId, body.packet_id, reply, "packet not found for case")) return;
    const preview = getPacketPreview(db, body.packet_id);
    if (!preview) {
      return reply.code(404).send({ ok: false, error: "packet not found" });
    }
    const lines = preview.sections.flatMap((section) => {
      const header = `## ${section.section_label}`;
      const entries = section.exhibits.map((exhibit) => {
        const title = exhibit.title?.trim() || "Untitled Exhibit";
        return `- Exhibit ${exhibit.exhibit_label}: ${title} (${exhibit.page_count_estimate} pages)`;
      });
      return [header, ...entries];
    });
    return {
      ok: true,
      packet_id: body.packet_id,
      markdown: lines.join("\n")
    };
  });
}
