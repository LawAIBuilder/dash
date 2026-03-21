import type { MatterProjection, ProjectionWatermark } from "@wc/domain-core";
import { API_BASE, buildApiHeaders } from "@/config";
import type {
  CaseActivityEvent,
  CasePersonItem,
  CaseListItem,
  CaseTimelineItem,
  CreateCaseInput,
  DocumentTypeListItem,
  PracticePantherConnectionStatus,
  PracticePantherMatterItem,
  ReviewQueueResponse
} from "@/types/cases";
import type {
  ExhibitHistoryEntry,
  ExhibitPacket,
  ExhibitSuggestion,
  ExhibitWorkspaceResponse,
  PacketPdfExportLayout,
  PacketPdfExportRow
} from "@/types/exhibits";
import type { UserDocumentTemplate, UserDocumentTemplateFill } from "@/types/document-templates";

const DEFAULT_API_TIMEOUT_MS = 30_000;
const LONG_API_TIMEOUT_MS = 120_000;

export interface ApiRequestOptions {
  signal?: AbortSignal | null;
  timeoutMs?: number;
}

interface ApiRequestInit extends RequestInit, ApiRequestOptions {}

export class ApiError extends Error {
  status: number;
  isTimeout: boolean;
  retryAfterSeconds: number | null;

  constructor(message: string, status: number, options?: { isTimeout?: boolean; retryAfterSeconds?: number | null }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.isTimeout = options?.isTimeout ?? false;
    this.retryAfterSeconds = options?.retryAfterSeconds ?? null;
  }
}

function combineAbortSignals(inputSignal: AbortSignal | null | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let didTimeout = false;
  const timeoutId = globalThis.setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  const abortFromInput = () => {
    controller.abort();
  };

  if (inputSignal) {
    if (inputSignal.aborted) {
      abortFromInput();
    } else {
      inputSignal.addEventListener("abort", abortFromInput, { once: true });
    }
  }

  return {
    signal: controller.signal,
    didTimeout: () => didTimeout,
    cleanup: () => {
      globalThis.clearTimeout(timeoutId);
      if (inputSignal) {
        inputSignal.removeEventListener("abort", abortFromInput);
      }
    }
  };
}

async function apiFetch(input: string | URL, init: ApiRequestInit = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_API_TIMEOUT_MS, signal, ...requestInit } = init;
  const combined = combineAbortSignals(signal, timeoutMs);
  try {
    return await fetch(input, {
      ...requestInit,
      signal: combined.signal
    });
  } catch (error) {
    if (combined.didTimeout()) {
      throw new ApiError(`Request timed out after ${Math.round(timeoutMs / 1000)}s`, 408, { isTimeout: true });
    }
    throw error;
  } finally {
    combined.cleanup();
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  const json = (await response.json().catch(() => null)) as { error?: string } | null;
  if (typeof json?.error === "string" && json.error.trim()) {
    return json.error;
  }
  const text = await response.text().catch(() => "");
  return text || `Request failed (${response.status})`;
}

function readRetryAfterSeconds(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    const message =
      typeof (payload as { error?: string }).error === "string"
        ? (payload as { error?: string }).error
        : `Request failed (${response.status})`;
    const retryAfterSeconds = readRetryAfterSeconds(response);
    const suffix =
      response.status === 429 && retryAfterSeconds
        ? ` Retry in about ${retryAfterSeconds}s.`
        : "";
    throw new ApiError(`${message || `Request failed (${response.status})`}${suffix}`, response.status, {
      retryAfterSeconds
    });
  }
  return payload;
}

function apiUrl(path: string) {
  return `${API_BASE}${path}`;
}

export function isRetryableApiError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.isTimeout || error.status === 408 || error.status === 429 || error.status >= 500;
  }
  if (error instanceof TypeError) {
    return true;
  }
  return false;
}

export function getDisplayErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError || error instanceof Error) {
    return error.message || fallback;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallback;
}

