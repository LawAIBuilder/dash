import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { documentTypeAliasSeeds, documentTypeSeeds, hearingPrepPreset, medicalRequestBranch } from "@wc/wc-rules";
import { DEFAULT_BLUEPRINT_SEEDS } from "./blueprints.js";

function nowIso() {
  return new Date().toISOString();
}

type SeedDocumentType = {
  canonical_name: string;
  category: string;
  target_folder?: string | null;
  exhibit_policy?: string;
  exhibit_eligible?: boolean;
  default_priority?: number;
  hearing_relevance?: string | null;
  extraction_schema?: string | null;
};

type SeedDocumentAlias = {
  canonical_name: string;
  alias_pattern: string;
  match_mode: string;
  priority?: number;
};

export function seedFoundation(db: Database.Database) {
  function getIdByKey(table: string, keyColumn: string, keyValue: string): string | null {
    const row = db.prepare(`SELECT id FROM ${table} WHERE ${keyColumn} = ? LIMIT 1`).get(keyValue) as
      | { id: string }
      | undefined;
    return row?.id ?? null;
  }

  function getIdByQuery(sql: string, ...args: Array<string | number | null>) {
    const row = db.prepare(sql).get(...args) as { id: string } | undefined;
    return row?.id ?? null;
  }

  const createdAt = nowIso();

  const workflowRows = [
    {
      state_key: "intake_ready",
      state_name: "Intake Ready",
      sort_order: 10,
      entry_conditions: { preset_selected: true },
      exit_conditions: { matter_selected: true, source_links_present: true },
      blocking_conditions: {},
      approval_required: false
    },
    {
      state_key: "sources_hydrated",
      state_name: "Sources Hydrated",
      sort_order: 20,
      entry_conditions: { matter_selected: true },
      exit_conditions: { box_inventory_complete: true, pp_sync_complete: true },
      blocking_conditions: { source_auth_failed: true },
      approval_required: false
    },
    {
      state_key: "proof_map_started",
      state_name: "Proof Map Started",
      sort_order: 30,
      entry_conditions: { sources_hydrated: true },
      exit_conditions: { issues_created: true, proof_requirements_created: true },
      blocking_conditions: { critical_docs_unreadable: true },
      approval_required: false
    },
    {
      state_key: "packet_strategy_selected",
      state_name: "Packet Strategy Selected",
      sort_order: 40,
      entry_conditions: { proof_map_started: true },
      exit_conditions: { branch_instances_present: true, packet_policy_selected: true },
      blocking_conditions: { issue_scope_unclear: true },
      approval_required: false
    },
    {
      state_key: "exhibit_build_in_progress",
      state_name: "Exhibit Build In Progress",
      sort_order: 50,
      entry_conditions: { packet_strategy_selected: true },
      exit_conditions: { proposed_exhibits_exist: true },
      blocking_conditions: { critical_missing_proof: true },
      approval_required: false
    },
    {
      state_key: "bates_review_ready",
      state_name: "Bates Review Ready",
      sort_order: 60,
      entry_conditions: { proposed_exhibits_exist: true },
      exit_conditions: { bates_review_approved: true },
      blocking_conditions: { regression_failures_present: true },
      approval_required: true
    },
    {
      state_key: "bates_locked",
      state_name: "Bates Locked",
      sort_order: 70,
      entry_conditions: { bates_review_approved: true },
      exit_conditions: { bates_run_complete: true, citations_propagated: true },
      blocking_conditions: { citation_propagation_failed: true },
      approval_required: false
    },
    {
      state_key: "artifacts_generated",
      state_name: "Artifacts Generated",
      sort_order: 80,
      entry_conditions: { bates_locked: true },
      exit_conditions: { required_artifacts_complete: true },
      blocking_conditions: { artifact_render_failed: true },
      approval_required: false
    },
    {
      state_key: "final_review_ready",
      state_name: "Final Review Ready",
      sort_order: 90,
      entry_conditions: { required_artifacts_complete: true },
      exit_conditions: { final_review_approved: true },
      blocking_conditions: { critical_open_questions: true },
      approval_required: true
    },
    {
      state_key: "finalized",
      state_name: "Finalized",
      sort_order: 100,
      entry_conditions: { final_review_approved: true },
      exit_conditions: {},
      blocking_conditions: {},
      approval_required: false
    }
  ] as const;

  const approvalRows = [
    {
      gate_key: "proof_map_review",
      gate_name: "Proof Map Review",
      gate_policy: {
        requires_human: true,
        must_review: ["issues", "proof_requirements", "critical_missing_proof", "branch_selection"]
      }
    },
    {
      gate_key: "packet_strategy_review",
      gate_name: "Packet Strategy Review",
      gate_policy: {
        requires_human: true,
        must_review: ["packet_policy", "included_exhibits", "excluded_candidates", "close_calls", "joint_exhibit_decision"]
      }
    },
    {
      gate_key: "bates_lock_review",
      gate_name: "Bates Lock Review",
      gate_policy: {
        requires_human: true,
        must_review: ["proposed_bates_map", "regression_results", "duplicate_exhibit_check", "packet_page_count"]
      }
    },
    {
      gate_key: "artifact_review",
      gate_name: "Artifact Review",
      gate_policy: {
        requires_human: true,
        must_review: ["hearing_memo", "opening_notes", "witness_outlines", "artifact_citations"]
      }
    },
    {
      gate_key: "final_publish_review",
      gate_name: "Final Publish Review",
      gate_policy: {
        requires_human: true,
        must_review: ["combined_exhibit_pdf", "final_artifact_versions", "run_manifest", "remaining_blockers"]
      }
    }
  ] as const;

  const artifactRows = [
    {
      artifact_key: "issue_map",
      artifact_name: "Issue Map",
      output_format: "json",
      template_source: "internal:issue_map_v1",
      required_inputs: ["issues", "proof_requirements", "issue_evidence_links"],
      approval_gate_key: null
    },
    {
      artifact_key: "claims_summary",
      artifact_name: "Claims Summary",
      output_format: "markdown",
      template_source: "internal:claims_summary_v1",
      required_inputs: ["issues", "branch_instances", "missing_proof"],
      approval_gate_key: null
    },
    {
      artifact_key: "exhibit_list",
      artifact_name: "Exhibit List",
      output_format: "markdown",
      template_source: "internal:exhibit_list_v1",
      required_inputs: ["exhibits", "exhibit_page_instances"],
      approval_gate_key: null
    },
    {
      artifact_key: "hearing_memo",
      artifact_name: "Hearing Memo",
      output_format: "markdown",
      template_source: "internal:hearing_memo_v1",
      required_inputs: ["issues", "facts", "assertions", "artifact_citations"],
      approval_gate_key: "artifact_review"
    },
    {
      artifact_key: "opening_notes",
      artifact_name: "Opening Notes",
      output_format: "markdown",
      template_source: "internal:opening_notes_v1",
      required_inputs: ["issues", "assertions", "artifact_citations"],
      approval_gate_key: "artifact_review"
    },
    {
      artifact_key: "witness_outlines",
      artifact_name: "Witness Outlines",
      output_format: "json",
      template_source: "internal:witness_outlines_v1",
      required_inputs: ["issues", "facts", "assertions", "exhibits"],
      approval_gate_key: "artifact_review"
    },
    {
      artifact_key: "combined_exhibit_packet",
      artifact_name: "Combined Exhibit Packet",
      output_format: "pdf",
      template_source: "internal:combined_exhibit_packet_v1",
      required_inputs: ["exhibits", "exhibit_page_instances", "bates_run"],
      approval_gate_key: "final_publish_review"
    },
    {
      artifact_key: "readiness_checklist",
      artifact_name: "Readiness Checklist",
      output_format: "markdown",
      template_source: "internal:readiness_checklist_v1",
      required_inputs: ["issues", "missing_proof", "approval_gates", "branch_instances"],
      approval_gate_key: null
    }
  ] as const;

  const rulepackRows = [
    {
      version: "v1",
      rule_type: "artifact_policy",
      rule_key: "required_artifacts",
      rule_value: [
        "issue_map",
        "claims_summary",
        "exhibit_list",
        "hearing_memo",
        "opening_notes",
        "witness_outlines",
        "combined_exhibit_packet",
        "readiness_checklist"
      ]
    },
    {
      version: "v1",
      rule_type: "source_policy",
      rule_key: "never_auto_exhibit",
      rule_value: ["Deposition Transcript", "Pretrial Statement", "Claim Petition", "Hearing Notice", "Settlement Only"]
    },
    {
      version: "v1",
      rule_type: "packet_policy",
      rule_key: "default_packet_mode",
      rule_value: "branch_driven"
    },
    {
      version: "v1",
      rule_type: "finalize_policy",
      rule_key: "required_regression_checks",
      rule_value: [
        "excluded_exhibit_check",
        "duplicate_exhibit_check",
        "packet_policy_check",
        "bates_integrity_check",
        "citation_range_check",
        "ocr_blocker_check",
        "intervenor_completeness_check",
        "artifact_citation_presence_check"
      ]
    }
  ] as const;

  const transitionRows = [
    {
      from_stage_key: "issue_identified",
      to_stage_key: "core_treating_proof_located",
      transition_label: "Core treatment proof found",
      trigger_type: "document",
      trigger_condition: {
        required_document_types_present: ["Treatment Order", "Narrative Report or Key Office Note"]
      },
      blocking_condition: null
    },
    {
      from_stage_key: "core_treating_proof_located",
      to_stage_key: "stale_proof_review",
      transition_label: "Treating proof reviewed for freshness",
      trigger_type: "system",
      trigger_condition: { stale_proof_check_completed: true },
      blocking_condition: null
    },
    {
      from_stage_key: "stale_proof_review",
      to_stage_key: "intervenor_review",
      transition_label: "Intervenor relevance assessed",
      trigger_type: "system",
      trigger_condition: { intervenor_check_completed: true },
      blocking_condition: null
    },
    {
      from_stage_key: "intervenor_review",
      to_stage_key: "compact_packet_review",
      transition_label: "Packet compactness evaluated",
      trigger_type: "system",
      trigger_condition: { packet_policy_check_completed: true },
      blocking_condition: null
    },
    {
      from_stage_key: "compact_packet_review",
      to_stage_key: "assembly_ready",
      transition_label: "Packet ready for assembly",
      trigger_type: "approval",
      trigger_condition: { packet_strategy_review_approved: true },
      blocking_condition: null
    },
    {
      from_stage_key: "assembly_ready",
      to_stage_key: "bates_locked",
      transition_label: "Bates lock completed",
      trigger_type: "system",
      trigger_condition: { bates_run_complete: true, citations_propagated: true },
      blocking_condition: null
    },
    {
      from_stage_key: "bates_locked",
      to_stage_key: "branch_complete",
      transition_label: "Medical request packet complete",
      trigger_type: "approval",
      trigger_condition: { artifact_review_approved: true, final_publish_review_approved: true },
      blocking_condition: null
    }
  ] as const;

  const requirementRows = [
    {
      stage_key: "core_treating_proof_located",
      requirement_type: "document_type",
      requirement_key: "Treatment Order",
      requirement_policy: "blocking_if_missing",
      rationale: "Core treatment-request proof"
    },
    {
      stage_key: "core_treating_proof_located",
      requirement_type: "document_type",
      requirement_key: "Narrative Report",
      requirement_policy: "required_or_substitute",
      rationale: "Preferred treating support"
    },
    {
      stage_key: "core_treating_proof_located",
      requirement_type: "document_type",
      requirement_key: "Office Note",
      requirement_policy: "required_or_substitute",
      rationale: "Acceptable substitute if narrative is absent but issue support is sufficient"
    },
    {
      stage_key: "intervenor_review",
      requirement_type: "document_type",
      requirement_key: "Intervention Notice",
      requirement_policy: "recommended",
      rationale: "Needed when reimbursement is live"
    },
    {
      stage_key: "compact_packet_review",
      requirement_type: "approval",
      requirement_key: "packet_strategy_review",
      requirement_policy: "required",
      rationale: "Compact packet policy must be reviewed before assembly"
    }
  ] as const;

  const slaRows = [
    { stage_key: "core_treating_proof_located", target_hours: 24, warning_hours: 48, critical_hours: 96 },
    { stage_key: "stale_proof_review", target_hours: 8, warning_hours: 24, critical_hours: 48 },
    { stage_key: "intervenor_review", target_hours: 8, warning_hours: 24, critical_hours: 72 },
    { stage_key: "compact_packet_review", target_hours: 8, warning_hours: 24, critical_hours: 48 },
    { stage_key: "assembly_ready", target_hours: 8, warning_hours: 24, critical_hours: 48 }
  ] as const;

  const normalizedDocumentTypes = new Map<string, SeedDocumentType>();
  const baseDocumentTypes = [
    ...documentTypeSeeds.map((documentType) => ({
      canonical_name: documentType.canonical_name,
      category: documentType.category,
      target_folder: documentType.target_folder ?? null,
      exhibit_policy: documentType.exhibit_policy,
      exhibit_eligible: documentType.exhibit_eligible !== false &&
        String(documentType.exhibit_policy) !== "never_exhibit",
      default_priority: documentType.default_priority ?? 50,
      hearing_relevance: documentType.hearing_relevance ?? null,
      extraction_schema: "extraction_schema" in documentType
        ? (documentType as Record<string, unknown>).extraction_schema as string | null
        : null
    })),
    {
      canonical_name: "Provider Records",
      category: "medical_records",
      target_folder: "medical/provider-records",
      exhibit_policy: "normal",
      exhibit_eligible: true,
      default_priority: 40,
      hearing_relevance: "branch_core"
    },
    {
      canonical_name: "Intervention Notice",
      category: "court_documents",
      target_folder: "court/intervenor",
      exhibit_policy: "normal",
      exhibit_eligible: true,
      default_priority: 45,
      hearing_relevance: "branch_context"
    },
    {
      canonical_name: "Motion to Intervene",
      category: "court_documents",
      target_folder: "court/intervenor",
      exhibit_policy: "normal",
      exhibit_eligible: true,
      default_priority: 45,
      hearing_relevance: "branch_context"
    },
    {
      canonical_name: "Retainer",
      category: "other",
      target_folder: "admin",
      exhibit_policy: "reference_only",
      exhibit_eligible: false,
      default_priority: 60,
      hearing_relevance: "branch_context"
    },
    {
      canonical_name: "Wage Statement",
      category: "other",
      target_folder: "wage-loss",
      exhibit_policy: "normal",
      exhibit_eligible: true,
      default_priority: 60,
      hearing_relevance: "reference_only"
    },
    {
      canonical_name: "Mileage Exhibit",
      category: "other",
      target_folder: "expenses",
      exhibit_policy: "normal",
      exhibit_eligible: true,
      default_priority: 60,
      hearing_relevance: "reference_only"
    },
    {
      canonical_name: "Out-of-Pocket Packet",
      category: "other",
      target_folder: "expenses",
      exhibit_policy: "normal",
      exhibit_eligible: true,
      default_priority: 70,
      hearing_relevance: "reference_only"
    },
    {
      canonical_name: "Job Log",
      category: "other",
      target_folder: "wage-loss",
      exhibit_policy: "normal",
      exhibit_eligible: true,
      default_priority: 70,
      hearing_relevance: "reference_only"
    },
    {
      canonical_name: "Broad Medical Chronology",
      category: "medical_records",
      target_folder: "medical",
      exhibit_policy: "reference_only",
      exhibit_eligible: false,
      default_priority: 65,
      hearing_relevance: "reference_only"
    },
    {
      canonical_name: "Pretrial Statement",
      category: "court_documents",
      target_folder: "court",
      exhibit_policy: "reference_only",
      exhibit_eligible: false,
      default_priority: 65,
      hearing_relevance: "reference_only"
    },
    {
      canonical_name: "Claim Petition",
      category: "court_documents",
      target_folder: "court",
      exhibit_policy: "reference_only",
      exhibit_eligible: false,
      default_priority: 65,
      hearing_relevance: "reference_only"
    },
    {
      canonical_name: "Hearing Notice",
      category: "court_documents",
      target_folder: "court",
      exhibit_policy: "reference_only",
      exhibit_eligible: false,
      default_priority: 30,
      hearing_relevance: "case_support"
    },
    {
      canonical_name: "Settlement Only",
      category: "other",
      target_folder: "settlement",
      exhibit_policy: "never_exhibit",
      exhibit_eligible: false,
      default_priority: 80,
      hearing_relevance: "excluded_by_default"
    }
  ] satisfies SeedDocumentType[];

  for (const row of baseDocumentTypes) {
    normalizedDocumentTypes.set(row.canonical_name, row);
  }

  const normalizedAliases = new Map<string, SeedDocumentAlias>();
  const baseAliases = [
    ...documentTypeAliasSeeds.map((alias) => ({
      canonical_name: alias.canonical_name,
      alias_pattern: alias.alias_pattern,
      match_mode: alias.match_mode,
      priority: 50
    })),
    { canonical_name: "Treatment Order", alias_pattern: "treatment order", match_mode: "contains", priority: 10 },
    { canonical_name: "Treatment Order", alias_pattern: "treatment request", match_mode: "contains", priority: 15 },
    { canonical_name: "Narrative Report", alias_pattern: "narrative report", match_mode: "contains", priority: 10 },
    { canonical_name: "Office Note", alias_pattern: "key office note", match_mode: "contains", priority: 10 },
    { canonical_name: "Provider Records", alias_pattern: "provider records", match_mode: "contains", priority: 20 },
    { canonical_name: "Intervention Notice", alias_pattern: "intervention notice", match_mode: "contains", priority: 20 },
    { canonical_name: "Motion to Intervene", alias_pattern: "motion to intervene", match_mode: "contains", priority: 20 },
    { canonical_name: "Retainer", alias_pattern: "retainer", match_mode: "contains", priority: 30 },
    { canonical_name: "Wage Statement", alias_pattern: "wage statement", match_mode: "contains", priority: 30 },
    { canonical_name: "Mileage Exhibit", alias_pattern: "mileage", match_mode: "contains", priority: 40 },
    { canonical_name: "Out-of-Pocket Packet", alias_pattern: "out of pocket", match_mode: "contains", priority: 40 },
    { canonical_name: "Job Log", alias_pattern: "job log", match_mode: "contains", priority: 40 },
    { canonical_name: "Broad Medical Chronology", alias_pattern: "medical chronology", match_mode: "contains", priority: 40 },
    { canonical_name: "Pretrial Statement", alias_pattern: "pretrial statement", match_mode: "contains", priority: 40 },
    { canonical_name: "Claim Petition", alias_pattern: "claim petition", match_mode: "contains", priority: 40 },
    { canonical_name: "Hearing Notice", alias_pattern: "hearing notice", match_mode: "contains", priority: 20 },
    { canonical_name: "Settlement Only", alias_pattern: "settlement", match_mode: "contains", priority: 50 }
  ] satisfies SeedDocumentAlias[];

  for (const alias of baseAliases) {
    normalizedAliases.set(
      `${alias.canonical_name}::${alias.alias_pattern.toLowerCase()}::${alias.match_mode}`,
      alias
    );
  }

  const documentTypeRuleRows = [
    {
      canonical_name: "NOID",
      rule_type: "on_ingest",
      rule_key: "set_priority",
      rule_value: { default_priority: 10 }
    },
    {
      canonical_name: "Treatment Order",
      rule_type: "extraction",
      rule_key: "route",
      rule_value: { schema: "medical_request_order_v1" }
    },
    {
      canonical_name: "Narrative Report",
      rule_type: "extraction",
      rule_key: "route",
      rule_value: { schema: "medical_narrative_v1" }
    },
    {
      canonical_name: "Office Note",
      rule_type: "extraction",
      rule_key: "route",
      rule_value: { schema: "office_note_v1" }
    },
    {
      canonical_name: "Deposition Transcript",
      rule_type: "source_policy",
      rule_key: "auto_offer_as_exhibit",
      rule_value: false
    },
    {
      canonical_name: "Settlement Only",
      rule_type: "source_policy",
      rule_key: "auto_offer_as_exhibit",
      rule_value: false
    }
  ] as const;

  db.transaction(() => {
    const insertPreset = db.prepare(`
      INSERT INTO product_presets
        (id, key, name, description, source_policy, compact_default, active, created_at)
      VALUES
        (@id, @key, @name, @description, @source_policy, @compact_default, @active, @created_at)
      ON CONFLICT(key) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        source_policy = excluded.source_policy,
        compact_default = excluded.compact_default,
        active = excluded.active
    `);

    const insertWorkflow = db.prepare(`
      INSERT INTO product_workflows
        (id, product_preset_id, state_key, state_name, sort_order, entry_conditions, exit_conditions, blocking_conditions, approval_required)
      VALUES
        (@id, @product_preset_id, @state_key, @state_name, @sort_order, @entry_conditions, @exit_conditions, @blocking_conditions, @approval_required)
      ON CONFLICT(product_preset_id, state_key) DO UPDATE SET
        state_name = excluded.state_name,
        sort_order = excluded.sort_order,
        entry_conditions = excluded.entry_conditions,
        exit_conditions = excluded.exit_conditions,
        blocking_conditions = excluded.blocking_conditions,
        approval_required = excluded.approval_required
    `);

    const insertGate = db.prepare(`
      INSERT INTO approval_gates
        (id, product_preset_id, gate_key, gate_name, gate_policy, sort_order)
      VALUES
        (@id, @product_preset_id, @gate_key, @gate_name, @gate_policy, @sort_order)
      ON CONFLICT(product_preset_id, gate_key) DO UPDATE SET
        gate_name = excluded.gate_name,
        gate_policy = excluded.gate_policy,
        sort_order = excluded.sort_order
    `);

    const insertArtifactTemplate = db.prepare(`
      INSERT INTO artifact_templates
        (id, product_preset_id, artifact_key, artifact_name, output_format, template_source, required_inputs, approval_gate_key)
      VALUES
        (@id, @product_preset_id, @artifact_key, @artifact_name, @output_format, @template_source, @required_inputs, @approval_gate_key)
      ON CONFLICT(product_preset_id, artifact_key) DO UPDATE SET
        artifact_name = excluded.artifact_name,
        output_format = excluded.output_format,
        template_source = excluded.template_source,
        required_inputs = excluded.required_inputs,
        approval_gate_key = excluded.approval_gate_key
    `);

    const insertRulepack = db.prepare(`
      INSERT INTO product_rulepacks
        (id, product_preset_id, version, rule_type, rule_key, rule_value, active, created_at)
      VALUES
        (@id, @product_preset_id, @version, @rule_type, @rule_key, @rule_value, 1, @created_at)
      ON CONFLICT(product_preset_id, version, rule_type, rule_key) DO UPDATE SET
        rule_value = excluded.rule_value,
        active = 1
    `);

    const insertBranch = db.prepare(`
      INSERT INTO branch_templates
        (id, key, name, branch_family, packet_policy, issue_scope_policy, description, active, created_at)
      VALUES
        (@id, @key, @name, @branch_family, @packet_policy, @issue_scope_policy, @description, 1, @created_at)
      ON CONFLICT(key) DO UPDATE SET
        name = excluded.name,
        branch_family = excluded.branch_family,
        packet_policy = excluded.packet_policy,
        issue_scope_policy = excluded.issue_scope_policy,
        description = excluded.description,
        active = 1
    `);

    const insertTransition = db.prepare(`
      INSERT INTO branch_transitions
        (id, branch_template_id, from_stage_key, to_stage_key, transition_label, trigger_type, trigger_condition, blocking_condition, created_at)
      VALUES
        (@id, @branch_template_id, @from_stage_key, @to_stage_key, @transition_label, @trigger_type, @trigger_condition, @blocking_condition, @created_at)
      ON CONFLICT(branch_template_id, from_stage_key, to_stage_key, transition_label) DO UPDATE SET
        trigger_type = excluded.trigger_type,
        trigger_condition = excluded.trigger_condition,
        blocking_condition = excluded.blocking_condition
    `);

    const insertRequirement = db.prepare(`
      INSERT INTO branch_stage_requirements
        (id, branch_template_id, stage_key, requirement_type, requirement_key, requirement_policy, rationale)
      VALUES
        (@id, @branch_template_id, @stage_key, @requirement_type, @requirement_key, @requirement_policy, @rationale)
      ON CONFLICT(branch_template_id, stage_key, requirement_type, requirement_key) DO UPDATE SET
        requirement_policy = excluded.requirement_policy,
        rationale = excluded.rationale
    `);

    const insertSla = db.prepare(`
      INSERT INTO branch_sla_targets
        (id, branch_template_id, stage_key, target_hours, warning_hours, critical_hours)
      VALUES
        (@id, @branch_template_id, @stage_key, @target_hours, @warning_hours, @critical_hours)
      ON CONFLICT(branch_template_id, stage_key) DO UPDATE SET
        target_hours = excluded.target_hours,
        warning_hours = excluded.warning_hours,
        critical_hours = excluded.critical_hours
    `);

    const insertDocType = db.prepare(`
      INSERT INTO document_types
        (id, canonical_name, category, target_folder, exhibit_eligible, exhibit_policy, extraction_schema, default_priority, hearing_relevance, active)
      VALUES
        (@id, @canonical_name, @category, @target_folder, @exhibit_eligible, @exhibit_policy, @extraction_schema, @default_priority, @hearing_relevance, 1)
      ON CONFLICT(canonical_name) DO UPDATE SET
        category = excluded.category,
        target_folder = excluded.target_folder,
        exhibit_eligible = excluded.exhibit_eligible,
        exhibit_policy = excluded.exhibit_policy,
        extraction_schema = excluded.extraction_schema,
        default_priority = excluded.default_priority,
        hearing_relevance = excluded.hearing_relevance,
        active = 1
    `);

    const insertAlias = db.prepare(`
      INSERT INTO document_type_aliases
        (id, document_type_id, alias_pattern, match_mode, source, priority, active)
      VALUES
        (@id, @document_type_id, @alias_pattern, @match_mode, 'seed', @priority, 1)
      ON CONFLICT(document_type_id, alias_pattern, match_mode) DO UPDATE SET
        source = 'seed',
        priority = excluded.priority,
        active = 1
    `);

    const insertDocRule = db.prepare(`
      INSERT INTO document_type_rules
        (id, document_type_id, rule_type, rule_key, rule_value, active)
      VALUES
        (@id, @document_type_id, @rule_type, @rule_key, @rule_value, 1)
      ON CONFLICT(document_type_id, rule_type, rule_key) DO UPDATE SET
        rule_value = excluded.rule_value,
        active = 1
    `);

    const presetId = getIdByKey("product_presets", "key", hearingPrepPreset.key) ?? randomUUID();
    insertPreset.run({
      id: presetId,
      key: hearingPrepPreset.key,
      name: hearingPrepPreset.name,
      description: hearingPrepPreset.description,
      source_policy: JSON.stringify({
        ...hearingPrepPreset.source_policy,
        conditionally_allowed_source_classes: ["depositions", "pretrial_materials", "reference_only_materials"],
        excluded_source_classes_by_default: ["settlement_only_docs", "mediation_statements", "internal_strategy_only_notes"]
      }),
      compact_default: hearingPrepPreset.compact_default ? 1 : 0,
      active: hearingPrepPreset.active ? 1 : 0,
      created_at: createdAt
    });

    for (const row of workflowRows) {
      const id =
        getIdByQuery(
          `SELECT id FROM product_workflows WHERE product_preset_id = ? AND state_key = ? LIMIT 1`,
          presetId,
          row.state_key
        ) ?? randomUUID();

      insertWorkflow.run({
        id,
        product_preset_id: presetId,
        state_key: row.state_key,
        state_name: row.state_name,
        sort_order: row.sort_order,
        entry_conditions: JSON.stringify(row.entry_conditions),
        exit_conditions: JSON.stringify(row.exit_conditions),
        blocking_conditions: JSON.stringify(row.blocking_conditions),
        approval_required: row.approval_required ? 1 : 0
      });
    }

    approvalRows.forEach((row, index) => {
      const id =
        getIdByQuery(
          `SELECT id FROM approval_gates WHERE product_preset_id = ? AND gate_key = ? LIMIT 1`,
          presetId,
          row.gate_key
        ) ?? randomUUID();

      insertGate.run({
        id,
        product_preset_id: presetId,
        gate_key: row.gate_key,
        gate_name: row.gate_name,
        gate_policy: JSON.stringify(row.gate_policy),
        sort_order: (index + 1) * 10
      });
    });

    for (const row of artifactRows) {
      const id =
        getIdByQuery(
          `SELECT id FROM artifact_templates WHERE product_preset_id = ? AND artifact_key = ? LIMIT 1`,
          presetId,
          row.artifact_key
        ) ?? randomUUID();

      insertArtifactTemplate.run({
        id,
        product_preset_id: presetId,
        artifact_key: row.artifact_key,
        artifact_name: row.artifact_name,
        output_format: row.output_format,
        template_source: row.template_source,
        required_inputs: JSON.stringify(row.required_inputs),
        approval_gate_key: row.approval_gate_key
      });
    }

    for (const row of rulepackRows) {
      const id =
        getIdByQuery(
          `SELECT id FROM product_rulepacks WHERE product_preset_id = ? AND version = ? AND rule_type = ? AND rule_key = ? LIMIT 1`,
          presetId,
          row.version,
          row.rule_type,
          row.rule_key
        ) ?? randomUUID();

      insertRulepack.run({
        id,
        product_preset_id: presetId,
        version: row.version,
        rule_type: row.rule_type,
        rule_key: row.rule_key,
        rule_value: JSON.stringify(row.rule_value),
        created_at: createdAt
      });
    }

    const blueprintTablesReady =
      Boolean(
        db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'blueprints' LIMIT 1`).get()
      ) &&
      Boolean(
        db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'blueprint_versions' LIMIT 1`).get()
      );

    if (blueprintTablesReady) {
      const insertBlueprint = db.prepare(`
        INSERT INTO blueprints
          (id, blueprint_key, package_type, name, description, execution_engine, product_preset_id, created_at, updated_at)
        VALUES
          (@id, @blueprint_key, @package_type, @name, @description, @execution_engine, @product_preset_id, @created_at, @updated_at)
        ON CONFLICT(blueprint_key) DO UPDATE SET
          package_type = excluded.package_type,
          name = excluded.name,
          description = excluded.description,
          execution_engine = excluded.execution_engine,
          product_preset_id = excluded.product_preset_id,
          updated_at = excluded.updated_at
      `);

      const insertBlueprintVersion = db.prepare(`
        INSERT INTO blueprint_versions
          (
            id,
            blueprint_id,
            version,
            status,
            default_model,
            prompt_contract_json,
            retrieval_profile_json,
            output_contract_json,
            provenance_policy_json,
            evaluation_policy_json,
            linked_rulepack_version,
            linked_workflow_states_json,
            linked_approval_gates_json,
            linked_artifact_templates_json,
            created_at,
            updated_at
          )
        VALUES
          (
            @id,
            @blueprint_id,
            @version,
            @status,
            @default_model,
            @prompt_contract_json,
            @retrieval_profile_json,
            @output_contract_json,
            @provenance_policy_json,
            @evaluation_policy_json,
            @linked_rulepack_version,
            @linked_workflow_states_json,
            @linked_approval_gates_json,
            @linked_artifact_templates_json,
            @created_at,
            @updated_at
          )
        ON CONFLICT(blueprint_id, version) DO UPDATE SET
          status = excluded.status,
          default_model = excluded.default_model,
          prompt_contract_json = excluded.prompt_contract_json,
          retrieval_profile_json = excluded.retrieval_profile_json,
          output_contract_json = excluded.output_contract_json,
          provenance_policy_json = excluded.provenance_policy_json,
          evaluation_policy_json = excluded.evaluation_policy_json,
          linked_rulepack_version = excluded.linked_rulepack_version,
          linked_workflow_states_json = excluded.linked_workflow_states_json,
          linked_approval_gates_json = excluded.linked_approval_gates_json,
          linked_artifact_templates_json = excluded.linked_artifact_templates_json,
          updated_at = excluded.updated_at
      `);

      for (const spec of DEFAULT_BLUEPRINT_SEEDS) {
        const productPresetId = spec.productPresetKey ? getIdByKey("product_presets", "key", spec.productPresetKey) : null;
        const blueprintId = getIdByKey("blueprints", "blueprint_key", spec.key) ?? randomUUID();
        insertBlueprint.run({
          id: blueprintId,
          blueprint_key: spec.key,
          package_type: spec.packageType,
          name: spec.name,
          description: spec.description,
          execution_engine: spec.executionEngine,
          product_preset_id: productPresetId,
          created_at: createdAt,
          updated_at: createdAt
        });

        const linkedWorkflowStates =
          productPresetId &&
          (db
            .prepare(
              `
                SELECT state_key
                FROM product_workflows
                WHERE product_preset_id = ?
                ORDER BY sort_order ASC, state_key ASC
              `
            )
            .all(productPresetId) as Array<{ state_key: string }>).map((row) => row.state_key);

        const linkedApprovalGates =
          productPresetId &&
          (db
            .prepare(
              `
                SELECT gate_key
                FROM approval_gates
                WHERE product_preset_id = ?
                ORDER BY sort_order ASC, gate_key ASC
              `
            )
            .all(productPresetId) as Array<{ gate_key: string }>).map((row) => row.gate_key);

        const linkedArtifactTemplates =
          productPresetId &&
          (db
            .prepare(
              `
                SELECT artifact_key
                FROM artifact_templates
                WHERE product_preset_id = ?
                ORDER BY artifact_key ASC
              `
            )
            .all(productPresetId) as Array<{ artifact_key: string }>).map((row) => row.artifact_key);

        const linkedRulepackVersion =
          productPresetId &&
          ((db
            .prepare(
              `
                SELECT version
                FROM product_rulepacks
                WHERE product_preset_id = ?
                ORDER BY created_at DESC, version DESC
                LIMIT 1
              `
            )
            .get(productPresetId) as { version: string } | undefined)?.version ?? null);

        const blueprintVersionId =
          getIdByQuery(`SELECT id FROM blueprint_versions WHERE blueprint_id = ? AND version = ? LIMIT 1`, blueprintId, spec.version) ??
          randomUUID();

        insertBlueprintVersion.run({
          id: blueprintVersionId,
          blueprint_id: blueprintId,
          version: spec.version,
          status: "active",
          default_model: spec.defaultModel,
          prompt_contract_json: JSON.stringify(spec.promptContract),
          retrieval_profile_json: JSON.stringify(spec.retrievalProfile),
          output_contract_json: JSON.stringify(spec.outputContract),
          provenance_policy_json: JSON.stringify(spec.provenancePolicy),
          evaluation_policy_json: JSON.stringify(spec.evaluationPolicy),
          linked_rulepack_version: linkedRulepackVersion,
          linked_workflow_states_json: JSON.stringify(linkedWorkflowStates ?? []),
          linked_approval_gates_json: JSON.stringify(linkedApprovalGates ?? []),
          linked_artifact_templates_json: JSON.stringify(linkedArtifactTemplates ?? []),
          created_at: createdAt,
          updated_at: createdAt
        });
      }
    }

    const branchId = getIdByKey("branch_templates", "key", medicalRequestBranch.key) ?? randomUUID();
    insertBranch.run({
      id: branchId,
      key: medicalRequestBranch.key,
      name: medicalRequestBranch.name,
      branch_family: medicalRequestBranch.branch_family,
      packet_policy: medicalRequestBranch.packet_policy,
      issue_scope_policy: medicalRequestBranch.issue_scope_policy,
      description: medicalRequestBranch.description,
      created_at: createdAt
    });

    for (const row of transitionRows) {
      const id =
        getIdByQuery(
          `SELECT id FROM branch_transitions WHERE branch_template_id = ? AND from_stage_key = ? AND to_stage_key = ? AND transition_label = ? LIMIT 1`,
          branchId,
          row.from_stage_key,
          row.to_stage_key,
          row.transition_label
        ) ?? randomUUID();

      insertTransition.run({
        id,
        branch_template_id: branchId,
        from_stage_key: row.from_stage_key,
        to_stage_key: row.to_stage_key,
        transition_label: row.transition_label,
        trigger_type: row.trigger_type,
        trigger_condition: JSON.stringify(row.trigger_condition),
        blocking_condition: row.blocking_condition ? JSON.stringify(row.blocking_condition) : null,
        created_at: createdAt
      });
    }

    for (const row of requirementRows) {
      const id =
        getIdByQuery(
          `SELECT id FROM branch_stage_requirements WHERE branch_template_id = ? AND stage_key = ? AND requirement_type = ? AND requirement_key = ? LIMIT 1`,
          branchId,
          row.stage_key,
          row.requirement_type,
          row.requirement_key
        ) ?? randomUUID();

      insertRequirement.run({
        id,
        branch_template_id: branchId,
        ...row
      });
    }

    for (const row of slaRows) {
      const id =
        getIdByQuery(
          `SELECT id FROM branch_sla_targets WHERE branch_template_id = ? AND stage_key = ? LIMIT 1`,
          branchId,
          row.stage_key
        ) ?? randomUUID();

      insertSla.run({
        id,
        branch_template_id: branchId,
        ...row
      });
    }

    const docTypeIdByName = new Map<string, string>();
    for (const docType of normalizedDocumentTypes.values()) {
      const id = getIdByKey("document_types", "canonical_name", docType.canonical_name) ?? randomUUID();
      docTypeIdByName.set(docType.canonical_name, id);
      insertDocType.run({
        id,
        canonical_name: docType.canonical_name,
        category: docType.category,
        target_folder: docType.target_folder ?? null,
        exhibit_eligible: docType.exhibit_eligible === false ? 0 : 1,
        exhibit_policy: docType.exhibit_policy ?? "normal",
        extraction_schema: docType.extraction_schema ?? null,
        default_priority: docType.default_priority ?? 50,
        hearing_relevance: docType.hearing_relevance ?? null
      });
    }

    for (const alias of normalizedAliases.values()) {
      const documentTypeId = docTypeIdByName.get(alias.canonical_name);
      if (!documentTypeId) continue;

      const id =
        getIdByQuery(
          `SELECT id FROM document_type_aliases WHERE document_type_id = ? AND alias_pattern = ? AND match_mode = ? LIMIT 1`,
          documentTypeId,
          alias.alias_pattern,
          alias.match_mode
        ) ?? randomUUID();

      insertAlias.run({
        id,
        document_type_id: documentTypeId,
        alias_pattern: alias.alias_pattern,
        match_mode: alias.match_mode,
        priority: alias.priority ?? 50
      });
    }

    for (const row of documentTypeRuleRows) {
      const documentTypeId = docTypeIdByName.get(row.canonical_name);
      if (!documentTypeId) continue;

      const id =
        getIdByQuery(
          `SELECT id FROM document_type_rules WHERE document_type_id = ? AND rule_type = ? AND rule_key = ? LIMIT 1`,
          documentTypeId,
          row.rule_type,
          row.rule_key
        ) ?? randomUUID();

      insertDocRule.run({
        id,
        document_type_id: documentTypeId,
        rule_type: row.rule_type,
        rule_key: row.rule_key,
        rule_value: JSON.stringify(row.rule_value)
      });
    }
  })();
}

