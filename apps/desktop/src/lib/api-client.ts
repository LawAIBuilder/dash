import type { MatterProjection, ProjectionWatermark } from "@wc/domain-core";
import { API_BASE, buildApiHeaders } from "@/config";
import type {
  CaseListItem,
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

export async function getPracticePantherStatus() {
  const response = await fetch(apiUrl("/api/connectors/practicepanther/status"), {
    headers: buildApiHeaders()
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
  const response = await fetch(apiUrl("/api/connectors/practicepanther/auth/start"), {
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

export async function listPracticePantherMatters(searchText?: string) {
  const url = new URL(apiUrl("/api/connectors/practicepanther/matters"), window.location.origin);
  if (searchText?.trim()) {
    url.searchParams.set("search_text", searchText.trim());
  }
  const response = await fetch(url.toString(), {
    headers: buildApiHeaders()
  });
  const payload = await readJson<{ ok: true; matters: PracticePantherMatterItem[] }>(response);
  return payload.matters;
}

export async function syncPracticePanther(caseId: string, input?: { pp_matter_id?: string | null }) {
  const response = await fetch(apiUrl("/api/connectors/practicepanther/sync"), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({
      case_id: caseId,
      pp_matter_id: input?.pp_matter_id ?? null
    })
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

export async function getExhibitWorkspace(caseId: string): Promise<ExhibitPacket[]> {
  const response = await fetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/exhibits`), {
    headers: buildApiHeaders()
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
  const response = await fetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/exhibit-packets`), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(input ?? {})
  });
  return readJson<{ ok: true; case_id: string; packet: ExhibitPacket | null }>(response);
}

export async function updateExhibitPacket(
  packetId: string,
  input: {
    packet_name?: string;
    packet_mode?: "compact" | "full";
    naming_scheme?: string;
    status?: string;
    package_type?: string;
    package_label?: string;
    target_document_source_item_id?: string;
    run_status?: string;
  }
) {
  const response = await fetch(apiUrl(`/api/exhibit-packets/${encodeURIComponent(packetId)}`), {
    method: "PATCH",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(input)
  });
  return readJson<{ ok: true; packet: ExhibitPacket | null }>(response);
}

export async function createExhibitSlot(
  sectionId: string,
  input?: {
    exhibit_label?: string | null;
    title?: string | null;
    purpose?: string | null;
    objection_risk?: string | null;
    notes?: string | null;
  }
) {
  const response = await fetch(apiUrl(`/api/exhibit-sections/${encodeURIComponent(sectionId)}/exhibits`), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(input ?? {})
  });
  return readJson<{ ok: true; packet: ExhibitPacket | null }>(response);
}

export async function reorderExhibitSections(packetId: string, sectionIds: string[]) {
  const response = await fetch(apiUrl(`/api/exhibit-packets/${encodeURIComponent(packetId)}/sections/reorder`), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ section_ids: sectionIds })
  });
  return readJson<{ ok: true; packet: ExhibitPacket | null }>(response);
}

export async function reorderSectionExhibits(sectionId: string, exhibitIds: string[]) {
  const response = await fetch(apiUrl(`/api/exhibit-sections/${encodeURIComponent(sectionId)}/exhibits/reorder`), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ exhibit_ids: exhibitIds })
  });
  return readJson<{ ok: true; packet: ExhibitPacket | null }>(response);
}

export async function updateExhibitSlot(
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
  const response = await fetch(apiUrl(`/api/exhibits/${encodeURIComponent(exhibitId)}`), {
    method: "PATCH",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(input)
  });
  return readJson<{ ok: true; packet: ExhibitPacket | null }>(response);
}

export async function addExhibitItem(exhibitId: string, input: { source_item_id: string; notes?: string | null }) {
  const response = await fetch(apiUrl(`/api/exhibits/${encodeURIComponent(exhibitId)}/items`), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(input)
  });
  return readJson<{ ok: true; packet: ExhibitPacket | null }>(response);
}

export async function removeExhibitItem(itemId: string) {
  const response = await fetch(apiUrl(`/api/exhibit-items/${encodeURIComponent(itemId)}`), {
    method: "DELETE",
    headers: buildApiHeaders()
  });
  return readJson<{ ok: true; packet: ExhibitPacket | null }>(response);
}

