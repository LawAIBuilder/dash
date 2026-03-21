import type { MatterProjection, ProjectionWatermark } from "@wc/domain-core";

export interface CaseListItem {
  id: string;
  name: string;
  case_type: string;
  status: string;
  employee_name?: string | null;
  employer_name?: string | null;
  insurer_name?: string | null;
  hearing_date?: string | null;
  pp_matter_id?: string | null;
  box_root_folder_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  box_connection_status?: string | null;
  latest_sync_status?: string | null;
  source_item_count?: number | null;
}

export interface CreateCaseInput {
  name: string;
  case_type?: string;
  pp_matter_id?: string | null;
  box_root_folder_id?: string | null;
  employee_name?: string | null;
  employer_name?: string | null;
  insurer_name?: string | null;
  hearing_date?: string | null;
}

export interface ReviewQueueItemOcr {
  canonical_page_id: string;
  page_number: number;
  raw_text?: string | null;
  ocr_method?: string | null;
  ocr_confidence?: number | null;
  ocr_status?: string | null;
  extraction_status?: string | null;
  canonical_document_id: string;
  canonical_document_title?: string | null;
  source_item_id?: string | null;
  source_item_title?: string | null;
  document_type_name?: string | null;
  review_id: string;
  severity: string;
  review_status: string;
  review_note?: string | null;
  blocker_for_branch?: number | null;
  blocker_for_preset?: number | null;
}

export interface ReviewQueueItemUnclassified {
  source_item_id: string;
  title?: string | null;
  provider: string;
  source_kind: string;
  updated_at?: string | null;
  canonical_document_id?: string | null;
}

export interface ReviewQueueItemMissingProof {
  proof_requirement_id: string;
  issue_id: string;
  requirement_key: string;
  requirement_policy: string;
  rationale?: string | null;
  issue_type: string;
}

export interface ReviewQueueResponse {
  ok: true;
  case_id: string;
  ocr_reviews: ReviewQueueItemOcr[];
  unclassified_documents: ReviewQueueItemUnclassified[];
  missing_proof: ReviewQueueItemMissingProof[];
}

export interface ProjectionCacheEntry {
  projection: MatterProjection;
  watermark: ProjectionWatermark;
  viewSource: "cache" | "remote";
}

export interface DocumentTypeListItem {
  id: string;
  canonical_name: string;
  category: string;
  hearing_relevance?: string | null;
  exhibit_policy?: string | null;
  exhibit_eligible?: number | null;
  mandatory_vlm_ocr?: number | null;
}

export interface PracticePantherConnectionStatus {
  id: string;
  provider: string;
  account_label?: string | null;
  auth_mode: string;
  status: string;
  authorization_url?: string | null;
  external_account_id?: string | null;
  last_error_message?: string | null;
  last_verified_at?: string | null;
  metadata_json?: string | null;
}

export interface PracticePantherMatterItem {
  id: string;
  name?: string | null;
  display_name?: string | null;
  number?: number | null;
  status?: string | null;
  updated_at?: string | null;
  account_ref?: {
    id?: string | null;
    display_name?: string | null;
  } | null;
}
