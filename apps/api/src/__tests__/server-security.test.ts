import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeTempDbPath() {
  const dir = mkdtempSync(join(tmpdir(), "wc-legal-prep-security-test-"));
  return {
    dir,
    dbPath: join(dir, "authoritative.sqlite")
  };
}

async function loadServerWithEnv(env: Record<string, string | undefined>) {
  const { dir, dbPath } = makeTempDbPath();
  vi.resetModules();
  process.env.WC_SKIP_LISTEN = "1";
  process.env.WC_SQLITE_PATH = dbPath;

  for (const [key, value] of Object.entries(env)) {
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
      rmSync(dir, { recursive: true, force: true });
      delete process.env.WC_SKIP_LISTEN;
      delete process.env.WC_SQLITE_PATH;
      for (const key of Object.keys(env)) {
        delete process.env[key];
      }
    }
  };
}

describe("server security defaults", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("adds basic security headers on API responses", async () => {
    const server = await loadServerWithEnv({
      NODE_ENV: "test",
      WC_ENABLE_DEV_ROUTES: "1"
    });

    try {
      const res = await server.app.inject({
        method: "GET",
        url: "/health"
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
      expect(res.headers["x-dns-prefetch-control"]).toBe("off");
    } finally {
      await server.cleanup();
    }
  });

  it("disables dev routes by default for staging-like environments", async () => {
    const server = await loadServerWithEnv({
      NODE_ENV: "staging",
      WC_ENABLE_DEV_ROUTES: undefined
    });

    try {
      const res = await server.app.inject({
        method: "POST",
        url: "/dev/cases",
        payload: { name: "Should Not Exist" }
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({
        ok: false,
        error: "Not found"
      });
    } finally {
      await server.cleanup();
    }
  });

  it("allows dev routes when explicitly enabled", async () => {
    const server = await loadServerWithEnv({
      NODE_ENV: "staging",
      WC_ENABLE_DEV_ROUTES: "1"
    });

    try {
      const res = await server.app.inject({
        method: "POST",
        url: "/dev/cases",
        payload: { name: "Allowed Dev Route" }
      });

      expect(res.statusCode).toBe(200);
      const payload = res.json<{ case_id: string }>();
      expect(typeof payload.case_id).toBe("string");
      expect(payload.case_id.length).toBeGreaterThan(0);
    } finally {
      await server.cleanup();
    }
  });

  it("hides placeholder box browser auth outside dev mode", async () => {
    const server = await loadServerWithEnv({
      NODE_ENV: "staging",
      WC_ENABLE_DEV_ROUTES: "0"
    });

    try {
      const res = await server.app.inject({
        method: "POST",
        url: "/api/connectors/box/auth/start",
        payload: { account_label: "Staging Box" }
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({
        ok: false,
        error: "Not found"
      });
    } finally {
      await server.cleanup();
    }
  });
});