export async function listCases(requestOptions?: ApiRequestOptions): Promise<CaseListItem[]> {
  const response = await apiFetch(apiUrl("/api/cases"), {
    headers: buildApiHeaders(),
    ...requestOptions
  });
  const payload = await readJson<{ cases: CaseListItem[] }>(response);
  return payload.cases;
}

export async function listDocumentTypes(requestOptions?: ApiRequestOptions): Promise<DocumentTypeListItem[]> {
  const response = await apiFetch(apiUrl("/api/document-types"), {
    headers: buildApiHeaders(),
    ...requestOptions
  });
  const payload = await readJson<{ document_types: DocumentTypeListItem[] }>(response);
  return payload.document_types;
}

export async function createCase(input: CreateCaseInput): Promise<CaseListItem> {
  const response = await apiFetch(apiUrl("/api/cases"), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(input)
  });
  const payload = await readJson<{ ok: true; case: CaseListItem }>(response);
  return payload.case;
}

export async function getCase(caseId: string, requestOptions?: ApiRequestOptions): Promise<CaseListItem> {
  const response = await apiFetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}`), {
    headers: buildApiHeaders(),
    ...requestOptions
  });
  const payload = await readJson<{ ok: true; case: CaseListItem }>(response);
  return payload.case;
}

export async function updateCase(caseId: string, input: Partial<CreateCaseInput>): Promise<CaseListItem> {
  const response = await apiFetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}`), {
    method: "PATCH",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(input)
  });
  const payload = await readJson<{ ok: true; case: CaseListItem }>(response);
  return payload.case;
}

export async function getCasePeople(caseId: string, requestOptions?: ApiRequestOptions): Promise<CasePersonItem[]> {
  const response = await apiFetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/people`), {
    headers: buildApiHeaders(),
    ...requestOptions
  });
  const payload = await readJson<{ ok: true; people: CasePersonItem[] }>(response);
  return payload.people;
}

export async function getCaseTimeline(caseId: string, requestOptions?: ApiRequestOptions): Promise<CaseTimelineItem[]> {
  const response = await apiFetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/timeline`), {
    headers: buildApiHeaders(),
    ...requestOptions
  });
  const payload = await readJson<{
    ok: true;
    entries: CaseTimelineItem[];
    summary?: Record<string, unknown>;
  }>(response);
  return payload.entries;
}

export async function getCaseActivity(caseId: string, requestOptions?: ApiRequestOptions): Promise<CaseActivityEvent[]> {
  const response = await apiFetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/activity`), {
    headers: buildApiHeaders(),
    ...requestOptions
  });
  const payload = await readJson<{ ok: true; events: CaseActivityEvent[] }>(response);
  return payload.events;
}

export async function getHearingPrepSnapshot(
  caseId: string,
  packetId?: string | null,
  requestOptions?: ApiRequestOptions
) {
  const qs = packetId ? `?packet_id=${encodeURIComponent(packetId)}` : "";
  const response = await apiFetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/hearing-prep${qs}`), {
    headers: buildApiHeaders(),
    timeoutMs: LONG_API_TIMEOUT_MS,
    ...requestOptions
  });
  const payload = await readJson<{ ok: true; case_id: string; snapshot: Record<string, unknown> }>(response);
  return payload.snapshot;
}