const DEFAULT_PACKAGE_RULE_SEEDS: Array<{
  package_type: string;
  rule_key: string;
  rule_label: string;
  instructions: string;
  sort_order: number;
}> = [
  {
    package_type: "claim_petition",
    rule_key: "cover_letter",
    rule_label: "Cover letter to WCCA / OAH",
    instructions:
      "Draft a professional cover letter identifying the employee, employer, insurer, docket or claim numbers from the bundle, and listing enclosed materials. Use MN workers' compensation filing conventions.",
    sort_order: 10
  },
  {
    package_type: "claim_petition",
    rule_key: "claim_petition",
    rule_label: "Claim petition body",
    instructions:
      "Frame the petition using Minn. Stat. ch. 176 and applicable rules. Include injury description, causal relationship, benefits sought, and jurisdictional facts drawn only from the retrieval bundle.",
    sort_order: 20
  },
  {
    package_type: "claim_petition",
    rule_key: "intervention_notice",
    rule_label: "Intervention notice",
    instructions:
      "When third-party reimbursement or intervention is active in PP notes or documents, include a concise intervention / joinder notice section with parties and basis.",
    sort_order: 30
  },
  {
    package_type: "claim_petition",
    rule_key: "medical_causation",
    rule_label: "Medical causation support",
    instructions:
      "Identify treating records, narrative reports, or causation opinions in the corpus. Flag missing medical causation documentation before export.",
    sort_order: 40
  },
  {
    package_type: "claim_petition",
    rule_key: "affidavit_of_service",
    rule_label: "Affidavit of service",
    instructions:
      "When required for filing, draft affidavit language with service method and dates consistent with case documents.",
    sort_order: 50
  },
  {
    package_type: "discovery_response",
    rule_key: "objections_core",
    rule_label: "Standard WC discovery objections",
    instructions:
      "Apply objections for relevance, privilege, overbreadth, and undue burden where appropriate. Reserve on form interrogatories where required.",
    sort_order: 10
  },
  {
    package_type: "discovery_response",
    rule_key: "request_by_request",
    rule_label: "Request-by-request responses",
    instructions:
      "Answer each interrogatory or production request separately with citations to documents in the bundle. Note insufficient evidence explicitly.",
    sort_order: 20
  },
  {
    package_type: "discovery_response",
    rule_key: "responsive_docs",
    rule_label: "Responsive document grouping",
    instructions:
      "Group exhibits logically (medical, employment, benefits) and map them to the requests they support.",
    sort_order: 30
  },
  {
    package_type: "hearing_packet",
    rule_key: "readiness_qa",
    rule_label: "Hearing readiness",
    instructions:
      "Confirm exhibit list completeness, page exclusions, OCR review, and finalization before hearing packet export.",
    sort_order: 10
  }
];

/** Idempotent per case: inserts default package_rules rows for all alpha package types. */
export function seedDefaultPackageRulesForCase(db: Database.Database, caseId: string) {
  const ts = nowIso();
  const stmt = db.prepare(`
    INSERT INTO package_rules (id, case_id, package_type, rule_key, rule_label, instructions, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(case_id, package_type, rule_key) DO NOTHING
  `);
  for (const r of DEFAULT_PACKAGE_RULE_SEEDS) {
    stmt.run(randomUUID(), caseId, r.package_type, r.rule_key, r.rule_label, r.instructions, r.sort_order, ts, ts);
  }
}
