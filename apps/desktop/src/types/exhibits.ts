export interface ExhibitItemPageRule {
  id: string;
  exhibit_item_id: string;
  canonical_page_id: string;
  rule_type: string;
  note?: string | null;
  created_at: string;
}

export interface ExhibitItem {
  id: string;
  exhibit_id: string;
  source_item_id?: string | null;
  canonical_document_id?: string | null;
  canonical_page_id?: string | null;
  page_start?: number | null;
  page_end?: number | null;
  include_order: number;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  source_item_title?: string | null;
  document_type_name?: string | null;
  document_category?: string | null;
  provider?: string | null;
  source_kind?: string | null;
  canonical_document_title?: string | null;
  page_count?: number | null;
  excluded_page_count: number;
  page_rules: ExhibitItemPageRule[];
}

export interface ExhibitSlot {
  id: string;
  exhibit_section_id: string;
  exhibit_label: string;
  title?: string | null;
  status: string;
  sort_order: number;
  purpose?: string | null;
  objection_risk?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  items: ExhibitItem[];
}

export interface ExhibitSection {
  id: string;
  exhibit_packet_id: string;
  section_key: string;
  section_label: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  exhibits: ExhibitSlot[];
}

export interface ExhibitPacket {
  id: string;
  case_id: string;
  packet_name: string;
  packet_mode: "compact" | "full";
  naming_scheme: string;
  status: string;
  metadata_json?: string | null;
  package_type?: string;
  package_label?: string | null;
  target_document_source_item_id?: string | null;
  run_status?: string | null;
  created_at: string;
  updated_at: string;
  sections: ExhibitSection[];
}

export interface ExhibitSuggestion {
  id: string;
  suggestion_type: string;
  severity: "info" | "warn";
  title: string;
  detail: string;
  payload: Record<string, unknown>;
}

export interface ExhibitHistoryEntry {
  id: string;
  packet_id: string;
  actor_id?: string | null;
  action_type: string;
  target_type: string;
  target_id?: string | null;
  payload_json?: string | null;
  created_at: string;
}

export interface ExhibitWorkspaceResponse {
  ok: true;
  case_id: string;
  packets: ExhibitPacket[];
}

/** POST body for `/api/exhibit-packets/:id/exports/packet-pdf` — matches server `parsePacketPdfExportOptions`. */
export type PacketPdfExportLayout = {
  cover_sheet?: boolean;
  section_separators?: boolean;
  exhibit_separators?: boolean;
  bates?: { prefix?: string; start_at?: number; padding?: number } | null;
};

export interface PacketPdfExportRow {
  id: string;
  case_id: string;
  packet_id: string;
  status: string;
  export_type: string;
  pdf_relative_path: string | null;
  manifest_json: string | null;
  error_text: string | null;
  page_count: number | null;
  created_at: string;
  completed_at: string | null;
}
