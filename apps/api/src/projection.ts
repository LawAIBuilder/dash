import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { writeCaseEvent } from "./events.js";

const PROJECTION_VERSION = "slice03.v1";

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function latestSourceSnapshotIds(db: Database.Database, caseId: string) {
  const rows = db
    .prepare(
      `
        SELECT snapshot_type, id
        FROM source_snapshots
        WHERE case_id = ?
        ORDER BY created_at DESC
      `
    )
    .all(caseId) as Array<{ snapshot_type: string; id: string }>;

  const ids: Record<string, string> = {};
  for (const row of rows) {
    if (!ids[row.snapshot_type]) {
      ids[row.snapshot_type] = row.id;
    }
  }

  return ids;
}

function assetManifestVersion(db: Database.Database, caseId: string) {
  const versions = db
    .prepare(
      `
        SELECT si.provider, si.remote_id, sv.version_token, sv.content_hash, sv.remote_modified_at
        FROM source_versions sv
        JOIN source_items si ON si.id = sv.source_item_id
        WHERE si.case_id = ?
        ORDER BY si.provider ASC, si.remote_id ASC, sv.version_token ASC
      `
    )
    .all(caseId);

  return stableHash(versions);
}

export function buildCaseProjection(db: Database.Database, caseId: string) {
  const caseHeader = db
    .prepare(
      `
        SELECT
          id,
          name,
          case_type,
          status,
          pp_matter_id,
          box_root_folder_id,
          created_at,
          updated_at
        FROM cases
        WHERE id = ?
      `
    )
    .get(caseId) as
    | {
        id: string;
        name: string;
        case_type: string;
        status: string;
        pp_matter_id: string | null;
        box_root_folder_id: string | null;
        created_at: string | null;
        updated_at: string | null;
      }
    | undefined;

  if (!caseHeader) {
    return null;
  }

  const issues = db
    .prepare(
      `
        SELECT *
        FROM issues
        WHERE case_id = ?
        ORDER BY priority ASC, created_at ASC
      `
    )
    .all(caseId);

  const proofRequirements = db
    .prepare(
      `
        SELECT pr.*
        FROM proof_requirements pr
        JOIN issues i ON i.id = pr.issue_id
        WHERE i.case_id = ?
        ORDER BY i.priority ASC, pr.requirement_key ASC
      `
    )
    .all(caseId);

  const branchInstances = db
    .prepare(
      `
        SELECT
          mbi.*,
          pp.key AS product_preset_key,
          bt.key AS branch_template_key
        FROM matter_branch_instances mbi
        LEFT JOIN product_presets pp ON pp.id = mbi.product_preset_id
        LEFT JOIN branch_templates bt ON bt.id = mbi.branch_template_id
        WHERE mbi.case_id = ?
        ORDER BY mbi.priority ASC, mbi.started_at ASC
      `
    )
    .all(caseId) as Array<{
    id: string;
    current_stage_key: string | null;
    status: string;
    [key: string]: unknown;
  }>;

  const branchStageStatus = db
    .prepare(
      `
        SELECT
          bss.*
        FROM branch_stage_status bss
        JOIN matter_branch_instances mbi ON mbi.id = bss.matter_branch_instance_id
        WHERE mbi.case_id = ?
        ORDER BY bss.entered_at ASC, bss.stage_key ASC
      `
    )
    .all(caseId);

  const sourceConnections = db
    .prepare(
      `
        SELECT
          sc.id,
          sc.provider,
          sc.account_label,
          sc.external_account_id,
          sc.auth_mode,
          sc.status,
          sc.scopes,
          sc.callback_state,
          sc.authorization_url,
          sc.metadata_json,
          sc.last_error_message,
          sc.last_verified_at,
          sc.updated_at,
          sc.created_at,
          latest_sync.sync_type AS latest_sync_type,
          latest_sync.status AS latest_sync_status,
          latest_sync.started_at AS latest_sync_started_at,
          latest_sync.completed_at AS latest_sync_completed_at,
          latest_sync.error_message AS latest_sync_error,
          COALESCE(snapshot_counts.snapshot_count, 0) AS snapshot_count,
          COALESCE(source_item_counts.source_item_count, 0) AS source_item_count
        FROM source_connections sc
        LEFT JOIN (
          SELECT sr1.*
          FROM sync_runs sr1
          JOIN (
            SELECT source_connection_id, MAX(started_at) AS latest_started_at
            FROM sync_runs
            WHERE case_id = ?
            GROUP BY source_connection_id
          ) latest
            ON latest.source_connection_id = sr1.source_connection_id
           AND latest.latest_started_at = sr1.started_at
          WHERE sr1.case_id = ?
        ) latest_sync ON latest_sync.source_connection_id = sc.id
        LEFT JOIN (
          SELECT source_connection_id, COUNT(*) AS snapshot_count
          FROM source_snapshots
          WHERE case_id = ?
          GROUP BY source_connection_id
        ) snapshot_counts ON snapshot_counts.source_connection_id = sc.id
        LEFT JOIN (
          SELECT source_connection_id, COUNT(*) AS source_item_count
          FROM source_items
          WHERE case_id = ?
          GROUP BY source_connection_id
        ) source_item_counts ON source_item_counts.source_connection_id = sc.id
        WHERE EXISTS (
          SELECT 1
          FROM source_items si
          WHERE si.case_id = ?
            AND si.source_connection_id = sc.id
        )
           OR EXISTS (
          SELECT 1
          FROM source_snapshots ss
          WHERE ss.case_id = ?
            AND ss.source_connection_id = sc.id
        )
           OR EXISTS (
          SELECT 1
          FROM sync_runs sr
          WHERE sr.case_id = ?
            AND sr.source_connection_id = sc.id
        )
        ORDER BY sc.provider ASC, sc.created_at ASC
      `
    )
    .all(caseId, caseId, caseId, caseId, caseId, caseId, caseId) as Array<{
    id: string;
    provider: string;
    account_label: string | null;
    external_account_id: string | null;
    auth_mode: string;
    status: string;
    scopes: string | null;
    callback_state: string | null;
    authorization_url: string | null;
    metadata_json: string | null;
    last_error_message: string | null;
    last_verified_at: string | null;
    updated_at: string | null;
    created_at: string | null;
    latest_sync_type: string | null;
    latest_sync_status: string | null;
    latest_sync_started_at: string | null;
    latest_sync_completed_at: string | null;
    latest_sync_error: string | null;
    snapshot_count: number;
    source_item_count: number;
  }>;

  const sourceItems = db
    .prepare(
      `
        SELECT
          si.id,
          si.provider,
          si.source_kind,
          si.title,
          si.document_type_id,
          si.document_type_name,
          si.classification_method,
          si.classification_confidence,
          dt.category AS document_category,
          dt.exhibit_eligible,
          dt.exhibit_policy,
          dt.hearing_relevance,
          dt.mandatory_vlm_ocr,
          dt.default_priority,
          json_extract(si.raw_json, '$.normalization_status') AS normalization_status,
          json_extract(si.raw_json, '$.canonical_document_id') AS canonical_document_id,
          si.raw_json,
          si.updated_at
        FROM source_items si
        LEFT JOIN document_types dt ON dt.id = si.document_type_id
        WHERE si.case_id = ?
        ORDER BY COALESCE(dt.default_priority, 50) ASC, si.created_at ASC
      `
    )
    .all(caseId) as Array<{
    id: string;
    updated_at: string | null;
    raw_json: string | null;
    document_type_id: string | null;
    document_type_name: string | null;
    classification_method: string | null;
    document_category: string | null;
    exhibit_eligible: number | null;
    exhibit_policy: string | null;
    hearing_relevance: string | null;
    mandatory_vlm_ocr: number | null;
    default_priority: number | null;
    [key: string]: unknown;
  }>;

  const canonicalDocuments = db
    .prepare(
      `
        SELECT
          cd.id,
          cd.title,
          cd.document_type_id,
          dt.canonical_name AS document_type_name,
          dt.mandatory_vlm_ocr,
          cd.provider,
          si.source_kind,
          si.id AS source_item_id,
          sv.version_token AS latest_version_token,
          cd.content_hash,
          cd.page_count,
          cd.ocr_status,
          cd.ingestion_status,
          cd.created_at,
          cd.updated_at,
          COALESCE(cp.complete_pages, 0) AS complete_pages,
          COALESCE(cp.queued_pages, 0) AS queued_pages,
          COALESCE(cp.processing_pages, 0) AS processing_pages,
          COALESCE(cp.review_required_pages, 0) AS review_required_pages,
          CASE
            WHEN COALESCE(cp.review_required_pages, 0) > 0 THEN 'review_required'
            WHEN cd.ocr_status = 'complete' THEN 'ready'
            WHEN COALESCE(cp.processing_pages, 0) > 0 OR COALESCE(cp.queued_pages, 0) > 0 THEN 'processing'
            WHEN cp.page_count > 0 THEN 'pages_created'
            ELSE 'canonicalized'
          END AS state
        FROM canonical_documents cd
        LEFT JOIN document_types dt ON dt.id = cd.document_type_id
        LEFT JOIN logical_documents ld ON ld.id = cd.logical_document_id
        LEFT JOIN source_items si ON si.id = ld.source_item_id
        LEFT JOIN source_versions sv ON sv.id = ld.source_version_id
        LEFT JOIN (
          SELECT canonical_doc_id, COUNT(*) AS page_count
               , SUM(CASE WHEN ocr_status = 'complete' THEN 1 ELSE 0 END) AS complete_pages
               , SUM(CASE WHEN ocr_status = 'queued' THEN 1 ELSE 0 END) AS queued_pages
               , SUM(CASE WHEN ocr_status = 'processing' THEN 1 ELSE 0 END) AS processing_pages
               , SUM(CASE WHEN ocr_status = 'review_required' THEN 1 ELSE 0 END) AS review_required_pages
          FROM canonical_pages
          GROUP BY canonical_doc_id
        ) cp ON cp.canonical_doc_id = cd.id
        WHERE cd.case_id = ?
        ORDER BY cd.created_at ASC
      `
    )
    .all(caseId) as Array<Record<string, unknown>>;

  const canonicalPages = db
    .prepare(
      `
        SELECT
          cp.id,
          cp.canonical_doc_id AS canonical_document_id,
          cp.page_number_in_doc AS page_number,
          cp.ocr_method,
          cp.ocr_confidence,
          cp.ocr_status,
          cp.extraction_status,
          cp.updated_at,
          review.active_review_status AS review_status,
          review.active_review_severity AS review_severity,
          review.blocker_for_branch,
          review.blocker_for_preset,
          cp.created_at,
          CASE
            WHEN review.active_review_status IS NOT NULL THEN 'review_required'
            WHEN cp.ocr_status = 'complete' AND cp.extraction_status = 'ready' THEN 'ready'
            WHEN cp.ocr_status = 'complete' THEN 'text_ready'
            WHEN cp.ocr_status IN ('queued', 'processing') THEN 'processing'
            ELSE 'page_stub'
          END AS state
        FROM canonical_pages cp
        JOIN canonical_documents cd ON cd.id = cp.canonical_doc_id
        LEFT JOIN (
          SELECT
            canonical_page_id,
            MAX(CASE WHEN review_status IN ('pending', 'in_review') THEN review_status END) AS active_review_status,
            MAX(CASE WHEN review_status IN ('pending', 'in_review') THEN severity END) AS active_review_severity,
            MAX(CASE WHEN review_status IN ('pending', 'in_review') THEN blocker_for_branch END) AS blocker_for_branch,
            MAX(CASE WHEN review_status IN ('pending', 'in_review') THEN blocker_for_preset END) AS blocker_for_preset
          FROM ocr_review_queue
          GROUP BY canonical_page_id
        ) review ON review.canonical_page_id = cp.id
        WHERE cd.case_id = ?
        ORDER BY cd.created_at ASC, cp.page_number_in_doc ASC
      `
    )
    .all(caseId) as Array<Record<string, unknown>>;

  const pageExtractions = db
    .prepare(
      `
        SELECT
          pe.id,
          pe.canonical_page_id,
          pe.schema_key,
          pe.extractor_version,
          pe.payload_json,
          pe.confidence,
          pe.created_at
        FROM page_extractions pe
        JOIN canonical_pages cp ON cp.id = pe.canonical_page_id
        JOIN canonical_documents cd ON cd.id = cp.canonical_doc_id
        WHERE cd.case_id = ?
        ORDER BY pe.created_at ASC
      `
    )
    .all(caseId) as Array<{
    id: string;
    canonical_page_id: string;
    schema_key: string;
    extractor_version: string;
    payload_json: string;
    confidence: number | null;
    created_at: string | null;
  }>;

  const extractionRows = pageExtractions.map((row) => {
    let payload: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(row.payload_json) as unknown;
      payload =
        parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      payload = {};
    }
    return {
      id: row.id,
      canonical_page_id: row.canonical_page_id,
      schema_key: row.schema_key,
      extractor_version: row.extractor_version,
      confidence: row.confidence,
      created_at: row.created_at,
      payload
    };
  });

  const documentStateCounts = canonicalDocuments.reduce<Record<string, number>>((acc, doc) => {
    const state = String(doc.state ?? "unknown");
    acc[state] = (acc[state] ?? 0) + 1;
    return acc;
  }, {});

  const pageStateCounts = canonicalPages.reduce<Record<string, number>>((acc, page) => {
    const state = String(page.state ?? "unknown");
    acc[state] = (acc[state] ?? 0) + 1;
    return acc;
  }, {});

  const ocrStatusCounts = canonicalPages.reduce<Record<string, number>>((acc, page) => {
    const status = String(page.ocr_status ?? "pending");
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {});

  const extractionStatusCounts = canonicalPages.reduce<Record<string, number>>((acc, page) => {
    const status = String(page.extraction_status ?? "pending");
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {});

  const slices = {
    case_header: caseHeader,
    issue_proof_slice: {
      issues,
      proof_requirements: proofRequirements
    },
    branch_state_slice: {
      branch_instances: branchInstances,
      branch_stage_status: branchStageStatus
    },
    source_connection_slice: {
      connections: sourceConnections
    },
    document_inventory_slice: {
      source_items: sourceItems,
      classification_summary: {
        total: sourceItems.length,
        classified: sourceItems.filter((i) => i.document_type_id !== null).length,
        unclassified: sourceItems.filter((i) => i.document_type_id === null).length,
        by_method: sourceItems.reduce<Record<string, number>>((acc, i) => {
          const method = i.classification_method ?? "unclassified";
          acc[method] = (acc[method] ?? 0) + 1;
          return acc;
        }, {}),
        by_category: sourceItems.reduce<Record<string, number>>((acc, i) => {
          const cat = (i.document_category as string) ?? "uncategorized";
          acc[cat] = (acc[cat] ?? 0) + 1;
          return acc;
        }, {}),
        by_hearing_relevance: sourceItems.reduce<Record<string, number>>((acc, i) => {
          const rel = (i.hearing_relevance as string) ?? "unrated";
          acc[rel] = (acc[rel] ?? 0) + 1;
          return acc;
        }, {}),
        exhibit_eligible_count: sourceItems.filter((i) => i.exhibit_eligible === 1).length,
        critical_ocr_required: sourceItems.filter((i) => i.mandatory_vlm_ocr === 1).length
      },
      ocr_summary: {
        total_pages: canonicalPages.length,
        by_ocr_status: ocrStatusCounts,
        by_extraction_status: extractionStatusCounts,
        review_required_count: canonicalPages.filter((page) => page.review_status !== null && page.review_status !== undefined)
          .length,
        blocking_review_count: canonicalPages.filter((page) => Number(page.blocker_for_branch ?? 0) === 1).length
      }
    },
    canonical_document_slice: {
      documents: canonicalDocuments,
      state_summary: {
        document_count: canonicalDocuments.length,
        page_count: canonicalPages.length,
        document_state_counts: documentStateCounts,
        page_state_counts: pageStateCounts
      }
    },
    canonical_page_slice: {
      pages: canonicalPages,
      state_summary: {
        document_count: canonicalDocuments.length,
        page_count: canonicalPages.length,
        document_state_counts: documentStateCounts,
        page_state_counts: pageStateCounts
      }
    },
    canonical_spine_slice: {
      documents: canonicalDocuments,
      pages: canonicalPages,
      state_summary: {
        document_count: canonicalDocuments.length,
        page_count: canonicalPages.length,
        document_state_counts: documentStateCounts,
        page_state_counts: pageStateCounts
      }
    },
    extraction_slice: {
      extractions: extractionRows,
      summary: {
        total: extractionRows.length,
        by_schema: extractionRows.reduce<Record<string, number>>((acc, row) => {
          const key = row.schema_key ?? "unknown";
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {})
      }
    }
  };

  const sliceChecksums = {
    case_header: stableHash(slices.case_header),
    issue_proof_slice: stableHash(slices.issue_proof_slice),
    branch_state_slice: stableHash(slices.branch_state_slice),
    source_connection_slice: stableHash(slices.source_connection_slice),
    document_inventory_slice: stableHash(slices.document_inventory_slice),
    canonical_document_slice: stableHash(slices.canonical_document_slice),
    canonical_page_slice: stableHash(slices.canonical_page_slice),
    canonical_spine_slice: stableHash(slices.canonical_spine_slice),
    extraction_slice: stableHash(slices.extraction_slice)
  };

  const matterVersionToken = `matter_${stableHash({
    caseHeader,
    issues,
    proofRequirements,
    branchInstances: branchInstances.map((instance) => ({
      id: instance.id,
      current_stage_key: instance.current_stage_key,
      status: instance.status
    })),
    sourceConnections: sourceConnections.map((connection) => ({
      id: connection.id,
      provider: connection.provider,
      auth_mode: connection.auth_mode,
      status: connection.status,
      external_account_id: connection.external_account_id,
      callback_state: connection.callback_state,
      authorization_url: connection.authorization_url,
      last_error_message: connection.last_error_message,
      last_verified_at: connection.last_verified_at,
      latest_sync_status: connection.latest_sync_status,
      latest_sync_started_at: connection.latest_sync_started_at,
      source_item_count: connection.source_item_count
    })),
    sourceItems: sourceItems.map((item) => ({
      id: item.id,
      updated_at: item.updated_at,
      raw_json: item.raw_json
    })),
    canonicalDocuments: canonicalDocuments.map((document) => ({
      id: document.id,
      updated_at: document.updated_at,
      state: document.state,
      ocr_status: document.ocr_status,
      ingestion_status: document.ingestion_status
    })),
    canonicalPages: canonicalPages.map((page) => ({
      id: page.id,
      updated_at: page.updated_at,
      state: page.state,
      ocr_status: page.ocr_status,
      extraction_status: page.extraction_status,
      review_status: page.review_status
    })),
    pageExtractions: extractionRows.map((row) => ({
      id: row.id,
      schema_key: row.schema_key,
      canonical_page_id: row.canonical_page_id
    }))
  })}`;

  const snapshotId = randomUUID();
  const snapshotCreatedAt = new Date().toISOString();
  const sliceChecksum = stableHash(sliceChecksums);
  const assetManifest = assetManifestVersion(db, caseId);
  const latestSnapshots = latestSourceSnapshotIds(db, caseId);

  db.prepare(
    `
      INSERT INTO projected_case_queue
        (case_id, last_projection_refresh_at, projection_snapshot_id, matter_version_token)
      VALUES
        (?, ?, ?, ?)
      ON CONFLICT(case_id) DO UPDATE SET
        last_projection_refresh_at = excluded.last_projection_refresh_at,
        projection_snapshot_id = excluded.projection_snapshot_id,
        matter_version_token = excluded.matter_version_token
    `
  ).run(caseId, snapshotCreatedAt, snapshotId, matterVersionToken);

  writeCaseEvent(db, {
    caseId,
    eventName: "projection.refreshed",
    sourceType: "projection",
    sourceId: snapshotId,
    payload: {
      projection_snapshot_id: snapshotId,
      slice_names: Object.keys(slices),
      matter_version_token: matterVersionToken
    }
  });

  return {
    snapshot_id: snapshotId,
    snapshot_created_at: snapshotCreatedAt,
    projection_version: PROJECTION_VERSION,
    matter_version_token: matterVersionToken,
    slice_checksum: sliceChecksum,
    asset_manifest_version: assetManifest,
    snapshot_metadata: {
      snapshot_id: snapshotId,
      snapshot_created_at: snapshotCreatedAt,
      projection_version: PROJECTION_VERSION,
      slice_checksum: sliceChecksum,
      slice_checksums: sliceChecksums,
      asset_manifest_version: assetManifest,
      latest_source_snapshot_ids: latestSnapshots
    },
    slices
  };
}
