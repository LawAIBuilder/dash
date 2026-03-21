import type Database from "better-sqlite3";

export interface AuthoritativeMigration {
  id: string;
  description: string;
  up: (db: Database.Database) => void;
}

function hasColumn(db: Database.Database, tableName: string, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
}

function addColumnIfMissing(
  db: Database.Database,
  tableName: string,
  columnName: string,
  definition: string
) {
  if (!hasColumn(db, tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
  }
}

export const foundationMigrationSql = `
CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  oah_number TEXT,
  wid TEXT,
  case_type TEXT NOT NULL DEFAULT 'wc',
  status TEXT NOT NULL DEFAULT 'active',
  employee_name TEXT,
  employee_address TEXT,
  employee_dob TEXT,
  employer_name TEXT,
  insurer_name TEXT,
  judge_name TEXT,
  doi_dates TEXT,
  hearing_date TEXT,
  hearing_location TEXT,
  pp_matter_id TEXT,
  box_root_folder_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS case_people (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  organization TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  pp_contact_id TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_case_people_case ON case_people(case_id);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  issue_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  employee_position TEXT,
  defense_position TEXT,
  requested_relief TEXT,
  priority INTEGER DEFAULT 50,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_issues_case ON issues(case_id);

CREATE TABLE IF NOT EXISTS proof_requirements (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  requirement_key TEXT NOT NULL,
  requirement_type TEXT NOT NULL,
  requirement_policy TEXT NOT NULL,
  rationale TEXT,
  satisfied INTEGER DEFAULT 0,
  satisfied_by_type TEXT,
  satisfied_by_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_proof_requirements_issue ON proof_requirements(issue_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_proof_requirements_issue_key
  ON proof_requirements(issue_id, requirement_key);

CREATE TABLE IF NOT EXISTS issue_evidence_links (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  evidence_kind TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  rationale TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_issue_evidence_issue ON issue_evidence_links(issue_id);

CREATE TABLE IF NOT EXISTS open_questions (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  issue_id TEXT REFERENCES issues(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'important',
  resolved INTEGER DEFAULT 0,
  resolution_note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_open_questions_case ON open_questions(case_id);

CREATE TABLE IF NOT EXISTS product_presets (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  source_policy TEXT NOT NULL,
  compact_default INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_rulepacks (
  id TEXT PRIMARY KEY,
  product_preset_id TEXT NOT NULL REFERENCES product_presets(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  rule_key TEXT NOT NULL,
  rule_value TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_rulepacks_preset ON product_rulepacks(product_preset_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_rulepacks_unique
  ON product_rulepacks(product_preset_id, version, rule_type, rule_key);

CREATE TABLE IF NOT EXISTS product_workflows (
  id TEXT PRIMARY KEY,
  product_preset_id TEXT NOT NULL REFERENCES product_presets(id) ON DELETE CASCADE,
  state_key TEXT NOT NULL,
  state_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  entry_conditions TEXT,
  exit_conditions TEXT,
  blocking_conditions TEXT,
  approval_required INTEGER DEFAULT 0,
  UNIQUE(product_preset_id, state_key)
);

CREATE TABLE IF NOT EXISTS approval_gates (
  id TEXT PRIMARY KEY,
  product_preset_id TEXT NOT NULL REFERENCES product_presets(id) ON DELETE CASCADE,
  gate_key TEXT NOT NULL,
  gate_name TEXT NOT NULL,
  gate_policy TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(product_preset_id, gate_key)
);

CREATE TABLE IF NOT EXISTS artifact_templates (
  id TEXT PRIMARY KEY,
  product_preset_id TEXT NOT NULL REFERENCES product_presets(id) ON DELETE CASCADE,
  artifact_key TEXT NOT NULL,
  artifact_name TEXT NOT NULL,
  output_format TEXT NOT NULL,
  template_source TEXT NOT NULL,
  required_inputs TEXT,
  approval_gate_key TEXT,
  UNIQUE(product_preset_id, artifact_key)
);

CREATE TABLE IF NOT EXISTS branch_templates (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  branch_family TEXT NOT NULL,
  packet_policy TEXT NOT NULL,
  issue_scope_policy TEXT NOT NULL,
  description TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS branch_transitions (
  id TEXT PRIMARY KEY,
  branch_template_id TEXT NOT NULL REFERENCES branch_templates(id) ON DELETE CASCADE,
  from_stage_key TEXT NOT NULL,
  to_stage_key TEXT NOT NULL,
  transition_label TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_condition TEXT NOT NULL,
  blocking_condition TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_branch_transitions_unique
  ON branch_transitions(branch_template_id, from_stage_key, to_stage_key, transition_label);

CREATE TABLE IF NOT EXISTS branch_stage_requirements (
  id TEXT PRIMARY KEY,
  branch_template_id TEXT NOT NULL REFERENCES branch_templates(id) ON DELETE CASCADE,
  stage_key TEXT NOT NULL,
  requirement_type TEXT NOT NULL,
  requirement_key TEXT NOT NULL,
  requirement_policy TEXT NOT NULL,
  rationale TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_branch_stage_requirements_unique
  ON branch_stage_requirements(branch_template_id, stage_key, requirement_type, requirement_key);

CREATE TABLE IF NOT EXISTS branch_sla_targets (
  id TEXT PRIMARY KEY,
  branch_template_id TEXT NOT NULL REFERENCES branch_templates(id) ON DELETE CASCADE,
  stage_key TEXT NOT NULL,
  target_hours INTEGER,
  warning_hours INTEGER,
  critical_hours INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_branch_sla_targets_unique
  ON branch_sla_targets(branch_template_id, stage_key);

CREATE TABLE IF NOT EXISTS matter_branch_instances (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  product_preset_id TEXT NOT NULL REFERENCES product_presets(id),
  branch_template_id TEXT NOT NULL REFERENCES branch_templates(id),
  status TEXT NOT NULL DEFAULT 'active',
  priority INTEGER DEFAULT 50,
  current_stage_key TEXT,
  started_at TEXT DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_branch_instances_case ON matter_branch_instances(case_id);

CREATE TABLE IF NOT EXISTS branch_events (
  id TEXT PRIMARY KEY,
  matter_branch_instance_id TEXT NOT NULL REFERENCES matter_branch_instances(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_source TEXT NOT NULL,
  source_id TEXT,
  event_time TEXT NOT NULL,
  payload TEXT
);
CREATE INDEX IF NOT EXISTS idx_branch_events_instance ON branch_events(matter_branch_instance_id);

CREATE TABLE IF NOT EXISTS branch_stage_status (
  id TEXT PRIMARY KEY,
  matter_branch_instance_id TEXT NOT NULL REFERENCES matter_branch_instances(id) ON DELETE CASCADE,
  stage_key TEXT NOT NULL,
  status TEXT NOT NULL,
  entered_at TEXT,
  completed_at TEXT,
  blocker_summary TEXT,
  progress_summary TEXT,
  UNIQUE(matter_branch_instance_id, stage_key)
);

CREATE TABLE IF NOT EXISTS branch_recommendations (
  id TEXT PRIMARY KEY,
  matter_branch_instance_id TEXT NOT NULL REFERENCES matter_branch_instances(id) ON DELETE CASCADE,
  stage_key TEXT,
  recommendation_type TEXT NOT NULL,
  priority_score REAL NOT NULL,
  summary TEXT NOT NULL,
  rationale TEXT,
  action_payload TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS branch_conformance_runs (
  id TEXT PRIMARY KEY,
  matter_branch_instance_id TEXT NOT NULL REFERENCES matter_branch_instances(id) ON DELETE CASCADE,
  run_time TEXT DEFAULT CURRENT_TIMESTAMP,
  expected_stage_key TEXT,
  actual_stage_key TEXT,
  conforms INTEGER NOT NULL,
  findings_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_branch_conformance_instance
  ON branch_conformance_runs(matter_branch_instance_id);

CREATE TABLE IF NOT EXISTS branch_bottleneck_findings (
  id TEXT PRIMARY KEY,
  matter_branch_instance_id TEXT NOT NULL REFERENCES matter_branch_instances(id) ON DELETE CASCADE,
  stage_key TEXT,
  bottleneck_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  summary TEXT NOT NULL,
  linked_object_ids TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_branch_bottlenecks_instance
  ON branch_bottleneck_findings(matter_branch_instance_id);

CREATE TABLE IF NOT EXISTS source_connections (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  account_label TEXT,
  auth_mode TEXT NOT NULL,
  scopes TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_verified_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  source_connection_id TEXT NOT NULL REFERENCES source_connections(id),
  case_id TEXT REFERENCES cases(id) ON DELETE CASCADE,
  sync_type TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  cursor_before TEXT,
  cursor_after TEXT,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_runs_source ON sync_runs(source_connection_id);
CREATE INDEX IF NOT EXISTS idx_sync_runs_case ON sync_runs(case_id);

CREATE TABLE IF NOT EXISTS sync_cursors (
  id TEXT PRIMARY KEY,
  source_connection_id TEXT NOT NULL REFERENCES source_connections(id),
  case_id TEXT REFERENCES cases(id) ON DELETE CASCADE,
  cursor_key TEXT NOT NULL,
  cursor_value TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_connection_id, case_id, cursor_key)
);

CREATE TABLE IF NOT EXISTS source_snapshots (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  source_connection_id TEXT NOT NULL REFERENCES source_connections(id),
  snapshot_type TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_source_snapshots_case ON source_snapshots(case_id);

CREATE TABLE IF NOT EXISTS source_items (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  source_connection_id TEXT NOT NULL REFERENCES source_connections(id),
  provider TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  parent_remote_id TEXT,
  source_kind TEXT NOT NULL,
  title TEXT,
  mime_type TEXT,
  content_hash TEXT,
  latest_version_token TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  raw_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, remote_id)
);
CREATE INDEX IF NOT EXISTS idx_source_items_case ON source_items(case_id);

CREATE TABLE IF NOT EXISTS source_versions (
  id TEXT PRIMARY KEY,
  source_item_id TEXT NOT NULL REFERENCES source_items(id) ON DELETE CASCADE,
  version_token TEXT NOT NULL,
  content_hash TEXT,
  remote_modified_at TEXT,
  authoritative_asset_uri TEXT,
  raw_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_source_versions_item ON source_versions(source_item_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_source_versions_item_version
  ON source_versions(source_item_id, version_token);

CREATE TABLE IF NOT EXISTS document_types (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  target_folder TEXT,
  filename_pattern TEXT,
  case_types TEXT DEFAULT '["wc"]',
  exhibit_eligible INTEGER DEFAULT 1,
  exhibit_policy TEXT DEFAULT 'normal',
  extraction_schema TEXT,
  default_priority INTEGER DEFAULT 50,
  mandatory_vlm_ocr INTEGER DEFAULT 0,
  hearing_relevance TEXT,
  dashboard_triggers TEXT,
  cross_check_docs TEXT,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS document_type_aliases (
  id TEXT PRIMARY KEY,
  document_type_id TEXT NOT NULL REFERENCES document_types(id) ON DELETE CASCADE,
  alias_pattern TEXT NOT NULL,
  match_mode TEXT NOT NULL DEFAULT 'contains',
  source TEXT,
  attorney TEXT,
  priority INTEGER DEFAULT 50,
  example_filenames TEXT,
  active INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_doc_aliases_type ON document_type_aliases(document_type_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_type_aliases_unique
  ON document_type_aliases(document_type_id, alias_pattern, match_mode);

CREATE TABLE IF NOT EXISTS document_type_rules (
  id TEXT PRIMARY KEY,
  document_type_id TEXT NOT NULL REFERENCES document_types(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL,
  rule_key TEXT NOT NULL,
  rule_value TEXT NOT NULL,
  active INTEGER DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_type_rules_unique
  ON document_type_rules(document_type_id, rule_type, rule_key);

CREATE TABLE IF NOT EXISTS pp_entities_raw (
  id TEXT PRIMARY KEY,
  case_id TEXT REFERENCES cases(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  pp_entity_id TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  source_updated_at TEXT,
  synced_at TEXT DEFAULT CURRENT_TIMESTAMP,
  content_hash TEXT,
  UNIQUE(entity_type, pp_entity_id)
);
CREATE INDEX IF NOT EXISTS idx_pp_entities_case ON pp_entities_raw(case_id);

CREATE TABLE IF NOT EXISTS pp_custom_field_defs (
  id TEXT PRIMARY KEY,
  pp_field_id TEXT NOT NULL UNIQUE,
  entity_scope TEXT NOT NULL,
  field_key TEXT NOT NULL,
  label TEXT NOT NULL,
  field_type TEXT,
  options_json TEXT,
  active INTEGER DEFAULT 1,
  synced_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pp_custom_field_values (
  id TEXT PRIMARY KEY,
  case_id TEXT REFERENCES cases(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_remote_id TEXT NOT NULL,
  pp_field_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  raw_value_json TEXT,
  normalized_text TEXT,
  normalized_number REAL,
  normalized_date TEXT,
  synced_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pp_cf_values_case ON pp_custom_field_values(case_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pp_cf_values_unique
  ON pp_custom_field_values(entity_type, entity_remote_id, pp_field_id);

CREATE TABLE IF NOT EXISTS projected_case_queue (
  case_id TEXT PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,
  last_projection_refresh_at TEXT,
  projection_snapshot_id TEXT,
  matter_version_token TEXT
);

CREATE TABLE IF NOT EXISTS regression_checks (
  id TEXT PRIMARY KEY,
  case_id TEXT REFERENCES cases(id) ON DELETE CASCADE,
  artifact_id TEXT,
  bates_run_id TEXT,
  check_type TEXT NOT NULL,
  passed INTEGER NOT NULL,
  message TEXT,
  details_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_regression_checks_case ON regression_checks(case_id);

CREATE TABLE IF NOT EXISTS run_manifests (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  product_preset_id TEXT REFERENCES product_presets(id),
  source_snapshot_id TEXT REFERENCES source_snapshots(id),
  rulepack_version TEXT,
  bates_run_id TEXT,
  artifact_ids_json TEXT,
  regression_results_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_run_manifests_case ON run_manifests(case_id);
`;

export const authoritativeMigrations: AuthoritativeMigration[] = [
  {
    id: "0001_slice01_foundation",
    description: "Create Slice 01 authoritative foundation schema",
    up(db) {
      db.exec(foundationMigrationSql);
    }
  },
  {
    id: "0002_slice01_additive_columns",
    description: "Add Slice 01 compatibility columns to existing tables",
    up(db) {
      addColumnIfMissing(db, "cases", "oah_number", "oah_number TEXT");
      addColumnIfMissing(db, "cases", "wid", "wid TEXT");
      addColumnIfMissing(db, "cases", "employee_name", "employee_name TEXT");
      addColumnIfMissing(db, "cases", "employee_address", "employee_address TEXT");
      addColumnIfMissing(db, "cases", "employee_dob", "employee_dob TEXT");
      addColumnIfMissing(db, "cases", "employer_name", "employer_name TEXT");
      addColumnIfMissing(db, "cases", "insurer_name", "insurer_name TEXT");
      addColumnIfMissing(db, "cases", "judge_name", "judge_name TEXT");
      addColumnIfMissing(db, "cases", "doi_dates", "doi_dates TEXT");
      addColumnIfMissing(db, "cases", "hearing_date", "hearing_date TEXT");
      addColumnIfMissing(db, "cases", "hearing_location", "hearing_location TEXT");

      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_proof_requirements_issue_key
          ON proof_requirements(issue_id, requirement_key);
        CREATE INDEX IF NOT EXISTS idx_sync_runs_case ON sync_runs(case_id);
        CREATE INDEX IF NOT EXISTS idx_source_snapshots_case ON source_snapshots(case_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_source_versions_item_version
          ON source_versions(source_item_id, version_token);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_pp_cf_values_unique
          ON pp_custom_field_values(entity_type, entity_remote_id, pp_field_id);
      `);
    }
  },
  {
    id: "0003_slice02_canonical_document_spine",
    description: "Create Slice 02 logical and canonical document spine tables",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS logical_documents (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
          source_item_id TEXT REFERENCES source_items(id),
          source_version_id TEXT REFERENCES source_versions(id),
          document_type_id TEXT REFERENCES document_types(id),
          title TEXT NOT NULL,
          normalization_status TEXT NOT NULL DEFAULT 'pending',
          content_fingerprint TEXT,
          parent_logical_document_id TEXT REFERENCES logical_documents(id),
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_logical_docs_case ON logical_documents(case_id);
        CREATE INDEX IF NOT EXISTS idx_logical_docs_source_item ON logical_documents(source_item_id);

        CREATE TABLE IF NOT EXISTS document_parts (
          id TEXT PRIMARY KEY,
          logical_document_id TEXT NOT NULL REFERENCES logical_documents(id) ON DELETE CASCADE,
          part_index INTEGER NOT NULL,
          part_kind TEXT NOT NULL,
          title TEXT,
          page_start INTEGER,
          page_end INTEGER,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_document_parts_logical_document
          ON document_parts(logical_document_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_document_parts_logical_part
          ON document_parts(logical_document_id, part_index);

        CREATE TABLE IF NOT EXISTS canonical_documents (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
          logical_document_id TEXT REFERENCES logical_documents(id),
          document_type_id TEXT REFERENCES document_types(id),
          title TEXT NOT NULL,
          provider TEXT,
          provider_group TEXT,
          date_earliest TEXT,
          date_latest TEXT,
          content_hash TEXT,
          page_count INTEGER,
          total_text_length INTEGER,
          filed_status TEXT DEFAULT 'producible',
          ocr_status TEXT DEFAULT 'pending',
          ingestion_status TEXT DEFAULT 'pending',
          authoritative_asset_uri TEXT,
          active_cache_key TEXT,
          ai_summary TEXT,
          ai_what_it_proves TEXT,
          ai_risks TEXT,
          ai_suggested_questions TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_canonical_docs_case ON canonical_documents(case_id);
        CREATE INDEX IF NOT EXISTS idx_canonical_docs_logical
          ON canonical_documents(logical_document_id);
        CREATE INDEX IF NOT EXISTS idx_canonical_docs_type
          ON canonical_documents(document_type_id);
        CREATE INDEX IF NOT EXISTS idx_canonical_docs_content_hash
          ON canonical_documents(content_hash);

        CREATE TABLE IF NOT EXISTS canonical_pages (
          id TEXT PRIMARY KEY,
          canonical_doc_id TEXT NOT NULL REFERENCES canonical_documents(id) ON DELETE CASCADE,
          page_number_in_doc INTEGER NOT NULL,
          text_length INTEGER DEFAULT 0,
          raw_text TEXT,
          ocr_method TEXT,
          ocr_confidence REAL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(canonical_doc_id, page_number_in_doc)
        );
        CREATE INDEX IF NOT EXISTS idx_canonical_pages_doc ON canonical_pages(canonical_doc_id);

        CREATE TABLE IF NOT EXISTS ocr_attempts (
          id TEXT PRIMARY KEY,
          canonical_page_id TEXT NOT NULL REFERENCES canonical_pages(id) ON DELETE CASCADE,
          attempt_order INTEGER NOT NULL,
          engine TEXT NOT NULL,
          status TEXT NOT NULL,
          confidence REAL,
          output_text TEXT,
          metadata_json TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_ocr_attempts_page ON ocr_attempts(canonical_page_id);

        CREATE TABLE IF NOT EXISTS ocr_review_queue (
          id TEXT PRIMARY KEY,
          canonical_page_id TEXT NOT NULL REFERENCES canonical_pages(id) ON DELETE CASCADE,
          case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
          severity TEXT NOT NULL DEFAULT 'important',
          blocker_for_branch INTEGER DEFAULT 0,
          blocker_for_preset INTEGER DEFAULT 0,
          review_status TEXT NOT NULL DEFAULT 'pending',
          review_note TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          resolved_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_ocr_review_case ON ocr_review_queue(case_id);
        CREATE INDEX IF NOT EXISTS idx_ocr_review_page ON ocr_review_queue(canonical_page_id);
      `);
    }
  },
  {
    id: "0004_slice02_classification_columns",
    description: "Add first-class classification columns to source_items and ocr_status to canonical_pages",
    up(db) {
      addColumnIfMissing(db, "source_items", "document_type_id", "document_type_id TEXT REFERENCES document_types(id)");
      addColumnIfMissing(db, "source_items", "document_type_name", "document_type_name TEXT");
      addColumnIfMissing(db, "source_items", "classification_method", "classification_method TEXT");
      addColumnIfMissing(db, "source_items", "classification_confidence", "classification_confidence REAL");

      addColumnIfMissing(db, "canonical_pages", "ocr_status", "ocr_status TEXT DEFAULT 'pending'");

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_source_items_doc_type ON source_items(document_type_id);
        CREATE INDEX IF NOT EXISTS idx_source_items_doc_type_name ON source_items(document_type_name);
        CREATE INDEX IF NOT EXISTS idx_source_items_classification ON source_items(classification_method);
        CREATE INDEX IF NOT EXISTS idx_source_items_confidence ON source_items(classification_confidence);
        CREATE INDEX IF NOT EXISTS idx_canonical_pages_ocr_status ON canonical_pages(ocr_status);
      `);

      db.exec(`
        UPDATE source_items
        SET document_type_id = json_extract(raw_json, '$.__classification.document_type_id'),
            document_type_name = json_extract(raw_json, '$.__classification.canonical_name'),
            classification_method = json_extract(raw_json, '$.__classification.classification_method'),
            classification_confidence = 1.0
        WHERE document_type_id IS NULL
          AND json_extract(raw_json, '$.__classification.document_type_id') IS NOT NULL;

        UPDATE source_items
        SET document_type_id = json_extract(raw_json, '$.document_type_id'),
            document_type_name = json_extract(raw_json, '$.document_type_name'),
            classification_method = COALESCE(classification_method, 'alias_match'),
            classification_confidence = 1.0
        WHERE document_type_id IS NULL
          AND json_extract(raw_json, '$.document_type_id') IS NOT NULL;

        UPDATE source_items
        SET classification_confidence = 1.0
        WHERE classification_method = 'alias_match'
          AND classification_confidence IS NULL;
      `);
    }
  },
  {
    id: "0005_slice02_ocr_processing_state",
    description: "Add canonical page extraction state and OCR review indexes",
    up(db) {
      addColumnIfMissing(
        db,
        "canonical_pages",
        "extraction_status",
        "extraction_status TEXT DEFAULT 'pending'"
      );
      addColumnIfMissing(db, "canonical_pages", "updated_at", "updated_at TEXT");

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_canonical_pages_extraction_status
          ON canonical_pages(extraction_status);
        CREATE INDEX IF NOT EXISTS idx_ocr_review_status
          ON ocr_review_queue(review_status);
      `);

      db.exec(`
        UPDATE canonical_pages
        SET extraction_status = CASE
              WHEN raw_text IS NOT NULL AND LENGTH(raw_text) > 0 THEN 'ready'
              ELSE 'pending'
            END,
            updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
        WHERE extraction_status IS NULL
           OR updated_at IS NULL;
      `);
    }
  },
  {
    id: "0006_source_connection_lifecycle",
    description: "Add richer source connection auth lifecycle metadata",
    up(db) {
      addColumnIfMissing(db, "source_connections", "external_account_id", "external_account_id TEXT");
      addColumnIfMissing(db, "source_connections", "callback_state", "callback_state TEXT");
      addColumnIfMissing(db, "source_connections", "authorization_url", "authorization_url TEXT");
      addColumnIfMissing(db, "source_connections", "metadata_json", "metadata_json TEXT");
      addColumnIfMissing(db, "source_connections", "last_error_message", "last_error_message TEXT");
      addColumnIfMissing(db, "source_connections", "updated_at", "updated_at TEXT");

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_source_connections_provider_status
          ON source_connections(provider, status);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_source_connections_callback_state
          ON source_connections(callback_state)
          WHERE callback_state IS NOT NULL;
      `);

      db.exec(`
        UPDATE source_connections
        SET updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP),
            metadata_json = COALESCE(metadata_json, '{}')
        WHERE updated_at IS NULL
           OR metadata_json IS NULL;
      `);
    }
  },
  {
    id: "0007_page_extractions_append_only",
    description: "Append-only structured extractions per canonical page (decoupled from OCR writes)",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS page_extractions (
          id TEXT PRIMARY KEY,
          canonical_page_id TEXT NOT NULL REFERENCES canonical_pages(id) ON DELETE CASCADE,
          schema_key TEXT NOT NULL,
          extractor_version TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          confidence REAL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_page_extractions_page ON page_extractions(canonical_page_id);
        CREATE INDEX IF NOT EXISTS idx_page_extractions_schema ON page_extractions(schema_key);
      `);
    }
  },
  {
    id: "0008_worker_heartbeats",
    description: "Track long-running worker health and heartbeat state",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS worker_heartbeats (
          worker_name TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          last_heartbeat_at TEXT NOT NULL,
          last_started_at TEXT,
          last_stopped_at TEXT,
          last_error_message TEXT,
          last_processed_count INTEGER DEFAULT 0,
          metadata_json TEXT
        );
      `);
    }
  }
];
