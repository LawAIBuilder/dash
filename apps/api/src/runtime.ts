import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { writeCaseEvent } from "./events.js";
import {
  getSourceConnectorSpec,
  normalizeBoxInventoryFile
} from "./source-adapters.js";
import {
  persistBoxInventoryFile,
  persistPracticePantherEntity
} from "./source-persistence.js";
import {
  readSyncCursorValue,
  runTrackedSourceSync,
  startSyncRun,
  upsertSyncCursor
} from "./sync-lifecycle.js";
import { seedDefaultPackageRulesForCase } from "./seed.js";
import { isSafeOpaqueId } from "./fs-safety.js";

const HEARING_PREP_KEY = "hearing_prep";
const MEDICAL_REQUEST_KEY = "medical_request";

export interface EnsureCaseScaffoldInput {
  caseId?: string;
  name?: string;
  caseType?: string;
  ppMatterId?: string | null;
  boxRootFolderId?: string | null;
  employeeName?: string | null;
  employerName?: string | null;
  insurerName?: string | null;
  hearingDate?: string | null;
}

export interface ConnectorAuthSessionInput {
  provider: "box" | "practicepanther";
  accountLabel?: string | null;
  scopes?: string[];
  authMode?: string | null;
}

export interface CompleteConnectorAuthInput {
  provider: "box" | "practicepanther";
  connectionId?: string | null;
  callbackState?: string | null;
  accountLabel?: string | null;
  authMode?: string | null;
  externalAccountId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface BoxInventoryFileInput {
  remote_id: string;
  title?: string | null;
  filename?: string | null;
  mime_type?: string | null;
  parent_folder_id?: string | null;
  version_token?: string | null;
  remote_modified_at?: string | null;
  content_hash?: string | null;
  authoritative_asset_uri?: string | null;
  raw_json?: Record<string, unknown>;
}

export interface HydrateBoxInventoryInput {
  caseId: string;
  accountLabel?: string | null;
  files: BoxInventoryFileInput[];
  cursorAfter?: string | null;
}

export interface PracticePantherCustomFieldInput {
  pp_field_id: string;
  field_key: string;
  label: string;
  entity_scope?: string;
  field_type?: string | null;
  options_json?: unknown;
  value?: unknown;
  normalized_text?: string | null;
  normalized_number?: number | null;
  normalized_date?: string | null;
}

export interface PracticePantherEntityInput {
  entity_type: string;
  pp_entity_id: string;
  title?: string | null;
  source_updated_at?: string | null;
  raw_json?: Record<string, unknown>;
  custom_fields?: PracticePantherCustomFieldInput[];
}

export interface HydratePracticePantherInput {
  caseId: string;
  accountLabel?: string | null;
  cursorAfter?: string | null;
  entities: PracticePantherEntityInput[];
}

export interface RecordRegressionCheckInput {
  caseId: string;
  checkType: string;
  passed: boolean;
  message?: string | null;
  detailsJson?: unknown;
  artifactId?: string | null;
  batesRunId?: string | null;
}

export interface CreateRunManifestInput {
  caseId: string;
  productPresetId?: string | null;
  sourceSnapshotId?: string | null;
  rulepackVersion?: string | null;
  batesRunId?: string | null;
  artifactIds?: string[];
}

export interface NormalizeSourceItemInput {
  sourceItemId: string;
  stubPageCount?: number | null;
}

export interface NormalizeCaseSourceItemsInput {
  caseId: string;
  sourceItemIds?: string[];
  stubPageCount?: number | null;
}

export interface QueueCaseOcrWorkInput {
  caseId: string;
  canonicalDocumentId?: string | null;
  canonicalPageIds?: string[];
  preferredEngine?: string | null;
  /** When true, enqueue OCR even if the page already has complete text (re-run pipeline). */
  forceRerun?: boolean;
}

export interface ResolveCanonicalPageOcrReviewInput {
  canonicalPageId: string;
  /** Allow resolving when there is no OCR text (e.g. skipped office formats). */
  acceptEmpty?: boolean;
  resolutionNote?: string | null;
}

export interface RecordCanonicalPageOcrAttemptInput {
  canonicalPageId: string;
  engine: string;
  status: string;
  confidence?: number | null;
  outputText?: string | null;
  metadataJson?: unknown;
}

function nowIso() {
  return new Date().toISOString();
}

function buildDevelopmentAuthorizationUrl(provider: "box" | "practicepanther", callbackState: string) {
  const spec = getSourceConnectorSpec(provider);
  return `https://auth.placeholder.local/${spec.provider}?state=${encodeURIComponent(callbackState)}`;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function parseJsonRecord(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function isNormalizableSourceKind(sourceKind: string) {
  return sourceKind === "file" || sourceKind === "attachment" || sourceKind === "upload";
}

function resolveStubPageCount(rawJson: Record<string, unknown>, override?: number | null) {
  const candidates = [
    rawJson.stub_page_count,
    rawJson.stubPageCount,
    rawJson.page_count,
    rawJson.pageCount,
    rawJson.total_pages,
    rawJson.totalPages,
    rawJson.pages,
    override
  ];

  for (const candidate of candidates) {
    const parsed = parsePositiveInteger(candidate);
    if (parsed) {
      return Math.min(parsed, 500);
    }
  }

  return 1;
}

function resolveDocumentTypeMetadata(db: Database.Database, rawJson: Record<string, unknown>) {
  const explicitId =
    typeof rawJson.document_type_id === "string" && rawJson.document_type_id.trim().length > 0
      ? rawJson.document_type_id.trim()
      : null;
  const explicitName =
    typeof rawJson.document_type_name === "string" && rawJson.document_type_name.trim().length > 0
      ? rawJson.document_type_name.trim()
      : null;

  if (explicitId) {
    const row = db
      .prepare(`SELECT id, canonical_name FROM document_types WHERE id = ? LIMIT 1`)
      .get(explicitId) as { id: string; canonical_name: string } | undefined;
    if (row) {
      return {
        documentTypeId: row.id,
        documentTypeName: row.canonical_name
      };
    }
  }

  if (explicitName) {
    const row = db
      .prepare(`SELECT id, canonical_name FROM document_types WHERE canonical_name = ? LIMIT 1`)
      .get(explicitName) as { id: string; canonical_name: string } | undefined;
    if (row) {
      return {
        documentTypeId: row.id,
        documentTypeName: row.canonical_name
      };
    }
  }

  return {
    documentTypeId: null,
    documentTypeName: explicitName
  };
}

interface SourceItemNormalizationContext {
  id: string;
  case_id: string;
  source_connection_id: string;
  provider: string;
  remote_id: string;
  source_kind: string;
  title: string | null;
  mime_type: string | null;
  content_hash: string | null;
  latest_version_token: string | null;
  raw_json: string | null;
  rawJson: Record<string, unknown>;
  source_version_id: string | null;
  source_version_token: string | null;
  source_version_content_hash: string | null;
  authoritative_asset_uri: string | null;
  remote_modified_at: string | null;
}

function loadSourceItemNormalizationContext(
  db: Database.Database,
  sourceItemId: string
): SourceItemNormalizationContext | null {
  const sourceItem = db
    .prepare(
      `
        SELECT
          id,
          case_id,
          source_connection_id,
          provider,
          remote_id,
          source_kind,
          title,
          mime_type,
          content_hash,
          latest_version_token,
          raw_json
        FROM source_items
        WHERE id = ?
        LIMIT 1
      `
    )
    .get(sourceItemId) as
    | {
        id: string;
        case_id: string;
        source_connection_id: string;
        provider: string;
        remote_id: string;
        source_kind: string;
        title: string | null;
        mime_type: string | null;
        content_hash: string | null;
        latest_version_token: string | null;
        raw_json: string | null;
      }
    | undefined;

  if (!sourceItem) {
    return null;
  }

  const sourceVersion = sourceItem.latest_version_token
    ? ((db
        .prepare(
          `
            SELECT id, version_token, content_hash, authoritative_asset_uri, remote_modified_at
            FROM source_versions
            WHERE source_item_id = ? AND version_token = ?
            LIMIT 1
          `
        )
        .get(sourceItem.id, sourceItem.latest_version_token) as
        | {
            id: string;
            version_token: string;
            content_hash: string | null;
            authoritative_asset_uri: string | null;
            remote_modified_at: string | null;
          }
        | undefined) ?? undefined)
    : ((db
        .prepare(
          `
            SELECT id, version_token, content_hash, authoritative_asset_uri, remote_modified_at
            FROM source_versions
            WHERE source_item_id = ?
            ORDER BY created_at DESC
            LIMIT 1
          `
        )
        .get(sourceItem.id) as
        | {
            id: string;
            version_token: string;
            content_hash: string | null;
            authoritative_asset_uri: string | null;
            remote_modified_at: string | null;
          }
        | undefined) ?? undefined);

  return {
    ...sourceItem,
    rawJson: parseJsonRecord(sourceItem.raw_json),
    source_version_id: sourceVersion?.id ?? null,
    source_version_token: sourceVersion?.version_token ?? null,
    source_version_content_hash: sourceVersion?.content_hash ?? null,
    authoritative_asset_uri: sourceVersion?.authoritative_asset_uri ?? null,
    remote_modified_at: sourceVersion?.remote_modified_at ?? null
  };
}

function buildDevelopmentContentFingerprint(
  context: SourceItemNormalizationContext,
  documentTypeId: string | null
) {
  return sha256(
    JSON.stringify({
      provider: context.provider,
      remote_id: context.remote_id,
      source_kind: context.source_kind,
      mime_type: context.mime_type,
      title: context.title,
      latest_version_token: context.latest_version_token,
      source_version_token: context.source_version_token,
      content_hash: context.content_hash ?? context.source_version_content_hash,
      document_type_id: documentTypeId
    })
  );
}

function ensureLogicalDocument(
  db: Database.Database,
  input: {
    caseId: string;
    sourceItemId: string;
    sourceVersionId?: string | null;
    documentTypeId?: string | null;
    title: string;
    contentFingerprint: string;
  }
) {
  const existing = db
    .prepare(
      `
        SELECT id
        FROM logical_documents
        WHERE source_item_id = ?
        ORDER BY created_at ASC
        LIMIT 1
      `
    )
    .get(input.sourceItemId) as { id: string } | undefined;

  const logicalDocumentId = existing?.id ?? randomUUID();
  if (existing) {
    db.prepare(
      `
        UPDATE logical_documents
        SET source_version_id = COALESCE(?, source_version_id),
            document_type_id = COALESCE(?, document_type_id),
            title = ?,
            normalization_status = 'normalized',
            content_fingerprint = ?,
            parent_logical_document_id = NULL
        WHERE id = ?
      `
    ).run(
      input.sourceVersionId ?? null,
      input.documentTypeId ?? null,
      input.title,
      input.contentFingerprint,
      logicalDocumentId
    );
  } else {
    db.prepare(
      `
        INSERT INTO logical_documents
          (id, case_id, source_item_id, source_version_id, document_type_id, title, normalization_status, content_fingerprint, parent_logical_document_id)
        VALUES
          (?, ?, ?, ?, ?, ?, 'normalized', ?, NULL)
      `
    ).run(
      logicalDocumentId,
      input.caseId,
      input.sourceItemId,
      input.sourceVersionId ?? null,
      input.documentTypeId ?? null,
      input.title,
      input.contentFingerprint
    );
  }

  return {
    logicalDocumentId,
    reusedExisting: Boolean(existing)
  };
}

function ensureCanonicalDocument(
  db: Database.Database,
  input: {
    caseId: string;
    logicalDocumentId: string;
    documentTypeId?: string | null;
    title: string;
    contentHash: string;
    pageCount: number;
    authoritativeAssetUri?: string | null;
  }
) {
  const existingByLogical = db
    .prepare(
      `
        SELECT id, logical_document_id
        FROM canonical_documents
        WHERE logical_document_id = ?
        LIMIT 1
      `
    )
    .get(input.logicalDocumentId) as
    | {
        id: string;
        logical_document_id: string | null;
      }
    | undefined;

  const existingByHash =
    existingByLogical ??
    (db
      .prepare(
        `
          SELECT id, logical_document_id
          FROM canonical_documents
          WHERE case_id = ? AND content_hash = ?
          ORDER BY created_at ASC
          LIMIT 1
        `
      )
      .get(input.caseId, input.contentHash) as
      | {
          id: string;
          logical_document_id: string | null;
        }
      | undefined);

  const canonicalDocumentId = existingByHash?.id ?? randomUUID();
  if (existingByHash) {
    db.prepare(
      `
        UPDATE canonical_documents
        SET logical_document_id = CASE
              WHEN logical_document_id IS NULL THEN ?
              ELSE logical_document_id
            END,
            document_type_id = COALESCE(?, document_type_id),
            title = CASE
              WHEN logical_document_id = ? OR logical_document_id IS NULL THEN ?
              ELSE title
            END,
            content_hash = COALESCE(content_hash, ?),
            page_count = CASE
              WHEN page_count IS NULL OR page_count < ? THEN ?
              ELSE page_count
            END,
            total_text_length = COALESCE(total_text_length, 0),
            authoritative_asset_uri = COALESCE(?, authoritative_asset_uri),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
    ).run(
      input.logicalDocumentId,
      input.documentTypeId ?? null,
      input.logicalDocumentId,
      input.title,
      input.contentHash,
      input.pageCount,
      input.pageCount,
      input.authoritativeAssetUri ?? null,
      canonicalDocumentId
    );
  } else {
    db.prepare(
      `
        INSERT INTO canonical_documents
          (id, case_id, logical_document_id, document_type_id, title, content_hash, page_count, total_text_length, ocr_status, ingestion_status, authoritative_asset_uri)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, 0, 'pending', 'pending', ?)
      `
    ).run(
      canonicalDocumentId,
      input.caseId,
      input.logicalDocumentId,
      input.documentTypeId ?? null,
      input.title,
      input.contentHash,
      input.pageCount,
      input.authoritativeAssetUri ?? null
    );
  }

  return {
    canonicalDocumentId,
    reusedExisting: Boolean(existingByHash)
  };
}

function ensureCanonicalPageStubs(
  db: Database.Database,
  input: {
    canonicalDocumentId: string;
    pageCount: number;
  }
) {
  const existingPages = db
    .prepare(
      `
        SELECT id, page_number_in_doc
        FROM canonical_pages
        WHERE canonical_doc_id = ?
        ORDER BY page_number_in_doc ASC
      `
    )
    .all(input.canonicalDocumentId) as Array<{
    id: string;
    page_number_in_doc: number;
  }>;

  const existingPageNumbers = new Set(existingPages.map((page) => page.page_number_in_doc));
  let createdCount = 0;
  for (let pageNumber = 1; pageNumber <= input.pageCount; pageNumber += 1) {
    if (existingPageNumbers.has(pageNumber)) {
      continue;
    }

    db.prepare(
      `
        INSERT INTO canonical_pages
          (
            id,
            canonical_doc_id,
            page_number_in_doc,
            text_length,
            raw_text,
            ocr_method,
            ocr_confidence,
            ocr_status,
            extraction_status,
            updated_at
          )
        VALUES
          (?, ?, ?, 0, NULL, NULL, NULL, 'pending', 'pending', CURRENT_TIMESTAMP)
      `
    ).run(randomUUID(), input.canonicalDocumentId, pageNumber);
    createdCount += 1;
  }

  const highestExistingPage = existingPages.reduce(
    (highest, page) => Math.max(highest, page.page_number_in_doc),
    0
  );
  const totalPages = Math.max(input.pageCount, highestExistingPage);
  db.prepare(
    `
      UPDATE canonical_documents
      SET page_count = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
  ).run(totalPages, input.canonicalDocumentId);

  return {
    createdCount,
    totalPages
  };
}

function resolveCanonicalDocumentOcrPolicy(db: Database.Database, canonicalDocumentId: string) {
  const row = db
    .prepare(
      `
        SELECT
          cd.case_id,
          COALESCE(dt.mandatory_vlm_ocr, 0) AS mandatory_vlm_ocr
        FROM canonical_documents cd
        LEFT JOIN document_types dt ON dt.id = cd.document_type_id
        WHERE cd.id = ?
        LIMIT 1
      `
    )
    .get(canonicalDocumentId) as
    | {
        case_id: string;
        mandatory_vlm_ocr: number;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    caseId: row.case_id,
    mandatoryVlmOcr: row.mandatory_vlm_ocr === 1,
    defaultEngine: row.mandatory_vlm_ocr === 1 ? "vision_local" : "native_extract"
  };
}

function upsertActiveOcrReviewQueue(
  db: Database.Database,
  input: {
    canonicalPageId: string;
    caseId: string;
    severity: string;
    blockerForBranch: boolean;
    blockerForPreset: boolean;
    reviewNote?: string | null;
  }
) {
  const existing = db
    .prepare(
      `
        SELECT id
        FROM ocr_review_queue
        WHERE canonical_page_id = ?
          AND review_status IN ('pending', 'in_review')
        ORDER BY created_at DESC
        LIMIT 1
      `
    )
    .get(input.canonicalPageId) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `
        UPDATE ocr_review_queue
        SET severity = ?,
            blocker_for_branch = ?,
            blocker_for_preset = ?,
            review_note = COALESCE(?, review_note)
        WHERE id = ?
      `
    ).run(
      input.severity,
      input.blockerForBranch ? 1 : 0,
      input.blockerForPreset ? 1 : 0,
      input.reviewNote ?? null,
      existing.id
    );

    return existing.id;
  }

  const reviewId = randomUUID();
  db.prepare(
    `
      INSERT INTO ocr_review_queue
        (
          id,
          canonical_page_id,
          case_id,
          severity,
          blocker_for_branch,
          blocker_for_preset,
          review_status,
          review_note
        )
      VALUES
        (?, ?, ?, ?, ?, ?, 'pending', ?)
    `
  ).run(
    reviewId,
    input.canonicalPageId,
    input.caseId,
    input.severity,
    input.blockerForBranch ? 1 : 0,
    input.blockerForPreset ? 1 : 0,
    input.reviewNote ?? null
  );

  return reviewId;
}

function syncCanonicalDocumentProcessingState(db: Database.Database, canonicalDocumentId: string) {
  const row = db
    .prepare(
      `
        SELECT
          cd.id,
          COUNT(cp.id) AS total_pages,
          COALESCE(SUM(CASE WHEN cp.ocr_status = 'complete' THEN 1 ELSE 0 END), 0) AS complete_pages,
          COALESCE(SUM(CASE WHEN cp.ocr_status = 'queued' THEN 1 ELSE 0 END), 0) AS queued_pages,
          COALESCE(SUM(CASE WHEN cp.ocr_status = 'processing' THEN 1 ELSE 0 END), 0) AS processing_pages,
          COALESCE(SUM(CASE WHEN cp.ocr_status = 'review_required' THEN 1 ELSE 0 END), 0) AS review_required_pages,
          COALESCE(SUM(CASE WHEN cp.ocr_status = 'failed' THEN 1 ELSE 0 END), 0) AS failed_pages,
          COALESCE(SUM(CASE WHEN cp.extraction_status = 'ready' THEN 1 ELSE 0 END), 0) AS ready_pages,
          COALESCE(SUM(cp.text_length), 0) AS total_text_length
        FROM canonical_documents cd
        LEFT JOIN canonical_pages cp ON cp.canonical_doc_id = cd.id
        WHERE cd.id = ?
        GROUP BY cd.id
      `
    )
    .get(canonicalDocumentId) as
    | {
        id: string;
        total_pages: number;
        complete_pages: number;
        queued_pages: number;
        processing_pages: number;
        review_required_pages: number;
        failed_pages: number;
        ready_pages: number;
        total_text_length: number;
      }
    | undefined;

  if (!row) {
    return null;
  }

  let ocrStatus = "pending";
  if (row.review_required_pages > 0) {
    ocrStatus = "review_required";
  } else if (row.complete_pages > 0 && row.complete_pages === row.total_pages) {
    ocrStatus = "complete";
  } else if (row.processing_pages > 0) {
    ocrStatus = "processing";
  } else if (row.queued_pages > 0) {
    ocrStatus = "queued";
  } else if (row.failed_pages > 0) {
    ocrStatus = "failed";
  }

  let ingestionStatus = "pending";
  if (row.review_required_pages > 0) {
    ingestionStatus = "blocked_on_review";
  } else if (row.complete_pages > 0 && row.complete_pages === row.total_pages) {
    ingestionStatus = row.ready_pages > 0 ? "ready_for_extraction" : "ocr_complete";
  } else if (row.processing_pages > 0 || row.queued_pages > 0) {
    ingestionStatus = "ocr_in_progress";
  } else if (row.failed_pages > 0) {
    ingestionStatus = "ocr_failed";
  } else if (row.total_pages > 0) {
    ingestionStatus = "canonicalized";
  }

  db.prepare(
    `
      UPDATE canonical_documents
      SET page_count = ?,
          total_text_length = ?,
          ocr_status = ?,
          ingestion_status = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
  ).run(row.total_pages, row.total_text_length, ocrStatus, ingestionStatus, canonicalDocumentId);

  return {
    totalPages: row.total_pages,
    completePages: row.complete_pages,
    queuedPages: row.queued_pages,
    processingPages: row.processing_pages,
    reviewRequiredPages: row.review_required_pages,
    failedPages: row.failed_pages,
    readyPages: row.ready_pages,
    ocrStatus,
    ingestionStatus
  };
}

function queueCanonicalPageForOcr(
  db: Database.Database,
  input: {
    canonicalPageId: string;
    preferredEngine?: string | null;
    syncDocumentState?: boolean;
    forceRerun?: boolean;
  }
) {
  const page = db
    .prepare(
      `
        SELECT
          cp.id,
          cp.canonical_doc_id,
          cp.raw_text,
          cp.ocr_status,
          COALESCE(dt.mandatory_vlm_ocr, 0) AS mandatory_vlm_ocr
        FROM canonical_pages cp
        JOIN canonical_documents cd ON cd.id = cp.canonical_doc_id
        LEFT JOIN document_types dt ON dt.id = cd.document_type_id
        WHERE cp.id = ?
        LIMIT 1
      `
    )
    .get(input.canonicalPageId) as
    | {
        id: string;
        canonical_doc_id: string;
        raw_text: string | null;
        ocr_status: string | null;
        mandatory_vlm_ocr: number;
      }
    | undefined;

  if (!page) {
    return { ok: false as const, error: "canonical page not found" };
  }

  if (
    !input.forceRerun &&
    page.raw_text &&
    page.raw_text.trim().length > 0 &&
    page.ocr_status === "complete"
  ) {
    return {
      ok: true as const,
      queued: false,
      canonicalDocumentId: page.canonical_doc_id,
      canonicalPageId: page.id
    };
  }

  const activeAttempt = db
    .prepare(
      `
        SELECT id
        FROM ocr_attempts
        WHERE canonical_page_id = ?
          AND status IN ('queued', 'processing')
        ORDER BY attempt_order DESC
        LIMIT 1
      `
    )
    .get(page.id) as { id: string } | undefined;

  if (activeAttempt) {
    return {
      ok: true as const,
      queued: false,
      canonicalDocumentId: page.canonical_doc_id,
      canonicalPageId: page.id
    };
  }

  const orderRow = db
    .prepare(`SELECT COALESCE(MAX(attempt_order), 0) AS max_attempt_order FROM ocr_attempts WHERE canonical_page_id = ?`)
    .get(page.id) as { max_attempt_order: number };
  const engine = input.preferredEngine ?? (page.mandatory_vlm_ocr === 1 ? "vision_local" : "native_extract");

  db.prepare(
    `
      INSERT INTO ocr_attempts
        (id, canonical_page_id, attempt_order, engine, status, metadata_json)
      VALUES
        (?, ?, ?, ?, 'queued', ?)
    `
  ).run(
    randomUUID(),
    page.id,
    orderRow.max_attempt_order + 1,
    engine,
    JSON.stringify({ queued_at: nowIso(), queued_by: "normalization_or_api" })
  );

  db.prepare(
    `
      UPDATE canonical_pages
      SET ocr_status = 'queued',
          extraction_status = CASE
            WHEN extraction_status = 'complete' THEN extraction_status
            ELSE 'pending'
          END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
  ).run(page.id);

  if (input.syncDocumentState !== false) {
    syncCanonicalDocumentProcessingState(db, page.canonical_doc_id);
  }

  return {
    ok: true as const,
    queued: true,
    canonicalDocumentId: page.canonical_doc_id,
    canonicalPageId: page.id
  };
}

function queueCanonicalDocumentOcr(
  db: Database.Database,
  input: {
    canonicalDocumentId: string;
    preferredEngine?: string | null;
  }
) {
  const pages = db
    .prepare(
      `
        SELECT id
        FROM canonical_pages
        WHERE canonical_doc_id = ?
        ORDER BY page_number_in_doc ASC
      `
    )
    .all(input.canonicalDocumentId) as Array<{ id: string }>;

  let queuedCount = 0;
  let skippedCount = 0;
  for (const page of pages) {
    const result = queueCanonicalPageForOcr(db, {
      canonicalPageId: page.id,
      preferredEngine: input.preferredEngine ?? null,
      syncDocumentState: false
    });
    if (!result.ok || !result.queued) {
      skippedCount += 1;
      continue;
    }
    queuedCount += 1;
  }

  const state = syncCanonicalDocumentProcessingState(db, input.canonicalDocumentId);
  return {
    queuedCount,
    skippedCount,
    state
  };
}

export function queueCaseOcrWork(db: Database.Database, input: QueueCaseOcrWorkInput) {
  const requestedPageIds = input.canonicalPageIds?.filter((pageId) => pageId.trim().length > 0) ?? [];
  const pages =
    requestedPageIds.length > 0
      ? requestedPageIds.map((id) => ({ id }))
      : ((db
          .prepare(
            `
              SELECT cp.id
              FROM canonical_pages cp
              JOIN canonical_documents cd ON cd.id = cp.canonical_doc_id
              WHERE cd.case_id = ?
                AND (? IS NULL OR cd.id = ?)
              ORDER BY cd.created_at ASC, cp.page_number_in_doc ASC
            `
          )
          .all(input.caseId, input.canonicalDocumentId ?? null, input.canonicalDocumentId ?? null) as Array<{
          id: string;
        }>) ?? []);

  let queuedPageCount = 0;
  let skippedPageCount = 0;
  const touchedDocumentIds = new Set<string>();

  for (const page of pages) {
    const result = queueCanonicalPageForOcr(db, {
      canonicalPageId: page.id,
      preferredEngine: input.preferredEngine ?? null,
      syncDocumentState: false,
      forceRerun: input.forceRerun === true
    });
    if (!result.ok) {
      skippedPageCount += 1;
      continue;
    }
    touchedDocumentIds.add(result.canonicalDocumentId);
    if (result.queued) {
      queuedPageCount += 1;
    } else {
      skippedPageCount += 1;
    }
  }

  const documentStates = Array.from(touchedDocumentIds).map((canonicalDocumentId) => ({
    canonical_document_id: canonicalDocumentId,
    state: syncCanonicalDocumentProcessingState(db, canonicalDocumentId)
  }));

  return {
    ok: true as const,
    case_id: input.caseId,
    requested_page_count: pages.length,
    queued_page_count: queuedPageCount,
    skipped_page_count: skippedPageCount,
    canonical_document_ids: Array.from(touchedDocumentIds),
    document_states: documentStates
  };
}

export function recordCanonicalPageOcrAttempt(
  db: Database.Database,
  input: RecordCanonicalPageOcrAttemptInput
) {
  const page = db
    .prepare(
      `
        SELECT
          cp.id,
          cp.canonical_doc_id,
          cd.case_id,
          COALESCE(dt.mandatory_vlm_ocr, 0) AS mandatory_vlm_ocr
        FROM canonical_pages cp
        JOIN canonical_documents cd ON cd.id = cp.canonical_doc_id
        LEFT JOIN document_types dt ON dt.id = cd.document_type_id
        WHERE cp.id = ?
        LIMIT 1
      `
    )
    .get(input.canonicalPageId) as
    | {
        id: string;
        canonical_doc_id: string;
        case_id: string;
        mandatory_vlm_ocr: number;
      }
    | undefined;

  if (!page) {
    return {
      ok: false as const,
      canonical_page_id: input.canonicalPageId,
      error: "canonical page not found"
    };
  }

  const orderRow = db
    .prepare(`SELECT COALESCE(MAX(attempt_order), 0) AS max_attempt_order FROM ocr_attempts WHERE canonical_page_id = ?`)
    .get(page.id) as { max_attempt_order: number };

  const normalizedStatus = input.status === "low_confidence" ? "review_required" : input.status;
  db.prepare(
    `
      INSERT INTO ocr_attempts
        (id, canonical_page_id, attempt_order, engine, status, confidence, output_text, metadata_json)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    randomUUID(),
    page.id,
    orderRow.max_attempt_order + 1,
    input.engine,
    normalizedStatus,
    input.confidence ?? null,
    input.outputText ?? null,
    input.metadataJson === undefined ? null : JSON.stringify(input.metadataJson)
  );

  if (normalizedStatus === "complete") {
    const trimmedOutput = input.outputText?.trim() ?? "";
    db.prepare(
      `
        UPDATE canonical_pages
        SET raw_text = ?,
            text_length = ?,
            ocr_method = ?,
            ocr_confidence = ?,
            ocr_status = 'complete',
            extraction_status = 'ready',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
    ).run(trimmedOutput || null, trimmedOutput.length, input.engine, input.confidence ?? null, page.id);

    db.prepare(
      `
        UPDATE ocr_review_queue
        SET review_status = 'resolved',
            resolved_at = CURRENT_TIMESTAMP
        WHERE canonical_page_id = ?
          AND review_status IN ('pending', 'in_review')
      `
    ).run(page.id);
  } else if (normalizedStatus === "failed" || normalizedStatus === "review_required") {
    db.prepare(
      `
        UPDATE canonical_pages
        SET ocr_method = ?,
            ocr_confidence = ?,
            ocr_status = 'review_required',
            extraction_status = 'blocked',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
    ).run(input.engine, input.confidence ?? null, page.id);

    upsertActiveOcrReviewQueue(db, {
      canonicalPageId: page.id,
      caseId: page.case_id,
      severity: page.mandatory_vlm_ocr === 1 ? "critical" : "important",
      blockerForBranch: page.mandatory_vlm_ocr === 1,
      blockerForPreset: page.mandatory_vlm_ocr === 1,
      reviewNote:
        normalizedStatus === "failed"
          ? "OCR attempt failed and requires page review."
          : "OCR result requires review before extraction."
    });
  } else {
    db.prepare(
      `
        UPDATE canonical_pages
        SET ocr_method = COALESCE(?, ocr_method),
            ocr_confidence = COALESCE(?, ocr_confidence),
            ocr_status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
    ).run(input.engine, input.confidence ?? null, normalizedStatus, page.id);
  }

