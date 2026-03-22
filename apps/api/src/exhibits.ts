import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { resolveBlueprintVersionForPackageType } from "./blueprints.js";

type ExhibitPacketStatus = "draft" | "needs_review" | "ready" | "finalized" | "exported" | "archived";
type ExhibitPacketMode = "compact" | "full";
type SuggestionResolutionAction = "accept" | "dismiss";

const DEFAULT_SECTIONS = [
  { key: "employee", label: "Employee Exhibits" }
] as const;

const DEFAULT_EXHIBIT_SLOT_COUNT = 5;

function nowIso() {
  return new Date().toISOString();
}

function nextSectionKey(existingCount: number) {
  return `custom_${existingCount + 1}`;
}

function nextExhibitLabel(index: number, namingScheme: string) {
  if (namingScheme === "numbers") {
    return String(index + 1);
  }

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let remaining = index;
  let out = "";
  do {
    out = alphabet[remaining % 26] + out;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return out;
}

function isPdfLikeSource(title: string | null, mimeType: string | null) {
  const normalizedMime = mimeType?.trim().toLowerCase() ?? "";
  if (normalizedMime === "application/pdf") {
    return true;
  }
  return /\.pdf$/i.test(title ?? "");
}

function recordHistory(
  db: Database.Database,
  input: {
    packetId: string;
    actionType: string;
    targetType: string;
    targetId?: string | null;
    payload?: unknown;
  }
) {
  db.prepare(
    `
      INSERT INTO exhibit_history
        (id, packet_id, actor_id, action_type, target_type, target_id, payload_json)
      VALUES
        (?, ?, NULL, ?, ?, ?, ?)
    `
  ).run(
    randomUUID(),
    input.packetId,
    input.actionType,
    input.targetType,
    input.targetId ?? null,
    input.payload === undefined ? null : JSON.stringify(input.payload)
  );
}

function getPacketRow(db: Database.Database, packetId: string) {
  const row = db
    .prepare(
      `
        SELECT
          id,
          case_id,
          packet_name,
          packet_mode,
          naming_scheme,
          status,
          metadata_json,
          package_type,
          package_label,
          target_document_source_item_id,
          blueprint_version_id,
          run_status,
          created_at,
          updated_at
        FROM exhibit_packets
        WHERE id = ?
        LIMIT 1
      `
    )
    .get(packetId) as
    | {
        id: string;
        case_id: string;
        packet_name: string;
        packet_mode: string;
        naming_scheme: string;
        status: ExhibitPacketStatus;
        metadata_json: string | null;
        package_type: string;
        package_label: string | null;
        target_document_source_item_id: string | null;
        blueprint_version_id: string | null;
        run_status: string | null;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (!row) {
    return undefined;
  }

  const blueprint = resolveBlueprintVersionForPackageType(db, row.package_type, row.blueprint_version_id);
  return {
    ...row,
    blueprint_version_id: blueprint?.blueprint_version_id ?? row.blueprint_version_id ?? null,
    blueprint_version: blueprint?.blueprint_version ?? null,
    blueprint_key: blueprint?.blueprint_key ?? null,
    blueprint_name: blueprint?.blueprint_name ?? null,
    blueprint_execution_engine: blueprint?.execution_engine ?? null
  };
}

function sourceItemBelongsToCase(db: Database.Database, sourceItemId: string, caseId: string) {
  const row = db
    .prepare(`SELECT id FROM source_items WHERE id = ? AND case_id = ? LIMIT 1`)
    .get(sourceItemId, caseId) as { id: string } | undefined;
  return !!row;
}

function getSectionRows(db: Database.Database, packetId: string) {
  return db
    .prepare(
      `
        SELECT id, exhibit_packet_id, section_key, section_label, sort_order, created_at, updated_at
        FROM exhibit_sections
        WHERE exhibit_packet_id = ?
        ORDER BY sort_order ASC, created_at ASC
      `
    )
    .all(packetId) as Array<{
    id: string;
    exhibit_packet_id: string;
    section_key: string;
    section_label: string;
    sort_order: number;
    created_at: string;
    updated_at: string;
  }>;
}

function getSectionRow(db: Database.Database, sectionId: string) {
  return db
    .prepare(
      `
        SELECT
          es.id,
          es.exhibit_packet_id,
          es.section_key,
          es.section_label,
          es.sort_order,
          ep.case_id
        FROM exhibit_sections es
        JOIN exhibit_packets ep ON ep.id = es.exhibit_packet_id
        WHERE es.id = ?
        LIMIT 1
      `
    )
    .get(sectionId) as
    | {
        id: string;
        exhibit_packet_id: string;
        section_key: string;
        section_label: string;
        sort_order: number;
        case_id: string;
      }
    | undefined;
}

function getExhibitRows(db: Database.Database, sectionId: string) {
  return db
    .prepare(
      `
        SELECT
          id,
          exhibit_section_id,
          exhibit_label,
          title,
          status,
          sort_order,
          purpose,
          objection_risk,
          notes,
          created_at,
          updated_at
        FROM exhibits
        WHERE exhibit_section_id = ?
        ORDER BY sort_order ASC, created_at ASC
      `
    )
    .all(sectionId) as Array<{
    id: string;
    exhibit_section_id: string;
    exhibit_label: string;
    title: string | null;
    status: string;
    sort_order: number;
    purpose: string | null;
    objection_risk: string | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
  }>;
}

function getExhibitRow(db: Database.Database, exhibitId: string) {
  return db
    .prepare(
      `
        SELECT
          e.id,
          e.exhibit_section_id,
          es.exhibit_packet_id,
          ep.case_id,
          e.exhibit_label,
          e.sort_order
        FROM exhibits e
        JOIN exhibit_sections es ON es.id = e.exhibit_section_id
        JOIN exhibit_packets ep ON ep.id = es.exhibit_packet_id
        WHERE e.id = ?
        LIMIT 1
      `
    )
    .get(exhibitId) as
    | {
        id: string;
        exhibit_section_id: string;
        exhibit_packet_id: string;
        case_id: string;
        exhibit_label: string;
        sort_order: number;
      }
    | undefined;
}

export function getExhibitCaseId(db: Database.Database, exhibitId: string) {
  const row = getExhibitRow(db, exhibitId);
  return row ? { case_id: row.case_id, exhibit_packet_id: row.exhibit_packet_id } : undefined;
}

function getExhibitItemRows(db: Database.Database, exhibitId: string) {
  return db
    .prepare(
      `
        SELECT
          ei.id,
          ei.exhibit_id,
          ei.source_item_id,
          ei.canonical_document_id,
          ei.canonical_page_id,
          ei.page_start,
          ei.page_end,
          ei.include_order,
          ei.notes,
          ei.created_at,
          ei.updated_at,
          si.title AS source_item_title,
          si.document_type_name,
          json_extract(si.raw_json, '$.document_category') AS document_category,
          si.provider,
          si.source_kind,
          cd.title AS canonical_document_title,
          cd.page_count,
          (
            SELECT COUNT(*)
            FROM exhibit_item_page_rules eipr
            WHERE eipr.exhibit_item_id = ei.id
              AND eipr.rule_type = 'exclude'
          ) AS excluded_page_count
        FROM exhibit_items ei
        LEFT JOIN source_items si ON si.id = ei.source_item_id
        LEFT JOIN canonical_documents cd ON cd.id = ei.canonical_document_id
        WHERE ei.exhibit_id = ?
        ORDER BY ei.include_order ASC, ei.created_at ASC
      `
    )
    .all(exhibitId) as Array<{
    id: string;
    exhibit_id: string;
    source_item_id: string | null;
    canonical_document_id: string | null;
    canonical_page_id: string | null;
    page_start: number | null;
    page_end: number | null;
    include_order: number;
    notes: string | null;
    created_at: string;
    updated_at: string;
    source_item_title: string | null;
    document_type_name: string | null;
    document_category: string | null;
    provider: string | null;
    source_kind: string | null;
    canonical_document_title: string | null;
    page_count: number | null;
    excluded_page_count: number;
  }>;
}

function getPageRules(db: Database.Database, exhibitItemId: string) {
  return db
    .prepare(
      `
        SELECT id, exhibit_item_id, canonical_page_id, rule_type, note, created_at
        FROM exhibit_item_page_rules
        WHERE exhibit_item_id = ?
        ORDER BY created_at ASC
      `
    )
    .all(exhibitItemId) as Array<{
    id: string;
    exhibit_item_id: string;
    canonical_page_id: string;
    rule_type: string;
    note: string | null;
    created_at: string;
  }>;
}

function listAllPacketItems(db: Database.Database, packetId: string) {
  return db
    .prepare(
      `
        SELECT
          ei.id,
          ei.source_item_id,
          ei.canonical_document_id,
          ei.canonical_page_id,
          e.exhibit_label,
          es.section_key,
          si.title AS source_item_title,
          si.document_type_name,
          json_extract(si.raw_json, '$.document_category') AS document_category
        FROM exhibit_items ei
        JOIN exhibits e ON e.id = ei.exhibit_id
        JOIN exhibit_sections es ON es.id = e.exhibit_section_id
        LEFT JOIN source_items si ON si.id = ei.source_item_id
        WHERE es.exhibit_packet_id = ?
        ORDER BY es.sort_order ASC, e.sort_order ASC, ei.include_order ASC
      `
    )
    .all(packetId) as Array<{
    id: string;
    source_item_id: string | null;
    canonical_document_id: string | null;
    canonical_page_id: string | null;
    exhibit_label: string;
    section_key: string;
    source_item_title: string | null;
    document_type_name: string | null;
    document_category: string | null;
  }>;
}

export function getPacketCaseId(db: Database.Database, packetId: string) {
  return db
    .prepare(`SELECT case_id FROM exhibit_packets WHERE id = ? LIMIT 1`)
    .get(packetId) as { case_id: string } | undefined;
}

export function getSectionCaseId(db: Database.Database, sectionId: string) {
  return db
    .prepare(
      `
        SELECT ep.case_id
        FROM exhibit_sections es
        JOIN exhibit_packets ep ON ep.id = es.exhibit_packet_id
        WHERE es.id = ?
        LIMIT 1
      `
    )
    .get(sectionId) as { case_id: string } | undefined;
}

export function getExhibitItemCaseId(db: Database.Database, exhibitItemId: string) {
  return db
    .prepare(
      `
        SELECT ep.case_id, ep.id AS exhibit_packet_id
        FROM exhibit_items ei
        JOIN exhibits e ON e.id = ei.exhibit_id
        JOIN exhibit_sections es ON es.id = e.exhibit_section_id
        JOIN exhibit_packets ep ON ep.id = es.exhibit_packet_id
        WHERE ei.id = ?
        LIMIT 1
      `
    )
    .get(exhibitItemId) as
    | {
        case_id: string;
        exhibit_packet_id: string;
      }
    | undefined;
}

function getResolvedSuggestionIds(db: Database.Database, packetId: string) {
  return new Set(
    (
      db
        .prepare(
          `
            SELECT suggestion_id
            FROM exhibit_suggestion_resolutions
            WHERE packet_id = ?
          `
        )
        .all(packetId) as Array<{ suggestion_id: string }>
    ).map((row) => row.suggestion_id)
  );
}

function buildSuggestionId(input: { type: string; target: string }) {
  return `${input.type}:${input.target}`;
}

export function getPacketSuggestions(db: Database.Database, packetId: string) {
  const packet = getPacketRow(db, packetId);
  if (!packet) {
    return null;
  }

  const resolvedSuggestionIds = getResolvedSuggestionIds(db, packetId);
  const items = listAllPacketItems(db, packetId);
  const suggestions: Array<{
    id: string;
    suggestion_type: string;
    severity: "info" | "warn";
    title: string;
    detail: string;
    payload: Record<string, unknown>;
  }> = [];

  const byCanonicalDocument = new Map<string, typeof items>();
  for (const item of items) {
    if (!item.canonical_document_id) {
      continue;
    }
    const current = byCanonicalDocument.get(item.canonical_document_id) ?? [];
    current.push(item);
    byCanonicalDocument.set(item.canonical_document_id, current);
  }
  for (const [canonicalDocumentId, grouped] of byCanonicalDocument.entries()) {
    if (grouped.length <= 1) {
      continue;
    }
    const suggestionId = buildSuggestionId({ type: "deduplication", target: canonicalDocumentId });
    if (resolvedSuggestionIds.has(suggestionId)) {
      continue;
    }
    suggestions.push({
      id: suggestionId,
      suggestion_type: "deduplication",
      severity: "warn",
      title: "Potential duplicate exhibit content",
      detail: `${grouped[0]?.source_item_title ?? canonicalDocumentId} appears in multiple slots (${grouped
        .map((row) => `${row.section_key}:${row.exhibit_label}`)
        .join(", ")}).`,
      payload: {
        canonical_document_id: canonicalDocumentId,
        slot_refs: grouped.map((row) => ({ section_key: row.section_key, exhibit_label: row.exhibit_label }))
      }
    });
  }

  const missingProof = db
    .prepare(
      `
        SELECT pr.id, pr.requirement_key, pr.requirement_policy, i.issue_type
        FROM proof_requirements pr
        JOIN issues i ON i.id = pr.issue_id
        WHERE i.case_id = ?
          AND COALESCE(pr.satisfied, 0) = 0
        ORDER BY i.priority ASC, pr.requirement_key ASC
      `
    )
    .all(packet.case_id) as Array<{
    id: string;
    requirement_key: string;
    requirement_policy: string;
    issue_type: string;
  }>;

  for (const requirement of missingProof) {
    const suggestionId = buildSuggestionId({ type: "gap", target: requirement.id });
    if (resolvedSuggestionIds.has(suggestionId)) {
      continue;
    }
    suggestions.push({
      id: suggestionId,
      suggestion_type: "gap",
      severity: "warn",
      title: `Missing proof: ${requirement.requirement_key}`,
      detail: `${requirement.issue_type} is still missing evidence for ${requirement.requirement_key}.`,
      payload: requirement
    });
  }

  const assignedSourceIds = new Set(items.map((item) => item.source_item_id).filter((value): value is string => Boolean(value)));
  const unassignedDocs = db
    .prepare(
      `
        SELECT
          id,
          title,
          document_type_name,
          json_extract(raw_json, '$.document_category') AS document_category
        FROM source_items
        WHERE case_id = ?
          AND COALESCE(document_type_name, '') <> ''
        ORDER BY created_at ASC
      `
    )
    .all(packet.case_id) as Array<{
    id: string;
    title: string | null;
    document_type_name: string | null;
    document_category: string | null;
  }>;

  for (const row of unassignedDocs) {
    if (assignedSourceIds.has(row.id)) {
      continue;
    }
    const suggestionId = buildSuggestionId({ type: "grouping", target: row.id });
    if (resolvedSuggestionIds.has(suggestionId)) {
      continue;
    }
    suggestions.push({
      id: suggestionId,
      suggestion_type: "grouping",
      severity: "info",
      title: "Unassigned document",
      detail: `${row.title ?? row.id} is not assigned to any exhibit slot yet.`,
      payload: row
    });
  }

  return suggestions;
}

export function getPacketPreview(db: Database.Database, packetId: string) {
  const packet = getPacketRow(db, packetId);
  if (!packet) {
    return null;
  }
  const sections = getSectionRows(db, packetId).map((section) => {
    const exhibits = getExhibitRows(db, section.id).map((exhibit) => {
      const items = getExhibitItemRows(db, exhibit.id);
      return {
        id: exhibit.id,
        exhibit_label: exhibit.exhibit_label,
        title: exhibit.title,
        item_count: items.length,
        excluded_page_count: items.reduce((sum, item) => sum + item.excluded_page_count, 0),
        source_titles: items.map((item) => item.source_item_title ?? item.canonical_document_title ?? "Untitled"),
        page_count_estimate: items.reduce(
          (sum, item) => sum + Math.max((item.page_count ?? 0) - item.excluded_page_count, 0),
          0
        )
      };
    });
    return {
      id: section.id,
      section_key: section.section_key,
      section_label: section.section_label,
      exhibits
    };
  });

  return {
    packet_id: packet.id,
    status: packet.status,
    sections,
    total_exhibits: sections.reduce((sum, section) => sum + section.exhibits.length, 0),
    total_items: sections.reduce(
      (sum, section) => sum + section.exhibits.reduce((exhibitSum, exhibit) => exhibitSum + exhibit.item_count, 0),
      0
    )
  };
}

export function getPacketHistory(db: Database.Database, packetId: string) {
  const packet = getPacketRow(db, packetId);
  if (!packet) {
    return null;
  }
  return db
    .prepare(
      `
        SELECT id, packet_id, actor_id, action_type, target_type, target_id, payload_json, created_at
        FROM exhibit_history
        WHERE packet_id = ?
        ORDER BY created_at DESC
      `
    )
    .all(packetId) as Array<{
    id: string;
    packet_id: string;
    actor_id: string | null;
    action_type: string;
    target_type: string;
    target_id: string | null;
    payload_json: string | null;
    created_at: string;
  }>;
}

export function getCaseExhibitWorkspace(db: Database.Database, caseId: string) {
  const packets = db
    .prepare(
      `
        SELECT id
        FROM exhibit_packets
        WHERE case_id = ?
        ORDER BY updated_at DESC, created_at DESC
      `
    )
    .all(caseId) as Array<{ id: string }>;

  return packets
    .map(({ id }) => {
      const packet = getPacketRow(db, id);
      if (!packet) {
        return null;
      }
      const sections = getSectionRows(db, id).map((section) => ({
        ...section,
        exhibits: getExhibitRows(db, section.id).map((exhibit) => ({
          ...exhibit,
          items: getExhibitItemRows(db, exhibit.id).map((item) => ({
            ...item,
            page_rules: getPageRules(db, item.id)
          }))
        }))
      }));
      return { ...packet, sections };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null);
}

export function createExhibitPacket(
  db: Database.Database,
  input: {
    caseId: string;
    packetName?: string | null;
    packetMode?: ExhibitPacketMode | null;
    namingScheme?: string | null;
    starterSlotCount?: number | null;
    packageType?: string | null;
    packageLabel?: string | null;
    targetDocumentSourceItemId?: string | null;
  }
) {
  const packetId = randomUUID();
  const packetName = input.packetName?.trim() || "Hearing Packet";
  const packetMode = input.packetMode ?? "full";
  const namingScheme = input.namingScheme?.trim() || "letters";
  const packageType = input.packageType?.trim() || "hearing_packet";
  const targetDocumentSourceItemId = input.targetDocumentSourceItemId?.trim() || null;
  const resolvedBlueprint = resolveBlueprintVersionForPackageType(db, packageType);

  if (targetDocumentSourceItemId && !sourceItemBelongsToCase(db, targetDocumentSourceItemId, input.caseId)) {
    return {
      ok: false as const,
      error: "target document source item not found for this case"
    };
  }

  const existingActive = db
    .prepare(
      `
        SELECT id
        FROM exhibit_packets
        WHERE case_id = ?
          AND package_type = ?
          AND status <> 'archived'
        LIMIT 1
      `
    )
    .get(input.caseId, packageType) as { id: string } | undefined;
  if (existingActive) {
    return {
      ok: false as const,
      error: `an active ${packageType} package already exists for this case`
    };
  }

  db.transaction(() => {
    db.prepare(
      `
        INSERT INTO exhibit_packets
          (id, case_id, packet_name, packet_mode, naming_scheme, status, metadata_json,
           package_type, package_label, target_document_source_item_id, blueprint_version_id)
        VALUES
          (?, ?, ?, ?, ?, 'draft', '{}', ?, ?, ?, ?)
      `
    ).run(
      packetId,
      input.caseId,
      packetName,
      packetMode,
      namingScheme,
      packageType,
      input.packageLabel?.trim() ?? null,
      targetDocumentSourceItemId,
      resolvedBlueprint?.blueprint_version_id ?? null
    );

    const sectionIds: string[] = [];
    DEFAULT_SECTIONS.forEach((section, index) => {
      const sectionId = randomUUID();
      sectionIds.push(sectionId);
      db.prepare(
        `
          INSERT INTO exhibit_sections
            (id, exhibit_packet_id, section_key, section_label, sort_order)
          VALUES
            (?, ?, ?, ?, ?)
        `
      ).run(sectionId, packetId, section.key, section.label, index);
    });

    const starterCount = input.starterSlotCount ?? DEFAULT_EXHIBIT_SLOT_COUNT;
    const employeeSectionId = sectionIds[0];
    if (employeeSectionId && starterCount > 0) {
      for (let i = 0; i < starterCount; i++) {
        const label = namingScheme === "numbers" ? String(i + 1) : String.fromCharCode(65 + i);
        db.prepare(
          `
            INSERT INTO exhibits
              (id, exhibit_section_id, exhibit_label, status, sort_order)
            VALUES
              (?, ?, ?, 'draft', ?)
          `
        ).run(randomUUID(), employeeSectionId, label, i);
      }
    }

    recordHistory(db, {
      packetId,
      actionType: "packet_created",
      targetType: "packet",
      targetId: packetId,
      payload: {
        packet_name: packetName,
        packet_mode: packetMode,
        naming_scheme: namingScheme,
        starter_slots: starterCount,
        package_type: packageType,
        blueprint_version_id: resolvedBlueprint?.blueprint_version_id ?? null
      }
    });
  })();

  return {
    ok: true as const,
    packet: getCaseExhibitWorkspace(db, input.caseId).find((packet) => packet.id === packetId) ?? null
  };
}

export function updateExhibitPacket(
  db: Database.Database,
  input: {
    packetId: string;
    packetName?: string | null;
    packetMode?: ExhibitPacketMode | null;
    namingScheme?: string | null;
    status?: ExhibitPacketStatus | null;
    packageType?: string | null;
    packageLabel?: string | null;
    targetDocumentSourceItemId?: string | null;
    runStatus?: string | null;
  }
) {
  const packet = getPacketRow(db, input.packetId);
  if (!packet) {
    return {
      ok: false as const,
      error: "packet not found"
    };
  }

  if (Object.hasOwn(input, "targetDocumentSourceItemId")) {
    const targetDocumentSourceItemId = input.targetDocumentSourceItemId?.trim() || null;
    if (targetDocumentSourceItemId && !sourceItemBelongsToCase(db, targetDocumentSourceItemId, packet.case_id)) {
      return {
        ok: false as const,
        error: "target document source item not found for this case"
      };
    }
  }

  const updates: string[] = [];
  const params: Array<string | null> = [];
  if (Object.hasOwn(input, "packetName")) {
    updates.push("packet_name = ?");
    params.push(input.packetName?.trim() || "Hearing Packet");
  }
  if (Object.hasOwn(input, "packetMode")) {
    updates.push("packet_mode = ?");
    params.push(input.packetMode ?? "full");
  }
  if (Object.hasOwn(input, "namingScheme")) {
    updates.push("naming_scheme = ?");
    params.push(input.namingScheme?.trim() || "letters");
  }
  if (Object.hasOwn(input, "status")) {
    updates.push("status = ?");
    params.push(input.status ?? "draft");
  }
  if (Object.hasOwn(input, "packageType")) {
    updates.push("package_type = ?");
    params.push(input.packageType?.trim() || "hearing_packet");
    const nextBlueprint = resolveBlueprintVersionForPackageType(db, input.packageType?.trim() || "hearing_packet");
    updates.push("blueprint_version_id = ?");
    params.push(nextBlueprint?.blueprint_version_id ?? null);
  }
  if (Object.hasOwn(input, "packageLabel")) {
    updates.push("package_label = ?");
    params.push(input.packageLabel?.trim() ?? null);
  }
  if (Object.hasOwn(input, "targetDocumentSourceItemId")) {
    updates.push("target_document_source_item_id = ?");
    params.push(input.targetDocumentSourceItemId?.trim() ?? null);
  }
  if (Object.hasOwn(input, "runStatus")) {
    updates.push("run_status = ?");
    params.push(input.runStatus?.trim() ?? null);
  }

  if (updates.length > 0) {
    db.prepare(
      `
        UPDATE exhibit_packets
        SET ${updates.join(", ")},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
    ).run(...params, input.packetId);

    recordHistory(db, {
      packetId: input.packetId,
      actionType: "packet_updated",
      targetType: "packet",
      targetId: input.packetId,
      payload: input
    });
  }

  return getCaseExhibitWorkspace(db, packet.case_id).find((row) => row.id === input.packetId) ?? null;
}

export function createExhibitSection(
  db: Database.Database,
  input: {
    packetId: string;
    sectionKey?: string | null;
    sectionLabel?: string | null;
  }
) {
  const packet = getPacketRow(db, input.packetId);
  if (!packet) {
    return {
      ok: false as const,
      error: "packet not found"
    };
  }

  const current = getSectionRows(db, input.packetId);
  const sectionId = randomUUID();
  const sectionKey = input.sectionKey?.trim() || nextSectionKey(current.length);
  const sectionLabel = input.sectionLabel?.trim() || "Custom Section";
  const sortOrder = current.length;

  const duplicate = db
    .prepare(
      `
        SELECT id
        FROM exhibit_sections
        WHERE exhibit_packet_id = ?
          AND section_key = ?
        LIMIT 1
      `
    )
    .get(input.packetId, sectionKey) as { id: string } | undefined;
  if (duplicate) {
    return {
      ok: false as const,
      error: "section key already exists in this packet"
    };
  }

  db.transaction(() => {
    db.prepare(
      `
        INSERT INTO exhibit_sections
          (id, exhibit_packet_id, section_key, section_label, sort_order)
        VALUES
          (?, ?, ?, ?, ?)
      `
    ).run(sectionId, input.packetId, sectionKey, sectionLabel, sortOrder);

    recordHistory(db, {
      packetId: input.packetId,
      actionType: "section_created",
      targetType: "section",
      targetId: sectionId,
      payload: { section_key: sectionKey, section_label: sectionLabel }
    });
  })();

  return {
    ok: true as const,
    packet: getCaseExhibitWorkspace(db, packet.case_id).find((row) => row.id === input.packetId) ?? null
  };
}

export function updateExhibitSection(
  db: Database.Database,
  input: {
    sectionId: string;
    sectionLabel?: string | null;
    sortOrder?: number | null;
  }
) {
  const section = db
    .prepare(`SELECT id, exhibit_packet_id FROM exhibit_sections WHERE id = ? LIMIT 1`)
    .get(input.sectionId) as { id: string; exhibit_packet_id: string } | undefined;
  if (!section) {
    return null;
  }
  const packet = getPacketRow(db, section.exhibit_packet_id);
  if (!packet) {
    return null;
  }

  const updates: string[] = [];
  const params: Array<string | number | null> = [];
  if (Object.hasOwn(input, "sectionLabel")) {
    updates.push("section_label = ?");
    params.push(input.sectionLabel?.trim() || "Custom Section");
  }
  if (Object.hasOwn(input, "sortOrder")) {
    updates.push("sort_order = ?");
    params.push(input.sortOrder ?? 0);
  }
  if (updates.length > 0) {
    db.transaction(() => {
      db.prepare(
        `
          UPDATE exhibit_sections
          SET ${updates.join(", ")},
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `
      ).run(...params, input.sectionId);

      recordHistory(db, {
        packetId: packet.id,
        actionType: "section_updated",
        targetType: "section",
        targetId: input.sectionId,
        payload: input
      });
    })();
  }

  return getCaseExhibitWorkspace(db, packet.case_id).find((row) => row.id === packet.id) ?? null;
}

export function deleteExhibitSection(db: Database.Database, sectionId: string) {
  const section = db
    .prepare(`SELECT id, exhibit_packet_id FROM exhibit_sections WHERE id = ? LIMIT 1`)
    .get(sectionId) as { id: string; exhibit_packet_id: string } | undefined;
  if (!section) {
    return null;
  }
  const packet = getPacketRow(db, section.exhibit_packet_id);
  if (!packet) {
    return null;
  }

  db.transaction(() => {
    db.prepare(`DELETE FROM exhibit_sections WHERE id = ?`).run(sectionId);
    recordHistory(db, {
      packetId: packet.id,
      actionType: "section_deleted",
      targetType: "section",
      targetId: sectionId
    });
  })();
  return getCaseExhibitWorkspace(db, packet.case_id).find((row) => row.id === packet.id) ?? null;
}

export function createExhibit(
  db: Database.Database,
  input: {
    sectionId: string;
    exhibitLabel?: string | null;
    title?: string | null;
    purpose?: string | null;
    objectionRisk?: string | null;
    notes?: string | null;
  }
) {
  const section = db
    .prepare(`SELECT id, exhibit_packet_id FROM exhibit_sections WHERE id = ? LIMIT 1`)
    .get(input.sectionId) as { id: string; exhibit_packet_id: string } | undefined;
  if (!section) {
    return null;
  }
  const packet = getPacketRow(db, section.exhibit_packet_id);
  if (!packet) {
    return null;
  }
  const exhibits = getExhibitRows(db, input.sectionId);
  const exhibitId = randomUUID();
  const exhibitLabel = input.exhibitLabel?.trim() || nextExhibitLabel(exhibits.length, packet.naming_scheme);
  const title = input.title?.trim() || `${exhibitLabel} Exhibit`;

  db.transaction(() => {
    db.prepare(
      `
        INSERT INTO exhibits
          (id, exhibit_section_id, exhibit_label, title, status, sort_order, purpose, objection_risk, notes)
        VALUES
          (?, ?, ?, ?, 'draft', ?, ?, ?, ?)
      `
    ).run(
      exhibitId,
      input.sectionId,
      exhibitLabel,
      title,
      exhibits.length,
      input.purpose?.trim() || null,
      input.objectionRisk?.trim() || null,
      input.notes?.trim() || null
    );

    recordHistory(db, {
      packetId: packet.id,
      actionType: "exhibit_created",
      targetType: "exhibit",
      targetId: exhibitId,
      payload: { exhibit_label: exhibitLabel, title }
    });
  })();

  return getCaseExhibitWorkspace(db, packet.case_id).find((row) => row.id === packet.id) ?? null;
}

export function updateExhibit(
  db: Database.Database,
  input: {
    exhibitId: string;
    exhibitLabel?: string | null;
    title?: string | null;
    status?: string | null;
    purpose?: string | null;
    objectionRisk?: string | null;
    notes?: string | null;
    sortOrder?: number | null;
  }
) {
  const exhibit = db
    .prepare(
      `
        SELECT e.id, es.exhibit_packet_id
        FROM exhibits e
        JOIN exhibit_sections es ON es.id = e.exhibit_section_id
        WHERE e.id = ?
        LIMIT 1
      `
    )
    .get(input.exhibitId) as { id: string; exhibit_packet_id: string } | undefined;
  if (!exhibit) {
    return null;
  }
  const packet = getPacketRow(db, exhibit.exhibit_packet_id);
  if (!packet) {
    return null;
  }

  const updates: string[] = [];
  const params: Array<string | number | null> = [];
  if (Object.hasOwn(input, "exhibitLabel")) {
    updates.push("exhibit_label = ?");
    params.push(input.exhibitLabel?.trim() || "Exhibit");
  }
  if (Object.hasOwn(input, "title")) {
    updates.push("title = ?");
    params.push(input.title?.trim() || null);
  }
  if (Object.hasOwn(input, "status")) {
    updates.push("status = ?");
    params.push(input.status ?? "draft");
  }
  if (Object.hasOwn(input, "purpose")) {
    updates.push("purpose = ?");
    params.push(input.purpose?.trim() || null);
  }
  if (Object.hasOwn(input, "objectionRisk")) {
    updates.push("objection_risk = ?");
    params.push(input.objectionRisk?.trim() || null);
  }
  if (Object.hasOwn(input, "notes")) {
    updates.push("notes = ?");
    params.push(input.notes?.trim() || null);
  }
  if (Object.hasOwn(input, "sortOrder")) {
    updates.push("sort_order = ?");
    params.push(input.sortOrder ?? 0);
  }
  if (updates.length > 0) {
    db.transaction(() => {
      db.prepare(
        `
          UPDATE exhibits
          SET ${updates.join(", ")},
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `
      ).run(...params, input.exhibitId);

      recordHistory(db, {
        packetId: packet.id,
        actionType: "exhibit_updated",
        targetType: "exhibit",
        targetId: input.exhibitId,
        payload: input
      });
    })();
  }

  return getCaseExhibitWorkspace(db, packet.case_id).find((row) => row.id === packet.id) ?? null;
}

export function deleteExhibit(db: Database.Database, exhibitId: string) {
  const exhibit = db
    .prepare(
      `
        SELECT e.id, es.exhibit_packet_id
        FROM exhibits e
        JOIN exhibit_sections es ON es.id = e.exhibit_section_id
        WHERE e.id = ?
        LIMIT 1
      `
    )
    .get(exhibitId) as { id: string; exhibit_packet_id: string } | undefined;
  if (!exhibit) {
    return null;
  }
  const packet = getPacketRow(db, exhibit.exhibit_packet_id);
  if (!packet) {
    return null;
  }
  db.transaction(() => {
    db.prepare(`DELETE FROM exhibits WHERE id = ?`).run(exhibitId);
    recordHistory(db, {
      packetId: packet.id,
      actionType: "exhibit_deleted",
      targetType: "exhibit",
      targetId: exhibitId
    });
  })();
  return getCaseExhibitWorkspace(db, packet.case_id).find((row) => row.id === packet.id) ?? null;
}

export function addExhibitItem(
  db: Database.Database,
  input: {
    exhibitId: string;
    sourceItemId: string;
    notes?: string | null;
  }
) {
  const exhibit = db
    .prepare(
      `
        SELECT e.id, es.exhibit_packet_id
        FROM exhibits e
        JOIN exhibit_sections es ON es.id = e.exhibit_section_id
        WHERE e.id = ?
        LIMIT 1
      `
    )
    .get(input.exhibitId) as { id: string; exhibit_packet_id: string } | undefined;
  if (!exhibit) {
    return { ok: false as const, error: "exhibit not found" };
  }
  const packet = getPacketRow(db, exhibit.exhibit_packet_id);
  if (!packet) {
    return { ok: false as const, error: "packet not found" };
  }
  const sourceItem = db
    .prepare(
      `
        SELECT
          id,
          case_id,
          title,
          mime_type,
          document_type_id,
          document_type_name,
          raw_json,
          json_extract(raw_json, '$.canonical_document_id') AS canonical_document_id
        FROM source_items
        WHERE id = ?
        LIMIT 1
      `
    )
    .get(input.sourceItemId) as
    | {
        id: string;
        case_id: string;
        title: string | null;
        mime_type: string | null;
        document_type_id: string | null;
        document_type_name: string | null;
        raw_json: string | null;
        canonical_document_id: string | null;
      }
    | undefined;
  if (!sourceItem || sourceItem.case_id !== packet.case_id) {
    return { ok: false as const, error: "source item not found for packet case" };
  }

  if (packet.package_type === "hearing_packet" && !isPdfLikeSource(sourceItem.title, sourceItem.mime_type)) {
    return {
      ok: false as const,
      error: "hearing packets currently support PDF source items only"
    };
  }

  const duplicate = db
    .prepare(
      `
        SELECT
          ei.id,
          e.exhibit_label,
          es.section_label
        FROM exhibit_items ei
        JOIN exhibits e ON e.id = ei.exhibit_id
        JOIN exhibit_sections es ON es.id = e.exhibit_section_id
        WHERE es.exhibit_packet_id = ?
          AND ei.source_item_id = ?
        LIMIT 1
      `
    )
    .get(packet.id, input.sourceItemId) as
    | {
        id: string;
        exhibit_label: string;
        section_label: string;
      }
    | undefined;
  if (duplicate) {
    return {
      ok: false as const,
      error: `source item already assigned to exhibit ${duplicate.exhibit_label} in ${duplicate.section_label}`
    };
  }

  const orderRow = db
    .prepare(`SELECT COALESCE(MAX(include_order), -1) AS max_order FROM exhibit_items WHERE exhibit_id = ?`)
    .get(input.exhibitId) as { max_order: number };

  const exhibitItemId = randomUUID();
  db.transaction(() => {
    db.prepare(
      `
        INSERT INTO exhibit_items
          (id, exhibit_id, source_item_id, canonical_document_id, include_order, notes)
        VALUES
          (?, ?, ?, ?, ?, ?)
      `
    ).run(
      exhibitItemId,
      input.exhibitId,
      input.sourceItemId,
      sourceItem.canonical_document_id,
      orderRow.max_order + 1,
      input.notes?.trim() || null
    );

    recordHistory(db, {
      packetId: packet.id,
      actionType: "item_added",
      targetType: "exhibit_item",
      targetId: exhibitItemId,
      payload: { exhibit_id: input.exhibitId, source_item_id: input.sourceItemId }
    });

    let folderPath: string | null = null;
    try {
      const raw = sourceItem.raw_json ? JSON.parse(sourceItem.raw_json) : null;
      const entries = raw?.path_collection?.entries;
      if (Array.isArray(entries)) {
        folderPath = entries
          .filter((e: { id?: string }) => e.id !== "0")
          .map((e: { name?: string; id?: string }) => e.name ?? e.id ?? "")
          .join("/");
      }
    } catch {}

    const exhibitRow = db
      .prepare(`SELECT exhibit_label FROM exhibits WHERE id = ?`)
      .get(input.exhibitId) as { exhibit_label: string } | undefined;

    db.prepare(
      `INSERT INTO classification_signals
         (id, source_item_id, signal_type, folder_path, filename, document_type_id, document_type_name, exhibit_label)
       VALUES (?, ?, 'exhibit_assignment', ?, ?, ?, ?, ?)`
    ).run(
      randomUUID(),
      input.sourceItemId,
      folderPath,
      sourceItem.title,
      sourceItem.document_type_id,
      sourceItem.document_type_name,
      exhibitRow?.exhibit_label ?? null
    );
  })();

  return {
    ok: true as const,
    packet: getCaseExhibitWorkspace(db, packet.case_id).find((row) => row.id === packet.id) ?? null
  };
}

export function removeExhibitItem(db: Database.Database, exhibitItemId: string) {
  const item = db
    .prepare(
      `
        SELECT ei.id, es.exhibit_packet_id
        FROM exhibit_items ei
        JOIN exhibits e ON e.id = ei.exhibit_id
        JOIN exhibit_sections es ON es.id = e.exhibit_section_id
        WHERE ei.id = ?
        LIMIT 1
      `
    )
    .get(exhibitItemId) as { id: string; exhibit_packet_id: string } | undefined;
  if (!item) {
    return null;
  }
  const packet = getPacketRow(db, item.exhibit_packet_id);
  if (!packet) {
    return null;
  }
  db.transaction(() => {
    db.prepare(`DELETE FROM exhibit_items WHERE id = ?`).run(exhibitItemId);
    recordHistory(db, {
      packetId: packet.id,
      actionType: "item_removed",
      targetType: "exhibit_item",
      targetId: exhibitItemId
    });
  })();
  return getCaseExhibitWorkspace(db, packet.case_id).find((row) => row.id === packet.id) ?? null;
}

export function updateExhibitItemPageRules(
  db: Database.Database,
  input: {
    exhibitItemId: string;
    excludeCanonicalPageIds: string[];
  }
) {
  const item = db
    .prepare(
      `
        SELECT
          ei.id,
          ei.canonical_document_id,
          es.exhibit_packet_id
        FROM exhibit_items ei
        JOIN exhibits e ON e.id = ei.exhibit_id
        JOIN exhibit_sections es ON es.id = e.exhibit_section_id
        WHERE ei.id = ?
        LIMIT 1
      `
    )
    .get(input.exhibitItemId) as
    | {
        id: string;
        canonical_document_id: string | null;
        exhibit_packet_id: string;
      }
    | undefined;
  if (!item) {
    return { ok: false as const, error: "exhibit item not found" };
  }
  const packet = getPacketRow(db, item.exhibit_packet_id);
  if (!packet) {
    return { ok: false as const, error: "packet not found" };
  }

  const allowedPageIds = item.canonical_document_id
    ? new Set(
        (
          db
            .prepare(`SELECT id FROM canonical_pages WHERE canonical_doc_id = ? ORDER BY page_number_in_doc ASC`)
            .all(item.canonical_document_id) as Array<{ id: string }>
        ).map((row) => row.id)
      )
    : new Set<string>();

  const filteredPageIds = input.excludeCanonicalPageIds.filter((pageId) => allowedPageIds.has(pageId));

  db.transaction(() => {
    db.prepare(`DELETE FROM exhibit_item_page_rules WHERE exhibit_item_id = ? AND rule_type = 'exclude'`).run(input.exhibitItemId);
    for (const pageId of filteredPageIds) {
      db.prepare(
        `
          INSERT INTO exhibit_item_page_rules
            (id, exhibit_item_id, canonical_page_id, rule_type)
          VALUES
            (?, ?, ?, 'exclude')
        `
      ).run(randomUUID(), input.exhibitItemId, pageId);
    }
    recordHistory(db, {
      packetId: packet.id,
      actionType: "page_rules_updated",
      targetType: "exhibit_item",
      targetId: input.exhibitItemId,
      payload: { exclude_canonical_page_ids: filteredPageIds }
    });
  })();

  return {
    ok: true as const,
    packet: getCaseExhibitWorkspace(db, packet.case_id).find((row) => row.id === packet.id) ?? null
  };
}

export function finalizeExhibitPacket(db: Database.Database, packetId: string) {
  const packet = getPacketRow(db, packetId);
  if (!packet) {
    return null;
  }
  const suggestions = getPacketSuggestions(db, packetId) ?? [];
  const nextStatus: ExhibitPacketStatus = suggestions.some((row) => row.severity === "warn") ? "needs_review" : "finalized";
  db.transaction(() => {
    db.prepare(`UPDATE exhibit_packets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(nextStatus, packetId);
    recordHistory(db, {
      packetId,
      actionType: "packet_finalized",
      targetType: "packet",
      targetId: packetId,
      payload: { status: nextStatus, suggestion_count: suggestions.length }
    });
  })();
  return {
    packet: getCaseExhibitWorkspace(db, packet.case_id).find((row) => row.id === packetId) ?? null,
    suggestions,
    preview: getPacketPreview(db, packetId)
  };
}

export function reorderExhibitSections(db: Database.Database, packetId: string, sectionIds: string[]) {
  const packet = getPacketRow(db, packetId);
  if (!packet) {
    return { ok: false as const, error: "packet not found" };
  }
  const sections = getSectionRows(db, packetId);
  if (sections.length !== sectionIds.length) {
    return { ok: false as const, error: "section_ids must include every section in the packet" };
  }
  const existingIds = new Set(sections.map((section) => section.id));
  if (sectionIds.some((id) => !existingIds.has(id))) {
    return { ok: false as const, error: "section_ids must all belong to the packet" };
  }
  db.transaction(() => {
    sectionIds.forEach((sectionId, index) => {
      db.prepare(`UPDATE exhibit_sections SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(index, sectionId);
    });
    recordHistory(db, {
      packetId,
      actionType: "sections_reordered",
      targetType: "packet",
      targetId: packetId,
      payload: { section_ids: sectionIds }
    });
  })();
  return { ok: true as const, packet: getCaseExhibitWorkspace(db, packet.case_id).find((row) => row.id === packetId) ?? null };
}

export function reorderExhibitsInSection(db: Database.Database, sectionId: string, exhibitIds: string[]) {
  const section = getSectionRow(db, sectionId);
  if (!section) {
    return { ok: false as const, error: "section not found" };
  }
  const exhibits = getExhibitRows(db, sectionId);
  if (exhibits.length !== exhibitIds.length) {
    return { ok: false as const, error: "exhibit_ids must include every exhibit in the section" };
  }
  const existingIds = new Set(exhibits.map((exhibit) => exhibit.id));
  if (exhibitIds.some((id) => !existingIds.has(id))) {
    return { ok: false as const, error: "exhibit_ids must all belong to the section" };
  }
  db.transaction(() => {
    exhibitIds.forEach((exhibitId, index) => {
      db.prepare(`UPDATE exhibits SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(index, exhibitId);
    });
    recordHistory(db, {
      packetId: section.exhibit_packet_id,
      actionType: "exhibits_reordered",
      targetType: "section",
      targetId: sectionId,
      payload: { exhibit_ids: exhibitIds }
    });
  })();
  return {
    ok: true as const,
    packet: getCaseExhibitWorkspace(db, section.case_id).find((row) => row.id === section.exhibit_packet_id) ?? null
  };
}

export function resolveExhibitSuggestion(
  db: Database.Database,
  input: {
    packetId: string;
    suggestionId: string;
    action: SuggestionResolutionAction;
    note?: string | null;
  }
) {
  const packet = getPacketRow(db, input.packetId);
  if (!packet) {
    return { ok: false as const, error: "packet not found" };
  }
  db.transaction(() => {
    db.prepare(
      `
        INSERT INTO exhibit_suggestion_resolutions
          (id, packet_id, suggestion_id, resolution_action, note)
        VALUES
          (?, ?, ?, ?, ?)
        ON CONFLICT(packet_id, suggestion_id) DO UPDATE SET
          resolution_action = excluded.resolution_action,
          note = excluded.note,
          resolved_at = CURRENT_TIMESTAMP
      `
    ).run(randomUUID(), input.packetId, input.suggestionId, input.action, input.note?.trim() || null);
    recordHistory(db, {
      packetId: input.packetId,
      actionType: "suggestion_resolved",
      targetType: "suggestion",
      targetId: input.suggestionId,
      payload: { action: input.action, note: input.note ?? null }
    });
  })();
  return {
    ok: true as const,
    packet: getCaseExhibitWorkspace(db, packet.case_id).find((row) => row.id === input.packetId) ?? null
  };
}
