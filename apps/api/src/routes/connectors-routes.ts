import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { requireAuthenticatedUser, requireCaseAccess } from "../auth.js";
import { getSourceConnectorSpec } from "../source-adapters.js";
import {
  beginSourceConnectionAuth,
  completeSourceConnectionAuth,
  ensureSourceConnection,
  hydrateBoxInventory,
  hydratePracticePantherState
} from "../runtime.js";
import {
  authenticateBoxConnection,
  collectBoxRecursiveFileInventory,
  createBoxClient,
  fetchBoxFolderInventory,
  resolveBoxProviderConfig
} from "../box-provider.js";
import {
  PRACTICE_PANTHER_SYNC_DEFERRED_MESSAGE,
  buildPracticePantherAuthorizationUrl,
  buildPracticePantherMatterPatch,
  buildPracticePantherSyncCursorValue,
  exchangePracticePantherAuthorizationCode,
  extractPracticePantherCustomFields,
  fetchPracticePantherAccountById,
  fetchPracticePantherCallLogs,
  fetchPracticePantherContacts,
  fetchPracticePantherCurrentUser,
  fetchPracticePantherEmails,
  fetchPracticePantherEvents,
  fetchPracticePantherMatterById,
  fetchPracticePantherMatters,
  fetchPracticePantherNotes,
  fetchPracticePantherRelationships,
  fetchPracticePantherTasks,
  isPracticePantherOAuthReady,
  isPracticePantherProductionSyncConfigured,
  mergePracticePantherConnectionMetadata,
  parsePracticePantherConnectionMetadata,
  refreshPracticePantherAccessToken,
  readPracticePantherConfig,
  serializePracticePantherConnectionMetadata
} from "../pp-provider.js";
import { readSyncCursorValue } from "../sync-lifecycle.js";
import { clampPositiveIntegerInput } from "../env.js";

type ReplyLike = {
  header: (name: string, value: string | number) => unknown;
  code: (c: number) => { send: (b: unknown) => unknown };
};

export interface RegisterConnectorRoutesInput {
  app: FastifyInstance;
  db: Database.Database;
  enableDevRoutes: boolean;
  enforceExpensiveRouteRateLimit: (
    request: { ip: string },
    reply: ReplyLike,
    bucket: string
  ) => boolean;
}