export async function updateExhibitItemPageRules(itemId: string, excludeCanonicalPageIds: string[]) {
  const response = await fetch(apiUrl(`/api/exhibit-items/${encodeURIComponent(itemId)}/page-rules`), {
    method: "PATCH",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ exclude_canonical_page_ids: excludeCanonicalPageIds })
  });
  return readJson<{ ok: true; packet: ExhibitPacket | null }>(response);
}

export async function getExhibitSuggestions(packetId: string): Promise<ExhibitSuggestion[]> {
  const response = await fetch(apiUrl(`/api/exhibit-packets/${encodeURIComponent(packetId)}/suggestions`), {
    headers: buildApiHeaders()
  });
  const payload = await readJson<{ ok: true; suggestions: ExhibitSuggestion[] }>(response);
  return payload.suggestions;
}

export async function resolveExhibitSuggestion(
  packetId: string,
  suggestionId: string,
  input: { action: "accept" | "dismiss"; note?: string | null }
) {
  const response = await fetch(
    apiUrl(`/api/exhibit-packets/${encodeURIComponent(packetId)}/suggestions/${encodeURIComponent(suggestionId)}/resolve`),
    {
      method: "POST",
      headers: buildApiHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(input)
    }
  );
  return readJson<{ ok: true; packet: ExhibitPacket | null }>(response);
}

export async function getExhibitHistory(packetId: string): Promise<ExhibitHistoryEntry[]> {
  const response = await fetch(apiUrl(`/api/exhibit-packets/${encodeURIComponent(packetId)}/history`), {
    headers: buildApiHeaders()
  });
  const payload = await readJson<{ ok: true; history: ExhibitHistoryEntry[] }>(response);
  return payload.history;
}

export async function finalizeExhibitPacket(packetId: string) {
  const response = await fetch(apiUrl(`/api/exhibit-packets/${encodeURIComponent(packetId)}/finalize`), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({})
  });
  return readJson<{
    ok: true;
    packet: ExhibitPacket | null;
    suggestions: ExhibitSuggestion[];
    preview: Record<string, unknown> | null;
  }>(response);
}

export async function listPacketPdfExports(packetId: string): Promise<PacketPdfExportRow[]> {
  const response = await fetch(apiUrl(`/api/exhibit-packets/${encodeURIComponent(packetId)}/exports`), {
    headers: buildApiHeaders()
  });
  const payload = await readJson<{ ok: true; exports: PacketPdfExportRow[] }>(response);
  return payload.exports;
}

export async function generatePacketPdf(packetId: string, layout?: PacketPdfExportLayout) {
  const response = await fetch(apiUrl(`/api/exhibit-packets/${encodeURIComponent(packetId)}/exports/packet-pdf`), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(layout ?? {})
  });
  return readJson<{
    ok: true;
    export_id: string;
    page_count: number;
    manifest: unknown;
    pdf_relative_path: string;
  }>(response);
}

export async function downloadPacketExportPdf(exportId: string): Promise<Blob> {
  const response = await fetch(apiUrl(`/api/exhibit-packet-exports/${encodeURIComponent(exportId)}/pdf`), {
    headers: buildApiHeaders()
  });
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(typeof err.error === "string" ? err.error : `Download failed (${response.status})`);
  }
  return response.blob();
}

