import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  backfillCaseMembershipsForCase,
  deleteCaseMembership,
  ensureCaseMembership,
  listCaseMemberships,
  parseUserRole,
  requireCaseAccess,
  requireAuthenticatedUser,
  setCaseMembershipRole
} from "../auth.js";
import type { EnsureCaseScaffoldInput } from "../runtime.js";
import type { CaseRouteReply } from "./types.js";

type CaseRow = {
  id: string;
  name: string;
  case_type: string | null;
  status: string;
  employee_name: string | null;
  employer_name: string | null;
  insurer_name: string | null;
  hearing_date: string | null;
  pp_matter_id: string | null;
  box_root_folder_id: string | null;
  created_at: string;
  updated_at: string | null;
};

export interface RegisterCaseCatalogRoutesInput {
  app: FastifyInstance;
  db: Database.Database;
  assertCaseExists: (caseId: string, reply: CaseRouteReply, errorMessage?: string) => boolean;
  ensureCaseScaffold: (
    db: Database.Database,
    input: EnsureCaseScaffoldInput
  ) => {
    caseId: string;
    issueId: string;
    branchInstanceId: string;
    presetId: string;
  };
}

function readCaseRow(db: Database.Database, caseId: string) {
  return db
    .prepare(
      `
        SELECT id, name, case_type, status, employee_name, employer_name, insurer_name, hearing_date, pp_matter_id, box_root_folder_id, created_at, updated_at
        FROM cases
        WHERE id = ?
        LIMIT 1
      `
    )
    .get(caseId) as CaseRow | undefined;
}

