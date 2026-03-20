import type {
  ApprovalGateSeed,
  ArtifactTemplateSeed,
  BranchSlaTargetSeed,
  BranchStageRequirementSeed,
  BranchTemplateSeed,
  BranchTransitionSeed,
  DocumentTypeAliasSeed,
  DocumentTypeRuleSeed,
  DocumentTypeSeed,
  DocumentTypeMatchMode,
  HearingRelevance,
  ProductPresetSeed,
  ProductRulepackSeed,
  ProductWorkflowSeed
} from "@wc/domain-core";

export interface DocumentTypeAliasMatch {
  canonical_name: string;
  document_type: DocumentTypeSeed;
  alias: DocumentTypeAliasSeed;
}

export const hearingPrepPreset: ProductPresetSeed = {
  key: "hearing_prep",
  name: "Hearing Preparation",
  description:
    "Issue-scoped hearing preparation for workers' compensation matters, including evidence mapping, exhibit assembly, hearing artifacts, and readiness checks.",
  source_policy: {
    allowed_source_classes: [
      "box_documents",
      "pp_matter_metadata",
      "pp_notes",
      "pp_tasks",
      "pp_events",
      "pp_attachments",
      "manual_uploads"
    ]
  },
  compact_default: false,
  active: true
};

export const hearingPrepWorkflowSeeds = [
  {
    product_preset_key: hearingPrepPreset.key,
    state_key: "intake_ready",
    state_name: "Intake Ready",
    sort_order: 10,
    entry_conditions: {},
    exit_conditions: {},
    blocking_conditions: {},
    approval_required: false
  },
  {
    product_preset_key: hearingPrepPreset.key,
    state_key: "sources_hydrated",
    state_name: "Sources Hydrated",
    sort_order: 20,
    entry_conditions: {},
    exit_conditions: {},
    blocking_conditions: {},
    approval_required: false
  },
  {
    product_preset_key: hearingPrepPreset.key,
    state_key: "proof_map_started",
    state_name: "Proof Map Started",
    sort_order: 30,
    entry_conditions: {},
    exit_conditions: {},
    blocking_conditions: {},
    approval_required: false
  },
  {
    product_preset_key: hearingPrepPreset.key,
    state_key: "packet_strategy_selected",
    state_name: "Packet Strategy Selected",
    sort_order: 40,
    entry_conditions: {},
    exit_conditions: {},
    blocking_conditions: {},
    approval_required: false
  }
] as const satisfies readonly ProductWorkflowSeed[];

export const hearingPrepApprovalGateSeeds = [
  {
    product_preset_key: hearingPrepPreset.key,
    gate_key: "proof_map_review",
    gate_name: "Proof Map Review",
    gate_policy: { requires_human: true },
    sort_order: 10
  },
  {
    product_preset_key: hearingPrepPreset.key,
    gate_key: "packet_strategy_review",
    gate_name: "Packet Strategy Review",
    gate_policy: { requires_human: true },
    sort_order: 20
  }
] as const satisfies readonly ApprovalGateSeed[];

export const hearingPrepArtifactTemplateSeeds = [
  {
    product_preset_key: hearingPrepPreset.key,
    artifact_key: "issue_map",
    artifact_name: "Issue Map",
    output_format: "json",
    template_source: "internal:issue_map_v1",
    required_inputs: [],
    approval_gate_key: null
  },
  {
    product_preset_key: hearingPrepPreset.key,
    artifact_key: "claims_summary",
    artifact_name: "Claims Summary",
    output_format: "markdown",
    template_source: "internal:claims_summary_v1",
    required_inputs: [],
    approval_gate_key: null
  }
] as const satisfies readonly ArtifactTemplateSeed[];

export const hearingPrepRulepackSeeds = [
  {
    product_preset_key: hearingPrepPreset.key,
    version: "v1",
    rule_type: "packet_policy",
    rule_key: "default_packet_mode",
    rule_value: "branch_driven",
    active: true
  }
] as const satisfies readonly ProductRulepackSeed[];

export const hearingPrepSeedBundle = {
  preset: hearingPrepPreset,
  workflows: hearingPrepWorkflowSeeds,
  approvalGates: hearingPrepApprovalGateSeeds,
  artifactTemplates: hearingPrepArtifactTemplateSeeds,
  rulepacks: hearingPrepRulepackSeeds
} as const;

export const productPresetSeeds = [hearingPrepPreset] as const;

export const medicalRequestBranch: BranchTemplateSeed = {
  key: "medical_request",
  name: "Medical Request Path",
  branch_family: "hearing",
  packet_policy: "compact",
  issue_scope_policy: "tight",
  description:
    "Narrow treatment approval / medical request branch using compact, issue-scoped proof."
};

export const medicalRequestTreatingSupportDocumentTypes = ["Narrative Report", "Office Note"] as const;

export const medicalRequestTransitionSeeds = [
  {
    branch_template_key: medicalRequestBranch.key,
    from_stage_key: "issue_identified",
    to_stage_key: "core_treating_proof_located",
    transition_label: "Core treatment proof found",
    trigger_type: "document",
    trigger_condition: {
      required_document_types_present: ["Treatment Order"],
      required_document_types_any_of: [Array.from(medicalRequestTreatingSupportDocumentTypes)],
      treating_support_note: "Narrative report or key office note satisfies treating support."
    },
    blocking_condition: null
  }
] as const satisfies readonly BranchTransitionSeed[];

export const medicalRequestStageRequirementSeeds = [
  {
    branch_template_key: medicalRequestBranch.key,
    stage_key: "core_treating_proof_located",
    requirement_type: "document_type",
    requirement_key: "Treatment Order",
    requirement_policy: "blocking_if_missing",
    rationale: "Core treatment-request proof."
  },
  {
    branch_template_key: medicalRequestBranch.key,
    stage_key: "core_treating_proof_located",
    requirement_type: "document_type",
    requirement_key: "Narrative Report",
    requirement_policy: "preferred_treating_support",
    rationale: "Preferred treating support when available."
  },
  {
    branch_template_key: medicalRequestBranch.key,
    stage_key: "core_treating_proof_located",
    requirement_type: "document_type",
    requirement_key: "Office Note",
    requirement_policy: "allowed_substitute_for:Narrative Report",
    rationale: "A key office note can satisfy treating support when no narrative report is present."
  }
] as const satisfies readonly BranchStageRequirementSeed[];

export const medicalRequestSlaTargetSeeds = [
  {
    branch_template_key: medicalRequestBranch.key,
    stage_key: "core_treating_proof_located",
    target_hours: 24,
    warning_hours: 48,
    critical_hours: 96
  }
] as const satisfies readonly BranchSlaTargetSeed[];

export const medicalRequestSeedBundle = {
  branchTemplate: medicalRequestBranch,
  transitions: medicalRequestTransitionSeeds,
  stageRequirements: medicalRequestStageRequirementSeeds,
  slaTargets: medicalRequestSlaTargetSeeds,
  treatingSupportDocumentTypes: medicalRequestTreatingSupportDocumentTypes
} as const;

