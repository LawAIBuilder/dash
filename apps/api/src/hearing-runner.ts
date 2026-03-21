import type Database from "better-sqlite3";
import type {
  ProjectionIssue,
  ProjectionProofRequirement
} from "@wc/domain-core";
import { buildCaseProjection } from "./projection.js";
import { getCaseExhibitWorkspace, getPacketPreview, getPacketSuggestions } from "./exhibits.js";

function countBy<T>(values: T[], toKey: (value: T) => string) {
  return values.reduce<Record<string, number>>((acc, value) => {
    const key = toKey(value);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function identifyByTitle(
  sourceItems: Array<{ id: string; title?: string | null }>,
  pattern: RegExp
) {
  return sourceItems.filter((item) => pattern.test(item.title ?? ""));
}

function uniqueSorted(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value && value.trim())))).sort();
}

export function buildHearingPrepSnapshot(
  db: Database.Database,
  input: { caseId: string; packetId?: string | null }
) {
  const projection = buildCaseProjection(db, input.caseId);
  if (!projection) {
    return null;
  }

  const caseRow = db
    .prepare(
      `
        SELECT
          id,
          name,
          case_type,
          status,
          employee_name,
          employer_name,
          insurer_name,
          judge_name,
          hearing_date,
          hearing_location,
          pp_matter_id,
          box_root_folder_id
        FROM cases
        WHERE id = ?
        LIMIT 1
      `
    )
    .get(input.caseId) as
    | {
        id: string;
        name: string;
        case_type: string;
        status: string;
        employee_name: string | null;
        employer_name: string | null;
        insurer_name: string | null;
        judge_name: string | null;
        hearing_date: string | null;
        hearing_location: string | null;
        pp_matter_id: string | null;
        box_root_folder_id: string | null;
      }
    | undefined;

  if (!caseRow) {
    return null;
  }

  const packets = getCaseExhibitWorkspace(db, input.caseId);
  const packet =
    (input.packetId ? packets.find((candidate) => candidate.id === input.packetId) : null) ??
    packets.find((candidate) => candidate.package_type === "hearing_packet") ??
    packets[0] ??
    null;

  const packetPreview = packet ? getPacketPreview(db, packet.id) : null;
  const packetSuggestions = packet ? getPacketSuggestions(db, packet.id) ?? [] : [];
  const sourceItems = (projection.slices.document_inventory_slice?.source_items ?? []) as Array<{
    id: string;
    provider?: string | null;
    source_kind?: string | null;
    title?: string | null;
    document_type_name?: string | null;
    document_category?: string | null;
  }>;
  const issues = (projection.slices.issue_proof_slice?.issues ?? []) as ProjectionIssue[];
  const proofRequirements = (projection.slices.issue_proof_slice?.proof_requirements ?? []) as ProjectionProofRequirement[];
  const people = projection.slices.case_people_slice?.people ?? [];
  const timeline = projection.slices.case_timeline_slice?.entries ?? [];
  const ocrSummary = projection.slices.document_inventory_slice?.ocr_summary ?? null;

  const narratives = identifyByTitle(sourceItems, /narrative/i);
  const narrativeRequests = identifyByTitle(sourceItems, /narrative request/i);
  const imes = identifyByTitle(sourceItems, /\bime\b|independent medical/i);
  const pretrials = identifyByTitle(sourceItems, /pretrial/i);
  const orders = identifyByTitle(sourceItems, /order|award|decision/i);
  const hearingNotices = identifyByTitle(sourceItems, /hearing notice|notice hearing/i);
  const exhibitLists = identifyByTitle(sourceItems, /exhibit list/i);
  const prepDocs = identifyByTitle(sourceItems, /hearing prep|claims summary|prep memo/i);

  const fileInventory = {
    total_source_items: sourceItems.length,
    by_provider: countBy(sourceItems, (item) => item.provider ?? "unknown"),
    by_source_kind: countBy(sourceItems, (item) => item.source_kind ?? "unknown"),
    by_category: countBy(sourceItems, (item) => item.document_category ?? "uncategorized"),
    by_document_type: countBy(sourceItems, (item) => item.document_type_name ?? "unclassified"),
    unresolved_unclassified_count: sourceItems.filter((item) => !item.document_type_name).length,
    critical_candidates: {
      narratives: narratives.map((item) => item.title ?? item.id),
      narrative_requests: narrativeRequests.map((item) => item.title ?? item.id),
      imes: imes.map((item) => item.title ?? item.id),
      pretrials: pretrials.map((item) => item.title ?? item.id),
      orders: orders.map((item) => item.title ?? item.id),
      hearing_notices: hearingNotices.map((item) => item.title ?? item.id),
      exhibit_lists: exhibitLists.map((item) => item.title ?? item.id),
      prep_docs: prepDocs.map((item) => item.title ?? item.id)
    }
  };

  const caseProfile = {
    case_id: caseRow.id,
    matter_name: caseRow.name,
    case_type: caseRow.case_type,
    status: caseRow.status,
    employee_name: caseRow.employee_name,
    employer_name: caseRow.employer_name,
    insurer_name: caseRow.insurer_name,
    judge_name: caseRow.judge_name,
    hearing_date: caseRow.hearing_date,
    hearing_location: caseRow.hearing_location,
    pp_matter_id: caseRow.pp_matter_id,
    box_root_folder_id: caseRow.box_root_folder_id,
    active_packet_id: packet?.id ?? null,
    active_packet_name: packet?.packet_name ?? null,
    active_packet_status: packet?.status ?? null,
    source_item_count: sourceItems.length,
    review_required_pages: ocrSummary?.review_required_count ?? 0
  };

  const issueMatrix = issues.map((issue) => {
    const requirements = proofRequirements.filter((requirement) => requirement.issue_id === issue.id);
    const missing = requirements.filter((requirement) => requirement.satisfied !== 1);
    return {
      issue_id: issue.id,
      issue_type: issue.issue_type,
      title: issue.issue_type,
      requested_relief: issue.requested_relief ?? null,
      defense_position: issue.defense_position ?? null,
      support_level: missing.length === 0 ? "supported" : "needs_work",
      proof_requirements: requirements.map((requirement) => ({
        requirement_key: requirement.requirement_key,
        requirement_policy: requirement.requirement_policy,
        satisfied: requirement.satisfied === 1,
        rationale: requirement.rationale ?? null
      })),
      missing_requirements: missing.map((requirement) => requirement.requirement_key)
    };
  });

  const factTimeline = timeline.map((entry) => ({
    id: entry.id,
    occurred_at: entry.occurred_at ?? null,
    kind: entry.kind,
    label: entry.label,
    detail: entry.detail ?? null
  }));

  const exhibitCatalog =
    packet?.sections.flatMap((section) =>
      section.exhibits.map((slot) => ({
        section_key: section.section_key,
        section_label: section.section_label,
        exhibit_id: slot.id,
        exhibit_label: slot.exhibit_label,
        title: slot.title ?? `${slot.exhibit_label} Exhibit`,
        item_count: slot.items.length,
        source_titles: slot.items.map((item) => item.source_item_title ?? item.canonical_document_title ?? "Untitled"),
        categories: uniqueSorted(slot.items.map((item) => item.document_category)),
        document_types: uniqueSorted(slot.items.map((item) => item.document_type_name))
      }))
    ) ?? [];

  const witnessMatrix = people.map((person) => ({
    id: person.id,
    name: person.name ?? "",
    role: person.role ?? "",
    organization: person.organization ?? null,
    contact: {
      email: person.email ?? null,
      phone: person.phone ?? null
    },
    notes: person.notes ?? null
  }));

  const deadlinesAndRequirements = {
    hearing_date: caseRow.hearing_date,
    hearing_location: caseRow.hearing_location,
    review_required_pages: ocrSummary?.review_required_count ?? 0,
    blocking_review_count: ocrSummary?.blocking_review_count ?? 0,
    packet_status: packet?.status ?? null,
    unresolved_suggestions: packetSuggestions.length,
    missing_proof_items: proofRequirements.filter((requirement) => requirement.satisfied !== 1).length
  };

  const readCoverageLog = {
    inventory_complete: sourceItems.length > 0,
    identified_narratives: narratives.length,
    identified_narrative_requests: narrativeRequests.length,
    identified_imes: imes.length,
    identified_pretrials: pretrials.length,
    identified_orders: orders.length,
    identified_hearing_notices: hearingNotices.length,
    identified_exhibit_lists: exhibitLists.length,
    identified_prep_docs: prepDocs.length,
    unresolved_unclassified_count: sourceItems.filter((item) => !item.document_type_name).length,
    manual_read_verification_required: true
  };

  const openQuestions = [
    ...sourceItems
      .filter((item) => !item.document_type_name)
      .map((item) => ({
        kind: "unclassified_document",
        detail: item.title ?? item.id
      })),
    ...proofRequirements
      .filter((requirement) => requirement.satisfied !== 1)
      .map((requirement) => ({
        kind: "missing_proof",
        detail: `${requirement.requirement_key} (${requirement.requirement_policy})`
      })),
    ...packetSuggestions.map((suggestion) => ({
      kind: "packet_suggestion",
      detail: suggestion.title
    }))
  ];

  const proofToReliefGraph = issues.map((issue) => {
    const requirements = proofRequirements.filter((requirement) => requirement.issue_id === issue.id);
    return {
      issue_id: issue.id,
      requested_relief: issue.requested_relief ?? issue.issue_type,
      legal_elements: requirements.map((requirement) => requirement.requirement_key),
      missing_proof: requirements
        .filter((requirement) => requirement.satisfied !== 1)
        .map((requirement) => requirement.requirement_key)
    };
  });

  const exhibitPlan = {
    packet_preview: packetPreview,
    unresolved_suggestions: packetSuggestions,
    total_sections: packet?.sections.length ?? 0,
    total_slots: packet?.sections.reduce((sum, section) => sum + section.exhibits.length, 0) ?? 0
  };

  const hearingReadinessChecklist = [
    {
      check_id: "packet_exists",
      label: "Hearing packet exists",
      status: packet ? "pass" : "fail",
      detail: packet ? `Active packet: ${packet.packet_name}` : "No hearing packet found for this matter."
    },
    {
      check_id: "ocr_review",
      label: "OCR review queue clear",
      status: (ocrSummary?.review_required_count ?? 0) === 0 ? "pass" : "warn",
      detail: `${ocrSummary?.review_required_count ?? 0} review-required page(s).`
    },
    {
      check_id: "proof_requirements",
      label: "Proof requirements satisfied",
      status: proofRequirements.every((requirement) => requirement.satisfied === 1) ? "pass" : "warn",
      detail: `${proofRequirements.filter((requirement) => requirement.satisfied !== 1).length} missing proof requirement(s).`
    },
    {
      check_id: "packet_suggestions",
      label: "Packet suggestions resolved",
      status: packetSuggestions.length === 0 ? "pass" : "warn",
      detail: `${packetSuggestions.length} unresolved packet suggestion(s).`
    }
  ];

  return {
    case_profile: caseProfile,
    file_inventory: fileInventory,
    issue_matrix: issueMatrix,
    fact_timeline: factTimeline,
    exhibit_catalog: exhibitCatalog,
    witness_matrix: witnessMatrix,
    deadlines_and_requirements: deadlinesAndRequirements,
    read_coverage_log: readCoverageLog,
    open_questions: openQuestions,
    proof_to_relief_graph: proofToReliefGraph,
    exhibit_plan: exhibitPlan,
    hearing_readiness_checklist: hearingReadinessChecklist
  };
}
