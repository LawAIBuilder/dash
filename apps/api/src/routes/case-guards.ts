import type Database from "better-sqlite3";
import { getExhibitCaseId, getExhibitItemCaseId, getPacketCaseId, getSectionCaseId } from "../exhibits.js";
import { listSourceItemsMissingFromCase } from "../retrieval.js";
import type { CaseRouteReply } from "./types.js";

function sendNotFound(reply: CaseRouteReply, error: string): false {
  void reply.code(404).send({ ok: false, error });
  return false;
}

export interface CaseRouteGuards {
  assertCaseExists: (caseId: string, reply: CaseRouteReply, errorMessage?: string) => boolean;
  assertPacketBelongsToCase: (
    caseId: string,
    packetId: string,
    reply: CaseRouteReply,
    errorMessage?: string
  ) => boolean;
  assertSectionBelongsToCase: (
    caseId: string,
    sectionId: string,
    reply: CaseRouteReply,
    errorMessage?: string
  ) => boolean;
  assertExhibitBelongsToCase: (
    caseId: string,
    exhibitId: string,
    reply: CaseRouteReply,
    errorMessage?: string
  ) => boolean;
  assertExhibitItemBelongsToCase: (
    caseId: string,
    itemId: string,
    reply: CaseRouteReply,
    errorMessage?: string
  ) => boolean;
  assertPackageRunBelongsToCase: (
    caseId: string,
    runId: string,
    reply: CaseRouteReply,
    errorMessage?: string
  ) => boolean;
  assertPackageRuleBelongsToCase: (
    caseId: string,
    ruleId: string,
    reply: CaseRouteReply,
    errorMessage?: string
  ) => boolean;
  assertSourceItemsBelongToCase: (
    caseId: string,
    sourceItemIds: string[],
    reply: CaseRouteReply,
    errorMessage?: string
  ) => boolean;
  assertSourceItemBelongsToCase: (
    caseId: string,
    sourceItemId: string,
    reply: CaseRouteReply,
    errorMessage?: string
  ) => boolean;
  assertCanonicalPageBelongsToCase: (
    caseId: string,
    canonicalPageId: string,
    reply: CaseRouteReply,
    errorMessage?: string
  ) => boolean;
}