export function registerConnectorRoutes(input: RegisterConnectorRoutesInput) {
  const { app, db, enableDevRoutes, enforceExpensiveRouteRateLimit } = input;

  function requireConnectorAdminAccess(request: FastifyRequest, reply: FastifyReply) {
    if (request.user) {
      return requireAuthenticatedUser(request, reply, { roles: ["admin"] });
    }
    if (request.authMode === "api_key" || request.authMode === "none") {
      return { id: null };
    }
    void reply.code(401).send({ ok: false, error: "Unauthorized" });
    return null;
  }

  function requireConnectorCaseAccess(
    request: FastifyRequest,
    reply: FastifyReply,
    caseId: string
  ) {
    const caseRow = db
      .prepare(
        `
          SELECT id, box_root_folder_id, pp_matter_id
          FROM cases
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(caseId) as
      | {
          id: string;
          box_root_folder_id: string | null;
          pp_matter_id: string | null;
        }
      | undefined;

    if (!caseRow) {
      void reply.code(404).send({ ok: false, error: "case not found" });
      return null;
    }

    const access = requireCaseAccess(db, request, reply, caseRow.id);
    if (!access) {
      return null;
    }

    return caseRow;
  }

  function readSourceConnectionByProvider(provider: "box" | "practicepanther") {
    return db
      .prepare(
        `
          SELECT
            id,
            provider,
            account_label,
            auth_mode,
            status,
            scopes,
            callback_state,
            authorization_url,
            metadata_json,
            external_account_id,
            last_error_message,
            last_verified_at,
            updated_at,
            created_at
          FROM source_connections
          WHERE provider = ?
          ORDER BY COALESCE(updated_at, created_at) DESC, created_at DESC, id DESC
          LIMIT 1
        `
      )
      .get(provider) as
      | {
          id: string;
          provider: string;
          account_label: string | null;
          auth_mode: string;
          status: string;
          scopes: string | null;
          callback_state: string | null;
          authorization_url: string | null;
          metadata_json: string | null;
          external_account_id: string | null;
          last_error_message: string | null;
          last_verified_at: string | null;
          updated_at: string | null;
          created_at: string | null;
        }
      | undefined;
  }

  function readSourceConnectionByCallbackState(provider: "box" | "practicepanther", callbackState: string) {
    return db
      .prepare(
        `
          SELECT
            id,
            provider,
            account_label,
            auth_mode,
            status,
            scopes,
            callback_state,
            authorization_url,
            metadata_json,
            external_account_id,
            last_error_message,
            last_verified_at,
            updated_at,
            created_at
          FROM source_connections
          WHERE provider = ?
            AND callback_state = ?
          LIMIT 1
        `
      )
      .get(provider, callbackState) as
      | {
          id: string;
          provider: string;
          account_label: string | null;
          auth_mode: string;
          status: string;
          scopes: string | null;
          callback_state: string | null;
          authorization_url: string | null;
          metadata_json: string | null;
          external_account_id: string | null;
          last_error_message: string | null;
          last_verified_at: string | null;
          updated_at: string | null;
          created_at: string | null;
        }
      | undefined;
  }

  function updateSourceConnectionMetadata(connectionId: string, metadata: Record<string, unknown>) {
    db.prepare(
      `
        UPDATE source_connections
        SET metadata_json = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
    ).run(serializePracticePantherConnectionMetadata(metadata), connectionId);
  }

  function updatePracticePantherAuthStart(connectionId: string, authorizationUrl: string, metadata: Record<string, unknown>) {
    db.prepare(
      `
        UPDATE source_connections
        SET auth_mode = 'oauth_browser',
            status = 'auth_pending',
            authorization_url = ?,
            metadata_json = ?,
            last_error_message = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
    ).run(authorizationUrl, serializePracticePantherConnectionMetadata(metadata), connectionId);
  }

  function markPracticePantherConnectionError(connectionId: string, message: string) {
    db.prepare(
      `
        UPDATE source_connections
        SET status = 'error',
            last_error_message = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
    ).run(message, connectionId);
  }

  function completePracticePantherConnection(
    connectionId: string,
    payload: {
      accountLabel?: string | null;
      externalAccountId?: string | null;
      metadata: Record<string, unknown>;
    }
  ) {
    db.prepare(
      `
        UPDATE source_connections
        SET account_label = COALESCE(?, account_label),
            auth_mode = 'oauth_browser',
            status = 'active',
            external_account_id = COALESCE(?, external_account_id),
            metadata_json = ?,
            last_verified_at = CURRENT_TIMESTAMP,
            callback_state = NULL,
            authorization_url = NULL,
            last_error_message = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
    ).run(
      payload.accountLabel ?? null,
      payload.externalAccountId ?? null,
      serializePracticePantherConnectionMetadata(payload.metadata),
      connectionId
    );
  }

  const allowedRedirectOrigins = new Set([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    ...(process.env.WC_CORS_ORIGIN?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? [])
  ]);

  function isAllowedRedirectOrigin(url: string): boolean {
    try {
      const parsed = new URL(url);
      return allowedRedirectOrigins.has(parsed.origin);
    } catch {
      return false;
    }
  }

  function buildPracticePantherCallbackRedirect(returnTo: string | null | undefined, success: boolean, message?: string) {
    let target: string;
    if (returnTo && /^https?:\/\//i.test(returnTo) && isAllowedRedirectOrigin(returnTo)) {
      target = returnTo;
    } else if (returnTo && returnTo.startsWith("/")) {
      target = returnTo;
    } else {
      target = "/cases";
    }

    const url = new URL(target, target.startsWith("http") ? undefined : "http://localhost");
    if (success) {
      url.searchParams.set("pp_auth", "success");
    } else {
      url.searchParams.set("pp_auth", "error");
      if (message) {
        url.searchParams.set("pp_error", message);
      }
    }
    return target.startsWith("http") ? url.toString() : `${url.pathname}${url.search}`;
  }

  async function getValidPracticePantherAccessToken(connection: {
    id: string;
    metadata_json: string | null;
  }) {
    const config = readPracticePantherConfig();
    if (!isPracticePantherOAuthReady()) {
      throw new Error(PRACTICE_PANTHER_SYNC_DEFERRED_MESSAGE);
    }

    const metadata = parsePracticePantherConnectionMetadata(connection.metadata_json);
    const oauth = metadata.oauth;
    if (!oauth?.refresh_token) {
      throw new Error("PracticePanther connection is missing refresh_token");
    }

    const expiresAt = oauth.expires_at ? new Date(oauth.expires_at).getTime() : 0;
    const now = Date.now();
    if (oauth.access_token && expiresAt > now + 30_000) {
      return {
        accessToken: oauth.access_token,
        metadata
      };
    }

    const refreshed = await refreshPracticePantherAccessToken(config, oauth.refresh_token);
    const merged = mergePracticePantherConnectionMetadata(connection.metadata_json, {
      oauth: {
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        token_type: refreshed.token_type,
        expires_at: new Date(Date.now() + Math.max(0, refreshed.expires_in - 300) * 1000).toISOString()
      }
    });
    updateSourceConnectionMetadata(connection.id, merged as Record<string, unknown>);
    return {
      accessToken: refreshed.access_token,
      metadata: merged
    };
  }

  app.post("/api/connectors/box/auth/start", async (request, reply) => {
    if (!requireConnectorAdminAccess(request, reply)) return;
    if (!enableDevRoutes) {
      return reply.code(404).send({
        ok: false,
        error: "Not found"
      });
    }

    const spec = getSourceConnectorSpec("box");
    const body = request.body as { account_label?: string; scopes?: string[] } | undefined;
    const connection = beginSourceConnectionAuth(db, {
      provider: spec.provider,
      accountLabel: body?.account_label ?? spec.defaultAccountLabel,
      scopes: body?.scopes
    });

    reply.send({
      ok: true,
      provider: spec.provider,
      connection_id: connection.id,
      auth_mode: connection.auth_mode,
      status: connection.status,
      authorization_url: connection.authorization_url,
      callback_state: connection.callback_state,
      scopes: connection.scopes
    });
  });

  app.post("/api/connectors/box/auth/jwt", async (request, reply) => {
    if (!requireConnectorAdminAccess(request, reply)) return;
    const spec = getSourceConnectorSpec("box");
    const body = request.body as { connection_id?: string | null; account_label?: string | null } | undefined;
    const config = resolveBoxProviderConfig();
    if (!config) {
      return reply.code(400).send({
        ok: false,
        error: "BOX_JWT_CONFIG_JSON or BOX_JWT_CONFIG_FILE must be configured"
      });
    }

    const connection = ensureSourceConnection(db, {
      provider: spec.provider,
      accountLabel: body?.account_label ?? spec.defaultAccountLabel
    });

    const probe = await authenticateBoxConnection(
      db,
      body?.connection_id ?? connection.id,
      config
    );

    return {
      ok: true,
      connection_id: body?.connection_id ?? connection.id,
      probe
    };
  });

  app.get("/api/connectors/box/folders/:folderId/items", async (request, reply) => {
    if (!requireConnectorAdminAccess(request, reply)) return;
    const config = resolveBoxProviderConfig();
    if (!config) {
      return reply.code(400).send({
        ok: false,
        error: "BOX_JWT_CONFIG_JSON or BOX_JWT_CONFIG_FILE must be configured"
      });
    }

    const { folderId } = request.params as { folderId: string };
    const marker =
      typeof request.query === "object" && request.query !== null
        ? ((request.query as { marker?: string }).marker ?? null)
        : null;

    const { client } = createBoxClient(config);
    const inventory = await fetchBoxFolderInventory(client, folderId, {
      marker,
      limit: 1000
    });

    return {
      ok: true,
      folder_id: folderId,
      next_marker: inventory.nextMarker,
      total_count: inventory.totalCount,
      files: inventory.files,
      subfolders: inventory.subfolders
    };
  });

  app.get("/api/connectors/practicepanther/status", async (request, reply) => {
    if (!requireConnectorAdminAccess(request, reply)) return;
    const connection = readSourceConnectionByProvider("practicepanther");
    const sanitized = connection
      ? {
          id: connection.id,
          provider: connection.provider,
          account_label: connection.account_label,
          auth_mode: connection.auth_mode,
          status: connection.status,
          external_account_id: connection.external_account_id,
          last_error_message: connection.last_error_message,
          last_verified_at: connection.last_verified_at,
          updated_at: connection.updated_at,
          created_at: connection.created_at
        }
      : null;
    return {
      ok: true,
      configured: isPracticePantherOAuthReady(),
      api_base_url: readPracticePantherConfig().apiBaseUrl,
      redirect_uri: readPracticePantherConfig().redirectUri,
      connection: sanitized
    };
  });

  app.get("/api/connectors/practicepanther/matters", async (request, reply) => {
    if (!requireConnectorAdminAccess(request, reply)) return;
    const connection = readSourceConnectionByProvider("practicepanther");
    if (!connection) {
      return reply.code(404).send({ ok: false, error: "practicepanther connection not found" });
    }
    try {
      const { accessToken } = await getValidPracticePantherAccessToken(connection);
      const config = readPracticePantherConfig();
      const query =
        typeof request.query === "object" && request.query !== null
          ? (request.query as { search_text?: string }).search_text
          : undefined;
      const matters = await fetchPracticePantherMatters(config, accessToken, {
        searchText: query ?? null
      });
      return { ok: true, matters };
    } catch (error) {
      const message = error instanceof Error ? error.message : "PracticePanther matter list failed";
      markPracticePantherConnectionError(connection.id, message);
      return reply.code(400).send({ ok: false, error: message });
    }
  });

  app.get("/api/connectors/practicepanther/callback", async (request, reply) => {
    const query = (request.query ?? {}) as { code?: string; state?: string; error?: string; error_description?: string };
    if (!query.state) {
      return reply.code(400).send({ ok: false, error: "state is required" });
    }

    const connection = readSourceConnectionByCallbackState("practicepanther", query.state);
    if (!connection) {
      return reply.code(404).send({ ok: false, error: "source connection not found" });
    }

    const currentMetadata = parsePracticePantherConnectionMetadata(connection.metadata_json);
    const returnTo = currentMetadata.return_to ?? null;

    if (query.error) {
      const message = query.error_description ?? query.error;
      markPracticePantherConnectionError(connection.id, message);
      return reply.redirect(buildPracticePantherCallbackRedirect(returnTo, false, message));
    }
    if (!query.code) {
      markPracticePantherConnectionError(connection.id, "authorization code is required");
      return reply.redirect(buildPracticePantherCallbackRedirect(returnTo, false, "authorization code is required"));
    }

    try {
      const config = readPracticePantherConfig();
      const tokens = await exchangePracticePantherAuthorizationCode(config, query.code);
      const oauthMetadata = mergePracticePantherConnectionMetadata(connection.metadata_json, {
        oauth: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_type: tokens.token_type,
          expires_at: new Date(Date.now() + Math.max(0, tokens.expires_in - 300) * 1000).toISOString()
        }
      });
      const me = await fetchPracticePantherCurrentUser(config, tokens.access_token);
      const finalMetadata = mergePracticePantherConnectionMetadata(JSON.stringify(oauthMetadata), {
        user: {
          id: typeof me.id === "string" ? me.id : null,
          display_name: typeof me.display_name === "string" ? me.display_name : null,
          email: typeof me.email === "string" ? me.email : null
        },
        return_to: null
      });
      completePracticePantherConnection(connection.id, {
        accountLabel: connection.account_label,
        externalAccountId: typeof me.id === "string" ? me.id : null,
        metadata: finalMetadata as Record<string, unknown>
      });
      return reply.redirect(buildPracticePantherCallbackRedirect(returnTo, true));
    } catch (error) {
      const message = error instanceof Error ? error.message : "PracticePanther OAuth callback failed";
      markPracticePantherConnectionError(connection.id, message);
      return reply.redirect(buildPracticePantherCallbackRedirect(returnTo, false, message));
    }
  });

  app.post("/api/connectors/practicepanther/sync", async (request, reply) => {
    if (!enforceExpensiveRouteRateLimit(request, reply, "practicepanther-sync")) return;
    if (!isPracticePantherProductionSyncConfigured()) {
      return reply.code(400).send({
        ok: false,
        error: PRACTICE_PANTHER_SYNC_DEFERRED_MESSAGE,
        configured: false
      });
    }
    const body = request.body as
      | {
          case_id?: string;
          pp_matter_id?: string | null;
          search_text?: string | null;
        }
      | undefined;
    if (!body?.case_id?.trim()) {
      return reply.code(400).send({ ok: false, error: "case_id is required" });
    }

    const caseRow = requireConnectorCaseAccess(request, reply, body.case_id.trim());
    if (!caseRow) return;

    const connection = readSourceConnectionByProvider("practicepanther");
    if (!connection) {
      return reply.code(404).send({ ok: false, error: "practicepanther connection not found" });
    }

    try {
      const { accessToken } = await getValidPracticePantherAccessToken(connection);
      const config = readPracticePantherConfig();
      const targetMatterId = body.pp_matter_id?.trim() || caseRow.pp_matter_id;
      if (!targetMatterId) {
        return reply.code(400).send({ ok: false, error: "pp_matter_id is required (body or case field)" });
      }

      const matter = await fetchPracticePantherMatterById(config, accessToken, targetMatterId);
      const matterPatch = buildPracticePantherMatterPatch(matter as Record<string, unknown>);

      const patchUpdates: string[] = [];
      const patchParams: unknown[] = [];
      if (matterPatch.ppMatterId) {
        patchUpdates.push("pp_matter_id = ?");
        patchParams.push(matterPatch.ppMatterId);
      }
      if (matterPatch.hearingDate) {
        patchUpdates.push("hearing_date = ?");
        patchParams.push(matterPatch.hearingDate);
      }
      if (matterPatch.employeeName) {
        patchUpdates.push("employee_name = COALESCE(NULLIF(employee_name, ''), ?)");
        patchParams.push(matterPatch.employeeName);
      }
      if (matterPatch.employerName) {
        patchUpdates.push("employer_name = COALESCE(NULLIF(employer_name, ''), ?)");
        patchParams.push(matterPatch.employerName);
      }
      if (matterPatch.insurerName) {
        patchUpdates.push("insurer_name = COALESCE(NULLIF(insurer_name, ''), ?)");
        patchParams.push(matterPatch.insurerName);
      }
      if (patchUpdates.length > 0) {
        patchUpdates.push("updated_at = CURRENT_TIMESTAMP");
        patchParams.push(caseRow.id);
        db.prepare(`UPDATE cases SET ${patchUpdates.join(", ")} WHERE id = ?`).run(...patchParams);
      }

      const matterRecord = matter as Record<string, unknown>;
      const accountId =
        matterRecord.account_ref && typeof matterRecord.account_ref === "object" && matterRecord.account_ref !== null
          ? ((matterRecord.account_ref as { id?: unknown }).id as string | undefined)
          : undefined;

      const ppSpec = getSourceConnectorSpec("practicepanther");
      const previousCursor = readSyncCursorValue(db, {
        sourceConnectionId: connection.id,
        caseId: caseRow.id,
        cursorKey: ppSpec.cursorKey
      });
      const cursorAfter = buildPracticePantherSyncCursorValue();

      const account = accountId ? await fetchPracticePantherAccountById(config, accessToken, accountId) : null;
      const [contacts, notes, tasks, events, emails, callLogs, relationships] = await Promise.all([
        accountId ? fetchPracticePantherContacts(config, accessToken, accountId) : Promise.resolve([]),
        fetchPracticePantherNotes(config, accessToken, targetMatterId, previousCursor),
        fetchPracticePantherTasks(config, accessToken, targetMatterId, previousCursor),
        fetchPracticePantherEvents(config, accessToken, targetMatterId, previousCursor),
        fetchPracticePantherEmails(config, accessToken, targetMatterId, previousCursor),
        fetchPracticePantherCallLogs(config, accessToken, targetMatterId, previousCursor),
        fetchPracticePantherRelationships(config, accessToken, targetMatterId, previousCursor)
      ]);

      const entities = [
        {
          entity_type: "matter",
          pp_entity_id: String(matter.id),
          title:
            (typeof matter.display_name === "string" && matter.display_name) ||
            (typeof matter.name === "string" && matter.name) ||
            null,
          source_updated_at: typeof matter.updated_at === "string" ? matter.updated_at : null,
          raw_json: {
            ...matter,
            name:
              (typeof matter.name === "string" && matter.name) ||
              (typeof matter.display_name === "string" ? matter.display_name : null),
            pp_matter_id: typeof matter.id === "string" ? matter.id : targetMatterId
          },
          custom_fields: extractPracticePantherCustomFields("matter", matter as Record<string, unknown>)
        },
        ...(account
          ? [
              {
                entity_type: "account",
                pp_entity_id: String(account.id),
                title:
                  (typeof account.display_name === "string" && account.display_name) ||
                  (typeof account.company_name === "string" ? account.company_name : null),
                source_updated_at: typeof account.updated_at === "string" ? account.updated_at : null,
                raw_json: account,
                custom_fields: extractPracticePantherCustomFields("company", account)
              }
            ]
          : []),
        ...contacts.map((contact) => ({
          entity_type: "contact",
          pp_entity_id: String(contact.id),
          title:
            (typeof contact.display_name === "string" && contact.display_name) ||
            (typeof contact.first_name === "string" ? contact.first_name : null),
          source_updated_at: typeof contact.updated_at === "string" ? contact.updated_at : null,
          raw_json: contact,
          custom_fields: extractPracticePantherCustomFields("contact", contact)
        })),
        ...notes.map((note) => ({
          entity_type: "note",
          pp_entity_id: String(note.id),
          title: typeof note.subject === "string" ? note.subject : null,
          source_updated_at: typeof note.updated_at === "string" ? note.updated_at : null,
          raw_json: note
        })),
        ...tasks.map((task) => ({
          entity_type: "task",
          pp_entity_id: String(task.id),
          title: typeof task.subject === "string" ? task.subject : null,
          source_updated_at: typeof task.updated_at === "string" ? task.updated_at : null,
          raw_json: task
        })),
        ...events.map((event) => ({
          entity_type: "event",
          pp_entity_id: String(event.id),
          title: typeof event.subject === "string" ? event.subject : null,
          source_updated_at: typeof event.updated_at === "string" ? event.updated_at : null,
          raw_json: event
        })),
        ...emails.map((email) => ({
          entity_type: "email",
          pp_entity_id: String(email.id),
          title: typeof email.subject === "string" ? email.subject : null,
          source_updated_at: typeof email.updated_at === "string" ? email.updated_at : null,
          raw_json: email
        })),
        ...callLogs.map((callLog) => ({
          entity_type: "calllog",
          pp_entity_id: String(callLog.id),
          title: typeof callLog.subject === "string" ? callLog.subject : null,
          source_updated_at: typeof callLog.updated_at === "string" ? callLog.updated_at : null,
          raw_json: callLog
        })),
        ...relationships.map((relationship) => ({
          entity_type: "relationship",
          pp_entity_id: String(relationship.id),
          title: typeof relationship.name === "string" ? relationship.name : null,
          source_updated_at: typeof relationship.updated_at === "string" ? relationship.updated_at : null,
          raw_json: relationship
        }))
      ];

      const sync = hydratePracticePantherState(db, {
        caseId: caseRow.id,
        accountLabel: connection.account_label ?? "PracticePanther",
        cursorAfter,
        entities
      });

      let contactsPromoted = 0;
      for (const contact of contacts) {
        const c = contact as Record<string, unknown>;
        const ppContactId = typeof c.id === "string" ? c.id : null;
        const displayName = typeof c.display_name === "string" ? c.display_name : null;
        const email = typeof c.email === "string" ? c.email : null;
        const phone = typeof c.phone === "string" ? c.phone : null;
        const company = typeof c.company_name === "string" ? c.company_name : null;
        if (!ppContactId || !displayName) continue;

        const existing = db
          .prepare(`SELECT id FROM case_people WHERE case_id = ? AND pp_contact_id = ? LIMIT 1`)
          .get(caseRow.id, ppContactId) as { id: string } | undefined;
        if (existing) {
          db.prepare(
            `UPDATE case_people SET name = ?, email = COALESCE(?, email), phone = COALESCE(?, phone),
             organization = COALESCE(?, organization) WHERE id = ?`
          ).run(displayName, email, phone, company, existing.id);
        } else {
          db.prepare(
            `INSERT INTO case_people (id, case_id, name, role, organization, email, phone, pp_contact_id)
             VALUES (?, ?, ?, 'contact', ?, ?, ?, ?)`
          ).run(randomUUID(), caseRow.id, displayName, company, email, phone, ppContactId);
        }
        contactsPromoted++;
      }

      for (const rel of relationships) {
        const r = rel as Record<string, unknown>;
        const relName = typeof r.name === "string" ? r.name : typeof r.display_name === "string" ? r.display_name : null;
        const relRole = typeof r.relationship_type === "string" ? r.relationship_type.toLowerCase() : "relationship";
        if (!relName) continue;

        const existingRel = db
          .prepare(`SELECT id FROM case_people WHERE case_id = ? AND name = ? AND role = ? LIMIT 1`)
          .get(caseRow.id, relName, relRole) as { id: string } | undefined;
        if (!existingRel) {
          db.prepare(
            `INSERT INTO case_people (id, case_id, name, role) VALUES (?, ?, ?, ?)`
          ).run(randomUUID(), caseRow.id, relName, relRole);
        }
      }

      return {
        ok: true,
        connection_id: connection.id,
        case_id: caseRow.id,
        pp_matter_id: targetMatterId,
        sync,
        contacts_promoted: contactsPromoted,
        counts: {
          matter: 1,
          account: account ? 1 : 0,
          contacts: contacts.length,
          notes: notes.length,
          tasks: tasks.length,
          events: events.length,
          emails: emails.length,
          calllogs: callLogs.length,
          relationships: relationships.length
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "PracticePanther sync failed";
      markPracticePantherConnectionError(connection.id, message);
      return reply.code(400).send({ ok: false, error: message });
    }
  });

  app.post("/api/connectors/box/sync", async (request, reply) => {
    if (!enforceExpensiveRouteRateLimit(request, reply, "box-sync")) return;
    const config = resolveBoxProviderConfig();
    if (!config) {
      return reply.code(400).send({
        ok: false,
        error: "BOX_JWT_CONFIG_JSON or BOX_JWT_CONFIG_FILE must be configured"
      });
    }

    const body = request.body as
      | {
          case_id?: string;
          root_folder_id?: string | null;
          account_label?: string | null;
          cursor_after?: string | null;
          max_files?: number;
          max_folders?: number;
        }
      | undefined;

    if (!body?.case_id?.trim()) {
      return reply.code(400).send({ ok: false, error: "case_id is required" });
    }

    const caseRow = requireConnectorCaseAccess(request, reply, body.case_id.trim());
    if (!caseRow) return;

    const rootFolderId =
      (typeof body.root_folder_id === "string" && body.root_folder_id.trim().length > 0
        ? body.root_folder_id.trim()
        : null) ?? caseRow.box_root_folder_id;

    if (!rootFolderId) {
      return reply.code(400).send({
        ok: false,
        error: "root_folder_id is required (pass body.root_folder_id or set cases.box_root_folder_id)"
      });
    }

    const maxFiles = clampPositiveIntegerInput(body.max_files, 50_000, { min: 1, max: 200_000 });
    const maxFolders = clampPositiveIntegerInput(body.max_folders, 25_000, { min: 1, max: 200_000 });

    const { client } = createBoxClient(config);
    const collected = await collectBoxRecursiveFileInventory(client, rootFolderId, {
      maxFiles,
      maxFoldersVisited: maxFolders
    });

    const cursorAfter =
      body.cursor_after !== undefined
        ? body.cursor_after
        : `box_full_sync:${rootFolderId}:${new Date().toISOString()}`;

    const inventory = hydrateBoxInventory(db, {
      caseId: caseRow.id,
      accountLabel: body.account_label ?? null,
      cursorAfter: cursorAfter ?? undefined,
      files: collected.files
    });

    return {
      ok: true,
      box_sync: {
        root_folder_id: rootFolderId,
        files_discovered: collected.files.length,
        folders_visited: collected.foldersVisited,
        truncated: collected.truncated
      },
      inventory
    };
  });

  app.post("/api/connectors/practicepanther/auth/start", async (request, reply) => {
    if (!requireConnectorAdminAccess(request, reply)) return;
    const spec = getSourceConnectorSpec("practicepanther");
    const body = request.body as
      | { account_label?: string; scopes?: string[]; return_to?: string | null }
      | undefined;
    if (!isPracticePantherOAuthReady()) {
      return reply.code(400).send({
        ok: false,
        error: PRACTICE_PANTHER_SYNC_DEFERRED_MESSAGE,
        redirect_uri: readPracticePantherConfig().redirectUri
      });
    }
    const connection = beginSourceConnectionAuth(db, {
      provider: spec.provider,
      accountLabel: body?.account_label ?? spec.defaultAccountLabel,
      scopes: body?.scopes,
      authMode: "oauth_browser"
    });

    const existing = readSourceConnectionByProvider("practicepanther");
    const config = readPracticePantherConfig();
    const authorizationUrl = buildPracticePantherAuthorizationUrl(config, connection.callback_state);
    const mergedMetadata = mergePracticePantherConnectionMetadata(existing?.metadata_json ?? null, {
      return_to: body?.return_to ?? null
    });
    updatePracticePantherAuthStart(connection.id, authorizationUrl, mergedMetadata as Record<string, unknown>);

    reply.send({
      ok: true,
      provider: spec.provider,
      connection_id: connection.id,
      auth_mode: connection.auth_mode,
      status: connection.status,
      authorization_url: authorizationUrl,
      callback_state: connection.callback_state,
      scopes: connection.scopes,
      redirect_uri: config.redirectUri
    });
  });

  app.post("/api/connectors/:provider/auth/complete", async (request, reply) => {
    if (!requireConnectorAdminAccess(request, reply)) return;
    const body = request.body as
      | {
          connection_id?: string | null;
          callback_state?: string | null;
          account_label?: string | null;
          auth_mode?: string | null;
          external_account_id?: string | null;
          metadata_json?: Record<string, unknown> | null;
        }
      | undefined;
    const { provider } = request.params as { provider: string };

    if (provider !== "box" && provider !== "practicepanther") {
      return reply.code(400).send({ ok: false, error: "unsupported provider" });
    }

    const result = completeSourceConnectionAuth(db, {
      provider,
      connectionId: body?.connection_id ?? null,
      callbackState: body?.callback_state ?? null,
      accountLabel: body?.account_label ?? null,
      authMode: body?.auth_mode ?? "development_local_process",
      externalAccountId: body?.external_account_id ?? null,
      metadata: body?.metadata_json ?? null
    });

    if (!result.ok) {
      return reply.code(404).send(result);
    }

    return result;
  });

  app.post("/api/connectors/box/development/hydrate", async (request, reply) => {
    const body = request.body as
      | {
          case_id?: string;
          account_label?: string;
          cursor_after?: string;
          files?: Array<{
            remote_id: string;
            title?: string | null;
            filename?: string | null;
            mime_type?: string | null;
            parent_folder_id?: string | null;
            version_token?: string | null;
            remote_modified_at?: string | null;
            content_hash?: string | null;
            authoritative_asset_uri?: string | null;
            raw_json?: Record<string, unknown>;
          }>;
        }
      | undefined;

    if (!body?.case_id || !body.files?.length) {
      return reply.code(400).send({ ok: false, error: "case_id and at least one file are required" });
    }

    if (!requireConnectorCaseAccess(request, reply, body.case_id)) return;

    return hydrateBoxInventory(db, {
      caseId: body.case_id,
      accountLabel: body.account_label ?? null,
      cursorAfter: body.cursor_after ?? null,
      files: body.files
    });
  });

  app.post("/api/connectors/practicepanther/development/hydrate", async (request, reply) => {
    const body = request.body as
      | {
          case_id?: string;
          account_label?: string;
          cursor_after?: string;
          entities?: Array<{
            entity_type: string;
            pp_entity_id: string;
            title?: string | null;
            source_updated_at?: string | null;
            raw_json?: Record<string, unknown>;
            custom_fields?: Array<{
              pp_field_id: string;
              field_key: string;
              label: string;
              entity_scope?: string;
              field_type?: string | null;
              options_json?: unknown;
              value?: unknown;
              normalized_text?: string | null;
              normalized_number?: number | null;
              normalized_date?: string | null;
            }>;
          }>;
        }
      | undefined;

    if (!body?.case_id || !body.entities?.length) {
      return reply.code(400).send({ ok: false, error: "case_id and at least one entity are required" });
    }

    if (!requireConnectorCaseAccess(request, reply, body.case_id)) return;

    return hydratePracticePantherState(db, {
      caseId: body.case_id,
      accountLabel: body.account_label ?? null,
      cursorAfter: body.cursor_after ?? null,
      entities: body.entities
    });
  });
}
