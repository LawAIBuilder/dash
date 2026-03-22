import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import {
  appendClearedSessionCookie,
  appendSessionCookie,
  authenticateUser,
  createAuthSession,
  getAuthSessionSummary,
  isSessionAuthEnabled,
  listUsers,
  revokeSessionByToken
} from "../auth.js";

export interface RegisterAuthRoutesInput {
  app: FastifyInstance;
  db: Database.Database;
  apiKeyFallbackEnabled: boolean;
}

export function registerAuthRoutes(input: RegisterAuthRoutesInput) {
  const { app, db, apiKeyFallbackEnabled } = input;

  app.get("/api/auth/session", async (request) => {
    const summary = getAuthSessionSummary(db, apiKeyFallbackEnabled);
    return {
      ok: true,
      authenticated: Boolean(request.user),
      user: request.user
        ? {
            id: request.user.id,
            email: request.user.email,
            display_name: request.user.displayName,
            role: request.user.role
          }
        : null,
      session_enabled: summary.sessionEnabled,
      api_key_fallback_enabled: summary.apiKeyFallbackEnabled,
      bootstrap_admin_configured: summary.bootstrapAdminConfigured,
      bootstrap_admin_pending: summary.bootstrapAdminPending
    };
  });

  app.post("/api/auth/login", async (request, reply) => {
    if (!isSessionAuthEnabled()) {
      return reply.code(503).send({
        ok: false,
        error: "Browser session auth is not configured on this server"
      });
    }

    const body = request.body as { email?: string; password?: string } | undefined;
    if (typeof body?.email !== "string" || typeof body?.password !== "string") {
      return reply.code(400).send({
        ok: false,
        error: "email and password are required"
      });
    }

    const user = authenticateUser(db, body.email, body.password);
    if (!user) {
      return reply.code(401).send({
        ok: false,
        error: "Invalid email or password"
      });
    }

    const session = createAuthSession(db, {
      userId: user.id,
      ip: request.ip || null,
      userAgent: request.headers["user-agent"]?.trim() || null
    });
    appendSessionCookie(reply, session.token, session.expiresAt);

    return {
      ok: true,
      user,
      session_expires_at: session.expiresAt
    };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const cookies = request.headers.cookie ?? "";
    const sessionToken =
      cookies
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("wc_session="))
        ?.slice("wc_session=".length) ?? null;

    revokeSessionByToken(db, sessionToken ? decodeURIComponent(sessionToken) : null);
    appendClearedSessionCookie(reply);

    return {
      ok: true
    };
  });

  app.get("/api/auth/users", async (request, reply) => {
    if (!request.user || request.user.role !== "admin") {
      return reply.code(403).send({
        ok: false,
        error: "Forbidden"
      });
    }
    return {
      ok: true,
      users: listUsers(db)
    };
  });
}

