import type Database from "better-sqlite3";
import { DEFAULT_MAX_RETRIEVAL_CHARS } from "./retrieval.js";

export const BLUEPRINT_PACKAGE_TYPES = ["hearing_packet", "claim_petition", "discovery_response"] as const;

export type BlueprintPackageType = (typeof BLUEPRINT_PACKAGE_TYPES)[number];

type JsonObject = Record<string, unknown>;

export interface BlueprintSeedSpec {
  key: string;
  packageType: BlueprintPackageType;
  name: string;
  description: string;
  executionEngine: "package_worker";
  productPresetKey: string | null;
  version: string;
  defaultModel: string;
  promptContract: JsonObject;
  retrievalProfile: JsonObject;
  outputContract: JsonObject;
  provenancePolicy: JsonObject;
  evaluationPolicy: JsonObject;
}

type ActiveBlueprintVersionRow = {
  blueprint_id: string;
  blueprint_key: string;
  package_type: string;
  blueprint_name: string;
  blueprint_description: string | null;
  execution_engine: string;
  product_preset_id: string | null;
  product_preset_key: string | null;
  product_preset_name: string | null;
  blueprint_version_id: string;
  blueprint_version: string;
  blueprint_status: string;
  default_model: string | null;
  linked_rulepack_version: string | null;
  linked_workflow_states_json: string | null;
  linked_approval_gates_json: string | null;
  linked_artifact_templates_json: string | null;
  prompt_contract_json: string;
  retrieval_profile_json: string;
  output_contract_json: string;
  provenance_policy_json: string;
  evaluation_policy_json: string;
  created_at: string;
  updated_at: string;
};

export interface ActiveBlueprintVersionSummary {
  blueprint_id: string;
  blueprint_key: string;
  package_type: string;
  blueprint_name: string;
  blueprint_description: string | null;
  execution_engine: string;
  product_preset_id: string | null;
  product_preset_key: string | null;
  product_preset_name: string | null;
  blueprint_version_id: string;
  blueprint_version: string;
  blueprint_status: string;
  default_model: string | null;
  linked_rulepack_version: string | null;
  linked_workflow_states: string[];
  linked_approval_gates: string[];
  linked_artifact_templates: string[];
  prompt_contract: JsonObject;
  retrieval_profile: JsonObject;
  output_contract: JsonObject;
  provenance_policy: JsonObject;
  evaluation_policy: JsonObject;
  created_at: string;
  updated_at: string;
};

const DEFAULT_BLUEPRINT_MODEL = "gpt-4o";

function parseJsonObject(value: string | null | undefined, fallback: JsonObject): JsonObject {
  if (!value) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as JsonObject;
    }
  } catch {
    // ignore malformed JSON and use fallback
  }
  return fallback;
}

function parseJsonStringArray(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
    }
  } catch {
    // ignore malformed JSON and return empty
  }
  return [];
}