export async function getProjection(caseId: string, requestOptions?: ApiRequestOptions): Promise<MatterProjection> {
  const response = await apiFetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/projection`), {
    headers: buildApiHeaders(),
    timeoutMs: LONG_API_TIMEOUT_MS,
    ...requestOptions
  });
  return readJson<MatterProjection>(response);
}

export async function syncBox(caseId: string) {
  const response = await apiFetch(apiUrl("/api/connectors/box/sync"), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ case_id: caseId }),
    timeoutMs: LONG_API_TIMEOUT_MS
  });
  return readJson<Record<string, unknown>>(response);
}

export async function probeBoxJwt() {
  const response = await apiFetch(apiUrl("/api/connectors/box/auth/jwt"), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({})
  });
  return readJson<Record<string, unknown>>(response);
}

export async function getPracticePantherStatus(requestOptions?: ApiRequestOptions) {
  const response = await apiFetch(apiUrl("/api/connectors/practicepanther/status"), {
    headers: buildApiHeaders(),
    ...requestOptions
  });
  return readJson<{
    ok: true;
    configured: boolean;
    api_base_url: string;
    redirect_uri: string | null;
    connection: PracticePantherConnectionStatus | null;
  }>(response);
}

export async function startPracticePantherAuth(input?: { account_label?: string; return_to?: string | null }) {
  const response = await apiFetch(apiUrl("/api/connectors/practicepanther/auth/start"), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(input ?? {})
  });
  return readJson<{
    ok: true;
    connection_id: string;
    authorization_url: string;
    redirect_uri: string | null;
  }>(response);
}

export async function listPracticePantherMatters(searchText?: string, requestOptions?: ApiRequestOptions) {
  const url = new URL(apiUrl("/api/connectors/practicepanther/matters"), window.location.origin);
  if (searchText?.trim()) {
    url.searchParams.set("search_text", searchText.trim());
  }
  const response = await apiFetch(url.toString(), {
    headers: buildApiHeaders(),
    ...requestOptions
  });
  const payload = await readJson<{ ok: true; matters: PracticePantherMatterItem[] }>(response);
  return payload.matters;
}

export async function syncPracticePanther(caseId: string, input?: { pp_matter_id?: string | null }) {
  const response = await apiFetch(apiUrl("/api/connectors/practicepanther/sync"), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({
      case_id: caseId,
      pp_matter_id: input?.pp_matter_id ?? null
    }),
    timeoutMs: LONG_API_TIMEOUT_MS
  });
  return readJson<Record<string, unknown>>(response);
}

export async function normalizeDocuments(caseId: string) {
  const response = await apiFetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/normalize-documents`), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({}),
    timeoutMs: LONG_API_TIMEOUT_MS
  });
  return readJson<Record<string, unknown>>(response);
}

export async function queueOcr(caseId: string, input?: Record<string, unknown>) {
  const response = await apiFetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/ocr/queue`), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(input ?? {}),
    timeoutMs: LONG_API_TIMEOUT_MS
  });
  return readJson<Record<string, unknown>>(response);
}

export async function runHeuristicExtractions(caseId: string) {
  const response = await apiFetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/extractions/run-heuristics`), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({}),
    timeoutMs: LONG_API_TIMEOUT_MS
  });
  return readJson<Record<string, unknown>>(response);
}

export async function getReviewQueue(caseId: string, requestOptions?: ApiRequestOptions): Promise<ReviewQueueResponse> {
  const response = await apiFetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/review-queue`), {
    headers: buildApiHeaders(),
    ...requestOptions
  });
  return readJson<ReviewQueueResponse>(response);
}

export async function resolveOcrReview(caseId: string, pageId: string, acceptEmpty = false) {
  const response = await apiFetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/canonical-pages/${encodeURIComponent(pageId)}/ocr-review/resolve`),
    {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ accept_empty: acceptEmpty })
    }
  );
  return readJson<Record<string, unknown>>(response);
}