export async function listDocumentTemplates(caseId: string): Promise<UserDocumentTemplate[]> {
  const response = await fetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/document-templates`), {
    headers: buildApiHeaders()
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
  const response = await fetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/document-templates`), {
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
  const response = await fetch(
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
  const response = await fetch(
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
  const response = await fetch(
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

export async function listDocumentTemplateFills(caseId: string, templateId?: string): Promise<UserDocumentTemplateFill[]> {
  const q = templateId ? `?template_id=${encodeURIComponent(templateId)}` : "";
  const response = await fetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/document-template-fills${q}`), {
    headers: buildApiHeaders()
  });
  const payload = await readJson<{ ok: true; fills: UserDocumentTemplateFill[] }>(response);
  return payload.fills;
}

export async function getDocumentTemplateFill(caseId: string, fillId: string): Promise<UserDocumentTemplateFill> {
  const response = await fetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/document-template-fills/${encodeURIComponent(fillId)}`),
    {
      headers: buildApiHeaders()
    }
  );
  const payload = await readJson<{ ok: true; fill: UserDocumentTemplateFill }>(response);
  return payload.fill;
}

export async function deleteDocumentTemplateFill(caseId: string, fillId: string): Promise<void> {
  const response = await fetch(
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
  const response = await fetch(
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

export async function getAIStatus() {
  const response = await fetch(apiUrl("/api/ai/status"), { headers: buildApiHeaders() });
  return readJson<{ ok: true; configured: boolean }>(response);
}

export async function listAIEventConfigs(caseId: string) {
  const response = await fetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/ai/event-configs`), {
    headers: buildApiHeaders()
  });
  const payload = await readJson<{ ok: true; configs: AIEventConfig[] }>(response);
  return payload.configs;
}

export async function upsertAIEventConfig(
  caseId: string,
  input: { event_type: string; event_label: string; instructions: string; exhibit_strategy_json?: string | null }
) {
  const response = await fetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/ai/event-configs`), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(input)
  });
  const payload = await readJson<{ ok: true; config: AIEventConfig }>(response);
  return payload.config;
}

export async function deleteAIEventConfig(caseId: string, configId: string) {
  const response = await fetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/ai/event-configs/${encodeURIComponent(configId)}`),
    { method: "DELETE", headers: buildApiHeaders() }
  );
  return readJson<{ ok: true }>(response);
}

export async function runAIAssembly(caseId: string, eventType: string) {
  const response = await fetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/ai/assemble`), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ event_type: eventType })
  });
  const payload = await readJson<{ ok: true; job: AIJob }>(response);
  return payload.job;
}

export async function listAIJobs(caseId: string) {
  const response = await fetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/ai/jobs`), {
    headers: buildApiHeaders()
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
  created_at: string;
}

export async function uploadCaseFile(caseId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/uploads`), {
    method: "POST",
    headers: buildApiHeaders(),
    body: form
  });
  return readJson<{ ok: true; source_item_id: string; normalization: unknown }>(response);
}

export async function listPackageRules(caseId: string, packageType: string) {
  const response = await fetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/package-rules?package_type=${encodeURIComponent(packageType)}`),
    { headers: buildApiHeaders() }
  );
  const payload = await readJson<{ ok: true; rules: PackageRule[] }>(response);
  return payload.rules;
}

export async function createPackageRule(
  caseId: string,
  input: { package_type: string; rule_key: string; rule_label: string; instructions?: string; sort_order?: number }
) {
  const response = await fetch(apiUrl(`/api/cases/${encodeURIComponent(caseId)}/package-rules`), {
    method: "POST",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(input)
  });
  const payload = await readJson<{ ok: true; rule: PackageRule }>(response);
  return payload.rule;
}

export async function deletePackageRule(ruleId: string) {
  const response = await fetch(apiUrl(`/api/package-rules/${encodeURIComponent(ruleId)}`), {
    method: "DELETE",
    headers: buildApiHeaders()
  });
  return readJson<{ ok: true }>(response);
}

export async function listPackageRuns(packetId: string) {
  const response = await fetch(apiUrl(`/api/exhibit-packets/${encodeURIComponent(packetId)}/package-runs`), {
    headers: buildApiHeaders()
  });
  const payload = await readJson<{ ok: true; runs: PackageRun[] }>(response);
  return payload.runs;
}

export async function runPackageWorker(caseId: string, packetId: string, wholeFileSourceItemIds?: string[]) {
  const response = await fetch(
    apiUrl(`/api/cases/${encodeURIComponent(caseId)}/exhibit-packets/${encodeURIComponent(packetId)}/package-runs`),
    {
      method: "POST",
      headers: buildApiHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ whole_file_source_item_ids: wholeFileSourceItemIds })
    }
  );
  const payload = await readJson<{ ok: true; run: PackageRun }>(response);
  return payload.run;
}

export async function exportPackageRunDocx(runId: string) {
  const response = await fetch(apiUrl(`/api/package-runs/${encodeURIComponent(runId)}/export-docx`), {
    method: "POST",
    headers: buildApiHeaders()
  });
  return readJson<{ ok: true; path: string; filename: string; bytes: number }>(response);
}

export async function updatePackageRunDraft(runId: string, markdown: string) {
  const response = await fetch(apiUrl(`/api/package-runs/${encodeURIComponent(runId)}`), {
    method: "PATCH",
    headers: buildApiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ markdown })
  });
  const payload = await readJson<{ ok: true; run: PackageRun }>(response);
  return payload.run;
}