export const branchTemplateSeeds = [medicalRequestBranch] as const;

export const documentTypeSeeds = [
  // ── Medical Records ──────────────────────────────────────────────────
  {
    canonical_name: "Treatment Order",
    category: "medical_records",
    target_folder: "medical/treatment-orders",
    exhibit_policy: "critical_mandatory_ocr",
    exhibit_eligible: true,
    default_priority: 5,
    hearing_relevance: "critical",
    mandatory_vlm_ocr: true,
    active: true
  },
  {
    canonical_name: "Narrative Report",
    category: "medical_records",
    target_folder: "medical/narratives",
    exhibit_policy: "critical_mandatory_ocr",
    exhibit_eligible: true,
    default_priority: 5,
    hearing_relevance: "critical",
    mandatory_vlm_ocr: true,
    active: true
  },
  {
    canonical_name: "Office Note",
    category: "medical_records",
    target_folder: "medical/office-notes",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 20,
    hearing_relevance: "important",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "IME Report",
    category: "medical_records",
    target_folder: "medical/ime",
    exhibit_policy: "critical_mandatory_ocr",
    exhibit_eligible: true,
    default_priority: 3,
    hearing_relevance: "critical",
    mandatory_vlm_ocr: true,
    active: true
  },
  {
    canonical_name: "Medical Records - Office Visit",
    category: "medical_records",
    target_folder: "medical/provider-records/office-visits",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 25,
    hearing_relevance: "important",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Medical Records - ER",
    category: "medical_records",
    target_folder: "medical/provider-records/er",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 15,
    hearing_relevance: "important",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Medical Records - Surgery",
    category: "medical_records",
    target_folder: "medical/provider-records/surgery",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 15,
    hearing_relevance: "important",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Medical Records - Imaging",
    category: "medical_imaging",
    target_folder: "medical/imaging",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 30,
    hearing_relevance: "supporting",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Physical Therapy Note",
    category: "medical_records",
    target_folder: "medical/pt-notes",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 35,
    hearing_relevance: "supporting",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Pharmacy Record",
    category: "medical_records",
    target_folder: "medical/pharmacy",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 45,
    hearing_relevance: "supporting",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Diagnostic Test Result",
    category: "medical_records",
    target_folder: "medical/diagnostics",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 30,
    hearing_relevance: "supporting",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Hospital Discharge Summary",
    category: "medical_records",
    target_folder: "medical/provider-records/hospital",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 20,
    hearing_relevance: "important",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "MMI Notice",
    category: "medical_records",
    target_folder: "medical/mmi",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 10,
    hearing_relevance: "critical",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Medical Chronology",
    category: "medical_records",
    target_folder: "medical/chronology",
    exhibit_policy: "reference_only",
    exhibit_eligible: false,
    default_priority: 50,
    hearing_relevance: "background",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "FCE Report",
    category: "medical_records",
    target_folder: "medical/fce",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 15,
    hearing_relevance: "important",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Provider Records",
    category: "medical_records",
    target_folder: "medical/provider-records",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 30,
    hearing_relevance: "supporting",
    mandatory_vlm_ocr: false,
    active: true
  },
  // ── Medical Billing / Itemized Statements ────────────────────────────
  {
    canonical_name: "Medical Bill",
    category: "itemized_statements",
    target_folder: "billing/medical-bills",
    exhibit_policy: "separate_per_instance",
    exhibit_eligible: true,
    default_priority: 40,
    hearing_relevance: "supporting",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Itemized Statement",
    category: "itemized_statements",
    target_folder: "billing/itemized-statements",
    exhibit_policy: "separate_per_instance",
    exhibit_eligible: true,
    default_priority: 40,
    hearing_relevance: "supporting",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "HCPR",
    category: "itemized_statements",
    target_folder: "billing/hcpr",
    exhibit_policy: "critical_mandatory_ocr",
    exhibit_eligible: true,
    default_priority: 10,
    hearing_relevance: "critical",
    mandatory_vlm_ocr: true,
    active: true
  },
  // ── Court Documents ──────────────────────────────────────────────────
  {
    canonical_name: "NOID",
    category: "court_documents",
    target_folder: "court/noid",
    exhibit_policy: "reference_only",
    exhibit_eligible: false,
    default_priority: 10,
    hearing_relevance: "procedural",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "FROI",
    category: "employer_insurance",
    target_folder: "employer-insurance/froi",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 15,
    hearing_relevance: "important",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "NOPLD",
    category: "court_documents",
    target_folder: "court/nopld",
    exhibit_policy: "reference_only",
    exhibit_eligible: false,
    default_priority: 10,
    hearing_relevance: "procedural",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Claim Petition",
    category: "court_documents",
    target_folder: "court/claim-petition",
    exhibit_policy: "critical_mandatory_ocr",
    exhibit_eligible: false,
    default_priority: 5,
    hearing_relevance: "critical",
    mandatory_vlm_ocr: true,
    active: true
  },
  {
    canonical_name: "Hearing Notice",
    category: "court_documents",
    target_folder: "court/hearing-notice",
    exhibit_policy: "reference_only",
    exhibit_eligible: false,
    default_priority: 10,
    hearing_relevance: "procedural",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Pretrial Statement",
    category: "court_documents",
    target_folder: "court/pretrial",
    exhibit_policy: "critical_mandatory_ocr",
    exhibit_eligible: false,
    default_priority: 5,
    hearing_relevance: "critical",
    mandatory_vlm_ocr: true,
    active: true
  },
  {
    canonical_name: "Stipulation",
    category: "court_documents",
    target_folder: "court/stipulations",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 20,
    hearing_relevance: "important",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Order",
    category: "court_documents",
    target_folder: "court/orders",
    exhibit_policy: "critical_mandatory_ocr",
    exhibit_eligible: true,
    default_priority: 8,
    hearing_relevance: "critical",
    mandatory_vlm_ocr: true,
    active: true
  },
  {
    canonical_name: "Award on Stipulation",
    category: "court_documents",
    target_folder: "court/awards",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 12,
    hearing_relevance: "important",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Findings and Order",
    category: "court_documents",
    target_folder: "court/findings-and-orders",
    exhibit_policy: "critical_mandatory_ocr",
    exhibit_eligible: true,
    default_priority: 5,
    hearing_relevance: "critical",
    mandatory_vlm_ocr: true,
    active: true
  },
  // ── Discovery ────────────────────────────────────────────────────────
  {
    canonical_name: "Deposition Transcript",
    category: "discovery",
    target_folder: "discovery/depositions",
    exhibit_policy: "never_exhibit",
    exhibit_eligible: false,
    default_priority: 20,
    hearing_relevance: "important",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Interrogatory Response",
    category: "discovery",
    target_folder: "discovery/interrogatories",
    exhibit_policy: "reference_only",
    exhibit_eligible: false,
    default_priority: 40,
    hearing_relevance: "supporting",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Request for Production",
    category: "discovery",
    target_folder: "discovery/rfp",
    exhibit_policy: "reference_only",
    exhibit_eligible: false,
    default_priority: 45,
    hearing_relevance: "procedural",
    mandatory_vlm_ocr: false,
    active: true
  },
  // ── Intervention / Subrogation ───────────────────────────────────────
  {
    canonical_name: "Intervention Notice",
    category: "intervention_subrogation",
    target_folder: "intervenor/notices",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 25,
    hearing_relevance: "important",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Motion to Intervene",
    category: "intervention_subrogation",
    target_folder: "intervenor/motions",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 25,
    hearing_relevance: "important",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Declination of Intervention",
    category: "intervention_subrogation",
    target_folder: "intervenor/declinations",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 30,
    hearing_relevance: "supporting",
    mandatory_vlm_ocr: false,
    active: true
  },
  // ── QRC / Rehabilitation ─────────────────────────────────────────────
  {
    canonical_name: "QRC Report (RCR)",
    category: "qrc_rehab",
    target_folder: "qrc/rcr",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 20,
    hearing_relevance: "important",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "R2",
    category: "qrc_rehab",
    target_folder: "qrc/r2",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 25,
    hearing_relevance: "supporting",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "R3",
    category: "qrc_rehab",
    target_folder: "qrc/r3",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 25,
    hearing_relevance: "supporting",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Vocational Report",
    category: "qrc_rehab",
    target_folder: "qrc/vocational",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 20,
    hearing_relevance: "important",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Closure Report",
    category: "qrc_rehab",
    target_folder: "qrc/closure",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 30,
    hearing_relevance: "supporting",
    mandatory_vlm_ocr: false,
    active: true
  },
  // ── Wage / Employment ────────────────────────────────────────────────
  {
    canonical_name: "Wage Statement",
    category: "wage_employment",
    target_folder: "wage-loss/wage-statements",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 25,
    hearing_relevance: "important",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Payroll Records",
    category: "wage_employment",
    target_folder: "wage-loss/payroll",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 30,
    hearing_relevance: "supporting",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Employment Records",
    category: "wage_employment",
    target_folder: "wage-loss/employment",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 35,
    hearing_relevance: "supporting",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Job Description",
    category: "wage_employment",
    target_folder: "wage-loss/job-descriptions",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 40,
    hearing_relevance: "supporting",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Job Log",
    category: "wage_employment",
    target_folder: "wage-loss/job-logs",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 40,
    hearing_relevance: "supporting",
    mandatory_vlm_ocr: false,
    active: true
  },
  // ── Case Cost / Expenses ─────────────────────────────────────────────
  {
    canonical_name: "Out-of-Pocket Receipt",
    category: "case_cost",
    target_folder: "expenses/oop",
    exhibit_policy: "separate_per_instance",
    exhibit_eligible: true,
    default_priority: 50,
    hearing_relevance: "supporting",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Mileage Itemization",
    category: "case_cost",
    target_folder: "expenses/mileage",
    exhibit_policy: "separate_per_instance",
    exhibit_eligible: true,
    default_priority: 50,
    hearing_relevance: "supporting",
    mandatory_vlm_ocr: false,
    active: true
  },
  // ── Investigation ────────────────────────────────────────────────────
  {
    canonical_name: "Investigation Report",
    category: "investigation",
    target_folder: "investigation/reports",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 25,
    hearing_relevance: "important",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Safety Data Sheet",
    category: "investigation",
    target_folder: "investigation/safety-data",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 35,
    hearing_relevance: "supporting",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Industrial Hygiene Report",
    category: "investigation",
    target_folder: "investigation/hygiene",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 30,
    hearing_relevance: "supporting",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Incident Report",
    category: "investigation",
    target_folder: "investigation/incident",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 20,
    hearing_relevance: "important",
    mandatory_vlm_ocr: false,
    active: true
  },
  // ── Correspondence ───────────────────────────────────────────────────
  {
    canonical_name: "Correspondence - Attorney",
    category: "correspondence",
    target_folder: "correspondence/attorney",
    exhibit_policy: "strategy_only",
    exhibit_eligible: false,
    default_priority: 60,
    hearing_relevance: "background",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Correspondence - Insurer",
    category: "correspondence",
    target_folder: "correspondence/insurer",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 45,
    hearing_relevance: "supporting",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Correspondence - Employer",
    category: "correspondence",
    target_folder: "correspondence/employer",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 45,
    hearing_relevance: "supporting",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Background Letter",
    category: "correspondence",
    target_folder: "correspondence/background-letters",
    exhibit_policy: "reference_only",
    exhibit_eligible: false,
    default_priority: 55,
    hearing_relevance: "background",
    mandatory_vlm_ocr: false,
    active: true
  },
  // ── Employer / Insurance ─────────────────────────────────────────────
  {
    canonical_name: "Payment History",
    category: "employer_insurance",
    target_folder: "employer-insurance/payment-history",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 30,
    hearing_relevance: "important",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Benefit Summary",
    category: "employer_insurance",
    target_folder: "employer-insurance/benefit-summary",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 30,
    hearing_relevance: "important",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Denial Letter",
    category: "employer_insurance",
    target_folder: "employer-insurance/denials",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 10,
    hearing_relevance: "critical",
    mandatory_vlm_ocr: false,
    active: true
  },
  // ── Client Intake ────────────────────────────────────────────────────
  {
    canonical_name: "Retainer Agreement",
    category: "client_intake",
    target_folder: "intake/retainer",
    exhibit_policy: "never_exhibit",
    exhibit_eligible: false,
    default_priority: 70,
    hearing_relevance: "irrelevant",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Client Intake Form",
    category: "client_intake",
    target_folder: "intake/forms",
    exhibit_policy: "never_exhibit",
    exhibit_eligible: false,
    default_priority: 70,
    hearing_relevance: "background",
    mandatory_vlm_ocr: false,
    active: true
  },
  // ── Authorizations ───────────────────────────────────────────────────
  {
    canonical_name: "Authorization for Release",
    category: "authorizations",
    target_folder: "authorizations/release",
    exhibit_policy: "never_exhibit",
    exhibit_eligible: false,
    default_priority: 65,
    hearing_relevance: "irrelevant",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "HIPAA Authorization",
    category: "authorizations",
    target_folder: "authorizations/hipaa",
    exhibit_policy: "never_exhibit",
    exhibit_eligible: false,
    default_priority: 65,
    hearing_relevance: "irrelevant",
    mandatory_vlm_ocr: false,
    active: true
  },
  // ── Settlement ───────────────────────────────────────────────────────
  {
    canonical_name: "Settlement Agreement",
    category: "settlement",
    target_folder: "settlement/agreements",
    exhibit_policy: "never_exhibit",
    exhibit_eligible: false,
    default_priority: 80,
    hearing_relevance: "irrelevant",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Stipulation for Settlement",
    category: "settlement",
    target_folder: "settlement/stipulations",
    exhibit_policy: "never_exhibit",
    exhibit_eligible: false,
    default_priority: 80,
    hearing_relevance: "irrelevant",
    mandatory_vlm_ocr: false,
    active: true
  },
  // ── Miscellaneous ────────────────────────────────────────────────────
  {
    canonical_name: "Affidavit",
    category: "court_documents",
    target_folder: "court/affidavits",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 20,
    hearing_relevance: "important",
    mandatory_vlm_ocr: false,
    active: true
  },
  {
    canonical_name: "Expert Report",
    category: "medical_records",
    target_folder: "medical/expert-reports",
    exhibit_policy: "critical_mandatory_ocr",
    exhibit_eligible: true,
    default_priority: 8,
    hearing_relevance: "critical",
    mandatory_vlm_ocr: true,
    active: true
  },
  {
    canonical_name: "Peer Review Report",
    category: "medical_records",
    target_folder: "medical/peer-review",
    exhibit_policy: "normal",
    exhibit_eligible: true,
    default_priority: 15,
    hearing_relevance: "important",
    mandatory_vlm_ocr: false,
    active: true
  }
] as const satisfies readonly DocumentTypeSeed[];