  const state = syncCanonicalDocumentProcessingState(db, page.canonical_doc_id);
  return {
    ok: true as const,
    canonical_page_id: page.id,
    canonical_document_id: page.canonical_doc_id,
    ocr_status: normalizedStatus,
    document_state: state
  };
}

export function resolveCanonicalPageOcrReview(db: Database.Database, input: ResolveCanonicalPageOcrReviewInput) {
  const page = db
    .prepare(
      `
        SELECT cp.id, cp.canonical_doc_id, cp.raw_text
        FROM canonical_pages cp
        WHERE cp.id = ?
        LIMIT 1
      `
    )
    .get(input.canonicalPageId) as
    | { id: string; canonical_doc_id: string; raw_text: string | null }
    | undefined;

  if (!page) {
    return { ok: false as const, error: "canonical page not found" as const };
  }

  const trimmed = page.raw_text?.trim() ?? "";
  if (trimmed.length === 0 && !input.acceptEmpty) {
    return {
      ok: false as const,
      error: "raw_text is empty; pass accept_empty to acknowledge anyway" as const
    };
  }

  const extractionStatus = trimmed.length > 0 ? "ready" : "blocked";
  const note = input.resolutionNote?.trim() ?? null;

  db.transaction(() => {
    if (note) {
      db.prepare(
        `
          UPDATE ocr_review_queue
          SET review_status = 'resolved',
              resolved_at = CURRENT_TIMESTAMP,
              review_note = ?
          WHERE canonical_page_id = ?
            AND review_status IN ('pending', 'in_review')
        `
      ).run(note, page.id);
    } else {
      db.prepare(
        `
          UPDATE ocr_review_queue
          SET review_status = 'resolved',
              resolved_at = CURRENT_TIMESTAMP
          WHERE canonical_page_id = ?
            AND review_status IN ('pending', 'in_review')
        `
      ).run(page.id);
    }

    db.prepare(
      `
        UPDATE canonical_pages
        SET ocr_status = 'complete',
            extraction_status = ?,
            text_length = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
    ).run(extractionStatus, trimmed.length, page.id);
  })();

  const state = syncCanonicalDocumentProcessingState(db, page.canonical_doc_id);
  return {
    ok: true as const,
    canonical_page_id: page.id,
    canonical_document_id: page.canonical_doc_id,
    ocr_status: "complete" as const,
    extraction_status: extractionStatus,
    document_state: state
  };
}

function lookupSeedRuntimeIds(db: Database.Database) {
  const row = db
    .prepare(
      `
        SELECT
          (SELECT id FROM product_presets WHERE key = ? LIMIT 1) AS preset_id,
          (SELECT id FROM branch_templates WHERE key = ? LIMIT 1) AS branch_template_id
      `
    )
    .get(HEARING_PREP_KEY, MEDICAL_REQUEST_KEY) as
    | {
        preset_id: string | null;
        branch_template_id: string | null;
      }
    | undefined;

  if (!row?.preset_id || !row.branch_template_id) {
    throw new Error("Seed data missing: hearing_prep preset or medical_request branch template not found.");
  }

  return {
    presetId: row.preset_id,
    branchTemplateId: row.branch_template_id
  };
}

export function ensureSourceConnection(
  db: Database.Database,
  input: ConnectorAuthSessionInput
) {
  const existing = db
    .prepare(
      `
        SELECT id, provider, account_label, auth_mode, scopes, status
        FROM source_connections
        WHERE provider = ?
        ORDER BY created_at ASC
        LIMIT 1
      `
    )
    .get(input.provider) as
    | {
        id: string;
        provider: string;
        account_label: string | null;
        auth_mode: string;
        scopes: string | null;
        status: string;
      }
    | undefined;

  const scopes = input.scopes ?? getSourceConnectorSpec(input.provider).defaultScopes;
  const nextAuthMode = input.authMode ?? null;

  if (existing) {
    db.prepare(
      `
        UPDATE source_connections
        SET account_label = COALESCE(?, account_label),
            auth_mode = COALESCE(?, auth_mode, 'development_local_process'),
            scopes = ?,
            status = 'active',
            last_verified_at = CURRENT_TIMESTAMP,
            last_error_message = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
    ).run(input.accountLabel ?? existing.account_label, nextAuthMode, JSON.stringify(scopes), existing.id);

    return {
      id: existing.id,
      provider: existing.provider,
      auth_mode: (nextAuthMode ?? existing.auth_mode ?? "development_local_process"),
      scopes,
      status: "active"
    };
  }

  const id = randomUUID();
  db.prepare(
    `
      INSERT INTO source_connections
        (id, provider, account_label, auth_mode, scopes, status, last_verified_at, metadata_json, updated_at)
      VALUES
        (?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, '{}', CURRENT_TIMESTAMP)
    `
  ).run(id, input.provider, input.accountLabel ?? null, nextAuthMode ?? "development_local_process", JSON.stringify(scopes));

  return {
    id,
    provider: input.provider,
    auth_mode: nextAuthMode ?? "development_local_process",
    scopes,
    status: "active"
  };
}

export function beginSourceConnectionAuth(
  db: Database.Database,
  input: ConnectorAuthSessionInput
) {
  const existing = db
    .prepare(
      `
        SELECT id, provider, account_label
        FROM source_connections
        WHERE provider = ?
        ORDER BY created_at ASC
        LIMIT 1
      `
    )
    .get(input.provider) as
    | {
        id: string;
        provider: string;
        account_label: string | null;
      }
    | undefined;

  const scopes = input.scopes ?? getSourceConnectorSpec(input.provider).defaultScopes;
  const callbackState = randomUUID();
  const authorizationUrl = buildDevelopmentAuthorizationUrl(input.provider, callbackState);

  if (existing) {
    db.prepare(
      `
        UPDATE source_connections
        SET account_label = COALESCE(?, account_label),
            auth_mode = 'oauth_browser',
            scopes = ?,
            status = 'auth_pending',
            callback_state = ?,
            authorization_url = ?,
            last_error_message = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
    ).run(
      input.accountLabel ?? existing.account_label,
      JSON.stringify(scopes),
      callbackState,
      authorizationUrl,
      existing.id
    );

    return {
      id: existing.id,
      provider: existing.provider,
      auth_mode: "oauth_browser",
      scopes,
      status: "auth_pending",
      callback_state: callbackState,
      authorization_url: authorizationUrl
    };
  }

  const id = randomUUID();
  db.prepare(
    `
      INSERT INTO source_connections
        (
          id,
          provider,
          account_label,
          auth_mode,
          scopes,
          status,
          callback_state,
          authorization_url,
          metadata_json,
          updated_at
        )
      VALUES
        (?, ?, ?, 'oauth_browser', ?, 'auth_pending', ?, ?, '{}', CURRENT_TIMESTAMP)
    `
  ).run(id, input.provider, input.accountLabel ?? null, JSON.stringify(scopes), callbackState, authorizationUrl);

  return {
    id,
    provider: input.provider,
    auth_mode: "oauth_browser",
    scopes,
    status: "auth_pending",
    callback_state: callbackState,
    authorization_url: authorizationUrl
  };
}

export function completeSourceConnectionAuth(
  db: Database.Database,
  input: CompleteConnectorAuthInput
) {
  const existing =
    (input.connectionId
      ? (db
          .prepare(
            `
              SELECT id, provider, account_label
              FROM source_connections
              WHERE id = ?
                AND provider = ?
              LIMIT 1
            `
          )
          .get(input.connectionId, input.provider) as
          | {
              id: string;
              provider: string;
              account_label: string | null;
            }
          | undefined)
      : undefined) ??
    (input.callbackState
      ? (db
          .prepare(
            `
              SELECT id, provider, account_label
              FROM source_connections
              WHERE callback_state = ?
                AND provider = ?
              LIMIT 1
            `
          )
          .get(input.callbackState, input.provider) as
          | {
              id: string;
              provider: string;
              account_label: string | null;
            }
          | undefined)
      : undefined);

  if (!existing) {
    return {
      ok: false as const,
      error: "source connection not found"
    };
  }

  db.prepare(
    `
      UPDATE source_connections
      SET account_label = COALESCE(?, account_label),
          auth_mode = COALESCE(?, auth_mode),
          status = 'active',
          external_account_id = COALESCE(?, external_account_id),
          metadata_json = COALESCE(?, metadata_json, '{}'),
          last_verified_at = CURRENT_TIMESTAMP,
          callback_state = NULL,
          authorization_url = NULL,
          last_error_message = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
  ).run(
    input.accountLabel ?? existing.account_label,
    input.authMode ?? "development_local_process",
    input.externalAccountId ?? null,
    input.metadata ? JSON.stringify(input.metadata) : null,
    existing.id
  );

  return {
    ok: true as const,
    id: existing.id,
    provider: existing.provider,
    status: "active"
  };
}

function ensureMedicalRequestIssue(db: Database.Database, caseId: string) {
  const existing = db
    .prepare(
      `
        SELECT id
        FROM issues
        WHERE case_id = ? AND issue_type = 'medical_request'
        ORDER BY priority ASC, created_at ASC
        LIMIT 1
      `
    )
    .get(caseId) as { id: string } | undefined;

  if (existing) {
    return existing.id;
  }

  const issueId = randomUUID();
  db.prepare(
    `
      INSERT INTO issues
        (id, case_id, issue_type, status, requested_relief, priority)
      VALUES
        (?, ?, 'medical_request', 'active', 'Treatment approval', 10)
    `
  ).run(issueId, caseId);
  return issueId;
}

function ensureProofRequirements(db: Database.Database, issueId: string) {
  const upsertProofRequirement = db.prepare(
    `
      INSERT INTO proof_requirements
        (id, issue_id, requirement_key, requirement_type, requirement_policy, rationale)
      VALUES
        (@id, @issue_id, @requirement_key, @requirement_type, @requirement_policy, @rationale)
      ON CONFLICT(issue_id, requirement_key) DO UPDATE SET
        requirement_type = excluded.requirement_type,
        requirement_policy = excluded.requirement_policy,
        rationale = excluded.rationale
    `
  );

  const rows = [
    {
      requirement_key: "Treatment Order",
      requirement_type: "document_type",
      requirement_policy: "blocking_if_missing",
      rationale: "Core treatment-request proof"
    },
    {
      requirement_key: "Narrative Report",
      requirement_type: "document_type",
      requirement_policy: "required_or_substitute",
      rationale: "Preferred treating support"
    },
    {
      requirement_key: "Office Note",
      requirement_type: "document_type",
      requirement_policy: "required_or_substitute",
      rationale: "Acceptable substitute if narrative is absent but issue support is sufficient"
    }
  ] as const;

  for (const row of rows) {
    const existing = db
      .prepare(
        `
          SELECT id
          FROM proof_requirements
          WHERE issue_id = ? AND requirement_key = ?
          LIMIT 1
        `
      )
      .get(issueId, row.requirement_key) as { id: string } | undefined;

    upsertProofRequirement.run({
      id: existing?.id ?? randomUUID(),
      issue_id: issueId,
      ...row
    });
  }
}

function ensureMedicalRequestBranchInstance(db: Database.Database, caseId: string) {
  const runtimeIds = lookupSeedRuntimeIds(db);
  const existing = db
    .prepare(
      `
        SELECT mbi.id, mbi.product_preset_id, mbi.current_stage_key
        FROM matter_branch_instances mbi
        WHERE mbi.case_id = ? AND mbi.branch_template_id = ?
        LIMIT 1
      `
    )
    .get(caseId, runtimeIds.branchTemplateId) as
    | {
        id: string;
        product_preset_id: string;
        current_stage_key: string | null;
      }
    | undefined;

  if (existing) {
    db.prepare(
      `
        INSERT INTO branch_stage_status
          (id, matter_branch_instance_id, stage_key, status, entered_at, completed_at, progress_summary)
        VALUES
          (?, ?, 'issue_identified', 'completed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)
        ON CONFLICT(matter_branch_instance_id, stage_key) DO UPDATE SET
          status = 'completed',
          completed_at = COALESCE(branch_stage_status.completed_at, excluded.completed_at),
          progress_summary = excluded.progress_summary
      `
    ).run(
      randomUUID(),
      existing.id,
      "Medical request branch instantiated for the active treatment-approval issue."
    );

    return {
      id: existing.id,
      presetId: existing.product_preset_id,
      created: false
    };
  }

  const branchInstanceId = randomUUID();
  db.prepare(
    `
      INSERT INTO matter_branch_instances
        (id, case_id, product_preset_id, branch_template_id, status, priority, current_stage_key)
      VALUES
        (?, ?, ?, ?, 'active', 10, 'issue_identified')
    `
  ).run(branchInstanceId, caseId, runtimeIds.presetId, runtimeIds.branchTemplateId);

  db.prepare(
    `
      INSERT INTO branch_stage_status
        (id, matter_branch_instance_id, stage_key, status, entered_at, completed_at, progress_summary)
      VALUES
        (?, ?, 'issue_identified', 'completed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)
    `
  ).run(
    randomUUID(),
    branchInstanceId,
    "Medical request branch instantiated for the active treatment-approval issue."
  );

  writeCaseEvent(db, {
    caseId,
    branchInstanceId,
    presetId: runtimeIds.presetId,
    eventName: "branch.instance_created",
    sourceType: "system",
    sourceId: caseId,
    payload: {
      product_preset_key: HEARING_PREP_KEY,
      branch_template_key: MEDICAL_REQUEST_KEY,
      priority: 10,
      reason: "seeded_from_scope_or_manual_selection"
    }
  });

  return {
    id: branchInstanceId,
    presetId: runtimeIds.presetId,
    created: true
  };
}

export function ensureCaseScaffold(db: Database.Database, input: EnsureCaseScaffoldInput) {
  const caseId = input.caseId ?? randomUUID();
  if (input.caseId && !isSafeOpaqueId(input.caseId)) {
    throw new Error("case_id contains unsupported characters");
  }
  const existing = db.prepare(`SELECT id FROM cases WHERE id = ? LIMIT 1`).get(caseId) as
    | { id: string }
    | undefined;

  if (existing) {
    db.prepare(
      `
        UPDATE cases
        SET name = COALESCE(?, name),
            case_type = COALESCE(?, case_type),
            pp_matter_id = COALESCE(?, pp_matter_id),
            box_root_folder_id = COALESCE(?, box_root_folder_id),
            employee_name = COALESCE(?, employee_name),
            employer_name = COALESCE(?, employer_name),
            insurer_name = COALESCE(?, insurer_name),
            hearing_date = COALESCE(?, hearing_date),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
    ).run(
      input.name ?? null,
      input.caseType ?? null,
      input.ppMatterId ?? null,
      input.boxRootFolderId ?? null,
      input.employeeName ?? null,
      input.employerName ?? null,
      input.insurerName ?? null,
      input.hearingDate ?? null,
      caseId
    );
  } else {
    db.prepare(
      `
        INSERT INTO cases
          (id, name, case_type, pp_matter_id, box_root_folder_id, employee_name, employer_name, insurer_name, hearing_date)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      caseId,
      input.name ?? "Untitled Matter",
      input.caseType ?? "wc",
      input.ppMatterId ?? null,
      input.boxRootFolderId ?? null,
      input.employeeName ?? null,
      input.employerName ?? null,
      input.insurerName ?? null,
      input.hearingDate ?? null
    );
    seedDefaultPackageRulesForCase(db, caseId);
  }

  const issueId = ensureMedicalRequestIssue(db, caseId);
  ensureProofRequirements(db, issueId);
  const branch = ensureMedicalRequestBranchInstance(db, caseId);

  return {
    caseId,
    issueId,
    branchInstanceId: branch.id,
    presetId: branch.presetId
  };
}

function updateProofRequirementStatus(
  db: Database.Database,
  issueId: string,
  requirementKey: string,
  satisfied: boolean,
  satisfiedById: string | null
) {
  db.prepare(
    `
      UPDATE proof_requirements
      SET satisfied = ?,
          satisfied_by_type = ?,
          satisfied_by_id = ?
      WHERE issue_id = ? AND requirement_key = ?
    `
  ).run(
    satisfied ? 1 : 0,
    satisfied ? "source_item" : null,
    satisfied ? satisfiedById : null,
    issueId,
    requirementKey
  );
}

function upsertBranchStageStatus(
  db: Database.Database,
  input: {
    branchInstanceId: string;
    stageKey: string;
    status: string;
    blockerSummary?: string | null;
    progressSummary?: string | null;
    completedAt?: string | null;
  }
) {
  const existing = db
    .prepare(
      `
        SELECT id
        FROM branch_stage_status
        WHERE matter_branch_instance_id = ? AND stage_key = ?
        LIMIT 1
      `
    )
    .get(input.branchInstanceId, input.stageKey) as { id: string } | undefined;

  db.prepare(
    `
      INSERT INTO branch_stage_status
        (id, matter_branch_instance_id, stage_key, status, entered_at, completed_at, blocker_summary, progress_summary)
      VALUES
        (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)
      ON CONFLICT(matter_branch_instance_id, stage_key) DO UPDATE SET
        status = excluded.status,
        completed_at = excluded.completed_at,
        blocker_summary = excluded.blocker_summary,
        progress_summary = excluded.progress_summary
    `
  ).run(
    existing?.id ?? randomUUID(),
    input.branchInstanceId,
    input.stageKey,
    input.status,
    input.completedAt ?? null,
    input.blockerSummary ?? null,
    input.progressSummary ?? null
  );
}

export function evaluateMedicalRequestBranch(db: Database.Database, caseId: string) {
  const issue = db
    .prepare(
      `
        SELECT id
        FROM issues
        WHERE case_id = ? AND issue_type = 'medical_request'
        LIMIT 1
      `
    )
    .get(caseId) as { id: string } | undefined;

  const branch = db
    .prepare(
      `
        SELECT mbi.id, mbi.current_stage_key, mbi.product_preset_id
        FROM matter_branch_instances mbi
        JOIN branch_templates bt ON bt.id = mbi.branch_template_id
        WHERE mbi.case_id = ? AND bt.key = ?
        LIMIT 1
      `
    )
    .get(caseId, MEDICAL_REQUEST_KEY) as
    | {
        id: string;
        current_stage_key: string | null;
        product_preset_id: string | null;
      }
    | undefined;

  if (!issue || !branch) {
    return null;
  }

  const requiredDocTypes = db
    .prepare(
      `
        SELECT bsr.requirement_key, bsr.requirement_policy
        FROM branch_stage_requirements bsr
        JOIN branch_templates bt ON bt.id = bsr.branch_template_id
        WHERE bt.key = ?
          AND bsr.stage_key = 'core_treating_proof_located'
          AND bsr.requirement_type = 'document_type'
      `
    )
    .all(MEDICAL_REQUEST_KEY) as Array<{
    requirement_key: string;
    requirement_policy: string;
  }>;

  const blockingRequirements = requiredDocTypes.filter(
    (r) => r.requirement_policy === "blocking_if_missing"
  );
  const substituteRequirements = requiredDocTypes.filter(
    (r) => r.requirement_policy.includes("substitute") || r.requirement_policy === "required_or_substitute"
  );

  const sourceItems = db
    .prepare(
      `
        SELECT id, title, COALESCE(document_type_name, json_extract(raw_json, '$.document_type_name')) AS document_type_name
        FROM source_items
        WHERE case_id = ? AND source_kind = 'file'
        ORDER BY created_at ASC
      `
    )
    .all(caseId) as Array<{
    id: string;
    title: string | null;
    document_type_name: string | null;
  }>;

  const firstSourceItemIdByType = new Map<string, string>();
  for (const item of sourceItems) {
    if (item.document_type_name && !firstSourceItemIdByType.has(item.document_type_name)) {
      firstSourceItemIdByType.set(item.document_type_name, item.id);
    }
  }

  const findings: string[] = [];
  let allBlockersSatisfied = true;
  let anySubstituteSatisfied = substituteRequirements.length === 0;

  for (const req of blockingRequirements) {
    const present = firstSourceItemIdByType.has(req.requirement_key);
    updateProofRequirementStatus(
      db,
      issue.id,
      req.requirement_key,
      present,
      firstSourceItemIdByType.get(req.requirement_key) ?? null
    );
    if (!present) {
      findings.push(`missing_${req.requirement_key.toLowerCase().replace(/\s+/g, "_")}`);
      allBlockersSatisfied = false;
    }
  }

  for (const req of substituteRequirements) {
    const present = firstSourceItemIdByType.has(req.requirement_key);
    updateProofRequirementStatus(
      db,
      issue.id,
      req.requirement_key,
      present,
      firstSourceItemIdByType.get(req.requirement_key) ?? null
    );
    if (present) {
      anySubstituteSatisfied = true;
    }
  }

  if (!anySubstituteSatisfied) {
    const substituteNames = substituteRequirements.map((r) => r.requirement_key).join(" or ");
    findings.push(`missing_treating_support (need ${substituteNames})`);
  }

  const stageReached = allBlockersSatisfied && anySubstituteSatisfied;
  const targetStage = stageReached ? "core_treating_proof_located" : "issue_identified";
  const blockerSummary =
    findings.length > 0
      ? `Missing required medical request proof: ${findings.join(", ")}`
      : null;
  const progressSummary = stageReached
    ? "All required document types for core treating proof are present."
    : "Awaiting the document types required to establish core treating proof.";

  upsertBranchStageStatus(db, {
    branchInstanceId: branch.id,
    stageKey: "core_treating_proof_located",
    status: stageReached ? "completed" : "blocked",
    blockerSummary,
    progressSummary,
    completedAt: stageReached ? nowIso() : null
  });

  const previousStage = branch.current_stage_key;
  if (previousStage !== targetStage) {
    db.prepare(
      `
        UPDATE matter_branch_instances
        SET current_stage_key = ?
        WHERE id = ?
      `
    ).run(targetStage, branch.id);

    if (previousStage && targetStage !== previousStage) {
      writeCaseEvent(db, {
        caseId,
        branchInstanceId: branch.id,
        presetId: branch.product_preset_id,
        eventName: "branch.stage_changed",
        sourceType: "system",
        sourceId: caseId,
        payload: {
          from_stage_key: previousStage,
          to_stage_key: targetStage,
          reason:
            targetStage === "core_treating_proof_located"
              ? "required_document_types_present"
              : "required_document_types_missing"
        }
      });
    }
  }

  db.prepare(
    `
      INSERT INTO branch_conformance_runs
        (id, matter_branch_instance_id, expected_stage_key, actual_stage_key, conforms, findings_json)
      VALUES
        (?, ?, ?, ?, ?, ?)
    `
  ).run(
    randomUUID(),
    branch.id,
    "core_treating_proof_located",
    targetStage,
    findings.length === 0 ? 1 : 0,
    JSON.stringify({
      findings,
      document_types_present: Array.from(firstSourceItemIdByType.keys())
    })
  );

  return {
    branchInstanceId: branch.id,
    currentStageKey: targetStage,
    findings,
    documentTypesPresent: Array.from(firstSourceItemIdByType.keys())
  };
}

export function classifySourceItemByFilename(
  db: Database.Database,
  input: {
    sourceItemId: string;
    filename: string;
  }
) {
  const aliases = db
    .prepare(
      `
        SELECT
          dta.alias_pattern,
          dta.match_mode,
          dta.priority,
          dt.id AS document_type_id,
          dt.canonical_name
        FROM document_type_aliases dta
        JOIN document_types dt ON dt.id = dta.document_type_id
        WHERE dta.active = 1 AND dt.active = 1
        ORDER BY dta.priority ASC, LENGTH(dta.alias_pattern) DESC
      `
    )
    .all() as Array<{
    alias_pattern: string;
    match_mode: string;
    priority: number | null;
    document_type_id: string;
    canonical_name: string;
  }>;

  const filenameLower = input.filename.toLowerCase();
  const match = aliases.find((alias) => {
    const pattern = alias.alias_pattern.toLowerCase();
    if (alias.match_mode === "exact") return filenameLower === pattern;
    if (alias.match_mode === "starts_with") return filenameLower.startsWith(pattern);
    return filenameLower.includes(pattern);
  });

  if (!match) {
    return {
      ok: false as const,
      classification_method: "unclassified" as const,
      error: "no alias match"
    };
  }

  db.prepare(
    `
      UPDATE source_items
      SET document_type_id = ?,
          document_type_name = ?,
          classification_method = 'alias_match',
          classification_confidence = 1.0,
          raw_json = json_set(
            COALESCE(raw_json, '{}'),
            '$.document_type_id', ?,
            '$.document_type_name', ?,
            '$.classification_method', 'alias_match',
            '$.classified_at', ?
          ),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
  ).run(match.document_type_id, match.canonical_name, match.document_type_id, match.canonical_name, nowIso(), input.sourceItemId);

  const sourceItem = db
    .prepare(
      `
        SELECT case_id
        FROM source_items
        WHERE id = ?
        LIMIT 1
      `
    )
    .get(input.sourceItemId) as { case_id: string } | undefined;

  if (sourceItem?.case_id) {
    evaluateMedicalRequestBranch(db, sourceItem.case_id);
  }

  return {
    ok: true as const,
    classification_method: "alias_match" as const,
    document_type_id: match.document_type_id,
    canonical_name: match.canonical_name
  };
}

export function normalizeSourceItemDocumentSpine(
  db: Database.Database,
  input: NormalizeSourceItemInput
) {
  let context = loadSourceItemNormalizationContext(db, input.sourceItemId);
  if (!context) {
    return {
      ok: false as const,
      source_item_id: input.sourceItemId,
      error: "source item not found"
    };
  }

  if (!isNormalizableSourceKind(context.source_kind)) {
    return {
      ok: false as const,
      source_item_id: input.sourceItemId,
      error: `source kind ${context.source_kind} is not normalizable`
    };
  }

  if (!context.rawJson.document_type_id && !context.rawJson.document_type_name && context.title) {
    classifySourceItemByFilename(db, {
      sourceItemId: input.sourceItemId,
      filename: context.title
    });
    context = loadSourceItemNormalizationContext(db, input.sourceItemId);
  }

  if (!context) {
    return {
      ok: false as const,
      source_item_id: input.sourceItemId,
      error: "source item disappeared during normalization"
    };
  }

  const title = context.title ?? context.remote_id;
  const pageCount = resolveStubPageCount(context.rawJson, input.stubPageCount);
  const { documentTypeId, documentTypeName } = resolveDocumentTypeMetadata(db, context.rawJson);
  const contentFingerprint = buildDevelopmentContentFingerprint(context, documentTypeId);
  const canonicalContentHash =
    context.content_hash ?? context.source_version_content_hash ?? contentFingerprint;
  const normalizedAt = nowIso();

  return db.transaction(() => {
    const logicalDocument = ensureLogicalDocument(db, {
      caseId: context.case_id,
      sourceItemId: context.id,
      sourceVersionId: context.source_version_id,
      documentTypeId,
      title,
      contentFingerprint
    });
    const canonicalDocument = ensureCanonicalDocument(db, {
      caseId: context.case_id,
      logicalDocumentId: logicalDocument.logicalDocumentId,
      documentTypeId,
      title,
      contentHash: canonicalContentHash,
      pageCount,
      authoritativeAssetUri: context.authoritative_asset_uri
    });
    const canonicalPages = ensureCanonicalPageStubs(db, {
      canonicalDocumentId: canonicalDocument.canonicalDocumentId,
      pageCount
    });
    const queuedOcr = queueCanonicalDocumentOcr(db, {
      canonicalDocumentId: canonicalDocument.canonicalDocumentId
    });

    db.prepare(
      `
        UPDATE source_items
        SET raw_json = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
    ).run(
      JSON.stringify({
        ...context.rawJson,
        ...(documentTypeId ? { document_type_id: documentTypeId } : {}),
        ...(documentTypeName ? { document_type_name: documentTypeName } : {}),
        source_version_id: context.source_version_id,
        logical_document_id: logicalDocument.logicalDocumentId,
        canonical_document_id: canonicalDocument.canonicalDocumentId,
        canonical_content_hash: canonicalContentHash,
        canonical_page_stub_count: canonicalPages.totalPages,
        normalization_status: "normalized",
        normalized_at: normalizedAt
      }),
      context.id
    );

    return {
      ok: true as const,
      case_id: context.case_id,
      source_item_id: context.id,
      logical_document_id: logicalDocument.logicalDocumentId,
      canonical_document_id: canonicalDocument.canonicalDocumentId,
      document_type_id: documentTypeId,
      document_type_name: documentTypeName,
      source_version_id: context.source_version_id,
      content_fingerprint: contentFingerprint,
      canonical_content_hash: canonicalContentHash,
      stub_page_count: canonicalPages.totalPages,
      created_page_stubs: canonicalPages.createdCount,
      queued_ocr_pages: queuedOcr.queuedCount,
      skipped_ocr_pages: queuedOcr.skippedCount,
      canonical_document_ocr_status: queuedOcr.state?.ocrStatus ?? "pending",
      canonical_document_ingestion_status: queuedOcr.state?.ingestionStatus ?? "pending",
      reused_logical_document: logicalDocument.reusedExisting,
      reused_canonical_document: canonicalDocument.reusedExisting
    };
  })();
}

