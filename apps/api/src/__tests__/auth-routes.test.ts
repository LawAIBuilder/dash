import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function createTempRoot(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix));
}

async function loadServerWithEnv(root: string, env: Record<string, string | undefined>) {
  vi.resetModules();
  const previousCwd = process.cwd();
  process.chdir(root);
  const previous = new Map<string, string | undefined>();
  const appliedEnv = {
    WC_SKIP_LISTEN: "1",
    ...env
  };

  for (const [key, value] of Object.entries(appliedEnv)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  const mod = await import("../server.js");
  return {
    app: mod.app as FastifyInstance,
    cleanup: async () => {
      await mod.app.close();
      process.chdir(previousCwd);
      for (const [key, value] of previous.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  };
}

describe("auth routes", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("reports bootstrap pending when browser session auth is enabled with no provisioned users", async () => {
    const root = createTempRoot("wc-auth-pending-");
    const dbDir = join(root, "persistent");
    mkdirSync(dbDir, { recursive: true });

    const server = await loadServerWithEnv(root, {
      WC_SQLITE_PATH: join(dbDir, "authoritative.sqlite"),
      WC_SESSION_SECRET: "test-session-secret",
      WC_BOOTSTRAP_ADMIN_EMAIL: undefined,
      WC_BOOTSTRAP_ADMIN_PASSWORD: undefined,
      WC_BOOTSTRAP_ADMIN_NAME: undefined
    });

    try {
      const res = await server.app.inject({
        method: "GET",
        url: "/api/auth/session"
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(
        expect.objectContaining({
          ok: true,
          authenticated: false,
          session_enabled: true,
          bootstrap_admin_pending: true
        })
      );
    } finally {
      await server.cleanup();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("logs in with the bootstrap admin, resolves request.user, and clears the session on logout", async () => {
    const root = createTempRoot("wc-auth-login-");
    const dbDir = join(root, "persistent");
    mkdirSync(dbDir, { recursive: true });

    const server = await loadServerWithEnv(root, {
      WC_SQLITE_PATH: join(dbDir, "authoritative.sqlite"),
      WC_SESSION_SECRET: "test-session-secret",
      WC_BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
      WC_BOOTSTRAP_ADMIN_PASSWORD: "test-password-123",
      WC_BOOTSTRAP_ADMIN_NAME: "Test Admin"
    });

    try {
      const login = await server.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: "admin@example.com",
          password: "test-password-123"
        }
      });

      expect(login.statusCode).toBe(200);
      const cookie = (login.headers["set-cookie"] as string).split(";")[0];
      expect(cookie.startsWith("wc_session=")).toBe(true);

      const session = await server.app.inject({
        method: "GET",
        url: "/api/auth/session",
        headers: {
          cookie
        }
      });
      expect(session.statusCode).toBe(200);
      expect(session.json()).toEqual(
        expect.objectContaining({
          ok: true,
          authenticated: true,
          user: expect.objectContaining({
            email: "admin@example.com",
            display_name: "Test Admin",
            role: "admin"
          })
        })
      );

      const userList = await server.app.inject({
        method: "GET",
        url: "/api/auth/users",
        headers: {
          cookie
        }
      });
      expect(userList.statusCode).toBe(200);
      expect(userList.json<{ users: Array<{ email: string }> }>().users).toEqual(
        expect.arrayContaining([expect.objectContaining({ email: "admin@example.com" })])
      );

      const logout = await server.app.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: {
          cookie
        }
      });
      expect(logout.statusCode).toBe(200);
      expect(String(logout.headers["set-cookie"])).toContain("Max-Age=0");

      const sessionAfterLogout = await server.app.inject({
        method: "GET",
        url: "/api/auth/session",
        headers: {
          cookie
        }
      });
      expect(sessionAfterLogout.statusCode).toBe(200);
      expect(sessionAfterLogout.json()).toEqual(
        expect.objectContaining({
          ok: true,
          authenticated: false
        })
      );
    } finally {
      await server.cleanup();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rate limits repeated login attempts", async () => {
    const root = createTempRoot("wc-auth-rate-limit-");
    const dbDir = join(root, "persistent");
    mkdirSync(dbDir, { recursive: true });

    const server = await loadServerWithEnv(root, {
      WC_SQLITE_PATH: join(dbDir, "authoritative.sqlite"),
      WC_SESSION_SECRET: "test-session-secret",
      WC_BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
      WC_BOOTSTRAP_ADMIN_PASSWORD: "test-password-123",
      WC_BOOTSTRAP_ADMIN_NAME: "Test Admin",
      WC_AUTH_LOGIN_RATE_LIMIT_MAX: "2",
      WC_AUTH_LOGIN_RATE_LIMIT_WINDOW_MS: "60000"
    });

    try {
      const first = await server.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: "admin@example.com",
          password: "wrong-password"
        }
      });
      expect(first.statusCode).toBe(401);

      const second = await server.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: "admin@example.com",
          password: "wrong-password"
        }
      });
      expect(second.statusCode).toBe(401);

      const limited = await server.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: "admin@example.com",
          password: "wrong-password"
        }
      });
      expect(limited.statusCode).toBe(429);
      expect(limited.json()).toEqual(
        expect.objectContaining({
          ok: false,
          error: expect.stringMatching(/too many login attempts/i)
        })
      );
      expect(Number(limited.headers["x-rate-limit-limit"])).toBe(2);
      expect(limited.headers["retry-after"]).toBeTruthy();
    } finally {
      await server.cleanup();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not consume the login bucket for successful logins", async () => {
    const root = createTempRoot("wc-auth-success-rate-limit-");
    const dbDir = join(root, "persistent");
    mkdirSync(dbDir, { recursive: true });

    const server = await loadServerWithEnv(root, {
      WC_SQLITE_PATH: join(dbDir, "authoritative.sqlite"),
      WC_SESSION_SECRET: "test-session-secret",
      WC_BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
      WC_BOOTSTRAP_ADMIN_PASSWORD: "test-password-123",
      WC_BOOTSTRAP_ADMIN_NAME: "Test Admin",
      WC_AUTH_LOGIN_RATE_LIMIT_MAX: "1",
      WC_AUTH_LOGIN_RATE_LIMIT_WINDOW_MS: "60000"
    });

    try {
      const first = await server.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: "admin@example.com",
          password: "test-password-123"
        }
      });
      expect(first.statusCode).toBe(200);

      const second = await server.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: "admin@example.com",
          password: "test-password-123"
        }
      });
      expect(second.statusCode).toBe(200);
      expect(second.headers["x-rate-limit-limit"]).toBeUndefined();
      expect(second.headers["x-rate-limit-remaining"]).toBeUndefined();
    } finally {
      await server.cleanup();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
