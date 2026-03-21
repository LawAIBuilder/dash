import type { MatterProjection, ProjectionWatermark } from "@wc/domain-core";
import { API_BASE, buildApiHeaders } from "@/config";
import type {
  CaseListItem,
  CreateCaseInput,
  DocumentTypeListItem,
  ReviewQueueResponse
} from "@/types/cases";

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    const message =
      typeof (payload as { error?: string }).error === "string"
        ? (payload as { error?: string }).error
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

function apiUrl(path: string) {
  return `${API_BASE}${path}`;
}

export async function listCases(): Promise<CaseListItem[]> {
  const response = await fetch(apiUrl("/api/cases"), {
    headers: buildApiHeaders()
  });
  const payload = await readJson<{ cases: CaseListItem[] }>(response);
  return payload.cases;
}

export async function listDocumentTypes(): Promise<DocumentTypeListItem[]> {
  const response = await fetch(apiUrl("/api/document-types"), {
    headers: buildApiHeaders()
  });
  const payload = await readJson<{ document_types: DocumentTypeListItem[] }>(response);
  return payload.document_types;
}

export async function createCase(input: CreateCaseInput): Promise<CaseListItem> {
  const response = await fetch(apiUrl("/api/cases"), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(input)
  });
  const payload = await readJson<{ ok: true; case: CaseListItem }>(response);
  return payload.case;
}

export async function getCase(caseId: string): Promise<CaseListItem> {
  const response = await fetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}`), {
    headers: buildApiHeaders()
  });
  const payload = await readJson<{ ok: true; case: CaseListItem }>(response);
  return payload.case;
}

export async function updateCase(caseId: string, input: Partial<CreateCaseInput>): Promise<CaseListItem> {
  const response = await fetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}`), {
    method: "PATCH",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(input)
  });
  const payload = await readJson<{ ok: true; case: CaseListItem }>(response);
  return payload.case;
}

export async function getProjection(caseId: string): Promise<MatterProjection> {
  const response = await fetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/projection`), {
    headers: buildApiHeaders()
  });
  return readJson<MatterProjection>(response);
}

export async function syncBox(caseId: string) {
  const response = await fetch(apiUrl("/api/connectors/box/sync"), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ case_id: caseId })
  });
  return readJson<Record<string, unknown>>(response);
}

export async function probeBoxJwt() {
  const response = await fetch(apiUrl("/api/connectors/box/auth/jwt"), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({})
  });
  return readJson<Record<string, unknown>>(response);
}

export async function normalizeDocuments(caseId: string) {
  const response = await fetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/normalize-documents`), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({})
  });
  return readJson<Record<string, unknown>>(response);
}

export async function queueOcr(caseId: string, input?: Record<string, unknown>) {
  const response = await fetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/ocr/queue`), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(input ?? {})
  });
  return readJson<Record<string, unknown>>(response);
}

export async function runHeuristicExtractions(caseId: string) {
  const response = await fetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/extractions/run-heuristics`), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({})
  });
  return readJson<Record<string, unknown>>(response);
}

export async function getReviewQueue(caseId: string): Promise<ReviewQueueResponse> {
  const response = await fetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/review-queue`), {
    headers: buildApiHeaders()
  });
  return readJson<ReviewQueueResponse>(response);
}

export async function resolveOcrReview(pageId: string, acceptEmpty = false) {
  const response = await fetch(apiUrl(`/api/canonical-pages/${encodeURIComponent(pageId)}/ocr-review/resolve`), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ accept_empty: acceptEmpty })
  });
  return readJson<Record<string, unknown>>(response);
}

export async function overrideClassification(sourceItemId: string, documentTypeId: string | null) {
  const response = await fetch(apiUrl(`/api/source-items/${encodeURIComponent(sourceItemId)}/classification`), {
    method: "PATCH",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(documentTypeId ? { document_type_id: documentTypeId } : { clear: true })
  });
  return readJson<Record<string, unknown>>(response);
}

export async function previewFile(sourceItemId: string): Promise<Blob> {
  const response = await fetch(apiUrl(`/api/files/${encodeURIComponent(sourceItemId)}/content`), {
    headers: buildApiHeaders()
  });
  if (!response.ok) {
    throw new Error((await response.text()) || `Preview failed (${response.status})`);
  }
  return response.blob();
}

export function buildWatermark(caseId: string, projection: MatterProjection, previous?: ProjectionWatermark | null): ProjectionWatermark {
  return {
    case_id: caseId,
    authoritative_snapshot_id: projection.snapshot_id,
    matter_version_token: projection.matter_version_token,
    last_pull_at: new Date().toISOString(),
    last_push_at: previous?.last_push_at ?? null
  };
}

export async function getOcrWorkerHealth() {
  const response = await fetch(apiUrl("/api/workers/ocr/health"), {
    headers: buildApiHeaders()
  });
  return readJson<{
    ok: true;
    worker: {
      worker_name: string;
      status: string;
      last_heartbeat_at: string;
      last_started_at: string | null;
      last_stopped_at: string | null;
      last_error_message: string | null;
      last_processed_count: number;
      metadata_json: string | null;
    } | null;
    stale: boolean;
    age_ms: number | null;
  }>(response);
}