export interface PageAssetContext {
  canonicalPageId: string;
  pageNumberInDoc: number;
  sourceItemId: string | null;
  provider: string | null;
  remoteId: string | null;
  mimeType: string | null;
  title: string | null;
  /** Local filesystem path or file:// URI for matter uploads */
  authoritativeAssetUri: string | null;
}

/**
 * Resolve Box/source file identity for a canonical page (join spine for OCR workers).
 */
export function resolvePageAssetContext(db: Database.Database, canonicalPageId: string): PageAssetContext | null {
  const row = db
    .prepare(
      `
        SELECT
          cp.id AS canonical_page_id,
          cp.page_number_in_doc,
          si.id AS source_item_id,
          si.provider,
          si.remote_id,
          si.mime_type,
          si.title,
          sv.authoritative_asset_uri AS authoritative_asset_uri
        FROM canonical_pages cp
        JOIN canonical_documents cd ON cd.id = cp.canonical_doc_id
        LEFT JOIN logical_documents ld ON ld.id = cd.logical_document_id
        LEFT JOIN source_items si ON si.id = ld.source_item_id
        LEFT JOIN source_versions sv ON sv.id = ld.source_version_id
        WHERE cp.id = ?
        LIMIT 1
      `
    )
    .get(canonicalPageId) as
    | {
        canonical_page_id: string;
        page_number_in_doc: number;
        source_item_id: string | null;
        provider: string | null;
        remote_id: string | null;
        mime_type: string | null;
        title: string | null;
        authoritative_asset_uri: string | null;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    canonicalPageId: row.canonical_page_id,
    pageNumberInDoc: row.page_number_in_doc,
    sourceItemId: row.source_item_id,
    provider: row.provider,
    remoteId: row.remote_id,
    mimeType: row.mime_type,
    title: row.title,
    authoritativeAssetUri: row.authoritative_asset_uri
  };
}