export async function overrideClassification(caseId: string, sourceItemId: string, documentTypeId: string | null) {
  const response = await apiFetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/source-items/${encodeURIComponent(sourceItemId)}/classification`),
    {
    method: "PATCH",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(documentTypeId ? { document_type_id: documentTypeId } : { clear: true })
    }
  );
  return readJson<Record<string, unknown>>(response);
}

export async function previewFile(caseId: string, sourceItemId: string): Promise<Blob> {
  const response = await apiFetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/source-items/${encodeURIComponent(sourceItemId)}/content`),
    {
    headers: buildApiHeaders(),
    timeoutMs: LONG_API_TIMEOUT_MS
    }
  );
  if (!response.ok) {
    const retryAfterSeconds = readRetryAfterSeconds(response);
    const message = await readErrorMessage(response);
    throw new ApiError(
      `${message}${response.status === 429 && retryAfterSeconds ? ` Retry in about ${retryAfterSeconds}s.` : ""}`,
      response.status,
      { retryAfterSeconds }
    );
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

export async function getOcrWorkerHealth(requestOptions?: ApiRequestOptions) {
  const response = await apiFetch(apiUrl("/api/workers/ocr/health"), {
    headers: buildApiHeaders(),
    ...requestOptions
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

export async function getExhibitWorkspace(caseId: string, requestOptions?: ApiRequestOptions): Promise<ExhibitPacket[]> {
  const response = await apiFetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/exhibits`), {
    headers: buildApiHeaders(),
    timeoutMs: LONG_API_TIMEOUT_MS,
    ...requestOptions
  });
  const payload = await readJson<ExhibitWorkspaceResponse>(response);
  return payload.packets;
}

export async function createExhibitPacket(
  caseId: string,
  input?: {
    packet_name?: string;
    packet_mode?: "compact" | "full";
    naming_scheme?: string;
    package_type?: string;
    package_label?: string;
    target_document_source_item_id?: string;
    starter_slot_count?: number;
  }
) {
  const response = await apiFetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/exhibit-packets`), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(input ?? {})
  });
  return readJson<{ ok: true; case_id: string; packet: ExhibitPacket | null }>(response);
}

export async function updateExhibitPacket(
  caseId: string,
  packetId: string,
  input: {
    packet_name?: string;
    packet_mode?: "compact" | "full";
    naming_scheme?: string;
    status?: string;
    package_type?: string;
    package_label?: string | null;
    target_document_source_item_id?: string | null;
    run_status?: string | null;
  }
) {
  const response = await apiFetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/exhibit-packets/${encodeURIComponent(packetId)}`), {
    method: "PATCH",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(input)
  });
  return readJson<{ ok: true; packet: ExhibitPacket | null }>(response);
}

export async function createExhibitSlot(
  caseId: string,
  sectionId: string,
  input?: {
    exhibit_label?: string | null;
    title?: string | null;
    purpose?: string | null;
    objection_risk?: string | null;
    notes?: string | null;
  }
) {
  const response = await apiFetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/exhibit-sections/${encodeURIComponent(sectionId)}/exhibits`),
    {
      method: "POST",
      headers: buildApiHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(input ?? {})
    }
  );
  return readJson<{ ok: true; packet: ExhibitPacket | null }>(response);
}

export async function reorderExhibitSections(caseId: string, packetId: string, sectionIds: string[]) {
  const response = await apiFetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/exhibit-packets/${encodeURIComponent(packetId)}/sections/reorder`),
    {
      method: "POST",
      headers: buildApiHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ section_ids: sectionIds })
    }
  );
  return readJson<{ ok: true; packet: ExhibitPacket | null }>(response);
}

export async function reorderSectionExhibits(caseId: string, sectionId: string, exhibitIds: string[]) {
  const response = await apiFetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/exhibit-sections/${encodeURIComponent(sectionId)}/exhibits/reorder`),
    {
      method: "POST",
      headers: buildApiHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ exhibit_ids: exhibitIds })
    }
  );
  return readJson<{ ok: true; packet: ExhibitPacket | null }>(response);
}

export async function updateExhibitSlot(
  caseId: string,
  exhibitId: string,
  input: {
    exhibit_label?: string | null;
    title?: string | null;
    status?: string | null;
    purpose?: string | null;
    objection_risk?: string | null;
    notes?: string | null;
  }
) {
  const response = await apiFetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/exhibits/${encodeURIComponent(exhibitId)}`), {
    method: "PATCH",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(input)
  });
  return readJson<{ ok: true; packet: ExhibitPacket | null }>(response);
}

export async function addExhibitItem(
  caseId: string,
  exhibitId: string,
  input: { source_item_id: string; notes?: string | null }
) {
  const response = await apiFetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/exhibits/${encodeURIComponent(exhibitId)}/items`), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(input)
  });
  return readJson<{ ok: true; packet: ExhibitPacket | null }>(response);
}