export function registerCaseCatalogRoutes(input: RegisterCaseCatalogRoutesInput) {
  const { app, db, assertCaseExists, ensureCaseScaffold } = input;

  function requireCatalogCaseAccess(request: FastifyRequest, reply: FastifyReply, caseId: string) {
    if (!assertCaseExists(caseId, reply)) {
      return null;
    }
    return requireCaseAccess(db, request, reply, caseId);
  }

  function listVisibleCases(request: FastifyRequest) {
    const baseQuery = `
      SELECT
        c.id,
        c.name,
        c.case_type,
        c.status,
        c.employee_name,
        c.employer_name,
        c.insurer_name,
        c.hearing_date,
        c.pp_matter_id,
        c.box_root_folder_id,
        c.created_at,
        c.updated_at,
        COALESCE(conn.status, 'inactive') AS box_connection_status,
        COALESCE(sync.latest_sync_status, 'not_synced') AS latest_sync_status,
        COALESCE(inv.source_item_count, 0) AS source_item_count
      FROM cases c
      LEFT JOIN (
        SELECT si.case_id, COUNT(*) AS source_item_count
        FROM source_items si
        GROUP BY si.case_id
      ) inv ON inv.case_id = c.id
      LEFT JOIN (
        SELECT
          sr.case_id,
          sc.status,
          ROW_NUMBER() OVER (PARTITION BY sr.case_id ORDER BY sr.started_at DESC) AS rn
        FROM sync_runs sr
        JOIN source_connections sc ON sc.id = sr.source_connection_id
        WHERE sc.provider = 'box'
      ) conn ON conn.case_id = c.id AND conn.rn = 1
      LEFT JOIN (
        SELECT
          sr.case_id,
          sr.status AS latest_sync_status,
          ROW_NUMBER() OVER (PARTITION BY sr.case_id ORDER BY sr.started_at DESC) AS rn
        FROM sync_runs sr
        JOIN source_connections sc ON sc.id = sr.source_connection_id
        WHERE sc.provider = 'box'
      ) sync ON sync.case_id = c.id AND sync.rn = 1
    `;

    if (request.user && request.user.role !== "admin") {
      return db
        .prepare(
          `
            ${baseQuery}
            WHERE EXISTS (
              SELECT 1
              FROM case_memberships cm
              WHERE cm.case_id = c.id
                AND cm.user_id = ?
            )
            ORDER BY COALESCE(c.updated_at, c.created_at) DESC
          `
        )
        .all(request.user.id);
    }

    return db
      .prepare(
        `
          ${baseQuery}
          ORDER BY COALESCE(c.updated_at, c.created_at) DESC
        `
      )
      .all();
  }

  app.get("/api/cases", async (request) => {
    const cases = listVisibleCases(request);

    return { cases };
  });

  app.get("/api/document-types", async () => {
    const rows = db
      .prepare(
        `
          SELECT id, canonical_name, category, hearing_relevance, exhibit_policy, exhibit_eligible, mandatory_vlm_ocr
          FROM document_types
          WHERE active = 1
          ORDER BY category ASC, canonical_name ASC
        `
      )
      .all();

    return { document_types: rows };
  });

  app.post("/api/cases", async (request, reply) => {
    const body = request.body as
      | {
          case_id?: string;
          name?: string;
          case_type?: string;
          pp_matter_id?: string;
          box_root_folder_id?: string;
          employee_name?: string;
          employer_name?: string;
          insurer_name?: string;
          hearing_date?: string;
        }
      | undefined;

    if (body?.case_id) {
      return reply.code(400).send({ ok: false, error: "case_id may not be supplied by clients" });
    }

    if (!body?.name?.trim()) {
      return reply.code(400).send({ ok: false, error: "name is required" });
    }

    const scaffold = ensureCaseScaffold(db, {
      name: body.name.trim(),
      caseType: body.case_type,
      ppMatterId: body.pp_matter_id ?? null,
      boxRootFolderId: body.box_root_folder_id ?? null,
      employeeName: body.employee_name ?? null,
      employerName: body.employer_name ?? null,
      insurerName: body.insurer_name ?? null,
      hearingDate: body.hearing_date ?? null
    });

    if (request.user) {
      ensureCaseMembership(db, {
        caseId: scaffold.caseId,
        userId: request.user.id,
        role: request.user.role
      });
    }

    return {
      ok: true,
      case: readCaseRow(db, scaffold.caseId) ?? null,
      issue_id: scaffold.issueId,
      branch_instance_id: scaffold.branchInstanceId
    };
  });

  app.get("/api/cases/:caseId", async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    if (!requireCatalogCaseAccess(request, reply, caseId)) {
      return;
    }
    return { ok: true, case: readCaseRow(db, caseId) ?? null };
  });

  app.get("/api/cases/:caseId/memberships", async (request, reply) => {
    const admin = requireAuthenticatedUser(request, reply, { roles: ["admin"] });
    if (!admin) {
      return;
    }
    const { caseId } = request.params as { caseId: string };
    if (!assertCaseExists(caseId, reply)) {
      return;
    }
    return {
      ok: true,
      case_id: caseId,
      memberships: listCaseMemberships(db, caseId)
    };
  });

  app.put("/api/cases/:caseId/memberships/:userId", async (request, reply) => {
    const admin = requireAuthenticatedUser(request, reply, { roles: ["admin"] });
    if (!admin) {
      return;
    }
    const { caseId, userId } = request.params as { caseId: string; userId: string };
    if (!assertCaseExists(caseId, reply)) {
      return;
    }
    const body = request.body as { role?: string } | undefined;
    const role = parseUserRole(body?.role?.trim());
    if (!role) {
      return reply.code(400).send({
        ok: false,
        error: "role must be one of operator, reviewer, approver, or admin"
      });
    }

    const membership = setCaseMembershipRole(db, {
      caseId,
      userId,
      role
    });
    if (!membership) {
      return reply.code(404).send({
        ok: false,
        error: "active user not found"
      });
    }
    return {
      ok: true,
      membership
    };
  });

  app.delete("/api/cases/:caseId/memberships/:userId", async (request, reply) => {
    const admin = requireAuthenticatedUser(request, reply, { roles: ["admin"] });
    if (!admin) {
      return;
    }
    const { caseId, userId } = request.params as { caseId: string; userId: string };
    if (!assertCaseExists(caseId, reply)) {
      return;
    }
    const removed = deleteCaseMembership(db, {
      caseId,
      userId
    });
    if (!removed) {
      return reply.code(404).send({
        ok: false,
        error: "membership not found"
      });
    }
    return {
      ok: true
    };
  });

  app.post("/api/cases/:caseId/memberships/backfill", async (request, reply) => {
    const admin = requireAuthenticatedUser(request, reply, { roles: ["admin"] });
    if (!admin) {
      return;
    }
    const { caseId } = request.params as { caseId: string };
    if (!assertCaseExists(caseId, reply)) {
      return;
    }
    const result = backfillCaseMembershipsForCase(db, caseId);
    return {
      ok: true,
      case_id: caseId,
      inserted_count: result.inserted_count,
      memberships: result.memberships
    };
  });

  app.patch("/api/cases/:caseId", async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    if (!requireCatalogCaseAccess(request, reply, caseId)) {
      return;
    }

    const body = request.body as
      | {
          name?: string;
          case_type?: string;
          pp_matter_id?: string | null;
          box_root_folder_id?: string | null;
          employee_name?: string | null;
          employer_name?: string | null;
          insurer_name?: string | null;
          hearing_date?: string | null;
        }
      | undefined;

    const patch = body ?? {};
    const updates: string[] = [];
    const params: Array<string | null> = [];

    if (Object.hasOwn(patch, "name")) {
      const nextName = patch.name?.trim();
      if (!nextName) {
        return reply.code(400).send({ ok: false, error: "name cannot be empty" });
      }
      updates.push("name = ?");
      params.push(nextName);
    }
    if (Object.hasOwn(patch, "case_type")) {
      const nextType = patch.case_type?.trim();
      if (!nextType) {
        return reply.code(400).send({ ok: false, error: "case_type cannot be empty" });
      }
      updates.push("case_type = ?");
      params.push(nextType);
    }
    if (Object.hasOwn(patch, "pp_matter_id")) {
      updates.push("pp_matter_id = ?");
      params.push(patch.pp_matter_id ?? null);
    }
    if (Object.hasOwn(patch, "box_root_folder_id")) {
      updates.push("box_root_folder_id = ?");
      params.push(patch.box_root_folder_id ?? null);
    }
    if (Object.hasOwn(patch, "employee_name")) {
      updates.push("employee_name = ?");
      params.push(patch.employee_name ?? null);
    }
    if (Object.hasOwn(patch, "employer_name")) {
      updates.push("employer_name = ?");
      params.push(patch.employer_name ?? null);
    }
    if (Object.hasOwn(patch, "insurer_name")) {
      updates.push("insurer_name = ?");
      params.push(patch.insurer_name ?? null);
    }
    if (Object.hasOwn(patch, "hearing_date")) {
      updates.push("hearing_date = ?");
      params.push(patch.hearing_date ?? null);
    }

    if (updates.length > 0) {
      db.prepare(
        `
          UPDATE cases
          SET ${updates.join(", ")},
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `
      ).run(...params, caseId);
    }

    return { ok: true, case: readCaseRow(db, caseId) ?? null };
  });

  app.post("/dev/cases", async (request) => {
    const body = request.body as
      | {
          case_id?: string;
          name?: string;
          case_type?: string;
          pp_matter_id?: string;
          box_root_folder_id?: string;
          employee_name?: string;
          employer_name?: string;
          insurer_name?: string;
          hearing_date?: string;
        }
      | undefined;

    const scaffold = ensureCaseScaffold(db, {
      caseId: body?.case_id,
      name: body?.name,
      caseType: body?.case_type,
      ppMatterId: body?.pp_matter_id ?? null,
      boxRootFolderId: body?.box_root_folder_id ?? null,
      employeeName: body?.employee_name ?? null,
      employerName: body?.employer_name ?? null,
      insurerName: body?.insurer_name ?? null,
      hearingDate: body?.hearing_date ?? null
    });

    return {
      case_id: scaffold.caseId,
      issue_id: scaffold.issueId,
      branch_instance_id: scaffold.branchInstanceId
    };
  });
}