export function normalizeCaseDocumentSpine(
  db: Database.Database,
  input: NormalizeCaseSourceItemsInput
) {
  const requestedIds = input.sourceItemIds?.filter((sourceItemId) => sourceItemId.trim().length > 0) ?? [];
  const rows =
    requestedIds.length > 0
      ? requestedIds.map((sourceItemId) => ({ id: sourceItemId }))
      : ((db
          .prepare(
            `
              SELECT id
              FROM source_items
              WHERE case_id = ?
                AND source_kind IN ('file', 'attachment', 'upload')
              ORDER BY created_at ASC
            `
          )
          .all(input.caseId) as Array<{ id: string }>) ?? []);

  const results = rows.map((row) =>
    normalizeSourceItemDocumentSpine(db, {
      sourceItemId: row.id,
      stubPageCount: input.stubPageCount
    })
  );

  const normalizedCount = results.filter((result) => result.ok).length;
  const canonicalRollup = db
    .prepare(
      `
        SELECT
          COUNT(DISTINCT cd.id) AS canonical_document_count,
          COUNT(cp.id) AS canonical_page_count
        FROM canonical_documents cd
        LEFT JOIN canonical_pages cp ON cp.canonical_doc_id = cd.id
        WHERE cd.case_id = ?
      `
    )
    .get(input.caseId) as
    | {
        canonical_document_count: number;
        canonical_page_count: number;
      }
    | undefined;

  return {
    ok: true as const,
    case_id: input.caseId,
    requested_count: rows.length,
    normalized_count: normalizedCount,
    skipped_count: rows.length - normalizedCount,
    canonical_document_count: canonicalRollup?.canonical_document_count ?? 0,
    canonical_page_count: canonicalRollup?.canonical_page_count ?? 0,
    results
  };
}