export async function removeExhibitItem(caseId: string, itemId: string) {
  const response = await apiFetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/exhibit-items/${encodeURIComponent(itemId)}`), {
    method: "DELETE",
    headers: buildApiHeaders()
  });
  return readJson<{ ok: true; packet: ExhibitPacket | null }>(response);
}

export async function updateExhibitItemPageRules(caseId: string, itemId: string, excludeCanonicalPageIds: string[]) {
  const response = await apiFetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/exhibit-items/${encodeURIComponent(itemId)}/page-rules`),
    {
      method: "PATCH",
      headers: buildApiHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ exclude_canonical_page_ids: excludeCanonicalPageIds })
    }
  );
  return readJson<{ ok: true; packet: ExhibitPacket | null }>(response);
}

export async function getExhibitSuggestions(
  caseId: string,
  packetId: string,
  requestOptions?: ApiRequestOptions
): Promise<ExhibitSuggestion[]> {
  const response = await apiFetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/exhibit-packets/${encodeURIComponent(packetId)}/suggestions`),
    {
      headers: buildApiHeaders(),
      ...requestOptions
    }
  );
  const payload = await readJson<{ ok: true; suggestions: ExhibitSuggestion[] }>(response);
  return payload.suggestions;
}

export async function resolveExhibitSuggestion(
  caseId: string,
  packetId: string,
  suggestionId: string,
  input: { action: "accept" | "dismiss"; note?: string | null }
) {
  const response = await apiFetch(
    apiUrl(
      `/api/cases/${encodeURIComponent(caseId)}/exhibit-packets/${encodeURIComponent(packetId)}/suggestions/${encodeURIComponent(suggestionId)}/resolve`
    ),
    {
      method: "POST",
      headers: buildApiHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(input)
    }
  );
  return readJson<{ ok: true; packet: ExhibitPacket | null }>(response);
}

export async function getExhibitHistory(
  caseId: string,
  packetId: string,
  requestOptions?: ApiRequestOptions
): Promise<ExhibitHistoryEntry[]> {
  const response = await apiFetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/exhibit-packets/${encodeURIComponent(packetId)}/history`),
    {
      headers: buildApiHeaders(),
      ...requestOptions
    }
  );
  const payload = await readJson<{ ok: true; history: ExhibitHistoryEntry[] }>(response);
  return payload.history;
}

export async function finalizeExhibitPacket(caseId: string, packetId: string) {
  const response = await apiFetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/exhibit-packets/${encodeURIComponent(packetId)}/finalize`),
    {
      method: "POST",
      headers: buildApiHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({})
    }
  );
  return readJson<{
    ok: true;
    packet: ExhibitPacket | null;
    suggestions: ExhibitSuggestion[];
    preview: Record<string, unknown> | null;
  }>(response);
}

export async function listPacketPdfExports(
  caseId: string,
  packetId: string,
  requestOptions?: ApiRequestOptions
): Promise<PacketPdfExportRow[]> {
  const response = await apiFetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/exhibit-packets/${encodeURIComponent(packetId)}/exports`),
    {
      headers: buildApiHeaders(),
      ...requestOptions
    }
  );
  const payload = await readJson<{ ok: true; exports: PacketPdfExportRow[] }>(response);
  return payload.exports;
}

