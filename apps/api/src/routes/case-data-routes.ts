import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { appendPageExtraction } from "../extraction.js";
import { runCaseHeuristicExtractions } from "../extraction-runner.js";
import { buildCaseProjection } from "../projection.js";
import {
  buildRegressionSummary,
  classifySourceItemByFilename,
  createRunManifest,
  evaluateMedicalRequestBranch,
  hydrateBoxInventory,
  hydratePracticePantherState,
  normalizeCaseDocumentSpine,
  normalizeSourceItemDocumentSpine,
  queueCaseOcrWork,
  recordCanonicalPageOcrAttempt,
  recordRegressionCheck,
  resolveCanonicalPageOcrReview
} from "../runtime.js";
import type { CaseRouteReply, HeaderRouteReply, StreamingRouteReply } from "./types.js";

type SourceItemBinaryContext = {
  id: string;
  case_id: string;
  provider: string;
  remote_id: string;
  source_kind: string;
  title: string | null;
  mime_type: string | null;
  authoritative_asset_uri: string | null;
};

export interface RegisterCaseDataRoutesInput {
  app: FastifyInstance;
  db: Database.Database;
  assertCanonicalPageBelongsToCase: (caseId: string, canonicalPageId: string, reply: CaseRouteReply) => boolean;
  assertCaseExists: (caseId: string, reply: CaseRouteReply) => boolean;
  assertSourceItemBelongsToCase: (caseId: string, sourceItemId: string, reply: CaseRouteReply) => boolean;
  enforceExpensiveRouteRateLimit: (
    request: { ip: string },
    reply: HeaderRouteReply,
    bucket: string
  ) => boolean;
  fetchPdfBytesForSourceItem: (sourceItemId: string) => Promise<Buffer>;
  isPdfLikeAsset: (title: string | null, mimeType: string | null, authoritativeAssetUri: string | null) => boolean;
  readSourceItemBinaryContext: (sourceItemId: string) => SourceItemBinaryContext | undefined;
}