export function hydrateBoxInventory(db: Database.Database, input: HydrateBoxInventoryInput) {
  const spec = getSourceConnectorSpec("box");
  const scaffold = ensureCaseScaffold(db, { caseId: input.caseId });
  const connection = ensureSourceConnection(db, {
    provider: spec.provider,
    accountLabel: input.accountLabel ?? spec.defaultAccountLabel
  });
  const cursorBefore = readSyncCursorValue(db, {
    sourceConnectionId: connection.id,
    caseId: scaffold.caseId,
    cursorKey: spec.cursorKey
  });

  const syncRunId = startSyncRun(db, {
    sourceConnectionId: connection.id,
    caseId: scaffold.caseId,
    syncType: spec.syncType,
    cursorBefore
  });

  const inventoriedItems: Array<{ source_item_id: string; remote_id: string; title: string | null }> = [];
  const { result, snapshotId } = runTrackedSourceSync({
    db,
    sourceConnectionId: connection.id,
    caseId: scaffold.caseId,
    syncRunId,
    snapshotType: spec.snapshotType,
    sourceType: spec.sourceType,
    cursorAfter: input.cursorAfter ?? null,
    run: () => {
      for (const file of input.files) {
        const normalizedFile = normalizeBoxInventoryFile(file);
        const persistedFile = persistBoxInventoryFile(db, {
          caseId: scaffold.caseId,
          sourceConnectionId: connection.id,
          provider: spec.provider,
          file,
          normalizedFile
        });

        classifySourceItemByFilename(db, {
          sourceItemId: persistedFile.sourceItemId,
          filename: normalizedFile.filename
        });

        writeCaseEvent(db, {
          caseId: scaffold.caseId,
          branchInstanceId: scaffold.branchInstanceId,
          presetId: scaffold.presetId,
          eventName: spec.inventoryEventName,
          sourceType: spec.sourceType,
          sourceId: file.remote_id,
          payload: {
            source_item_id: persistedFile.sourceItemId,
            box_file_id: file.remote_id,
            filename: persistedFile.title,
            mime_type: file.mime_type ?? null,
            parent_folder_id: persistedFile.parentRemoteId
          }
        });

        inventoriedItems.push({
          source_item_id: persistedFile.sourceItemId,
          remote_id: file.remote_id,
          title: persistedFile.title
        });
      }

      if (input.cursorAfter) {
        upsertSyncCursor(db, {
          sourceConnectionId: connection.id,
          caseId: scaffold.caseId,
          cursorKey: spec.cursorKey,
          cursorValue: input.cursorAfter
        });
      }

      return {
        inventoriedCount: inventoriedItems.length,
        branchState: evaluateMedicalRequestBranch(db, scaffold.caseId)
      };
    },
    buildSuccessManifest: (runResult) => ({
      sync_run_id: syncRunId,
      item_count: runResult.inventoriedCount,
      items: inventoriedItems,
      cursor_before: cursorBefore,
      cursor_after: input.cursorAfter ?? null
    }),
    buildFailureManifest: (errorMessage) => ({
      sync_run_id: syncRunId,
      item_count: inventoriedItems.length,
      items: inventoriedItems,
      cursor_before: cursorBefore,
      cursor_after: null,
      partial: true,
      error_message: errorMessage
    })
  });

  return {
    case_id: scaffold.caseId,
    sync_run_id: syncRunId,
    source_connection_id: connection.id,
    snapshot_id: snapshotId,
    inventoried_count: result.inventoriedCount,
    branch_state: result.branchState
  };
}