export async function generatePacketPdf(caseId: string, packetId: string, layout?: PacketPdfExportLayout) {
  const response = await apiFetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/exhibit-packets/${encodeURIComponent(packetId)}/exports/packet-pdf`),
    {
      method: "POST",
      headers: buildApiHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(layout ?? {}),
      timeoutMs: LONG_API_TIMEOUT_MS
    }
  );
  return readJson<{
    ok: true;
    export_id: string;
    page_count: number;
    manifest: unknown;
    pdf_relative_path: string;
  }>(response);
}

export async function downloadPacketExportPdf(caseId: string, exportId: string): Promise<Blob> {
  const response = await apiFetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/exhibit-packet-exports/${encodeURIComponent(exportId)}/pdf`),
    {
      headers: buildApiHeaders(),
      timeoutMs: LONG_API_TIMEOUT_MS
    }
  );
  if (!response.ok) {
    const retryAfterSeconds = readRetryAfterSeconds(response);
    const message = await readErrorMessage(response);
    throw new ApiError(
      `${message}${response.status === 429 && retryAfterSeconds ? ` Retry in about ${retryAfterSeconds}s.` : ""}`,
      response.status,
      { retryAfterSeconds }
    );
  }
  return response.blob();
}

export async function listDocumentTemplates(caseId: string, requestOptions?: ApiRequestOptions): Promise<UserDocumentTemplate[]> {
  const response = await apiFetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/document-templates`), {
    headers: buildApiHeaders(),
    ...requestOptions
  });
  const payload = await readJson<{ ok: true; templates: UserDocumentTemplate[] }>(response);
  return payload.templates;
}

export async function createDocumentTemplate(
  caseId: string,
  input: {
    name?: string;
    description?: string | null;
    body_markdown: string;
    fields?: Array<{ name: string; label?: string; default?: string | null }>;
    ai_hints?: string | null;
  }
): Promise<UserDocumentTemplate> {
  const response = await apiFetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/document-templates`), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(input)
  });
  const payload = await readJson<{ ok: true; template: UserDocumentTemplate | null }>(response);
  if (!payload.template) {
    throw new Error("Template was not created");
  }
  return payload.template;
}

export async function updateDocumentTemplate(
  caseId: string,
  templateId: string,
  input: {
    name?: string | null;
    description?: string | null;
    body_markdown?: string | null;
    fields?: Array<{ name: string; label?: string; default?: string | null }> | null;
    ai_hints?: string | null;
  }
): Promise<UserDocumentTemplate> {
  const response = await apiFetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/document-templates/${encodeURIComponent(templateId)}`),
    {
      method: "PATCH",
      headers: buildApiHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(input)
    }
  );
  const payload = await readJson<{ ok: true; template: UserDocumentTemplate | null }>(response);
  if (!payload.template) {
    throw new Error("Template was not updated");
  }
  return payload.template;
}

export async function deleteDocumentTemplate(caseId: string, templateId: string): Promise<void> {
  const response = await apiFetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/document-templates/${encodeURIComponent(templateId)}`),
    {
      method: "DELETE",
      headers: buildApiHeaders()
    }
  );
  await readJson<{ ok: true }>(response);
}

export async function renderDocumentTemplate(
  caseId: string,
  templateId: string,
  input: {
    values: Record<string, string>;
    body_markdown?: string | null;
    save?: boolean;
    source_item_id?: string | null;
    status?: string | null;
  }
): Promise<{
  rendered_markdown: string;
  missing_placeholders: string[];
  fill: UserDocumentTemplateFill | null;
}> {
  const response = await apiFetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/document-templates/${encodeURIComponent(templateId)}/render`),
    {
      method: "POST",
      headers: buildApiHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(input)
    }
  );
  return readJson<{
    ok: true;
    rendered_markdown: string;
    missing_placeholders: string[];
    fill: UserDocumentTemplateFill | null;
  }>(response);
}

export async function listDocumentTemplateFills(
  caseId: string,
  templateId?: string,
  requestOptions?: ApiRequestOptions
): Promise<UserDocumentTemplateFill[]> {
  const q = templateId ? `?template_id=${encodeURIComponent(templateId)}` : "";
  const response = await apiFetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/document-template-fills${q}`), {
    headers: buildApiHeaders(),
    ...requestOptions
  });
  const payload = await readJson<{ ok: true; fills: UserDocumentTemplateFill[] }>(response);
  return payload.fills;
}