export function getDefaultPromptContractForPackageType(packageType: string): JsonObject {
  if (packageType === "hearing_packet") {
    return {
      schema: "package_worker_prompt_contract_v1",
      system_prompt: `You are a Minnesota workers' compensation hearing-prep assistant. Use ONLY the retrieval bundle JSON and hearing packet context supplied by the user. Do not invent facts, dates, judges, exhibits, missing proof, or witness roles.

Output a single JSON object with keys:
- case_profile (object): hearing context, requested relief summary, major risks.
- issue_matrix (array of objects): one row per issue with defense gap, support level, and what proof answers it.
- fact_timeline (array of objects): dated or sequenced facts tied to sources.
- exhibit_catalog (array of objects): proposed exhibit list with why offered and issue proved.
- witness_matrix (array of objects): people/witnesses, what they prove, and risks.
- deadlines_and_requirements (object): deadlines, required filings, unresolved compliance items.
- read_coverage_log (object): what appears covered vs what still needs verification from the file.
- open_questions (array of objects): contradictions, missing proof, OCR/review gaps, legal calls.
- proof_to_relief_graph (array of objects): requested relief, legal elements, supporting proof, and remaining gaps.
- hearing_readiness_checklist (array of { check_id, label, status: "pass"|"fail"|"warn", detail }): operational and proof readiness checks.
- draft_markdown (string): a hearing-prep memo / argument-ready narrative summary.
- citations (array of { claim, source_item_id, canonical_page_id, page_text_excerpt }): cite every material factual assertion.
- qa_checklist (array of { check_id, label, status: "pass"|"fail"|"warn", detail }): package-level QA.

Rules:
- Be explicit when a field is uncertain.
- Put uncertainty in open_questions and checklist warnings instead of guessing.
- Prefer compact, issue-driven outputs over bloated summaries.
- Ground exhibit and witness choices in the actual packet context and retrieved matter evidence.`,
      response_format: "json_object"
    };
  }
  if (packageType === "claim_petition") {
    return {
      schema: "package_worker_prompt_contract_v1",
      system_prompt: `You are a Minnesota workers' compensation paralegal/attorney assistant. The Workers' Compensation Court of Appeals (WCCA) and Office of Administrative Hearings (OAH) filing context applies. Draft ONLY from the retrieval bundle JSON (case_summary, document_summaries, full_documents, pp_context, package_rules). Do not invent facts, dates, providers, or docket numbers.

Output a single JSON object with keys:
- draft_markdown (string): combined draft in markdown with sections --- Cover letter ---, --- Claim petition ---, and optional --- Intervention notice ---, --- Affidavit of service --- when rules/package_rules indicate.
- citations (array of { claim: string, source_item_id: string|null, canonical_page_id: string|null, page_text_excerpt: string }): one entry per material factual assertion tied to a source.
- qa_checklist (array of { check_id: string, label: string, status: "pass"|"fail"|"warn", detail: string }): include medical_causation_document_present (warn if no treating/narrative support found), required_filing_elements (pass/fail), intervention_if_applicable, affidavit_if_required.
- assembly_recommendations (array of { title: string, source_item_ids: string[], rationale: string }): suggested exhibits to attach.
- missing_proof (array of { item: string, severity: "blocker"|"warn" }): e.g. missing medical causation narrative, missing NOID, etc.

Use Minnesota WC practice framing (not California). Cite every factual claim.`,
      response_format: "json_object"
    };
  }
  if (packageType === "discovery_response") {
    return {
      schema: "package_worker_prompt_contract_v1",
      system_prompt: `You are a Minnesota workers' compensation attorney assistant. The uploaded interrogatories or requests for production appear as full text in the retrieval bundle (full_documents). Use ONLY the bundle for facts; flag gaps honestly.

Output a single JSON object with keys:
- draft_markdown (string): markdown with a clear subsection per numbered interrogatory/request (use the same numbering as the discovery set). For each, give a concise proposed response and standard objections where appropriate (relevance, privilege, overbreadth, vagueness) when supported by the rules and facts.
- interrogatory_parse (array of { index: number, label: string, summary: string }): mirror the machine-parsed list you receive in the user message; refine labels if needed.
- citations (same shape as claim_petition).
- qa_checklist (array of { check_id, label, status: "pass"|"fail"|"warn", detail }): include per-request weak_support flags.
- assembly_recommendations (same shape as claim_petition).
- objection_flags (array of { request_index: number, objection: string, basis: string }).

Mark weakly supported answers with qa_checklist status "warn".`,
      response_format: "json_object"
    };
  }
  return {
    schema: "package_worker_prompt_contract_v1",
    system_prompt:
      'You are a Minnesota workers\' compensation legal assistant helping prepare exhibit/hearing packets. Output valid JSON with keys: exhibits (array of { exhibit_label, title, source_item_ids, rationale }), citations (array of { claim, source_item_id, canonical_page_id, page_text_excerpt }), qa_checklist (array of { check_id, label, status: pass|fail|warn, detail }), draft_markdown (optional hearing summary or exhibit overview). Ground answers in the retrieval bundle only.',
    response_format: "json_object"
  };
}

export function getDefaultOutputContractForPackageType(packageType: string): JsonObject {
  if (packageType === "hearing_packet") {
    return {
      schema: "hearing_packet_output_v1",
      top_level_keys: [
        "case_profile",
        "issue_matrix",
        "fact_timeline",
        "exhibit_catalog",
        "witness_matrix",
        "deadlines_and_requirements",
        "read_coverage_log",
        "open_questions",
        "proof_to_relief_graph",
        "hearing_readiness_checklist",
        "draft_markdown",
        "citations",
        "qa_checklist"
      ]
    };
  }
  if (packageType === "claim_petition") {
    return {
      schema: "claim_petition_output_v1",
      top_level_keys: ["draft_markdown", "citations", "qa_checklist", "assembly_recommendations", "missing_proof"]
    };
  }
  if (packageType === "discovery_response") {
    return {
      schema: "discovery_response_output_v1",
      top_level_keys: ["draft_markdown", "interrogatory_parse", "citations", "qa_checklist", "assembly_recommendations", "objection_flags"]
    };
  }
  return {
    schema: "generic_package_output_v1",
    top_level_keys: ["draft_markdown", "citations", "qa_checklist"]
  };
}

