export type EventName =
  | "snapshot.created"
  | "box.file_inventoried"
  | "pp.entity_synced"
  | "branch.instance_created"
  | "branch.stage_changed"
  | "projection.refreshed";

export interface DomainEvent<TPayload = Record<string, unknown>> {
  event_id: string;
  event_name: EventName;
  case_id: string;
  preset_id?: string | null;
  branch_instance_id?: string | null;
  source_type: "box" | "pp" | "system" | "projection";
  source_id: string;
  occurred_at: string;
  payload_json: TPayload;
}

export interface ProductPresetSeed {
  key: string;
  name: string;
  description: string;
  source_policy: JsonObject;
  compact_default: boolean;
  active: boolean;
}

export interface BranchTemplateSeed {
  key: string;
  name: string;
  branch_family: "hearing" | "conference" | "demand";
  packet_policy: "compact" | "broad" | "damages_first";
  issue_scope_policy: "tight" | "moderate" | "broad";
  description: string;
}

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface ProductWorkflowSeed {
  product_preset_key: string;
  state_key: string;
  state_name: string;
  sort_order: number;
  entry_conditions: JsonObject;
  exit_conditions: JsonObject;
  blocking_conditions: JsonObject;
  approval_required: boolean;
}

export interface ApprovalGateSeed {
  product_preset_key: string;
  gate_key: string;
  gate_name: string;
  gate_policy: JsonObject;
  sort_order: number;
}

export interface ArtifactTemplateSeed {
  product_preset_key: string;
  artifact_key: string;
  artifact_name: string;
  output_format: string;
  template_source: string;
  required_inputs: JsonValue[];
  approval_gate_key: string | null;
}

export interface ProductRulepackSeed {
  product_preset_key: string;
  version: string;
  rule_type: string;
  rule_key: string;
  rule_value: JsonValue;
  active: boolean;
}

export interface BranchTransitionSeed {
  branch_template_key: string;
  from_stage_key: string;
  to_stage_key: string;
  transition_label: string;
  trigger_type: string;
  trigger_condition: JsonValue;
  blocking_condition: JsonValue | null;
}

export interface BranchStageRequirementSeed {
  branch_template_key: string;
  stage_key: string;
  requirement_type: string;
  requirement_key: string;
  requirement_policy: string;
  rationale: string;
}

export interface BranchSlaTargetSeed {
  branch_template_key: string;
  stage_key: string;
  target_hours: number;
  warning_hours: number;
  critical_hours: number;
}

export type DocumentCategory =
  | "authorizations"
  | "case_cost"
  | "client_intake"
  | "correspondence"
  | "court_documents"
  | "discovery"
  | "employer_insurance"
  | "intervention_subrogation"
  | "investigation"
  | "itemized_statements"
  | "medical_records"
  | "medical_imaging"
  | "qrc_rehab"
  | "settlement"
  | "wage_employment"
  | "other";

export type ExhibitPolicy =
  | "normal"
  | "never_exhibit"
  | "reference_only"
  | "critical_mandatory_ocr"
  | "strategy_only"
  | "separate_per_instance";

export type HearingRelevance =
  | "critical"
  | "important"
  | "supporting"
  | "procedural"
  | "background"
  | "irrelevant";

export type DocumentTypeMatchMode = "exact" | "starts_with" | "contains";

export interface DocumentTypeSeed {
  canonical_name: string;
  category: DocumentCategory;
  target_folder?: string;
  exhibit_policy: ExhibitPolicy;
  exhibit_eligible?: boolean;
  default_priority?: number;
  hearing_relevance?: HearingRelevance;
  mandatory_vlm_ocr?: boolean;
  active?: boolean;
}

export interface DocumentTypeAliasSeed {
  canonical_name: string;
  alias_pattern: string;
  match_mode: DocumentTypeMatchMode;
  priority?: number;
  source?: string;
  active?: boolean;
}

export interface DocumentTypeRuleSeed {
  canonical_name: string;
  rule_type: string;
  rule_key: string;
  rule_value: JsonValue;
  active?: boolean;
}

export interface ProjectionWatermark {
  case_id: string;
  authoritative_snapshot_id: string;
  matter_version_token?: string;
  last_pull_at: string | null;
  last_push_at: string | null;
}