export const documentTypeAliasSeeds = [
  // ── Treatment Order ──────────────────────────────────────────────────
  { canonical_name: "Treatment Order", alias_pattern: "treatment order", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Treatment Order", alias_pattern: "medical request order", match_mode: "contains", priority: 95, source: "seed", active: true },
  { canonical_name: "Treatment Order", alias_pattern: "treatment request", match_mode: "contains", priority: 90, source: "seed", active: true },
  // ── Narrative Report ─────────────────────────────────────────────────
  { canonical_name: "Narrative Report", alias_pattern: "narrative report", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Narrative Report", alias_pattern: "narrative", match_mode: "contains", priority: 60, source: "seed", active: true },
  { canonical_name: "Narrative Report", alias_pattern: "narr rpt", match_mode: "contains", priority: 70, source: "seed", active: true },
  // ── Office Note ──────────────────────────────────────────────────────
  { canonical_name: "Office Note", alias_pattern: "office note", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Office Note", alias_pattern: "chart note", match_mode: "contains", priority: 80, source: "seed", active: true },
  { canonical_name: "Office Note", alias_pattern: "clinic note", match_mode: "contains", priority: 80, source: "seed", active: true },
  { canonical_name: "Office Note", alias_pattern: "progress note", match_mode: "contains", priority: 75, source: "seed", active: true },
  // ── IME Report ───────────────────────────────────────────────────────
  { canonical_name: "IME Report", alias_pattern: "ime report", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "IME Report", alias_pattern: "independent medical exam", match_mode: "contains", priority: 95, source: "seed", active: true },
  { canonical_name: "IME Report", alias_pattern: "ime", match_mode: "contains", priority: 60, source: "seed", active: true },
  // ── Medical Records - Office Visit ───────────────────────────────────
  { canonical_name: "Medical Records - Office Visit", alias_pattern: "office visit", match_mode: "contains", priority: 90, source: "seed", active: true },
  { canonical_name: "Medical Records - Office Visit", alias_pattern: "medical records - office", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Medical Records - Office Visit", alias_pattern: "provider visit", match_mode: "contains", priority: 80, source: "seed", active: true },
  // ── Medical Records - ER ─────────────────────────────────────────────
  { canonical_name: "Medical Records - ER", alias_pattern: "emergency room", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Medical Records - ER", alias_pattern: "er records", match_mode: "contains", priority: 95, source: "seed", active: true },
  { canonical_name: "Medical Records - ER", alias_pattern: "er visit", match_mode: "contains", priority: 90, source: "seed", active: true },
  // ── Medical Records - Surgery ────────────────────────────────────────
  { canonical_name: "Medical Records - Surgery", alias_pattern: "surgery record", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Medical Records - Surgery", alias_pattern: "operative report", match_mode: "contains", priority: 95, source: "seed", active: true },
  { canonical_name: "Medical Records - Surgery", alias_pattern: "surgical note", match_mode: "contains", priority: 90, source: "seed", active: true },
  // ── Medical Records - Imaging ────────────────────────────────────────
  { canonical_name: "Medical Records - Imaging", alias_pattern: "imaging report", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Medical Records - Imaging", alias_pattern: "radiology report", match_mode: "contains", priority: 95, source: "seed", active: true },
  { canonical_name: "Medical Records - Imaging", alias_pattern: "mri report", match_mode: "contains", priority: 90, source: "seed", active: true },
  { canonical_name: "Medical Records - Imaging", alias_pattern: "x-ray report", match_mode: "contains", priority: 85, source: "seed", active: true },
  // ── Physical Therapy Note ────────────────────────────────────────────
  { canonical_name: "Physical Therapy Note", alias_pattern: "physical therapy note", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Physical Therapy Note", alias_pattern: "pt note", match_mode: "contains", priority: 85, source: "seed", active: true },
  { canonical_name: "Physical Therapy Note", alias_pattern: "therapy note", match_mode: "contains", priority: 70, source: "seed", active: true },
  // ── Pharmacy Record ──────────────────────────────────────────────────
  { canonical_name: "Pharmacy Record", alias_pattern: "pharmacy record", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Pharmacy Record", alias_pattern: "prescription record", match_mode: "contains", priority: 90, source: "seed", active: true },
  { canonical_name: "Pharmacy Record", alias_pattern: "rx record", match_mode: "contains", priority: 80, source: "seed", active: true },
  // ── Diagnostic Test Result ───────────────────────────────────────────
  { canonical_name: "Diagnostic Test Result", alias_pattern: "diagnostic test", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Diagnostic Test Result", alias_pattern: "lab result", match_mode: "contains", priority: 90, source: "seed", active: true },
  { canonical_name: "Diagnostic Test Result", alias_pattern: "test result", match_mode: "contains", priority: 70, source: "seed", active: true },
  // ── Hospital Discharge Summary ───────────────────────────────────────
  { canonical_name: "Hospital Discharge Summary", alias_pattern: "discharge summary", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Hospital Discharge Summary", alias_pattern: "hospital discharge", match_mode: "contains", priority: 95, source: "seed", active: true },
  { canonical_name: "Hospital Discharge Summary", alias_pattern: "dc summary", match_mode: "contains", priority: 80, source: "seed", active: true },
  // ── MMI Notice ───────────────────────────────────────────────────────
  { canonical_name: "MMI Notice", alias_pattern: "mmi notice", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "MMI Notice", alias_pattern: "maximum medical improvement", match_mode: "contains", priority: 95, source: "seed", active: true },
  { canonical_name: "MMI Notice", alias_pattern: "mmi", match_mode: "contains", priority: 60, source: "seed", active: true },
  // ── Medical Chronology ───────────────────────────────────────────────
  { canonical_name: "Medical Chronology", alias_pattern: "medical chronology", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Medical Chronology", alias_pattern: "med chron", match_mode: "contains", priority: 85, source: "seed", active: true },
  { canonical_name: "Medical Chronology", alias_pattern: "treatment chronology", match_mode: "contains", priority: 80, source: "seed", active: true },
  // ── FCE Report ───────────────────────────────────────────────────────
  { canonical_name: "FCE Report", alias_pattern: "fce report", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "FCE Report", alias_pattern: "functional capacity evaluation", match_mode: "contains", priority: 95, source: "seed", active: true },
  { canonical_name: "FCE Report", alias_pattern: "fce", match_mode: "contains", priority: 60, source: "seed", active: true },
  // ── Provider Records ─────────────────────────────────────────────────
  { canonical_name: "Provider Records", alias_pattern: "provider records", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Provider Records", alias_pattern: "treating physician records", match_mode: "contains", priority: 90, source: "seed", active: true },
  // ── Medical Bill / Itemized Statement ─────────────────────────────────
  { canonical_name: "Medical Bill", alias_pattern: "medical bill", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Medical Bill", alias_pattern: "med bill", match_mode: "contains", priority: 85, source: "seed", active: true },
  { canonical_name: "Medical Bill", alias_pattern: "billing statement", match_mode: "contains", priority: 80, source: "seed", active: true },
  { canonical_name: "Itemized Statement", alias_pattern: "itemized statement", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Itemized Statement", alias_pattern: "itemized bill", match_mode: "contains", priority: 90, source: "seed", active: true },
  { canonical_name: "Itemized Statement", alias_pattern: "itemization", match_mode: "contains", priority: 70, source: "seed", active: true },
  // ── HCPR ─────────────────────────────────────────────────────────────
  { canonical_name: "HCPR", alias_pattern: "hcpr", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "HCPR", alias_pattern: "health care provider report", match_mode: "contains", priority: 95, source: "seed", active: true },
  { canonical_name: "HCPR", alias_pattern: "provider report form", match_mode: "contains", priority: 85, source: "seed", active: true },
  // ── NOID ─────────────────────────────────────────────────────────────
  { canonical_name: "NOID", alias_pattern: "noid", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "NOID", alias_pattern: "notice of intention to discontinue", match_mode: "contains", priority: 95, source: "seed", active: true },
  { canonical_name: "NOID", alias_pattern: "intention to discontinue", match_mode: "contains", priority: 85, source: "seed", active: true },
  // ── FROI ─────────────────────────────────────────────────────────────
  { canonical_name: "FROI", alias_pattern: "froi", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "FROI", alias_pattern: "first report of injury", match_mode: "contains", priority: 95, source: "seed", active: true },
  { canonical_name: "FROI", alias_pattern: "first report", match_mode: "contains", priority: 60, source: "seed", active: true },
  // ── NOPLD ────────────────────────────────────────────────────────────
  { canonical_name: "NOPLD", alias_pattern: "nopld", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "NOPLD", alias_pattern: "notice of primary liability determination", match_mode: "contains", priority: 95, source: "seed", active: true },
  { canonical_name: "NOPLD", alias_pattern: "primary liability determination", match_mode: "contains", priority: 85, source: "seed", active: true },
  // ── Claim Petition ───────────────────────────────────────────────────
  { canonical_name: "Claim Petition", alias_pattern: "claim petition", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Claim Petition", alias_pattern: "petition", match_mode: "contains", priority: 50, source: "seed", active: true },
  { canonical_name: "Claim Petition", alias_pattern: "clm pet", match_mode: "contains", priority: 80, source: "seed", active: true },
  // ── Hearing Notice ───────────────────────────────────────────────────
  { canonical_name: "Hearing Notice", alias_pattern: "hearing notice", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Hearing Notice", alias_pattern: "notice of hearing", match_mode: "contains", priority: 95, source: "seed", active: true },
  { canonical_name: "Hearing Notice", alias_pattern: "hearing calendar", match_mode: "contains", priority: 75, source: "seed", active: true },
  // ── Pretrial Statement ───────────────────────────────────────────────
  { canonical_name: "Pretrial Statement", alias_pattern: "pretrial statement", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Pretrial Statement", alias_pattern: "pre-trial statement", match_mode: "contains", priority: 95, source: "seed", active: true },
  { canonical_name: "Pretrial Statement", alias_pattern: "pretrial", match_mode: "contains", priority: 60, source: "seed", active: true },
  // ── Stipulation ──────────────────────────────────────────────────────
  { canonical_name: "Stipulation", alias_pattern: "stipulation", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Stipulation", alias_pattern: "stip", match_mode: "contains", priority: 60, source: "seed", active: true },
  // ── Order ────────────────────────────────────────────────────────────
  { canonical_name: "Order", alias_pattern: "court order", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Order", alias_pattern: "judge order", match_mode: "contains", priority: 90, source: "seed", active: true },
  { canonical_name: "Order", alias_pattern: "administrative order", match_mode: "contains", priority: 85, source: "seed", active: true },
  // ── Award on Stipulation ─────────────────────────────────────────────
  { canonical_name: "Award on Stipulation", alias_pattern: "award on stipulation", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Award on Stipulation", alias_pattern: "aos", match_mode: "exact", priority: 80, source: "seed", active: true },
  { canonical_name: "Award on Stipulation", alias_pattern: "award stip", match_mode: "contains", priority: 85, source: "seed", active: true },
  // ── Findings and Order ───────────────────────────────────────────────
  { canonical_name: "Findings and Order", alias_pattern: "findings and order", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Findings and Order", alias_pattern: "f&o", match_mode: "contains", priority: 85, source: "seed", active: true },
  { canonical_name: "Findings and Order", alias_pattern: "findings & order", match_mode: "contains", priority: 95, source: "seed", active: true },
  // ── Deposition Transcript ────────────────────────────────────────────
  { canonical_name: "Deposition Transcript", alias_pattern: "deposition transcript", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Deposition Transcript", alias_pattern: "deposition", match_mode: "contains", priority: 60, source: "seed", active: true },
  { canonical_name: "Deposition Transcript", alias_pattern: "depo transcript", match_mode: "contains", priority: 90, source: "seed", active: true },
  // ── Interrogatory Response ───────────────────────────────────────────
  { canonical_name: "Interrogatory Response", alias_pattern: "interrogatory response", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Interrogatory Response", alias_pattern: "interrogatories", match_mode: "contains", priority: 80, source: "seed", active: true },
  { canonical_name: "Interrogatory Response", alias_pattern: "rogs", match_mode: "contains", priority: 70, source: "seed", active: true },
  // ── Request for Production ───────────────────────────────────────────
  { canonical_name: "Request for Production", alias_pattern: "request for production", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Request for Production", alias_pattern: "rfp", match_mode: "contains", priority: 70, source: "seed", active: true },
  { canonical_name: "Request for Production", alias_pattern: "document request", match_mode: "contains", priority: 80, source: "seed", active: true },
  // ── Intervention Notice ──────────────────────────────────────────────
  { canonical_name: "Intervention Notice", alias_pattern: "intervention notice", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Intervention Notice", alias_pattern: "notice of intervention", match_mode: "contains", priority: 95, source: "seed", active: true },
  { canonical_name: "Intervention Notice", alias_pattern: "intervenor notice", match_mode: "contains", priority: 85, source: "seed", active: true },
  // ── Motion to Intervene ──────────────────────────────────────────────
  { canonical_name: "Motion to Intervene", alias_pattern: "motion to intervene", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Motion to Intervene", alias_pattern: "intervention motion", match_mode: "contains", priority: 90, source: "seed", active: true },
  // ── Declination of Intervention ──────────────────────────────────────
  { canonical_name: "Declination of Intervention", alias_pattern: "declination of intervention", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Declination of Intervention", alias_pattern: "intervention declination", match_mode: "contains", priority: 90, source: "seed", active: true },
  { canonical_name: "Declination of Intervention", alias_pattern: "decline to intervene", match_mode: "contains", priority: 85, source: "seed", active: true },
  // ── QRC Report (RCR) ─────────────────────────────────────────────────
  { canonical_name: "QRC Report (RCR)", alias_pattern: "qrc report", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "QRC Report (RCR)", alias_pattern: "rcr", match_mode: "contains", priority: 80, source: "seed", active: true },
  { canonical_name: "QRC Report (RCR)", alias_pattern: "rehabilitation consultation report", match_mode: "contains", priority: 95, source: "seed", active: true },
  // ── R2 ───────────────────────────────────────────────────────────────
  { canonical_name: "R2", alias_pattern: "r-2", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "R2", alias_pattern: "r2 form", match_mode: "contains", priority: 95, source: "seed", active: true },
  { canonical_name: "R2", alias_pattern: "rehab plan", match_mode: "contains", priority: 70, source: "seed", active: true },
  // ── R3 ───────────────────────────────────────────────────────────────
  { canonical_name: "R3", alias_pattern: "r-3", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "R3", alias_pattern: "r3 form", match_mode: "contains", priority: 95, source: "seed", active: true },
  { canonical_name: "R3", alias_pattern: "closure form", match_mode: "contains", priority: 70, source: "seed", active: true },
  // ── Vocational Report ────────────────────────────────────────────────
  { canonical_name: "Vocational Report", alias_pattern: "vocational report", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Vocational Report", alias_pattern: "vocational evaluation", match_mode: "contains", priority: 95, source: "seed", active: true },
  { canonical_name: "Vocational Report", alias_pattern: "voc eval", match_mode: "contains", priority: 80, source: "seed", active: true },
  // ── Closure Report ───────────────────────────────────────────────────
  { canonical_name: "Closure Report", alias_pattern: "closure report", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Closure Report", alias_pattern: "rehab closure", match_mode: "contains", priority: 90, source: "seed", active: true },
  { canonical_name: "Closure Report", alias_pattern: "qrc closure", match_mode: "contains", priority: 85, source: "seed", active: true },
  // ── Wage Statement ───────────────────────────────────────────────────
  { canonical_name: "Wage Statement", alias_pattern: "wage statement", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Wage Statement", alias_pattern: "wage stmt", match_mode: "contains", priority: 85, source: "seed", active: true },
  { canonical_name: "Wage Statement", alias_pattern: "w-2", match_mode: "contains", priority: 70, source: "seed", active: true },
  // ── Payroll Records ──────────────────────────────────────────────────
  { canonical_name: "Payroll Records", alias_pattern: "payroll record", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Payroll Records", alias_pattern: "pay stub", match_mode: "contains", priority: 90, source: "seed", active: true },
  { canonical_name: "Payroll Records", alias_pattern: "payroll", match_mode: "contains", priority: 60, source: "seed", active: true },
  // ── Employment Records ───────────────────────────────────────────────
  { canonical_name: "Employment Records", alias_pattern: "employment record", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Employment Records", alias_pattern: "personnel file", match_mode: "contains", priority: 90, source: "seed", active: true },
  { canonical_name: "Employment Records", alias_pattern: "employment history", match_mode: "contains", priority: 85, source: "seed", active: true },
  // ── Job Description ──────────────────────────────────────────────────
  { canonical_name: "Job Description", alias_pattern: "job description", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Job Description", alias_pattern: "position description", match_mode: "contains", priority: 90, source: "seed", active: true },
  // ── Job Log ──────────────────────────────────────────────────────────
  { canonical_name: "Job Log", alias_pattern: "job log", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Job Log", alias_pattern: "job search log", match_mode: "contains", priority: 95, source: "seed", active: true },
  // ── Out-of-Pocket Receipt ────────────────────────────────────────────
  { canonical_name: "Out-of-Pocket Receipt", alias_pattern: "out-of-pocket", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Out-of-Pocket Receipt", alias_pattern: "oop receipt", match_mode: "contains", priority: 90, source: "seed", active: true },
  { canonical_name: "Out-of-Pocket Receipt", alias_pattern: "out of pocket", match_mode: "contains", priority: 95, source: "seed", active: true },
  // ── Mileage Itemization ──────────────────────────────────────────────
  { canonical_name: "Mileage Itemization", alias_pattern: "mileage itemization", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Mileage Itemization", alias_pattern: "mileage log", match_mode: "contains", priority: 90, source: "seed", active: true },
  { canonical_name: "Mileage Itemization", alias_pattern: "mileage", match_mode: "contains", priority: 50, source: "seed", active: true },
  // ── Investigation Report ─────────────────────────────────────────────
  { canonical_name: "Investigation Report", alias_pattern: "investigation report", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Investigation Report", alias_pattern: "investigative report", match_mode: "contains", priority: 95, source: "seed", active: true },
  { canonical_name: "Investigation Report", alias_pattern: "surveillance report", match_mode: "contains", priority: 85, source: "seed", active: true },
  // ── Safety Data Sheet ────────────────────────────────────────────────
  { canonical_name: "Safety Data Sheet", alias_pattern: "safety data sheet", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Safety Data Sheet", alias_pattern: "sds", match_mode: "exact", priority: 80, source: "seed", active: true },
  { canonical_name: "Safety Data Sheet", alias_pattern: "msds", match_mode: "contains", priority: 85, source: "seed", active: true },
  // ── Industrial Hygiene Report ────────────────────────────────────────
  { canonical_name: "Industrial Hygiene Report", alias_pattern: "industrial hygiene report", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Industrial Hygiene Report", alias_pattern: "industrial hygiene", match_mode: "contains", priority: 80, source: "seed", active: true },
  { canonical_name: "Industrial Hygiene Report", alias_pattern: "ih report", match_mode: "contains", priority: 85, source: "seed", active: true },
  // ── Incident Report ──────────────────────────────────────────────────
  { canonical_name: "Incident Report", alias_pattern: "incident report", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Incident Report", alias_pattern: "accident report", match_mode: "contains", priority: 90, source: "seed", active: true },
  { canonical_name: "Incident Report", alias_pattern: "injury report", match_mode: "contains", priority: 85, source: "seed", active: true },
  // ── Correspondence - Attorney ────────────────────────────────────────
  { canonical_name: "Correspondence - Attorney", alias_pattern: "attorney letter", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Correspondence - Attorney", alias_pattern: "attorney correspondence", match_mode: "contains", priority: 95, source: "seed", active: true },
  { canonical_name: "Correspondence - Attorney", alias_pattern: "ltr to atty", match_mode: "contains", priority: 85, source: "seed", active: true },
  // ── Correspondence - Insurer ─────────────────────────────────────────
  { canonical_name: "Correspondence - Insurer", alias_pattern: "insurer letter", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Correspondence - Insurer", alias_pattern: "insurance correspondence", match_mode: "contains", priority: 95, source: "seed", active: true },
  { canonical_name: "Correspondence - Insurer", alias_pattern: "adjuster letter", match_mode: "contains", priority: 85, source: "seed", active: true },
  // ── Correspondence - Employer ────────────────────────────────────────
  { canonical_name: "Correspondence - Employer", alias_pattern: "employer letter", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Correspondence - Employer", alias_pattern: "employer correspondence", match_mode: "contains", priority: 95, source: "seed", active: true },
  { canonical_name: "Correspondence - Employer", alias_pattern: "ltr from employer", match_mode: "contains", priority: 85, source: "seed", active: true },
  // ── Background Letter ────────────────────────────────────────────────
  { canonical_name: "Background Letter", alias_pattern: "background letter", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Background Letter", alias_pattern: "ime transmittal", match_mode: "contains", priority: 95, source: "seed", active: true },
  { canonical_name: "Background Letter", alias_pattern: "transmittal letter", match_mode: "contains", priority: 80, source: "seed", active: true },
  // ── Payment History ──────────────────────────────────────────────────
  { canonical_name: "Payment History", alias_pattern: "payment history", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Payment History", alias_pattern: "payment log", match_mode: "contains", priority: 90, source: "seed", active: true },
  { canonical_name: "Payment History", alias_pattern: "benefit payment", match_mode: "contains", priority: 75, source: "seed", active: true },
  // ── Benefit Summary ──────────────────────────────────────────────────
  { canonical_name: "Benefit Summary", alias_pattern: "benefit summary", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Benefit Summary", alias_pattern: "benefits summary", match_mode: "contains", priority: 95, source: "seed", active: true },
  { canonical_name: "Benefit Summary", alias_pattern: "comp benefit", match_mode: "contains", priority: 70, source: "seed", active: true },
  // ── Denial Letter ────────────────────────────────────────────────────
  { canonical_name: "Denial Letter", alias_pattern: "denial letter", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Denial Letter", alias_pattern: "denial", match_mode: "contains", priority: 55, source: "seed", active: true },
  { canonical_name: "Denial Letter", alias_pattern: "claim denial", match_mode: "contains", priority: 90, source: "seed", active: true },
  // ── Retainer Agreement ───────────────────────────────────────────────
  { canonical_name: "Retainer Agreement", alias_pattern: "retainer agreement", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Retainer Agreement", alias_pattern: "retainer", match_mode: "contains", priority: 60, source: "seed", active: true },
  { canonical_name: "Retainer Agreement", alias_pattern: "fee agreement", match_mode: "contains", priority: 85, source: "seed", active: true },
  // ── Client Intake Form ───────────────────────────────────────────────
  { canonical_name: "Client Intake Form", alias_pattern: "intake form", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Client Intake Form", alias_pattern: "client intake", match_mode: "contains", priority: 95, source: "seed", active: true },
  { canonical_name: "Client Intake Form", alias_pattern: "new client form", match_mode: "contains", priority: 85, source: "seed", active: true },
  // ── Authorization for Release ────────────────────────────────────────
  { canonical_name: "Authorization for Release", alias_pattern: "authorization for release", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Authorization for Release", alias_pattern: "medical release", match_mode: "contains", priority: 85, source: "seed", active: true },
  { canonical_name: "Authorization for Release", alias_pattern: "release authorization", match_mode: "contains", priority: 90, source: "seed", active: true },
  // ── HIPAA Authorization ──────────────────────────────────────────────
  { canonical_name: "HIPAA Authorization", alias_pattern: "hipaa authorization", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "HIPAA Authorization", alias_pattern: "hipaa", match_mode: "contains", priority: 60, source: "seed", active: true },
  { canonical_name: "HIPAA Authorization", alias_pattern: "hipaa release", match_mode: "contains", priority: 90, source: "seed", active: true },
  // ── Settlement Agreement ─────────────────────────────────────────────
  { canonical_name: "Settlement Agreement", alias_pattern: "settlement agreement", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Settlement Agreement", alias_pattern: "settlement", match_mode: "contains", priority: 50, source: "seed", active: true },
  // ── Stipulation for Settlement ───────────────────────────────────────
  { canonical_name: "Stipulation for Settlement", alias_pattern: "stipulation for settlement", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Stipulation for Settlement", alias_pattern: "settlement stipulation", match_mode: "contains", priority: 90, source: "seed", active: true },
  // ── Affidavit ────────────────────────────────────────────────────────
  { canonical_name: "Affidavit", alias_pattern: "affidavit", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Affidavit", alias_pattern: "sworn statement", match_mode: "contains", priority: 85, source: "seed", active: true },
  // ── Expert Report ────────────────────────────────────────────────────
  { canonical_name: "Expert Report", alias_pattern: "expert report", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Expert Report", alias_pattern: "expert opinion", match_mode: "contains", priority: 90, source: "seed", active: true },
  { canonical_name: "Expert Report", alias_pattern: "expert witness report", match_mode: "contains", priority: 95, source: "seed", active: true },
  // ── Peer Review Report ───────────────────────────────────────────────
  { canonical_name: "Peer Review Report", alias_pattern: "peer review", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Peer Review Report", alias_pattern: "peer review report", match_mode: "contains", priority: 100, source: "seed", active: true },
  { canonical_name: "Peer Review Report", alias_pattern: "utilization review", match_mode: "contains", priority: 85, source: "seed", active: true }
] as const satisfies readonly DocumentTypeAliasSeed[];

export const documentTypeRuleSeeds = [
  // ── Priority overrides for critical ingestion ────────────────────────
  { canonical_name: "NOID", rule_type: "on_ingest", rule_key: "set_priority", rule_value: { default_priority: 10 }, active: true },
  { canonical_name: "IME Report", rule_type: "on_ingest", rule_key: "set_priority", rule_value: { default_priority: 3 }, active: true },
  { canonical_name: "Claim Petition", rule_type: "on_ingest", rule_key: "set_priority", rule_value: { default_priority: 5 }, active: true },
  { canonical_name: "Pretrial Statement", rule_type: "on_ingest", rule_key: "set_priority", rule_value: { default_priority: 5 }, active: true },
  { canonical_name: "Hearing Notice", rule_type: "on_ingest", rule_key: "set_priority", rule_value: { default_priority: 10 }, active: true },
  { canonical_name: "HCPR", rule_type: "on_ingest", rule_key: "set_priority", rule_value: { default_priority: 10 }, active: true },
  { canonical_name: "Denial Letter", rule_type: "on_ingest", rule_key: "set_priority", rule_value: { default_priority: 10 }, active: true },
  // ── Extraction schema routing ────────────────────────────────────────
  { canonical_name: "Treatment Order", rule_type: "extraction", rule_key: "route", rule_value: { schema: "medical_request_order_v1" }, active: true },
  { canonical_name: "Narrative Report", rule_type: "extraction", rule_key: "route", rule_value: { schema: "medical_narrative_v1" }, active: true },
  { canonical_name: "Office Note", rule_type: "extraction", rule_key: "route", rule_value: { schema: "office_note_v1" }, active: true },
  { canonical_name: "IME Report", rule_type: "extraction", rule_key: "route", rule_value: { schema: "ime_report_v1" }, active: true },
  { canonical_name: "Claim Petition", rule_type: "extraction", rule_key: "route", rule_value: { schema: "claim_petition_v1" }, active: true },
  { canonical_name: "Pretrial Statement", rule_type: "extraction", rule_key: "route", rule_value: { schema: "pretrial_statement_v1" }, active: true },
  { canonical_name: "HCPR", rule_type: "extraction", rule_key: "route", rule_value: { schema: "hcpr_v1" }, active: true },
  { canonical_name: "Order", rule_type: "extraction", rule_key: "route", rule_value: { schema: "court_order_v1" }, active: true },
  { canonical_name: "Findings and Order", rule_type: "extraction", rule_key: "route", rule_value: { schema: "findings_and_order_v1" }, active: true },
  { canonical_name: "Expert Report", rule_type: "extraction", rule_key: "route", rule_value: { schema: "expert_report_v1" }, active: true },
  { canonical_name: "QRC Report (RCR)", rule_type: "extraction", rule_key: "route", rule_value: { schema: "qrc_rcr_v1" }, active: true },
  { canonical_name: "Vocational Report", rule_type: "extraction", rule_key: "route", rule_value: { schema: "vocational_report_v1" }, active: true },
  { canonical_name: "FCE Report", rule_type: "extraction", rule_key: "route", rule_value: { schema: "fce_report_v1" }, active: true },
  // ── Source policy: never auto-exhibit ─────────────────────────────────
  { canonical_name: "Deposition Transcript", rule_type: "source_policy", rule_key: "auto_offer_as_exhibit", rule_value: false, active: true },
  { canonical_name: "Retainer Agreement", rule_type: "source_policy", rule_key: "auto_offer_as_exhibit", rule_value: false, active: true },
  { canonical_name: "Authorization for Release", rule_type: "source_policy", rule_key: "auto_offer_as_exhibit", rule_value: false, active: true },
  { canonical_name: "HIPAA Authorization", rule_type: "source_policy", rule_key: "auto_offer_as_exhibit", rule_value: false, active: true },
  { canonical_name: "Settlement Agreement", rule_type: "source_policy", rule_key: "auto_offer_as_exhibit", rule_value: false, active: true },
  { canonical_name: "Stipulation for Settlement", rule_type: "source_policy", rule_key: "auto_offer_as_exhibit", rule_value: false, active: true },
  { canonical_name: "Client Intake Form", rule_type: "source_policy", rule_key: "auto_offer_as_exhibit", rule_value: false, active: true },
  { canonical_name: "Correspondence - Attorney", rule_type: "source_policy", rule_key: "auto_offer_as_exhibit", rule_value: false, active: true },
  // ── Mandatory VLM OCR ────────────────────────────────────────────────
  { canonical_name: "IME Report", rule_type: "on_ingest", rule_key: "mandatory_vlm_ocr", rule_value: true, active: true },
  { canonical_name: "Narrative Report", rule_type: "on_ingest", rule_key: "mandatory_vlm_ocr", rule_value: true, active: true },
  { canonical_name: "Treatment Order", rule_type: "on_ingest", rule_key: "mandatory_vlm_ocr", rule_value: true, active: true },
  { canonical_name: "Pretrial Statement", rule_type: "on_ingest", rule_key: "mandatory_vlm_ocr", rule_value: true, active: true },
  { canonical_name: "Claim Petition", rule_type: "on_ingest", rule_key: "mandatory_vlm_ocr", rule_value: true, active: true },
  { canonical_name: "Order", rule_type: "on_ingest", rule_key: "mandatory_vlm_ocr", rule_value: true, active: true },
  { canonical_name: "HCPR", rule_type: "on_ingest", rule_key: "mandatory_vlm_ocr", rule_value: true, active: true },
  { canonical_name: "Findings and Order", rule_type: "on_ingest", rule_key: "mandatory_vlm_ocr", rule_value: true, active: true },
  { canonical_name: "Expert Report", rule_type: "on_ingest", rule_key: "mandatory_vlm_ocr", rule_value: true, active: true }
] as const satisfies readonly DocumentTypeRuleSeed[];

export const slice01RuleSeedBundle = {
  presets: productPresetSeeds,
  branches: branchTemplateSeeds,
  documentTypes: documentTypeSeeds,
  documentTypeAliases: documentTypeAliasSeeds,
  documentTypeRules: documentTypeRuleSeeds,
  hearingPrep: hearingPrepSeedBundle,
  medicalRequest: medicalRequestSeedBundle
} as const;

const documentTypeSeedMap = new Map<string, DocumentTypeSeed>(
  documentTypeSeeds.map((seed) => [seed.canonical_name, seed])
);

function compareAliasSpecificity(left: DocumentTypeAliasSeed, right: DocumentTypeAliasSeed) {
  const leftPriority = left.priority ?? 50;
  const rightPriority = right.priority ?? 50;
  if (rightPriority !== leftPriority) return rightPriority - leftPriority;
  return right.alias_pattern.length - left.alias_pattern.length;
}

function aliasMatches(filenameLower: string, aliasPatternLower: string, matchMode: DocumentTypeMatchMode) {
  if (matchMode === "exact") return filenameLower === aliasPatternLower;
  if (matchMode === "starts_with") return filenameLower.startsWith(aliasPatternLower);
  return filenameLower.includes(aliasPatternLower);
}

export function getDocumentTypeSeed(canonicalName: string) {
  return documentTypeSeedMap.get(canonicalName) ?? null;
}

export function normalizeFilenameForAliasLookup(filename: string) {
  return filename.trim().toLowerCase();
}

export function matchDocumentTypeAlias(
  filename: string,
  aliases: readonly DocumentTypeAliasSeed[] = documentTypeAliasSeeds
): DocumentTypeAliasMatch | null {
  const filenameLower = normalizeFilenameForAliasLookup(filename);
  if (!filenameLower) return null;

  const activeAliases = aliases
    .filter((alias) => alias.active !== false)
    .slice()
    .sort(compareAliasSpecificity);

  for (const alias of activeAliases) {
    const aliasPatternLower = alias.alias_pattern.toLowerCase();
    if (!aliasMatches(filenameLower, aliasPatternLower, alias.match_mode)) continue;

    const documentType = getDocumentTypeSeed(alias.canonical_name);
    if (!documentType || documentType.active === false) continue;

    return {
      canonical_name: alias.canonical_name,
      document_type: documentType,
      alias
    };
  }

  return null;
}