export async function getDocumentTemplateFill(caseId: string, fillId: string): Promise<UserDocumentTemplateFill> {
  const response = await apiFetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/document-template-fills/${encodeURIComponent(fillId)}`),
    {
      headers: buildApiHeaders()
    }
  );
  const payload = await readJson<{ ok: true; fill: UserDocumentTemplateFill }>(response);
  return payload.fill;
}

export async function deleteDocumentTemplateFill(caseId: string, fillId: string): Promise<void> {
  const response = await apiFetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/document-template-fills/${encodeURIComponent(fillId)}`),
    {
      method: "DELETE",
      headers: buildApiHeaders()
    }
  );
  await readJson<{ ok: true }>(response);
}

export async function updateDocumentTemplateFill(
  caseId: string,
  fillId: string,
  input: {
    values?: Record<string, string> | null;
    rendered_markdown?: string | null;
    status?: string | null;
  }
): Promise<UserDocumentTemplateFill> {
  const response = await apiFetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/document-template-fills/${encodeURIComponent(fillId)}`),
    {
      method: "PATCH",
      headers: buildApiHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(input)
    }
  );
  const payload = await readJson<{ ok: true; fill: UserDocumentTemplateFill }>(response);
  return payload.fill;
}

// ── AI assembly ────────────────────────────────────────────────────────────

export interface AIEventConfig {
  id: string;
  case_id: string | null;
  event_type: string;
  event_label: string;
  instructions: string;
  exhibit_strategy_json: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface AIJob {
  id: string;
  case_id: string;
  event_type: string;
  status: string;
  input_json: string | null;
  output_json: string | null;
  error_message: string | null;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export async function getAIStatus(requestOptions?: ApiRequestOptions) {
  const response = await apiFetch(apiUrl("/api/ai/status"), { headers: buildApiHeaders(), ...requestOptions });
  return readJson<{ ok: true; configured: boolean }>(response);
}

export async function listAIEventConfigs(caseId: string, requestOptions?: ApiRequestOptions) {
  const response = await apiFetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/ai/event-configs`), {
    headers: buildApiHeaders(),
    ...requestOptions
  });
  const payload = await readJson<{ ok: true; configs: AIEventConfig[] }>(response);
  return payload.configs;
}

export async function upsertAIEventConfig(
  caseId: string,
  input: { event_type: string; event_label: string; instructions: string; exhibit_strategy_json?: string | null }
) {
  const response = await apiFetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/ai/event-configs`), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(input)
  });
  const payload = await readJson<{ ok: true; config: AIEventConfig }>(response);
  return payload.config;
}

export async function deleteAIEventConfig(caseId: string, configId: string) {
  const response = await apiFetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/ai/event-configs/${encodeURIComponent(configId)}`),
    { method: "DELETE", headers: buildApiHeaders() }
  );
  return readJson<{ ok: true }>(response);
}

export async function runAIAssembly(caseId: string, eventType: string) {
  const response = await apiFetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/ai/assemble`), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ event_type: eventType }),
    timeoutMs: LONG_API_TIMEOUT_MS
  });
  const payload = await readJson<{ ok: true; job: AIJob }>(response);
  return payload.job;
}

export async function listAIJobs(caseId: string, requestOptions?: ApiRequestOptions) {
  const response = await apiFetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/ai/jobs`), {
    headers: buildApiHeaders(),
    ...requestOptions
  });
  const payload = await readJson<{ ok: true; jobs: AIJob[] }>(response);
  return payload.jobs;
}

// ── Package workbench (uploads, rules, runs) ──────────────────────────────

