import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  MAX_TEMPLATE_BODY_MARKDOWN,
  buildFieldsForRender,
  createUserDocumentTemplate,
  deleteTemplateFill,
  deleteUserDocumentTemplate,
  getTemplateFill,
  getUserDocumentTemplate,
  listTemplateFills,
  listUserDocumentTemplates,
  renderUserTemplate,
  saveTemplateFill,
  serializeUserDocumentFill,
  serializeUserDocumentTemplate,
  updateTemplateFill,
  updateUserDocumentTemplate,
  validateValuesPayload
} from "../document-templates.js";
import { requireCaseAccess, requireWriteActor } from "../auth.js";
import type { CaseRouteReply } from "./types.js";

export interface RegisterDocumentTemplateRoutesInput {
  app: FastifyInstance;
  db: Database.Database;
  assertCaseExists: (caseId: string, reply: CaseRouteReply) => boolean;
}

export function registerDocumentTemplateRoutes(input: RegisterDocumentTemplateRoutesInput) {
  const { app, db, assertCaseExists } = input;

  function requireTemplateCaseAccess(request: FastifyRequest, reply: FastifyReply, caseId: string) {
    if (!assertCaseExists(caseId, reply)) {
      return null;
    }
    return requireCaseAccess(db, request, reply, caseId);
  }

  app.get("/api/cases/:caseId/document-templates", async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    if (!requireTemplateCaseAccess(request, reply, caseId)) {
      return;
    }
    const rows = listUserDocumentTemplates(db, caseId);
    return {
      ok: true,
      case_id: caseId,
      templates: rows.map(serializeUserDocumentTemplate)
    };
  });

  app.post("/api/cases/:caseId/document-templates", async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    if (!requireTemplateCaseAccess(request, reply, caseId)) {
      return;
    }
    const actor = requireWriteActor(request, reply);
    if (!actor) {
      return;
    }
    const body = request.body as
      | {
          name?: string;
          description?: string | null;
          body_markdown?: string;
          fields?: Array<{ name: string; label?: string; default?: string | null }>;
          ai_hints?: string | null;
        }
      | undefined;
    const bodyMarkdown = typeof body?.body_markdown === "string" ? body.body_markdown : "";
    if (!bodyMarkdown.trim()) {
      return reply.code(400).send({ ok: false, error: "body_markdown is required" });
    }
    if (bodyMarkdown.length > MAX_TEMPLATE_BODY_MARKDOWN) {
      return reply.code(400).send({ ok: false, error: "body_markdown is too large" });
    }
    const row = createUserDocumentTemplate(db, {
      caseId,
      name: body?.name ?? "Untitled template",
      description: body?.description,
      body_markdown: bodyMarkdown,
      fields: body?.fields,
      ai_hints: body?.ai_hints,
      actorLabel: actor.actorLabel,
      actorUserId: actor.actorUserId
    });
    return { ok: true, case_id: caseId, template: row ? serializeUserDocumentTemplate(row) : null };
  });

  app.get("/api/cases/:caseId/document-templates/:templateId", async (request, reply) => {
    const { caseId, templateId } = request.params as { caseId: string; templateId: string };
    if (!requireTemplateCaseAccess(request, reply, caseId)) {
      return;
    }
    const row = getUserDocumentTemplate(db, templateId, caseId);
    if (!row) {
      return reply.code(404).send({ ok: false, error: "template not found" });
    }
    return { ok: true, case_id: caseId, template: serializeUserDocumentTemplate(row) };
  });

  app.patch("/api/cases/:caseId/document-templates/:templateId", async (request, reply) => {
    const { caseId, templateId } = request.params as { caseId: string; templateId: string };
    if (!requireTemplateCaseAccess(request, reply, caseId)) {
      return;
    }
    const actor = requireWriteActor(request, reply);
    if (!actor) {
      return;
    }
    const body = request.body as
      | {
          name?: string | null;
          description?: string | null;
          body_markdown?: string | null;
          fields?: Array<{ name: string; label?: string; default?: string | null }> | null;
          ai_hints?: string | null;
        }
      | undefined;
    if (typeof body?.body_markdown === "string" && body.body_markdown.length > MAX_TEMPLATE_BODY_MARKDOWN) {
      return reply.code(400).send({ ok: false, error: "body_markdown is too large" });
    }
    const row = updateUserDocumentTemplate(db, {
      templateId,
      caseId,
      name: body?.name,
      description: body?.description,
      body_markdown: body?.body_markdown,
      fields: body?.fields,
      ai_hints: body?.ai_hints,
      actorLabel: actor.actorLabel,
      actorUserId: actor.actorUserId
    });
    if (!row) {
      return reply.code(404).send({ ok: false, error: "template not found" });
    }
    return { ok: true, case_id: caseId, template: serializeUserDocumentTemplate(row) };
  });

  app.delete("/api/cases/:caseId/document-templates/:templateId", async (request, reply) => {
    const { caseId, templateId } = request.params as { caseId: string; templateId: string };
    if (!requireTemplateCaseAccess(request, reply, caseId)) {
      return;
    }
    if (!requireWriteActor(request, reply)) {
      return;
    }
    const deleted = deleteUserDocumentTemplate(db, templateId, caseId);
    if (!deleted) {
      return reply.code(404).send({ ok: false, error: "template not found" });
    }
    return { ok: true, case_id: caseId };
  });

  app.post("/api/cases/:caseId/document-templates/:templateId/render", async (request, reply) => {
    const { caseId, templateId } = request.params as { caseId: string; templateId: string };
    if (!requireTemplateCaseAccess(request, reply, caseId)) {
      return;
    }
    const template = getUserDocumentTemplate(db, templateId, caseId);
    if (!template) {
      return reply.code(404).send({ ok: false, error: "template not found" });
    }
    const body = request.body as
      | {
          values?: Record<string, string>;
          body_markdown?: string | null;
          save?: boolean;
          source_item_id?: string | null;
          status?: string | null;
        }
      | undefined;
    const values = body?.values && typeof body.values === "object" && !Array.isArray(body.values) ? body.values : {};
    const validated = validateValuesPayload(values);
    if (!validated.ok) {
      return reply.code(400).send({ ok: false, error: validated.error });
    }
    const bodyToRender =
      typeof body?.body_markdown === "string" ? body.body_markdown : template.body_markdown;
    if (bodyToRender.length > MAX_TEMPLATE_BODY_MARKDOWN) {
      return reply.code(400).send({ ok: false, error: "body_markdown is too large" });
    }
    const fieldsForRender = buildFieldsForRender(template, bodyToRender);
    const { rendered_markdown, missing_placeholders } = renderUserTemplate(bodyToRender, values, fieldsForRender);
    let fill = null;
    if (body?.save) {
      const actor = requireWriteActor(request, reply);
      if (!actor) {
        return;
      }
      const saved = saveTemplateFill(db, {
        templateId,
        caseId,
        values,
        rendered_markdown,
        source_item_id: body?.source_item_id,
        status: body?.status ?? undefined,
        actorLabel: actor.actorLabel,
        actorUserId: actor.actorUserId
      });
      if (!saved.ok) {
        return reply.code(400).send({ ok: false, error: saved.error });
      }
      fill = serializeUserDocumentFill(saved.row);
    }
    return {
      ok: true,
      case_id: caseId,
      template_id: templateId,
      rendered_markdown,
      missing_placeholders,
      fill
    };
  });

  app.get("/api/cases/:caseId/document-template-fills", async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    if (!requireTemplateCaseAccess(request, reply, caseId)) {
      return;
    }
    const q = request.query as { template_id?: string };
    const templateId = typeof q.template_id === "string" && q.template_id.trim() ? q.template_id.trim() : undefined;
    const rows = listTemplateFills(db, caseId, templateId);
    return {
      ok: true,
      case_id: caseId,
      fills: rows.map(serializeUserDocumentFill)
    };
  });

  app.get("/api/cases/:caseId/document-template-fills/:fillId", async (request, reply) => {
    const { caseId, fillId } = request.params as { caseId: string; fillId: string };
    if (!requireTemplateCaseAccess(request, reply, caseId)) {
      return;
    }
    const row = getTemplateFill(db, fillId, caseId);
    if (!row) {
      return reply.code(404).send({ ok: false, error: "fill not found" });
    }
    return { ok: true, case_id: caseId, fill: serializeUserDocumentFill(row) };
  });

  app.patch("/api/cases/:caseId/document-template-fills/:fillId", async (request, reply) => {
    const { caseId, fillId } = request.params as { caseId: string; fillId: string };
    if (!requireTemplateCaseAccess(request, reply, caseId)) {
      return;
    }
    const actor = requireWriteActor(request, reply);
    if (!actor) {
      return;
    }
    const body = request.body as
      | {
          values?: Record<string, string> | null;
          rendered_markdown?: string | null;
          status?: string | null;
        }
      | undefined;
    if (body?.values && typeof body.values === "object" && !Array.isArray(body.values)) {
      const validated = validateValuesPayload(body.values);
      if (!validated.ok) {
        return reply.code(400).send({ ok: false, error: validated.error });
      }
    }
    if (typeof body?.rendered_markdown === "string" && body.rendered_markdown.length > MAX_TEMPLATE_BODY_MARKDOWN) {
      return reply.code(400).send({ ok: false, error: "rendered_markdown is too large" });
    }
    const row = updateTemplateFill(db, {
      fillId,
      caseId,
      values: body?.values,
      rendered_markdown: body?.rendered_markdown,
      status: body?.status,
      actorLabel: actor.actorLabel,
      actorUserId: actor.actorUserId
    });
    if (!row) {
      return reply.code(404).send({ ok: false, error: "fill not found" });
    }
    return { ok: true, case_id: caseId, fill: serializeUserDocumentFill(row) };
  });

  app.delete("/api/cases/:caseId/document-template-fills/:fillId", async (request, reply) => {
    const { caseId, fillId } = request.params as { caseId: string; fillId: string };
    if (!requireTemplateCaseAccess(request, reply, caseId)) {
      return;
    }
    if (!requireWriteActor(request, reply)) {
      return;
    }
    const deleted = deleteTemplateFill(db, fillId, caseId);
    if (!deleted) {
      return reply.code(404).send({ ok: false, error: "fill not found" });
    }
    return { ok: true, case_id: caseId };
  });
}