export function createCaseRouteGuards(db: Database.Database): CaseRouteGuards {
  function assertCaseExists(caseId: string, reply: CaseRouteReply, errorMessage = "case not found"): boolean {
    const row = db.prepare(`SELECT id FROM cases WHERE id = ? LIMIT 1`).get(caseId) as { id: string } | undefined;
    if (!row) {
      return sendNotFound(reply, errorMessage);
    }
    return true;
  }

  function assertPacketBelongsToCase(
    caseId: string,
    packetId: string,
    reply: CaseRouteReply,
    errorMessage = "packet not found for this case"
  ): boolean {
    const packetCase = getPacketCaseId(db, packetId);
    if (!packetCase || packetCase.case_id !== caseId) {
      return sendNotFound(reply, errorMessage);
    }
    return true;
  }

  function assertSectionBelongsToCase(
    caseId: string,
    sectionId: string,
    reply: CaseRouteReply,
    errorMessage = "section not found for this case"
  ): boolean {
    const sectionCase = getSectionCaseId(db, sectionId);
    if (!sectionCase || sectionCase.case_id !== caseId) {
      return sendNotFound(reply, errorMessage);
    }
    return true;
  }

  function assertExhibitBelongsToCase(
    caseId: string,
    exhibitId: string,
    reply: CaseRouteReply,
    errorMessage = "exhibit not found for this case"
  ): boolean {
    const exhibitCase = getExhibitCaseId(db, exhibitId);
    if (!exhibitCase || exhibitCase.case_id !== caseId) {
      return sendNotFound(reply, errorMessage);
    }
    return true;
  }

  function assertExhibitItemBelongsToCase(
    caseId: string,
    itemId: string,
    reply: CaseRouteReply,
    errorMessage = "exhibit item not found for this case"
  ): boolean {
    const itemCase = getExhibitItemCaseId(db, itemId);
    if (!itemCase || itemCase.case_id !== caseId) {
      return sendNotFound(reply, errorMessage);
    }
    return true;
  }

  function resolvePackageRunCaseId(runId: string): string | null {
    const row = db
      .prepare(
        `
          SELECT ep.case_id
          FROM package_runs pr
          JOIN exhibit_packets ep ON ep.id = pr.packet_id
          WHERE pr.id = ?
          LIMIT 1
        `
      )
      .get(runId) as { case_id: string } | undefined;
    return row?.case_id ?? null;
  }

  function assertPackageRunBelongsToCase(
    caseId: string,
    runId: string,
    reply: CaseRouteReply,
    errorMessage = "package run not found for this case"
  ): boolean {
    const runCaseId = resolvePackageRunCaseId(runId);
    if (!runCaseId || runCaseId !== caseId) {
      return sendNotFound(reply, errorMessage);
    }
    return true;
  }

  function resolvePackageRuleCaseId(ruleId: string): string | null {
    const row = db.prepare(`SELECT case_id FROM package_rules WHERE id = ? LIMIT 1`).get(ruleId) as
      | { case_id: string }
      | undefined;
    return row?.case_id ?? null;
  }

  function assertPackageRuleBelongsToCase(
    caseId: string,
    ruleId: string,
    reply: CaseRouteReply,
    errorMessage = "rule not found for this case"
  ): boolean {
    const ruleCaseId = resolvePackageRuleCaseId(ruleId);
    if (!ruleCaseId || ruleCaseId !== caseId) {
      return sendNotFound(reply, errorMessage);
    }
    return true;
  }

  function assertSourceItemsBelongToCase(
    caseId: string,
    sourceItemIds: string[],
    reply: CaseRouteReply,
    errorMessage = "source item not found for this case"
  ): boolean {
    const missingIds = listSourceItemsMissingFromCase(db, caseId, sourceItemIds);
    if (missingIds.length > 0) {
      return sendNotFound(reply, errorMessage);
    }
    return true;
  }

  function resolveSourceItemCaseId(sourceItemId: string): string | null {
    const row = db.prepare(`SELECT case_id FROM source_items WHERE id = ? LIMIT 1`).get(sourceItemId) as
      | { case_id: string }
      | undefined;
    return row?.case_id ?? null;
  }

  function assertSourceItemBelongsToCase(
    caseId: string,
    sourceItemId: string,
    reply: CaseRouteReply,
    errorMessage = "source item not found for this case"
  ): boolean {
    const sourceItemCaseId = resolveSourceItemCaseId(sourceItemId);
    if (!sourceItemCaseId || sourceItemCaseId !== caseId) {
      return sendNotFound(reply, errorMessage);
    }
    return true;
  }

  function resolveCanonicalPageCaseId(canonicalPageId: string): string | null {
    const row = db
      .prepare(
        `
          SELECT cd.case_id
          FROM canonical_pages cp
          JOIN canonical_documents cd ON cd.id = cp.canonical_doc_id
          WHERE cp.id = ?
          LIMIT 1
        `
      )
      .get(canonicalPageId) as { case_id: string } | undefined;
    return row?.case_id ?? null;
  }

  function assertCanonicalPageBelongsToCase(
    caseId: string,
    canonicalPageId: string,
    reply: CaseRouteReply,
    errorMessage = "canonical page not found for this case"
  ): boolean {
    const canonicalPageCaseId = resolveCanonicalPageCaseId(canonicalPageId);
    if (!canonicalPageCaseId || canonicalPageCaseId !== caseId) {
      return sendNotFound(reply, errorMessage);
    }
    return true;
  }

  return {
    assertCaseExists,
    assertPacketBelongsToCase,
    assertSectionBelongsToCase,
    assertExhibitBelongsToCase,
    assertExhibitItemBelongsToCase,
    assertPackageRunBelongsToCase,
    assertPackageRuleBelongsToCase,
    assertSourceItemsBelongToCase,
    assertSourceItemBelongsToCase,
    assertCanonicalPageBelongsToCase
  };
}