export function getDefaultRetrievalProfileForPackageType(packageType: string): JsonObject {
  return {
    schema: "package_worker_retrieval_profile_v1",
    max_chars: DEFAULT_MAX_RETRIEVAL_CHARS,
    include_case_summary: true,
    include_document_summaries: true,
    include_full_documents: true,
    include_chunks: true,
    include_pp_context: true,
    include_package_rules: true,
    include_golden_example: true,
    prepend_target_document: true,
    include_hearing_context: packageType === "hearing_packet",
    include_discovery_parse: packageType === "discovery_response"
  };
}

export function getDefaultProvenancePolicyForPackageType(packageType: string): JsonObject {
  return {
    schema: "package_worker_provenance_policy_v1",
    package_type: packageType,
    require_citations: true,
    require_bundle_grounding: true,
    require_qa_checklist: true,
    require_missing_proof: packageType === "claim_petition",
    require_open_questions: packageType === "hearing_packet"
  };
}

export function getDefaultEvaluationPolicyForPackageType(packageType: string): JsonObject {
  return {
    schema: "package_worker_evaluation_policy_v1",
    package_type: packageType,
    golden_fixture_key: packageType,
    qa_gate_required: true
  };
}

export const DEFAULT_BLUEPRINT_SEEDS: BlueprintSeedSpec[] = [
  {
    key: "hearing_packet_default",
    packageType: "hearing_packet",
    name: "Hearing Packet",
    description: "Default hearing-packet package worker blueprint for Minnesota workers' compensation matters.",
    executionEngine: "package_worker",
    productPresetKey: "hearing_prep",
    version: "v1",
    defaultModel: DEFAULT_BLUEPRINT_MODEL,
    promptContract: getDefaultPromptContractForPackageType("hearing_packet"),
    retrievalProfile: getDefaultRetrievalProfileForPackageType("hearing_packet"),
    outputContract: getDefaultOutputContractForPackageType("hearing_packet"),
    provenancePolicy: getDefaultProvenancePolicyForPackageType("hearing_packet"),
    evaluationPolicy: getDefaultEvaluationPolicyForPackageType("hearing_packet")
  },
  {
    key: "claim_petition_default",
    packageType: "claim_petition",
    name: "Claim Petition",
    description: "Default claim-petition drafting blueprint on the package worker path.",
    executionEngine: "package_worker",
    productPresetKey: null,
    version: "v1",
    defaultModel: DEFAULT_BLUEPRINT_MODEL,
    promptContract: getDefaultPromptContractForPackageType("claim_petition"),
    retrievalProfile: getDefaultRetrievalProfileForPackageType("claim_petition"),
    outputContract: getDefaultOutputContractForPackageType("claim_petition"),
    provenancePolicy: getDefaultProvenancePolicyForPackageType("claim_petition"),
    evaluationPolicy: getDefaultEvaluationPolicyForPackageType("claim_petition")
  },
  {
    key: "discovery_response_default",
    packageType: "discovery_response",
    name: "Discovery Response",
    description: "Default discovery-response drafting blueprint on the package worker path.",
    executionEngine: "package_worker",
    productPresetKey: null,
    version: "v1",
    defaultModel: DEFAULT_BLUEPRINT_MODEL,
    promptContract: getDefaultPromptContractForPackageType("discovery_response"),
    retrievalProfile: getDefaultRetrievalProfileForPackageType("discovery_response"),
    outputContract: getDefaultOutputContractForPackageType("discovery_response"),
    provenancePolicy: getDefaultProvenancePolicyForPackageType("discovery_response"),
    evaluationPolicy: getDefaultEvaluationPolicyForPackageType("discovery_response")
  }
];