export function hydratePracticePantherState(
  db: Database.Database,
  input: HydratePracticePantherInput
) {
  const spec = getSourceConnectorSpec("practicepanther");
  const scaffold = ensureCaseScaffold(db, { caseId: input.caseId });
  const connection = ensureSourceConnection(db, {
    provider: spec.provider,
    accountLabel: input.accountLabel ?? spec.defaultAccountLabel
  });
  const cursorBefore = readSyncCursorValue(db, {
    sourceConnectionId: connection.id,
    caseId: scaffold.caseId,
    cursorKey: spec.cursorKey
  });

  const syncRunId = startSyncRun(db, {
    sourceConnectionId: connection.id,
    caseId: scaffold.caseId,
    syncType: spec.syncType,
    cursorBefore
  });

  const syncedEntityIds: string[] = [];
  const syncedEntityTypes = new Set<string>();

  const { result, snapshotId } = runTrackedSourceSync({
    db,
    sourceConnectionId: connection.id,
    caseId: scaffold.caseId,
    syncRunId,
    snapshotType: spec.snapshotType,
    sourceType: spec.sourceType,
    cursorAfter: input.cursorAfter ?? null,
    run: () => {
      for (const entity of input.entities) {
        const persistedEntity = persistPracticePantherEntity(db, {
          caseId: scaffold.caseId,
          sourceConnectionId: connection.id,
          provider: spec.provider,
          entity
        });

        if (persistedEntity.matterPatch) {
          ensureCaseScaffold(db, {
            caseId: scaffold.caseId,
            name: persistedEntity.matterPatch.name,
            ppMatterId: persistedEntity.matterPatch.ppMatterId,
            boxRootFolderId: persistedEntity.matterPatch.boxRootFolderId
          });
        }

        writeCaseEvent(db, {
          caseId: scaffold.caseId,
          branchInstanceId: scaffold.branchInstanceId,
          presetId: scaffold.presetId,
          eventName: spec.inventoryEventName,
          sourceType: spec.sourceType,
          sourceId: entity.pp_entity_id,
          payload: {
            entity_type: entity.entity_type,
            pp_entity_id: entity.pp_entity_id,
            sync_run_id: syncRunId,
            status: "success"
          }
        });

        syncedEntityIds.push(entity.pp_entity_id);
        syncedEntityTypes.add(entity.entity_type);
      }

      if (input.cursorAfter) {
        upsertSyncCursor(db, {
          sourceConnectionId: connection.id,
          caseId: scaffold.caseId,
          cursorKey: spec.cursorKey,
          cursorValue: input.cursorAfter
        });
      }

      return {
        syncedCount: input.entities.length
      };
    },
    buildSuccessManifest: (runResult) => ({
      sync_run_id: syncRunId,
      item_count: runResult.syncedCount,
      entity_ids: syncedEntityIds,
      entity_types: Array.from(syncedEntityTypes),
      cursor_before: cursorBefore,
      cursor_after: input.cursorAfter ?? null
    }),
    buildFailureManifest: (errorMessage) => ({
      sync_run_id: syncRunId,
      item_count: syncedEntityIds.length,
      entity_ids: syncedEntityIds,
      entity_types: Array.from(syncedEntityTypes),
      cursor_before: cursorBefore,
      cursor_after: null,
      partial: true,
      error_message: errorMessage
    })
  });

  return {
    case_id: scaffold.caseId,
    sync_run_id: syncRunId,
    source_connection_id: connection.id,
    snapshot_id: snapshotId,
    synced_count: result.syncedCount
  };
}