export interface ProjectionCaseHeader {
  id: string;
  name: string;
  case_type: string;
  status: string;
  pp_matter_id?: string | null;
  box_root_folder_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ProjectionIssue {
  id: string;
  case_id: string;
  issue_type: string;
  status: string;
  employee_position?: string | null;
  defense_position?: string | null;
  requested_relief?: string | null;
  priority?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ProjectionProofRequirement {
  id: string;
  issue_id: string;
  requirement_key: string;
  requirement_type?: string | null;
  requirement_policy: string;
  rationale?: string | null;
  satisfied?: number | null;
  satisfied_by_type?: string | null;
  satisfied_by_id?: string | null;
  created_at?: string | null;
}

export interface ProjectionBranchInstance {
  id: string;
  case_id: string;
  product_preset_id?: string | null;
  branch_template_id?: string | null;
  status: string;
  priority?: number | null;
  current_stage_key: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface ProjectionBranchStageStatus {
  id: string;
  matter_branch_instance_id: string;
  stage_key: string;
  status: string;
  entered_at?: string | null;
  completed_at?: string | null;
  blocker_summary?: string | null;
  progress_summary?: string | null;
}

export interface ProjectionSourceConnection {
  id: string;
  provider: string;
  account_label?: string | null;
  external_account_id?: string | null;
  auth_mode: string;
  status: string;
  scopes?: string | null;
  callback_state?: string | null;
  authorization_url?: string | null;
  metadata_json?: string | null;
  last_error_message?: string | null;
  last_verified_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  latest_sync_type?: string | null;
  latest_sync_status?: string | null;
  latest_sync_started_at?: string | null;
  latest_sync_completed_at?: string | null;
  latest_sync_error?: string | null;
  snapshot_count?: number | null;
  source_item_count?: number | null;
}

export interface ProjectionSourceItem {
  id: string;
  provider: string;
  source_kind: string;
  title: string | null;
  document_type_id?: string | null;
  document_type_name?: string | null;
  classification_method?: string | null;
  classification_confidence?: number | null;
  document_category?: string | null;
  exhibit_eligible?: number | null;
  exhibit_policy?: string | null;
  hearing_relevance?: string | null;
  mandatory_vlm_ocr?: number | null;
  default_priority?: number | null;
  normalization_status?: string | null;
  canonical_document_id?: string | null;
  folder_path?: string | null;
  parent_remote_id?: string | null;
  raw_json: string | null;
  updated_at: string | null;
}

export interface ProjectionClassificationSummary {
  total: number;
  classified: number;
  unclassified: number;
  by_method: Record<string, number>;
  by_category: Record<string, number>;
  by_hearing_relevance: Record<string, number>;
  exhibit_eligible_count: number;
  critical_ocr_required: number;
}

export interface ProjectionOcrSummary {
  total_pages: number;
  by_ocr_status: Record<string, number>;
  by_extraction_status: Record<string, number>;
  review_required_count: number;
  blocking_review_count: number;
}

export interface ProjectionCanonicalDocument {
  id: string;
  title?: string | null;
  display_title?: string | null;
  canonical_name?: string | null;
  document_type_name?: string | null;
  state?: string | null;
  status?: string | null;
  ocr_status?: string | null;
  ingestion_status?: string | null;
  mandatory_vlm_ocr?: number | null;
  complete_pages?: number | null;
  queued_pages?: number | null;
  processing_pages?: number | null;
  review_required_pages?: number | null;
  provider?: string | null;
  source_kind?: string | null;
  source_item_id?: string | null;
  primary_source_item_id?: string | null;
  source_item_ids?: string[] | null;
  latest_version_token?: string | null;
  content_hash?: string | null;
  page_count?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ProjectionCanonicalPage {
  id: string;
  canonical_document_id?: string | null;
  document_id?: string | null;
  page_number?: number | null;
  state?: string | null;
  status?: string | null;
  source_item_id?: string | null;
  source_version_id?: string | null;
  extraction_status?: string | null;
  ocr_status?: string | null;
  ocr_method?: string | null;
  ocr_confidence?: number | null;
  review_status?: string | null;
  review_severity?: string | null;
  blocker_for_branch?: number | null;
  blocker_for_preset?: number | null;
  content_hash?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ProjectionCanonicalStateSummary {
  document_count?: number | null;
  page_count?: number | null;
  document_state_counts?: Record<string, number> | null;
  page_state_counts?: Record<string, number> | null;
}

export interface ProjectionCanonicalDocumentSlice {
  documents: ProjectionCanonicalDocument[];
  state_summary?: ProjectionCanonicalStateSummary | null;
}

export interface ProjectionCanonicalPageSlice {
  pages: ProjectionCanonicalPage[];
  state_summary?: ProjectionCanonicalStateSummary | null;
}

export interface ProjectionCanonicalSpineSlice {
  documents: ProjectionCanonicalDocument[];
  pages: ProjectionCanonicalPage[];
  state_summary?: ProjectionCanonicalStateSummary | null;
}

export interface ProjectionSnapshotMetadata {
  snapshot_id: string;
  snapshot_created_at: string;
  projection_version: string;
  slice_checksum: string;
  slice_checksums: Record<string, string>;
  asset_manifest_version: string;
  latest_source_snapshot_ids: Record<string, string>;
}

export interface ProjectionPageExtraction {
  id: string;
  canonical_page_id: string;
  schema_key: string;
  extractor_version: string;
  confidence?: number | null;
  created_at?: string | null;
  payload?: Record<string, unknown>;
}

export interface ProjectionExtractionSlice {
  extractions: ProjectionPageExtraction[];
  summary?: {
    total: number;
    by_schema: Record<string, number>;
  };
}

export interface MatterProjectionSlices {
  case_header: ProjectionCaseHeader | null;
  issue_proof_slice: {
    issues: ProjectionIssue[];
    proof_requirements: ProjectionProofRequirement[];
  };
  branch_state_slice: {
    branch_instances: ProjectionBranchInstance[];
    branch_stage_status: ProjectionBranchStageStatus[];
  };
  source_connection_slice?: {
    connections: ProjectionSourceConnection[];
  };
  document_inventory_slice: {
    source_items: ProjectionSourceItem[];
    classification_summary?: ProjectionClassificationSummary;
    ocr_summary?: ProjectionOcrSummary;
  };
  canonical_document_slice?: ProjectionCanonicalDocumentSlice;
  canonical_page_slice?: ProjectionCanonicalPageSlice;
  canonical_spine_slice?: ProjectionCanonicalSpineSlice;
  extraction_slice?: ProjectionExtractionSlice;
  case_people_slice?: {
    people: Array<Record<string, unknown>>;
    summary?: { total: number };
  };
  case_timeline_slice?: {
    entries: Array<{
      id: string;
      kind: string;
      label: string;
      detail: string | null;
      occurred_at: string | null;
      payload?: Record<string, unknown>;
    }>;
    summary?: { total: number };
  };
}

export interface MatterProjection {
  snapshot_id: string;
  snapshot_created_at?: string;
  projection_version?: string;
  matter_version_token: string;
  slice_checksum?: string;
  asset_manifest_version?: string;
  snapshot_metadata?: ProjectionSnapshotMetadata;
  slices: MatterProjectionSlices;
}