function mapActiveBlueprintRow(row: ActiveBlueprintVersionRow): ActiveBlueprintVersionSummary {
  return {
    blueprint_id: row.blueprint_id,
    blueprint_key: row.blueprint_key,
    package_type: row.package_type,
    blueprint_name: row.blueprint_name,
    blueprint_description: row.blueprint_description,
    execution_engine: row.execution_engine,
    product_preset_id: row.product_preset_id,
    product_preset_key: row.product_preset_key,
    product_preset_name: row.product_preset_name,
    blueprint_version_id: row.blueprint_version_id,
    blueprint_version: row.blueprint_version,
    blueprint_status: row.blueprint_status,
    default_model: row.default_model,
    linked_rulepack_version: row.linked_rulepack_version,
    linked_workflow_states: parseJsonStringArray(row.linked_workflow_states_json),
    linked_approval_gates: parseJsonStringArray(row.linked_approval_gates_json),
    linked_artifact_templates: parseJsonStringArray(row.linked_artifact_templates_json),
    prompt_contract: parseJsonObject(row.prompt_contract_json, getDefaultPromptContractForPackageType(row.package_type)),
    retrieval_profile: parseJsonObject(row.retrieval_profile_json, getDefaultRetrievalProfileForPackageType(row.package_type)),
    output_contract: parseJsonObject(row.output_contract_json, getDefaultOutputContractForPackageType(row.package_type)),
    provenance_policy: parseJsonObject(
      row.provenance_policy_json,
      getDefaultProvenancePolicyForPackageType(row.package_type)
    ),
    evaluation_policy: parseJsonObject(
      row.evaluation_policy_json,
      getDefaultEvaluationPolicyForPackageType(row.package_type)
    ),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

const ACTIVE_BLUEPRINT_SELECT = `
  SELECT
    b.id AS blueprint_id,
    b.blueprint_key,
    b.package_type,
    b.name AS blueprint_name,
    b.description AS blueprint_description,
    b.execution_engine,
    b.product_preset_id,
    pp.key AS product_preset_key,
    pp.name AS product_preset_name,
    bv.id AS blueprint_version_id,
    bv.version AS blueprint_version,
    bv.status AS blueprint_status,
    bv.default_model,
    bv.linked_rulepack_version,
    bv.linked_workflow_states_json,
    bv.linked_approval_gates_json,
    bv.linked_artifact_templates_json,
    bv.prompt_contract_json,
    bv.retrieval_profile_json,
    bv.output_contract_json,
    bv.provenance_policy_json,
    bv.evaluation_policy_json,
    bv.created_at,
    bv.updated_at
  FROM blueprint_versions bv
  JOIN blueprints b ON b.id = bv.blueprint_id
  LEFT JOIN product_presets pp ON pp.id = b.product_preset_id
`;

export function listActiveBlueprintVersions(db: Database.Database): ActiveBlueprintVersionSummary[] {
  const rows = db
    .prepare(
      `
        ${ACTIVE_BLUEPRINT_SELECT}
        WHERE bv.status = 'active'
        ORDER BY b.package_type ASC
      `
    )
    .all() as ActiveBlueprintVersionRow[];
  return rows.map(mapActiveBlueprintRow);
}

export function resolveBlueprintVersionForPackageType(
  db: Database.Database,
  packageType: string,
  preferredBlueprintVersionId?: string | null
): ActiveBlueprintVersionSummary | null {
  if (preferredBlueprintVersionId) {
    const preferred = db
      .prepare(
        `
          ${ACTIVE_BLUEPRINT_SELECT}
          WHERE bv.id = ?
            AND b.package_type = ?
          LIMIT 1
        `
      )
      .get(preferredBlueprintVersionId, packageType) as ActiveBlueprintVersionRow | undefined;
    if (preferred) {
      return mapActiveBlueprintRow(preferred);
    }
  }

  const active = db
    .prepare(
      `
        ${ACTIVE_BLUEPRINT_SELECT}
        WHERE b.package_type = ?
          AND bv.status = 'active'
        ORDER BY bv.created_at DESC, bv.id DESC
        LIMIT 1
      `
    )
    .get(packageType) as ActiveBlueprintVersionRow | undefined;

  return active ? mapActiveBlueprintRow(active) : null;
}

export function getBlueprintPromptText(summary: ActiveBlueprintVersionSummary | null, packageType: string) {
  const prompt = summary?.prompt_contract.system_prompt;
  if (typeof prompt === "string" && prompt.trim().length > 0) {
    return prompt;
  }
  const fallbackPrompt = getDefaultPromptContractForPackageType(packageType).system_prompt;
  return typeof fallbackPrompt === "string" ? fallbackPrompt : "";
}

export function getBlueprintRetrievalMaxChars(summary: ActiveBlueprintVersionSummary | null) {
  const raw = summary?.retrieval_profile.max_chars;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return DEFAULT_MAX_RETRIEVAL_CHARS;
}

export function isBlueprintRetrievalFlagEnabled(
  summary: ActiveBlueprintVersionSummary | null,
  key: string,
  defaultValue = false
) {
  const raw = summary?.retrieval_profile[key];
  if (typeof raw === "boolean") {
    return raw;
  }
  return defaultValue;
}