export function registerCaseDataRoutes(input: RegisterCaseDataRoutesInput) {
  const {
    app,
    db,
    assertCanonicalPageBelongsToCase,
    assertCaseExists,
    assertSourceItemBelongsToCase,
    enforceExpensiveRouteRateLimit,
    fetchPdfBytesForSourceItem,
    isPdfLikeAsset,
    readSourceItemBinaryContext
  } = input;

  app.get("/api/cases/:caseId/source-items/:sourceItemId/content", async (request, reply) => {
    const { caseId, sourceItemId } = request.params as { caseId: string; sourceItemId: string };
    if (!assertCaseExists(caseId, reply as StreamingRouteReply)) return;
    const sourceItem = readSourceItemBinaryContext(sourceItemId);
    if (!sourceItem || sourceItem.case_id !== caseId) {
      return reply.code(404).send({ ok: false, error: "source item not found" });
    }
    if (!isPdfLikeAsset(sourceItem.title, sourceItem.mime_type, sourceItem.authoritative_asset_uri)) {
      return reply.code(400).send({ ok: false, error: "preview currently supports PDF source items only" });
    }

    try {
      const buffer = await fetchPdfBytesForSourceItem(sourceItemId);
      reply.header("content-type", sourceItem.mime_type ?? "application/pdf");
      reply.header(
        "content-disposition",
        `inline; filename="${encodeURIComponent(sourceItem.title ?? `${sourceItem.remote_id}.pdf`)}"`
      );
      return reply.send(buffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Preview failed";
      const code = /not found/i.test(message) ? 404 : 400;
      return reply.code(code).send({ ok: false, error: message });
    }
  });

  app.post("/dev/source-items", async (request, reply) => {
    const body = request.body as
      | {
          case_id?: string;
          provider?: "box" | "practicepanther";
          remote_id?: string;
          source_kind?: string;
          title?: string;
          raw_json?: Record<string, unknown>;
        }
      | undefined;

    if (!body?.case_id || !body?.provider || !body?.remote_id || !body?.source_kind) {
      return reply.code(400).send({ ok: false, error: "case_id, provider, remote_id, and source_kind are required" });
    }

    if (body.provider === "box") {
      const result = hydrateBoxInventory(db, {
        caseId: body.case_id,
        files: [
          {
            remote_id: body.remote_id,
            title: body.title ?? null,
            filename: body.title ?? null,
            mime_type:
              typeof body.raw_json?.mime_type === "string" ? (body.raw_json.mime_type as string) : null,
            parent_folder_id:
              typeof body.raw_json?.parent_folder_id === "string"
                ? (body.raw_json.parent_folder_id as string)
                : null,
            raw_json: body.raw_json ?? {}
          }
        ]
      });

      const sourceItem = db
        .prepare(`SELECT id FROM source_items WHERE provider = 'box' AND remote_id = ? LIMIT 1`)
        .get(body.remote_id) as { id: string } | undefined;

      return { ok: true, source_item_id: sourceItem?.id ?? null, snapshot_id: result.snapshot_id };
    }

    const result = hydratePracticePantherState(db, {
      caseId: body.case_id,
      entities: [
        {
          entity_type: body.source_kind,
          pp_entity_id: body.remote_id,
          title: body.title ?? null,
          raw_json: body.raw_json ?? {}
        }
      ]
    });

    const sourceItem = db
      .prepare(
        `SELECT id FROM source_items WHERE provider = 'practicepanther' AND remote_id = ? LIMIT 1`
      )
      .get(`${body.source_kind}:${body.remote_id}`) as { id: string } | undefined;

    return { ok: true, source_item_id: sourceItem?.id ?? null, snapshot_id: result.snapshot_id };
  });

  app.post("/api/cases/:caseId/source-items/:sourceItemId/classify", async (request, reply) => {
    const body = request.body as { filename?: string } | undefined;
    const { caseId, sourceItemId } = request.params as { caseId: string; sourceItemId: string };
    if (!assertCaseExists(caseId, reply)) return;
    if (!assertSourceItemBelongsToCase(caseId, sourceItemId, reply)) return;

    const sourceItem = db
      .prepare(`SELECT title FROM source_items WHERE id = ? LIMIT 1`)
      .get(sourceItemId) as { title: string | null } | undefined;

    const filename = body?.filename ?? sourceItem?.title ?? null;
    if (!filename) {
      return reply.code(400).send({ ok: false, error: "filename is required when the source item has no title" });
    }

    const result = classifySourceItemByFilename(db, {
      sourceItemId,
      filename
    });

    if (!result.ok) {
      return reply.code(404).send(result);
    }

    return result;
  });

  app.patch("/api/cases/:caseId/source-items/:sourceItemId/classification", async (request, reply) => {
    const { caseId, sourceItemId } = request.params as { caseId: string; sourceItemId: string };
    const body = request.body as
      | {
          document_type_id?: string | null;
          clear?: boolean;
        }
      | undefined;
    if (!assertCaseExists(caseId, reply)) return;
    if (!assertSourceItemBelongsToCase(caseId, sourceItemId, reply)) return;

    const sourceItem = db
      .prepare(`SELECT id, case_id FROM source_items WHERE id = ? LIMIT 1`)
      .get(sourceItemId) as { id: string; case_id: string } | undefined;
    if (!sourceItem) {
      return reply.code(404).send({ ok: false, error: "source item not found" });
    }

    if (body?.clear === true) {
      db.prepare(
        `
          UPDATE source_items
          SET document_type_id = NULL,
              document_type_name = NULL,
              classification_method = 'manual_clear',
              classification_confidence = NULL,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `
      ).run(sourceItemId);

      evaluateMedicalRequestBranch(db, sourceItem.case_id);
      return { ok: true, source_item_id: sourceItemId, classification_method: "manual_clear" };
    }

    if (!body?.document_type_id) {
      return reply.code(400).send({ ok: false, error: "document_type_id is required unless clear=true" });
    }

    const documentType = db
      .prepare(`SELECT id, canonical_name FROM document_types WHERE id = ? LIMIT 1`)
      .get(body.document_type_id) as { id: string; canonical_name: string } | undefined;
    if (!documentType) {
      return reply.code(404).send({ ok: false, error: "document type not found" });
    }

    db.prepare(
      `
        UPDATE source_items
        SET document_type_id = ?,
            document_type_name = ?,
            classification_method = 'manual_override',
            classification_confidence = 1.0,
            raw_json = json_set(
              COALESCE(raw_json, '{}'),
              '$.document_type_id', ?,
              '$.document_type_name', ?,
              '$.classification_method', 'manual_override'
            ),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
    ).run(
      documentType.id,
      documentType.canonical_name,
      documentType.id,
      documentType.canonical_name,
      sourceItemId
    );

    evaluateMedicalRequestBranch(db, sourceItem.case_id);

    return {
      ok: true,
      source_item_id: sourceItemId,
      document_type_id: documentType.id,
      document_type_name: documentType.canonical_name,
      classification_method: "manual_override"
    };
  });

  app.post("/dev/classify-source-item", async (request, reply) => {
    const body = request.body as { source_item_id?: string; filename?: string } | undefined;
    if (!body?.source_item_id || !body?.filename) {
      return reply.code(400).send({ ok: false, error: "source_item_id and filename are required" });
    }

    const result = classifySourceItemByFilename(db, {
      sourceItemId: body.source_item_id,
      filename: body.filename
    });

    if (!result.ok) {
      return reply.code(404).send(result);
    }

    return result;
  });

  app.post("/dev/source-items/:sourceItemId/normalize", async (request, reply) => {
    const body = request.body as { stub_page_count?: number; stubPageCount?: number } | undefined;
    const { sourceItemId } = request.params as { sourceItemId: string };

    const result = normalizeSourceItemDocumentSpine(db, {
      sourceItemId,
      stubPageCount: body?.stub_page_count ?? body?.stubPageCount ?? null
    });

    if (!result.ok) {
      const statusCode = result.error === "source item not found" ? 404 : 400;
      return reply.code(statusCode).send(result);
    }

    return result;
  });

  app.post("/dev/cases/:caseId/normalize-documents", async (request, reply) => {
    if (!enforceExpensiveRouteRateLimit(request, reply, "normalize-documents")) return;
    const body = request.body as
      | {
          source_item_ids?: string[];
          stub_page_count?: number;
          stubPageCount?: number;
        }
      | undefined;
    const { caseId } = request.params as { caseId: string };

    if (!assertCaseExists(caseId, reply)) {
      return;
    }

    return normalizeCaseDocumentSpine(db, {
      caseId,
      sourceItemIds: body?.source_item_ids,
      stubPageCount: body?.stub_page_count ?? body?.stubPageCount ?? null
    });
  });

  app.post("/api/cases/:caseId/normalize-documents", async (request, reply) => {
    if (!enforceExpensiveRouteRateLimit(request, reply, "normalize-documents")) return;
    const body = request.body as
      | {
          source_item_ids?: string[];
          stub_page_count?: number;
          stubPageCount?: number;
        }
      | undefined;
    const { caseId } = request.params as { caseId: string };

    if (!assertCaseExists(caseId, reply)) {
      return;
    }
    if (body?.source_item_ids && body.source_item_ids.length > 1000) {
      return reply.code(400).send({ ok: false, error: "source_item_ids may not exceed 1000 items" });
    }

    return normalizeCaseDocumentSpine(db, {
      caseId,
      sourceItemIds: body?.source_item_ids,
      stubPageCount: body?.stub_page_count ?? body?.stubPageCount ?? null
    });
  });

  app.get("/api/cases/:caseId/review-queue", async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    if (!assertCaseExists(caseId, reply)) {
      return;
    }

    const ocrReviews = db
      .prepare(
        `
          SELECT
            cp.id AS canonical_page_id,
            cp.page_number_in_doc AS page_number,
            cp.raw_text,
            cp.ocr_method,
            cp.ocr_confidence,
            cp.ocr_status,
            cp.extraction_status,
            cd.id AS canonical_document_id,
            cd.title AS canonical_document_title,
            si.id AS source_item_id,
            si.title AS source_item_title,
            si.document_type_name,
            rq.id AS review_id,
            rq.severity,
            rq.review_status,
            rq.review_note,
            rq.blocker_for_branch,
            rq.blocker_for_preset
          FROM ocr_review_queue rq
          JOIN canonical_pages cp ON cp.id = rq.canonical_page_id
          JOIN canonical_documents cd ON cd.id = cp.canonical_doc_id
          LEFT JOIN logical_documents ld ON ld.id = cd.logical_document_id
          LEFT JOIN source_items si ON si.id = ld.source_item_id
          WHERE rq.case_id = ?
            AND rq.review_status IN ('pending', 'in_review')
          ORDER BY rq.created_at ASC, cd.created_at ASC, cp.page_number_in_doc ASC
        `
      )
      .all(caseId);

    const unclassifiedDocuments = db
      .prepare(
        `
          SELECT
            si.id AS source_item_id,
            si.title,
            si.provider,
            si.source_kind,
            si.updated_at,
            json_extract(si.raw_json, '$.canonical_document_id') AS canonical_document_id
          FROM source_items si
          WHERE si.case_id = ?
            AND si.document_type_id IS NULL
            AND si.document_type_name IS NULL
          ORDER BY si.created_at ASC
        `
      )
      .all(caseId);

    const missingProof = db
      .prepare(
        `
          SELECT
            pr.id AS proof_requirement_id,
            pr.issue_id,
            pr.requirement_key,
            pr.requirement_policy,
            pr.rationale,
            i.issue_type
          FROM proof_requirements pr
          JOIN issues i ON i.id = pr.issue_id
          WHERE i.case_id = ?
            AND COALESCE(pr.satisfied, 0) = 0
          ORDER BY i.priority ASC, pr.requirement_key ASC
        `
      )
      .all(caseId);

    return {
      ok: true,
      case_id: caseId,
      ocr_reviews: ocrReviews,
      unclassified_documents: unclassifiedDocuments,
      missing_proof: missingProof
    };
  });

  app.post("/api/cases/:caseId/ocr/queue", async (request, reply) => {
    if (!enforceExpensiveRouteRateLimit(request, reply, "ocr-queue")) return;
    const body = request.body as
      | {
          canonical_document_id?: string | null;
          canonical_page_ids?: string[];
          preferred_engine?: string | null;
          force_rerun?: boolean;
        }
      | undefined;
    const { caseId } = request.params as { caseId: string };

    if (!assertCaseExists(caseId, reply)) {
      return;
    }
    if (body?.canonical_page_ids && body.canonical_page_ids.length > 1000) {
      return reply.code(400).send({ ok: false, error: "canonical_page_ids may not exceed 1000 items" });
    }

    return db.transaction(() =>
      queueCaseOcrWork(db, {
        caseId,
        canonicalDocumentId: body?.canonical_document_id ?? null,
        canonicalPageIds: body?.canonical_page_ids,
        preferredEngine: body?.preferred_engine ?? null,
        forceRerun: body?.force_rerun === true
      })
    )();
  });

  app.post("/api/cases/:caseId/extractions/run-heuristics", async (request, reply) => {
    if (!enforceExpensiveRouteRateLimit(request, reply, "heuristic-extractions")) return;
    const { caseId } = request.params as { caseId: string };
    const body = request.body as { skip_if_exists?: boolean } | undefined;

    if (!assertCaseExists(caseId, reply)) {
      return;
    }

    const result = db.transaction(() =>
      runCaseHeuristicExtractions(db, {
        caseId,
        skipIfExists: body?.skip_if_exists !== false
      })
    )();

    return result;
  });

  app.post("/api/cases/:caseId/canonical-pages/:canonicalPageId/ocr-review/resolve", async (request, reply) => {
    const { caseId, canonicalPageId } = request.params as { caseId: string; canonicalPageId: string };
    const body = request.body as { accept_empty?: boolean; resolution_note?: string | null } | undefined;
    if (!assertCaseExists(caseId, reply)) return;
    if (!assertCanonicalPageBelongsToCase(caseId, canonicalPageId, reply)) return;

    const result = db.transaction(() =>
      resolveCanonicalPageOcrReview(db, {
        canonicalPageId,
        acceptEmpty: body?.accept_empty === true,
        resolutionNote: body?.resolution_note ?? null
      })
    )();

    if (!result.ok) {
      const code = result.error === "canonical page not found" ? 404 : 400;
      return reply.code(code).send(result);
    }

    return result;
  });

  app.post("/api/cases/:caseId/canonical-pages/:canonicalPageId/ocr-attempts", async (request, reply) => {
    const body = request.body as
      | {
          engine?: string;
          status?: string;
          confidence?: number | null;
          output_text?: string | null;
          metadata_json?: unknown;
        }
      | undefined;
    const { caseId, canonicalPageId } = request.params as { caseId: string; canonicalPageId: string };
    if (!assertCaseExists(caseId, reply)) return;
    if (!assertCanonicalPageBelongsToCase(caseId, canonicalPageId, reply)) return;

    if (!body?.engine || !body?.status) {
      return reply.code(400).send({ ok: false, error: "engine and status are required" });
    }

    const engine = body.engine;
    const status = body.status;

    const result = db.transaction(() =>
      recordCanonicalPageOcrAttempt(db, {
        canonicalPageId,
        engine,
        status,
        confidence: body.confidence ?? null,
        outputText: body.output_text ?? null,
        metadataJson: body.metadata_json
      })
    )();

    if (!result.ok) {
      return reply.code(404).send(result);
    }

    return result;
  });

  app.post("/api/cases/:caseId/canonical-pages/:canonicalPageId/extractions", async (request, reply) => {
    const body = request.body as
      | {
          schema_key?: string;
          extractor_version?: string;
          payload?: Record<string, unknown>;
          confidence?: number | null;
        }
      | undefined;
    const { caseId, canonicalPageId } = request.params as { caseId: string; canonicalPageId: string };
    if (!assertCaseExists(caseId, reply)) return;
    if (!assertCanonicalPageBelongsToCase(caseId, canonicalPageId, reply)) return;

    if (!body?.schema_key?.trim() || !body?.extractor_version?.trim() || !body?.payload || typeof body.payload !== "object") {
      return reply.code(400).send({
        ok: false,
        error: "schema_key, extractor_version, and payload object are required"
      });
    }

    const result = appendPageExtraction(db, {
      canonicalPageId,
      schemaKey: body.schema_key.trim(),
      extractorVersion: body.extractor_version.trim(),
      payload: body.payload,
      confidence: body.confidence ?? null
    });

    if (!result.ok) {
      return reply.code(404).send(result);
    }

    return { ok: true, extraction_id: result.extraction_id };
  });

  app.get("/api/cases/:caseId/projection", async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const projection = buildCaseProjection(db, caseId);
    if (!projection) {
      return reply.code(404).send({ ok: false, error: "case not found" });
    }

    return projection;
  });

  app.post("/api/cases/:caseId/regression-checks", async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    if (!assertCaseExists(caseId, reply)) return;
    const body = request.body as
      | {
          check_type?: string;
          passed?: boolean;
          message?: string;
          details_json?: unknown;
          artifact_id?: string | null;
          bates_run_id?: string | null;
        }
      | undefined;

    if (!body?.check_type || typeof body.passed !== "boolean") {
      return reply.code(400).send({ ok: false, error: "check_type and passed are required" });
    }

    const recorded = recordRegressionCheck(db, {
      caseId,
      checkType: body.check_type,
      passed: body.passed,
      message: body.message ?? null,
      detailsJson: body.details_json,
      artifactId: body.artifact_id ?? null,
      batesRunId: body.bates_run_id ?? null
    });

    return {
      ok: true,
      regression_id: recorded.regressionId,
      summary: buildRegressionSummary(db, caseId)
    };
  });

  app.post("/api/cases/:caseId/run-manifests", async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    if (!assertCaseExists(caseId, reply)) return;
    const body = request.body as
      | {
          product_preset_id?: string | null;
          source_snapshot_id?: string | null;
          rulepack_version?: string | null;
          bates_run_id?: string | null;
          artifact_ids?: string[];
        }
      | undefined;

    const manifest = createRunManifest(db, {
      caseId,
      productPresetId: body?.product_preset_id ?? null,
      sourceSnapshotId: body?.source_snapshot_id ?? null,
      rulepackVersion: body?.rulepack_version ?? null,
      batesRunId: body?.bates_run_id ?? null,
      artifactIds: body?.artifact_ids ?? []
    });

    return {
      ok: true,
      manifest_id: manifest.manifestId,
      regression_summary: manifest.summary
    };
  });

  app.post("/dev/regression-check", async (request, reply) => {
    const body = request.body as
      | {
          case_id?: string;
          check_type?: string;
          passed?: boolean;
          message?: string;
          details_json?: unknown;
        }
      | undefined;
    if (!body?.case_id || !body?.check_type || typeof body?.passed !== "boolean") {
      return reply.code(400).send({ ok: false, error: "case_id, check_type, and passed are required" });
    }

    const recorded = recordRegressionCheck(db, {
      caseId: body.case_id,
      checkType: body.check_type,
      passed: body.passed,
      message: body.message ?? null,
      detailsJson: body.details_json
    });

    const manifest = createRunManifest(db, {
      caseId: body.case_id
    });

    return {
      ok: true,
      regression_id: recorded.regressionId,
      manifest_id: manifest.manifestId,
      regression_summary: manifest.summary
    };
  });
}
