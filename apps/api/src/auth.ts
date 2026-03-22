import type Database from "better-sqlite3";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { readBooleanEnv, readPositiveIntegerEnv } from "./env.js";

export type UserRole = "operator" | "reviewer" | "approver" | "admin";

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  sessionId: string | null;
}

export interface PublicUser {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
}

export interface CaseMembershipUserSummary extends PublicUser {
  active: boolean;
}

export interface CaseMembershipSummary {
  case_id: string;
  user_id: string;
  role: UserRole;
  created_at: string | null;
  updated_at: string | null;
  user: CaseMembershipUserSummary;
}

type DbUserRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  password_salt: string;
  password_hash: string;
  active: number;
};

type DbSessionRow = {
  session_id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  role: string;
  active: number;
};

type DbCaseMembershipRow = {
  case_id: string;
  user_id: string;
  role: string;
};

type DbCaseMembershipListRow = DbCaseMembershipRow & {
  created_at: string | null;
  updated_at: string | null;
  email: string;
  display_name: string | null;
  user_role: string;
  active: number;
};

export interface AuthSessionSummary {
  sessionEnabled: boolean;
  apiKeyFallbackEnabled: boolean;
  bootstrapAdminConfigured: boolean;
  bootstrapAdminPending: boolean;
}

export interface CaseAccessGrant {
  authMode: "none" | "session" | "api_key";
  user: AuthenticatedUser | null;
  membershipRole: UserRole | null;
  adminOverride: boolean;
}

export interface WriteActor {
  authMode: "none" | "session" | "api_key";
  actorLabel: string | null;
  actorUserId: string | null;
  user: AuthenticatedUser | null;
}

declare module "fastify" {
  interface FastifyRequest {
    user: AuthenticatedUser | null;
    authMode: "none" | "session" | "api_key";
  }
}

const SESSION_COOKIE_NAME = "wc_session";
const SESSION_TOUCH_INTERVAL_MS = 5 * 60_000;

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizeRole(value: string | null | undefined): UserRole {
  switch (value) {
    case "operator":
    case "reviewer":
    case "approver":
    case "admin":
      return value;
    default:
      return "operator";
  }
}

export function parseUserRole(value: string | null | undefined): UserRole | null {
  switch (value) {
    case "operator":
    case "reviewer":
    case "approver":
    case "admin":
      return value;
    default:
      return null;
  }
}

function asPublicUser(row: Pick<DbUserRow, "id" | "email" | "display_name" | "role">): PublicUser {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name?.trim() || row.email,
    role: normalizeRole(row.role)
  };
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString("hex");
}

function encodeCookieValue(value: string) {
  return encodeURIComponent(value);
}

function decodeCookieValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    maxAgeSeconds?: number;
    expires?: Date;
    httpOnly?: boolean;
    sameSite?: "Lax" | "Strict" | "None";
    secure?: boolean;
    path?: string;
  } = {}
) {
  const parts = [`${name}=${encodeCookieValue(value)}`];
  parts.push(`Path=${options.path ?? "/"}`);
  if (options.httpOnly !== false) {
    parts.push("HttpOnly");
  }
  parts.push(`SameSite=${options.sameSite ?? "Lax"}`);
  if (options.secure) {
    parts.push("Secure");
  }
  if (typeof options.maxAgeSeconds === "number") {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  }
  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }
  return parts.join("; ");
}

function parseCookieHeader(header: string | undefined) {
  if (!header) {
    return new Map<string, string>();
  }
  return new Map(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separatorIndex = part.indexOf("=");
        if (separatorIndex < 0) {
          return [part, ""];
        }
        const key = part.slice(0, separatorIndex).trim();
        const value = part.slice(separatorIndex + 1).trim();
        return [key, decodeCookieValue(value)];
      })
  );
}

function hashSessionToken(token: string, secret: string) {
  return createHmac("sha256", secret).update(token).digest("hex");
}

