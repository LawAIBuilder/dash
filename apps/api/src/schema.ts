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
  },
  {
    id: "0009_exhibit_workspace",
    description: "Add exhibit packet, section, slot, item, page rule, and history tables",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS exhibit_packets (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
          packet_name TEXT NOT NULL,
          packet_mode TEXT NOT NULL DEFAULT 'full',
          naming_scheme TEXT NOT NULL DEFAULT 'letters',
          status TEXT NOT NULL DEFAULT 'draft',
          metadata_json TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_exhibit_packets_case ON exhibit_packets(case_id);

        CREATE TABLE IF NOT EXISTS exhibit_sections (
          id TEXT PRIMARY KEY,
          exhibit_packet_id TEXT NOT NULL REFERENCES exhibit_packets(id) ON DELETE CASCADE,
          section_key TEXT NOT NULL,
          section_label TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(exhibit_packet_id, section_key)
        );
        CREATE INDEX IF NOT EXISTS idx_exhibit_sections_packet ON exhibit_sections(exhibit_packet_id);

        CREATE TABLE IF NOT EXISTS exhibits (
          id TEXT PRIMARY KEY,
          exhibit_section_id TEXT NOT NULL REFERENCES exhibit_sections(id) ON DELETE CASCADE,
          exhibit_label TEXT NOT NULL,
          title TEXT,
          status TEXT NOT NULL DEFAULT 'draft',
          sort_order INTEGER NOT NULL DEFAULT 0,
          purpose TEXT,
          objection_risk TEXT,
          notes TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_exhibits_section ON exhibits(exhibit_section_id);

        CREATE TABLE IF NOT EXISTS exhibit_items (
          id TEXT PRIMARY KEY,
          exhibit_id TEXT NOT NULL REFERENCES exhibits(id) ON DELETE CASCADE,
          source_item_id TEXT REFERENCES source_items(id) ON DELETE SET NULL,
          canonical_document_id TEXT REFERENCES canonical_documents(id) ON DELETE SET NULL,
          canonical_page_id TEXT REFERENCES canonical_pages(id) ON DELETE SET NULL,
          page_start INTEGER,
          page_end INTEGER,
          include_order INTEGER NOT NULL DEFAULT 0,
          notes TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_exhibit_items_exhibit ON exhibit_items(exhibit_id);
        CREATE INDEX IF NOT EXISTS idx_exhibit_items_source_item ON exhibit_items(source_item_id);

        CREATE TABLE IF NOT EXISTS exhibit_item_page_rules (
          id TEXT PRIMARY KEY,
          exhibit_item_id TEXT NOT NULL REFERENCES exhibit_items(id) ON DELETE CASCADE,
          canonical_page_id TEXT NOT NULL REFERENCES canonical_pages(id) ON DELETE CASCADE,
          rule_type TEXT NOT NULL,
          note TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(exhibit_item_id, canonical_page_id, rule_type)
        );
        CREATE INDEX IF NOT EXISTS idx_exhibit_item_rules_item ON exhibit_item_page_rules(exhibit_item_id);

        CREATE TABLE IF NOT EXISTS exhibit_history (
          id TEXT PRIMARY KEY,
          packet_id TEXT NOT NULL REFERENCES exhibit_packets(id) ON DELETE CASCADE,
          actor_id TEXT,
          action_type TEXT NOT NULL,
          target_type TEXT NOT NULL,
          target_id TEXT,
          payload_json TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_exhibit_history_packet ON exhibit_history(packet_id);
      `);
    }
  },
  {
    id: "0010_exhibit_suggestion_resolutions",
    description: "Persist accepted or dismissed exhibit suggestions",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS exhibit_suggestion_resolutions (
          id TEXT PRIMARY KEY,
          packet_id TEXT NOT NULL REFERENCES exhibit_packets(id) ON DELETE CASCADE,
          suggestion_id TEXT NOT NULL,
          resolution_action TEXT NOT NULL,
          note TEXT,
          resolved_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(packet_id, suggestion_id)
        );
        CREATE INDEX IF NOT EXISTS idx_exhibit_suggestion_resolutions_packet
          ON exhibit_suggestion_resolutions(packet_id);
      `);
    }
  },
  {
    id: "0011_exhibit_packet_exports",
    description: "Persist combined exhibit packet PDF exports and manifests",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS exhibit_packet_exports (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
          packet_id TEXT NOT NULL REFERENCES exhibit_packets(id) ON DELETE CASCADE,
          status TEXT NOT NULL,
          export_type TEXT NOT NULL DEFAULT 'packet_pdf',
          pdf_relative_path TEXT,
          manifest_json TEXT,
          error_text TEXT,
          page_count INTEGER,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          completed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_exhibit_packet_exports_case ON exhibit_packet_exports(case_id);
        CREATE INDEX IF NOT EXISTS idx_exhibit_packet_exports_packet ON exhibit_packet_exports(packet_id);
      `);
    }
  },
  {
    id: "0012_user_document_templates",
    description: "User-authored document templates and filled renders per case",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_document_templates (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT,
          body_markdown TEXT NOT NULL DEFAULT '',
          fields_json TEXT NOT NULL DEFAULT '[]',
          ai_hints TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_user_document_templates_case ON user_document_templates(case_id);

        CREATE TABLE IF NOT EXISTS user_document_template_fills (
          id TEXT PRIMARY KEY,
          template_id TEXT NOT NULL REFERENCES user_document_templates(id) ON DELETE CASCADE,
          case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
          values_json TEXT NOT NULL,
          rendered_markdown TEXT NOT NULL,
          source_item_id TEXT REFERENCES source_items(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_user_document_template_fills_case ON user_document_template_fills(case_id);
        CREATE INDEX IF NOT EXISTS idx_user_document_template_fills_template ON user_document_template_fills(template_id);
      `);
    }
  },
  {
    id: "0013_user_document_template_fills_updated_at",
    description: "Add updated_at to template fills for edit tracking",
    up(db) {
      addColumnIfMissing(db, "user_document_template_fills", "updated_at", "updated_at TEXT DEFAULT CURRENT_TIMESTAMP");
      db.exec(`
        UPDATE user_document_template_fills
        SET updated_at = COALESCE(NULLIF(updated_at, ''), created_at)
        WHERE updated_at IS NULL OR updated_at = '';
      `);
    }
  },
  {
    id: "0014_ai_jobs_and_classification_learning",
    description: "AI job system for event-driven packet assembly and classification learning from user actions",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ai_event_configs (
          id TEXT PRIMARY KEY,
          case_id TEXT REFERENCES cases(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL,
          event_label TEXT NOT NULL,
          instructions TEXT NOT NULL DEFAULT '',
          exhibit_strategy_json TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_ai_event_configs_case ON ai_event_configs(case_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_event_configs_type ON ai_event_configs(case_id, event_type)
          WHERE case_id IS NOT NULL;

        CREATE TABLE IF NOT EXISTS ai_jobs (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          input_json TEXT,
          output_json TEXT,
          error_message TEXT,
          model TEXT,
          prompt_tokens INTEGER,
          completion_tokens INTEGER,
          started_at TEXT,
          completed_at TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_ai_jobs_case ON ai_jobs(case_id);
        CREATE INDEX IF NOT EXISTS idx_ai_jobs_status ON ai_jobs(status);

        CREATE TABLE IF NOT EXISTS classification_signals (
          id TEXT PRIMARY KEY,
          source_item_id TEXT NOT NULL REFERENCES source_items(id) ON DELETE CASCADE,
          signal_type TEXT NOT NULL,
          folder_path TEXT,
          filename TEXT,
          document_type_id TEXT REFERENCES document_types(id) ON DELETE SET NULL,
          document_type_name TEXT,
          exhibit_label TEXT,
          actor TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_classification_signals_type ON classification_signals(document_type_id);
      `);
    }
  },
  {
    id: "0015_package_workbench",
    description: "Package types, rules, upload connector seed, exhibit packet extensions",
    up(db) {
      addColumnIfMissing(db, "exhibit_packets", "package_type", "package_type TEXT NOT NULL DEFAULT 'hearing_packet'");
      addColumnIfMissing(db, "exhibit_packets", "package_label", "package_label TEXT");
      addColumnIfMissing(
        db,
        "exhibit_packets",
        "target_document_source_item_id",
        "target_document_source_item_id TEXT REFERENCES source_items(id) ON DELETE SET NULL"
      );
      addColumnIfMissing(db, "exhibit_packets", "run_status", "run_status TEXT");

      db.exec(`
        CREATE TABLE IF NOT EXISTS package_rules (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
          package_type TEXT NOT NULL,
          rule_key TEXT NOT NULL,
          rule_label TEXT NOT NULL,
          instructions TEXT NOT NULL DEFAULT '',
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(case_id, package_type, rule_key)
        );
        CREATE INDEX IF NOT EXISTS idx_package_rules_case ON package_rules(case_id);
      `);

      const uploadConnId = "a0000001-0000-4000-8000-000000000001";
      const existing = db.prepare(`SELECT id FROM source_connections WHERE id = ?`).get(uploadConnId) as
        | { id: string }
        | undefined;
      if (!existing) {
        db.prepare(
          `
            INSERT INTO source_connections
              (id, provider, account_label, auth_mode, scopes, status, last_verified_at, metadata_json, updated_at)
            VALUES
              (?, 'matter_upload', 'Matter uploads', 'local_upload', '[]', 'active', CURRENT_TIMESTAMP, '{}', CURRENT_TIMESTAMP)
          `
        ).run(uploadConnId);
      }
    }
  },
  {
    id: "0016_golden_examples",
    description: "Golden exemplar packages for retrieval-guided drafting",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS golden_examples (
          id TEXT PRIMARY KEY,
          case_id TEXT REFERENCES cases(id) ON DELETE SET NULL,
          package_type TEXT NOT NULL,
          label TEXT,
          summary TEXT,
          source_item_ids_json TEXT,
          metadata_json TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_golden_examples_pkg ON golden_examples(package_type);
        CREATE INDEX IF NOT EXISTS idx_golden_examples_case ON golden_examples(case_id);
      `);
    }
  },
  {
    id: "0017_package_runs",
    description: "Package worker runs with structured outputs",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS package_runs (
          id TEXT PRIMARY KEY,
          packet_id TEXT NOT NULL REFERENCES exhibit_packets(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'pending',
          input_json TEXT,
          output_json TEXT,
          citations_json TEXT,
          error_message TEXT,
          model TEXT,
          prompt_tokens INTEGER,
          completion_tokens INTEGER,
          retrieval_warnings_json TEXT,
          started_at TEXT,
          completed_at TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_package_runs_packet ON package_runs(packet_id);
        CREATE INDEX IF NOT EXISTS idx_package_runs_status ON package_runs(status);
      `);
    }
  },
  {
    id: "0018_case_events",
    description: "Case-level event log with optional branch linkage",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS case_events (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
          branch_instance_id TEXT REFERENCES matter_branch_instances(id) ON DELETE SET NULL,
          preset_id TEXT REFERENCES product_presets(id) ON DELETE SET NULL,
          event_name TEXT NOT NULL,
          source_type TEXT NOT NULL,
          source_id TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_case_events_case_time ON case_events(case_id, occurred_at DESC);
        CREATE INDEX IF NOT EXISTS idx_case_events_branch_time ON case_events(branch_instance_id, occurred_at DESC);
      `);
    }
  },
  {
    id: "0019_package_run_approvals",
    description: "Approval metadata for package runs before export/write-back",
    up(db) {
      addColumnIfMissing(db, "package_runs", "approval_status", "approval_status TEXT NOT NULL DEFAULT 'pending'");
      addColumnIfMissing(db, "package_runs", "approved_at", "approved_at TEXT");
      addColumnIfMissing(db, "package_runs", "approved_by", "approved_by TEXT");
      addColumnIfMissing(db, "package_runs", "approval_note", "approval_note TEXT");
      db.exec(`
        UPDATE package_runs
        SET approval_status = COALESCE(NULLIF(approval_status, ''), 'pending')
        WHERE approval_status IS NULL OR approval_status = '';
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_package_runs_approval_status ON package_runs(approval_status);
      `);
    }
  },
  {
    id: "0020_package_run_export_metadata",
    description: "Track latest exported artifact metadata for package runs",
    up(db) {
      addColumnIfMissing(db, "package_runs", "latest_export_format", "latest_export_format TEXT");
      addColumnIfMissing(db, "package_runs", "latest_export_path", "latest_export_path TEXT");
      addColumnIfMissing(db, "package_runs", "latest_export_bytes", "latest_export_bytes INTEGER");
      addColumnIfMissing(db, "package_runs", "latest_exported_at", "latest_exported_at TEXT");
    }
  },
  {
    id: "0021_sync_run_warnings",
    description: "Track sync warnings separately from sync failures",
    up(db) {
      addColumnIfMissing(db, "sync_runs", "warning_message", "warning_message TEXT");
    }
  },
  {
    id: "0022_ai_error_codes_and_usage_counters",
    description: "Track structured AI/package error codes and daily usage counters",
    up(db) {
      addColumnIfMissing(db, "ai_jobs", "error_code", "error_code TEXT");
      addColumnIfMissing(db, "package_runs", "error_code", "error_code TEXT");
      db.exec(`
        CREATE TABLE IF NOT EXISTS usage_counters (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
          counter_key TEXT NOT NULL,
          usage_date TEXT NOT NULL,
          units INTEGER NOT NULL DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(case_id, counter_key, usage_date)
        );
        CREATE INDEX IF NOT EXISTS idx_usage_counters_case_key ON usage_counters(case_id, counter_key, usage_date);
      `);
    }
  },
  {
    id: "0023_auth_principals_and_sessions",
    description: "Users, browser auth sessions, case memberships, and principal-backed package approvals",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          display_name TEXT,
          role TEXT NOT NULL DEFAULT 'operator',
          password_salt TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_users_role_active ON users(role, active);

        CREATE TABLE IF NOT EXISTS auth_sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          revoked_at TEXT,
          created_ip TEXT,
          created_user_agent TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active ON auth_sessions(user_id, revoked_at, expires_at);

        CREATE TABLE IF NOT EXISTS case_memberships (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role TEXT NOT NULL DEFAULT 'operator',
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(case_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_case_memberships_user ON case_memberships(user_id);
      `);

      addColumnIfMissing(
        db,
        "package_runs",
        "approved_by_user_id",
        "approved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL"
      );
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_package_runs_approved_by_user ON package_runs(approved_by_user_id);
      `);
    }
  }
];