export function recordRegressionCheck(
  db: Database.Database,
  input: RecordRegressionCheckInput
) {
  const regressionId = randomUUID();
  db.prepare(
    `
      INSERT INTO regression_checks
        (id, case_id, artifact_id, bates_run_id, check_type, passed, message, details_json)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    regressionId,
    input.caseId,
    input.artifactId ?? null,
    input.batesRunId ?? null,
    input.checkType,
    input.passed ? 1 : 0,
    input.message ?? null,
    JSON.stringify(input.detailsJson ?? {})
  );

  return {
    regressionId
  };
}

export function buildRegressionSummary(db: Database.Database, caseId: string) {
  const checks = db
    .prepare(
      `
        SELECT id, check_type, passed, message, details_json, created_at
        FROM regression_checks
        WHERE case_id = ?
        ORDER BY created_at DESC
      `
    )
    .all(caseId) as Array<{
    id: string;
    check_type: string;
    passed: number;
    message: string | null;
    details_json: string | null;
    created_at: string;
  }>;

  const preset = db
    .prepare(`SELECT id FROM product_presets WHERE key = ? LIMIT 1`)
    .get(HEARING_PREP_KEY) as { id: string } | undefined;

  const requiredChecksRow =
    preset &&
    (db
      .prepare(
        `
          SELECT rule_value
          FROM product_rulepacks
          WHERE product_preset_id = ?
            AND rule_type = 'finalize_policy'
            AND rule_key = 'required_regression_checks'
            AND active = 1
          ORDER BY created_at DESC
          LIMIT 1
        `
      )
      .get(preset.id) as { rule_value: string } | undefined);

  let requiredChecks: string[] = [];
  if (requiredChecksRow?.rule_value) {
    try {
      const parsed = JSON.parse(requiredChecksRow.rule_value);
      if (Array.isArray(parsed)) {
        requiredChecks = parsed.filter((value): value is string => typeof value === "string");
      }
    } catch {
      requiredChecks = [];
    }
  }

  const latestResultByType = new Map<string, boolean>();
  for (const check of checks) {
    if (!latestResultByType.has(check.check_type)) {
      latestResultByType.set(check.check_type, Boolean(check.passed));
    }
  }

  const failedChecks = checks.filter((check) => !check.passed).map((check) => ({
    regression_id: check.id,
    check_type: check.check_type,
    message: check.message,
    created_at: check.created_at
  }));

  return {
    total_checks: checks.length,
    passed_count: checks.filter((check) => Boolean(check.passed)).length,
    failed_count: failedChecks.length,
    latest_check_at: checks[0]?.created_at ?? null,
    required_checks: requiredChecks,
    missing_required_checks: requiredChecks.filter((checkType) => !latestResultByType.get(checkType)),
    all_required_checks_passing:
      requiredChecks.length > 0 &&
      requiredChecks.every((checkType) => latestResultByType.get(checkType) === true),
    checks: checks.map((check) => ({
      regression_id: check.id,
      check_type: check.check_type,
      passed: Boolean(check.passed),
      message: check.message,
      details_json: check.details_json ? JSON.parse(check.details_json) : {},
      created_at: check.created_at
    })),
    failed_checks: failedChecks
  };
}

export function createRunManifest(db: Database.Database, input: CreateRunManifestInput) {
  const presetId =
    input.productPresetId ??
    ((db.prepare(`SELECT id FROM product_presets WHERE key = ? LIMIT 1`).get(HEARING_PREP_KEY) as
      | { id: string }
      | undefined)?.id ??
      null);

  const latestSourceSnapshot =
    input.sourceSnapshotId ??
    ((db
      .prepare(
        `
          SELECT id
          FROM source_snapshots
          WHERE case_id = ?
          ORDER BY created_at DESC
          LIMIT 1
        `
      )
      .get(input.caseId) as { id: string } | undefined)?.id ??
      null);

  const summary = buildRegressionSummary(db, input.caseId);
  const manifestId = randomUUID();
  const rulepackVersion =
    input.rulepackVersion ??
    ((presetId &&
      (db
        .prepare(
          `
            SELECT version
            FROM product_rulepacks
            WHERE product_preset_id = ?
            ORDER BY created_at DESC
            LIMIT 1
          `
        )
        .get(presetId) as { version: string } | undefined)?.version) ??
      "v1");

  db.prepare(
    `
      INSERT INTO run_manifests
        (id, case_id, product_preset_id, source_snapshot_id, rulepack_version, bates_run_id, artifact_ids_json, regression_results_json)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    manifestId,
    input.caseId,
    presetId,
    latestSourceSnapshot,
    rulepackVersion,
    input.batesRunId ?? null,
    JSON.stringify(input.artifactIds ?? []),
    JSON.stringify(summary)
  );

  return {
    manifestId,
    summary
  };
}