function getSessionCookieSecureFlag() {
  if (readBooleanEnv("WC_SESSION_COOKIE_SECURE", process.env.NODE_ENV === "production")) {
    return true;
  }
  return false;
}

export function getSessionSecret() {
  const value = process.env.WC_SESSION_SECRET?.trim();
  return value && value.length > 0 ? value : null;
}

export function isSessionAuthEnabled() {
  return Boolean(getSessionSecret());
}

export function readSessionTtlMs() {
  const hours = readPositiveIntegerEnv("WC_SESSION_TTL_HOURS", 12, {
    min: 1,
    max: 24 * 14
  });
  return hours * 60 * 60 * 1000;
}

export function createPasswordDigest(password: string) {
  const salt = randomBytes(16).toString("hex");
  return {
    salt,
    hash: hashPassword(password, salt)
  };
}

export function verifyPassword(password: string, salt: string, expectedHash: string) {
  const actual = Buffer.from(hashPassword(password, salt), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  if (actual.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(actual, expected);
}

export function countUsers(db: Database.Database) {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM users WHERE active = 1`).get() as { count: number };
  return row.count;
}

export function getAuthSessionSummary(db: Database.Database, apiKeyFallbackEnabled: boolean): AuthSessionSummary {
  const userCount = countUsers(db);
  return {
    sessionEnabled: isSessionAuthEnabled(),
    apiKeyFallbackEnabled,
    bootstrapAdminConfigured: isBootstrapAdminConfigured(),
    bootstrapAdminPending: isSessionAuthEnabled() && userCount === 0
  };
}

export function isBootstrapAdminConfigured() {
  return Boolean(
    process.env.WC_BOOTSTRAP_ADMIN_EMAIL?.trim() && process.env.WC_BOOTSTRAP_ADMIN_PASSWORD?.trim()
  );
}

export function ensureBootstrapAdminUser(db: Database.Database) {
  const email = process.env.WC_BOOTSTRAP_ADMIN_EMAIL?.trim();
  const password = process.env.WC_BOOTSTRAP_ADMIN_PASSWORD?.trim();
  const displayName = process.env.WC_BOOTSTRAP_ADMIN_NAME?.trim() || "Bootstrap Admin";
  const reseed = readBooleanEnv("WC_BOOTSTRAP_ADMIN_RESEED", false);

  if (!email && !password) {
    return { configured: false, created: false, reseeded: false };
  }
  if (!email || !password) {
    throw new Error(
      "WC_BOOTSTRAP_ADMIN_EMAIL and WC_BOOTSTRAP_ADMIN_PASSWORD must both be set when bootstrap admin auth is configured"
    );
  }

  const normalizedEmail = normalizeEmail(email);
  const existing = db
    .prepare(
      `
        SELECT id, email, display_name, role, password_salt, password_hash, active
        FROM users
        WHERE email = ?
        LIMIT 1
      `
    )
    .get(normalizedEmail) as DbUserRow | undefined;

  if (!existing) {
    const digest = createPasswordDigest(password);
    db.prepare(
      `
        INSERT INTO users (id, email, display_name, role, password_salt, password_hash, active)
        VALUES (?, ?, ?, 'admin', ?, ?, 1)
      `
    ).run(randomUUID(), normalizedEmail, displayName, digest.salt, digest.hash);
    return { configured: true, created: true, reseeded: false };
  }

  const updates: string[] = [];
  const values: Array<string | number> = [];

  if (existing.display_name !== displayName) {
    updates.push("display_name = ?");
    values.push(displayName);
  }
  if (existing.role !== "admin") {
    updates.push("role = 'admin'");
  }
  if (existing.active !== 1) {
    updates.push("active = 1");
  }
  let reseeded = false;
  if (reseed) {
    const digest = createPasswordDigest(password);
    updates.push("password_salt = ?", "password_hash = ?");
    values.push(digest.salt, digest.hash);
    reseeded = true;
  }

  if (updates.length > 0) {
    updates.push("updated_at = CURRENT_TIMESTAMP");
    values.push(existing.id);
    db.prepare(
      `
        UPDATE users
        SET ${updates.join(", ")}
        WHERE id = ?
      `
    ).run(...values);
  }

  return {
    configured: true,
    created: false,
    reseeded
  };
}

export function listUsers(db: Database.Database) {
  return db
    .prepare(
      `
        SELECT id, email, display_name, role, active
        FROM users
        WHERE active = 1
        ORDER BY email ASC
      `
    )
    .all()
    .map((row) => asPublicUser(row as Pick<DbUserRow, "id" | "email" | "display_name" | "role">));
}

function mapCaseMembershipRow(row: DbCaseMembershipListRow): CaseMembershipSummary {
  return {
    case_id: row.case_id,
    user_id: row.user_id,
    role: normalizeRole(row.role),
    created_at: row.created_at,
    updated_at: row.updated_at,
    user: {
      id: row.user_id,
      email: row.email,
      display_name: row.display_name?.trim() || row.email,
      role: normalizeRole(row.user_role),
      active: row.active === 1
    }
  };
}

export function authenticateUser(db: Database.Database, email: string, password: string): PublicUser | null {
  const normalizedEmail = normalizeEmail(email);
  const user = db
    .prepare(
      `
        SELECT id, email, display_name, role, password_salt, password_hash, active
        FROM users
        WHERE email = ?
        LIMIT 1
      `
    )
    .get(normalizedEmail) as DbUserRow | undefined;

  if (!user || user.active !== 1) {
    return null;
  }

  if (!verifyPassword(password, user.password_salt, user.password_hash)) {
    return null;
  }

  return asPublicUser(user);
}

export function createAuthSession(
  db: Database.Database,
  input: {
    userId: string;
    ip: string | null;
    userAgent: string | null;
  }
) {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error("WC_SESSION_SECRET must be configured to create browser sessions");
  }

  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(rawToken, secret);
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + readSessionTtlMs());

  db.prepare(
    `
      INSERT INTO auth_sessions
        (id, user_id, token_hash, expires_at, created_ip, created_user_agent, last_seen_at)
      VALUES
        (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `
  ).run(sessionId, input.userId, tokenHash, expiresAt.toISOString(), input.ip, input.userAgent);

  return {
    sessionId,
    token: rawToken,
    expiresAt: expiresAt.toISOString()
  };
}

export function appendSessionCookie(reply: FastifyReply, token: string, expiresAtIso: string) {
  const expiresAt = new Date(expiresAtIso);
  const maxAgeSeconds = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  reply.header(
    "set-cookie",
    serializeCookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "Lax",
      secure: getSessionCookieSecureFlag(),
      path: "/",
      maxAgeSeconds,
      expires: expiresAt
    })
  );
}

export function appendClearedSessionCookie(reply: FastifyReply) {
  reply.header(
    "set-cookie",
    serializeCookie(SESSION_COOKIE_NAME, "", {
      httpOnly: true,
      sameSite: "Lax",
      secure: getSessionCookieSecureFlag(),
      path: "/",
      maxAgeSeconds: 0,
      expires: new Date(0)
    })
  );
}

function getSessionTokenFromRequest(request: FastifyRequest) {
  return parseCookieHeader(request.headers.cookie).get(SESSION_COOKIE_NAME) ?? null;
}

export function revokeSessionByToken(db: Database.Database, token: string | null) {
  const secret = getSessionSecret();
  if (!secret || !token) {
    return false;
  }
  const tokenHash = hashSessionToken(token, secret);
  const result = db
    .prepare(
      `
        UPDATE auth_sessions
        SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
        WHERE token_hash = ?
      `
    )
    .run(tokenHash);
  return result.changes > 0;
}

export function resolveAuthenticatedUser(db: Database.Database, request: FastifyRequest): AuthenticatedUser | null {
  const secret = getSessionSecret();
  const token = getSessionTokenFromRequest(request);
  if (!secret || !token) {
    return null;
  }

  const tokenHash = hashSessionToken(token, secret);
  const row = db
    .prepare(
      `
        SELECT
          s.id AS session_id,
          u.id AS user_id,
          u.email,
          u.display_name,
          u.role,
          u.active,
          s.last_seen_at
        FROM auth_sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?
          AND s.revoked_at IS NULL
          AND s.expires_at > CURRENT_TIMESTAMP
        LIMIT 1
      `
    )
    .get(tokenHash) as (DbSessionRow & { last_seen_at: string | null }) | undefined;

  if (!row || row.active !== 1) {
    return null;
  }

  if (row.last_seen_at) {
    const ageMs = Date.now() - Date.parse(row.last_seen_at);
    if (Number.isFinite(ageMs) && ageMs > SESSION_TOUCH_INTERVAL_MS) {
      db.prepare(`UPDATE auth_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`).run(row.session_id);
    }
  }

  return {
    id: row.user_id,
    email: row.email,
    displayName: row.display_name?.trim() || row.email,
    role: normalizeRole(row.role),
    sessionId: row.session_id
  };
}

export function requireAuthenticatedUser(
  request: FastifyRequest,
  reply: FastifyReply,
  options?: { roles?: UserRole[] }
) {
  if (!request.user) {
    void reply.code(401).send({
      ok: false,
      error: "Login required"
    });
    return null;
  }

  if (options?.roles && !options.roles.includes(request.user.role)) {
    void reply.code(403).send({
      ok: false,
      error: "Forbidden"
    });
    return null;
  }

  return request.user;
}

export function getFallbackActorHeader(request: FastifyRequest) {
  const actorHeader = request.headers["x-wc-actor"];
  if (typeof actorHeader === "string" && actorHeader.trim()) {
    return actorHeader.trim();
  }
  return null;
}

export function readApprovedByFallbackHeader(request: FastifyRequest) {
  return getFallbackActorHeader(request);
}

export function ensureCaseMembership(
  db: Database.Database,
  input: {
    caseId: string;
    userId: string;
    role: UserRole;
  }
) {
  db.prepare(
    `
      INSERT INTO case_memberships (id, case_id, user_id, role)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(case_id, user_id) DO UPDATE SET
        role = excluded.role,
        updated_at = CURRENT_TIMESTAMP
    `
  ).run(randomUUID(), input.caseId, input.userId, input.role);
}

export function listCaseMemberships(db: Database.Database, caseId: string) {
  return db
    .prepare(
      `
        SELECT
          cm.case_id,
          cm.user_id,
          cm.role,
          cm.created_at,
          cm.updated_at,
          u.email,
          u.display_name,
          u.role AS user_role,
          u.active
        FROM case_memberships cm
        JOIN users u ON u.id = cm.user_id
        WHERE cm.case_id = ?
        ORDER BY
          CASE cm.role
            WHEN 'admin' THEN 0
            WHEN 'approver' THEN 1
            WHEN 'reviewer' THEN 2
            ELSE 3
          END,
          u.email ASC
      `
    )
    .all(caseId)
    .map((row) => mapCaseMembershipRow(row as DbCaseMembershipListRow));
}

export function getCaseMembership(
  db: Database.Database,
  input: {
    caseId: string;
    userId: string;
  }
) {
  const row = db
    .prepare(
      `
        SELECT case_id, user_id, role
        FROM case_memberships
        WHERE case_id = ? AND user_id = ?
        LIMIT 1
      `
    )
    .get(input.caseId, input.userId) as DbCaseMembershipRow | undefined;

  if (!row) {
    return null;
  }

  return {
    caseId: row.case_id,
    userId: row.user_id,
    role: normalizeRole(row.role)
  };
}

export function setCaseMembershipRole(
  db: Database.Database,
  input: {
    caseId: string;
    userId: string;
    role: UserRole;
  }
) {
  const user = db
    .prepare(
      `
        SELECT id, email, display_name, role, active
        FROM users
        WHERE id = ?
        LIMIT 1
      `
    )
    .get(input.userId) as
    | {
        id: string;
        email: string;
        display_name: string | null;
        role: string;
        active: number;
      }
    | undefined;

  if (!user || user.active !== 1) {
    return null;
  }

  ensureCaseMembership(db, {
    caseId: input.caseId,
    userId: input.userId,
    role: input.role
  });

  return (
    listCaseMemberships(db, input.caseId).find((membership) => membership.user_id === input.userId) ?? null
  );
}

export function deleteCaseMembership(
  db: Database.Database,
  input: {
    caseId: string;
    userId: string;
  }
) {
  const result = db
    .prepare(`DELETE FROM case_memberships WHERE case_id = ? AND user_id = ?`)
    .run(input.caseId, input.userId);
  return result.changes > 0;
}

export function backfillCaseMembershipsForCase(db: Database.Database, caseId: string) {
  const activeUsers = db
    .prepare(
      `
        SELECT id
        FROM users
        WHERE active = 1
        ORDER BY email ASC
      `
    )
    .all() as Array<{ id: string }>;

  const insertMembership = db.prepare(
    `
      INSERT INTO case_memberships (id, case_id, user_id, role)
      VALUES (?, ?, ?, 'operator')
      ON CONFLICT(case_id, user_id) DO NOTHING
    `
  );

  let insertedCount = 0;
  const runBackfill = db.transaction(() => {
    for (const user of activeUsers) {
      const result = insertMembership.run(randomUUID(), caseId, user.id);
      insertedCount += result.changes;
    }
  });
  runBackfill();

  return {
    inserted_count: insertedCount,
    memberships: listCaseMemberships(db, caseId)
  };
}

export function requireCaseAccess(
  db: Database.Database,
  request: FastifyRequest,
  reply: FastifyReply,
  caseId: string
): CaseAccessGrant | null {
  if (request.user) {
    if (request.user.role === "admin") {
      return {
        authMode: "session",
        user: request.user,
        membershipRole: null,
        adminOverride: true
      };
    }

    const membership = getCaseMembership(db, {
      caseId,
      userId: request.user.id
    });
    if (!membership) {
      void reply.code(403).send({
        ok: false,
        error: "Forbidden"
      });
      return null;
    }

    return {
      authMode: "session",
      user: request.user,
      membershipRole: membership.role,
      adminOverride: false
    };
  }

  if (request.authMode === "api_key") {
    return {
      authMode: "api_key",
      user: null,
      membershipRole: null,
      adminOverride: false
    };
  }

  if (request.authMode === "none") {
    return {
      authMode: "none",
      user: null,
      membershipRole: null,
      adminOverride: false
    };
  }

  void reply.code(401).send({
    ok: false,
    error: "Login required"
  });
  return null;
}

export function requireWriteActor(
  request: FastifyRequest,
  reply: FastifyReply,
  options?: {
    roles?: UserRole[];
    fallbackHeaderLabel?: string;
  }
): WriteActor | null {
  if (request.user) {
    const user = requireAuthenticatedUser(request, reply, options);
    if (!user) {
      return null;
    }
    return {
      authMode: "session",
      actorLabel: user.email,
      actorUserId: user.id,
      user
    };
  }

  if (request.authMode === "api_key") {
    const actorLabel = getFallbackActorHeader(request);
    if (!actorLabel) {
      void reply.code(400).send({
        ok: false,
        error: `${options?.fallbackHeaderLabel ?? "x-wc-actor"} is required when using API key fallback`
      });
      return null;
    }
    return {
      authMode: "api_key",
      actorLabel,
      actorUserId: null,
      user: null
    };
  }

  if (request.authMode === "none") {
    return {
      authMode: "none",
      actorLabel: null,
      actorUserId: null,
      user: null
    };
  }

  void reply.code(401).send({
    ok: false,
    error: "Login required"
  });
  return null;
}