export interface PackageRule {
  id: string;
  case_id: string;
  package_type: string;
  rule_key: string;
  rule_label: string;
  instructions: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface PackageRun {
  id: string;
  packet_id: string;
  status: string;
  approval_status: string | null;
  approved_at: string | null;
  approved_by: string | null;
  approval_note: string | null;
  input_json: string | null;
  output_json: string | null;
  citations_json: string | null;
  error_message: string | null;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  retrieval_warnings_json: string | null;
  started_at: string | null;
  completed_at: string | null;
  latest_export_format: string | null;
  latest_export_path: string | null;
  latest_export_bytes: number | null;
  latest_exported_at: string | null;
  created_at: string;
}

export async function uploadCaseFile(caseId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const response = await apiFetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/uploads`), {
    method: "POST",
    headers: buildApiHeaders(),
    body: form,
    timeoutMs: LONG_API_TIMEOUT_MS
  });
  return readJson<{ ok: true; source_item_id: string; normalization: unknown }>(response);
}

export async function listPackageRules(caseId: string, packageType: string, requestOptions?: ApiRequestOptions) {
  const response = await apiFetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/package-rules?package_type=${encodeURIComponent(packageType)}`),
    { headers: buildApiHeaders(), ...requestOptions }
  );
  const payload = await readJson<{ ok: true; rules: PackageRule[] }>(response);
  return payload.rules;
}

export async function createPackageRule(
  caseId: string,
  input: { package_type: string; rule_key: string; rule_label: string; instructions?: string; sort_order?: number }
) {
  const response = await apiFetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/package-rules`), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(input)
  });
  const payload = await readJson<{ ok: true; rule: PackageRule }>(response);
  return payload.rule;
}

export async function deletePackageRule(caseId: string, ruleId: string) {
  const response = await apiFetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/package-rules/${encodeURIComponent(ruleId)}`),
    {
      method: "DELETE",
      headers: buildApiHeaders()
    }
  );
  return readJson<{ ok: true }>(response);
}

export async function listPackageRuns(caseId: string, packetId: string, requestOptions?: ApiRequestOptions) {
  const response = await apiFetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/exhibit-packets/${encodeURIComponent(packetId)}/package-runs`),
    {
      headers: buildApiHeaders(),
      ...requestOptions
    }
  );
  const payload = await readJson<{ ok: true; runs: PackageRun[] }>(response);
  return payload.runs;
}

export async function runPackageWorker(caseId: string, packetId: string, wholeFileSourceItemIds?: string[]) {
  const response = await apiFetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/exhibit-packets/${encodeURIComponent(packetId)}/package-runs`),
    {
      method: "POST",
      headers: buildApiHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ whole_file_source_item_ids: wholeFileSourceItemIds }),
      timeoutMs: LONG_API_TIMEOUT_MS
    }
  );
  const payload = await readJson<{ ok: true; run: PackageRun }>(response);
  return payload.run;
}

export async function exportPackageRunDocx(caseId: string, runId: string) {
  const response = await apiFetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/package-runs/${encodeURIComponent(runId)}/export-docx`),
    {
      method: "POST",
      headers: buildApiHeaders()
    }
  );
  return readJson<{ ok: true; path: string; filename: string; bytes: number }>(response);
}

export async function approvePackageRun(caseId: string, runId: string, note?: string) {
  const response = await apiFetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/package-runs/${encodeURIComponent(runId)}/approve`),
    {
      method: "POST",
      headers: buildApiHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(note ? { note } : {})
    }
  );
  const payload = await readJson<{ ok: true; run: PackageRun }>(response);
  return payload.run;
}

export async function updatePackageRunDraft(caseId: string, runId: string, markdown: string) {
  const response = await apiFetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/package-runs/${encodeURIComponent(runId)}`),
    {
      method: "PATCH",
      headers: buildApiHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ markdown })
    }
  );
  const payload = await readJson<{ ok: true; run: PackageRun }>(response);
  return payload.run;
}
