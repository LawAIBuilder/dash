import type { FastifyInstance, RouteOptions } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeTempDbPath() {
  const dir = mkdtempSync(join(tmpdir(), "wc-legal-prep-server-composition-"));
  return {
    dir,
    dbPath: join(dir, "authoritative.sqlite")
  };
}

async function loadServer() {
  const { dir, dbPath } = makeTempDbPath();
  vi.resetModules();
  process.env.NODE_ENV = "test";
  process.env.WC_ENABLE_DEV_ROUTES = "1";
  process.env.WC_SKIP_LISTEN = "1";
  process.env.WC_SQLITE_PATH = dbPath;

  const mod = await import("../server.js");
  return {
    app: mod.app as FastifyInstance,
    cleanup: async () => {
      await mod.app.close();
      rmSync(dir, { recursive: true, force: true });
      delete process.env.NODE_ENV;
      delete process.env.WC_ENABLE_DEV_ROUTES;
      delete process.env.WC_SKIP_LISTEN;
      delete process.env.WC_SQLITE_PATH;
    }
  };
}

function expectRoute(app: FastifyInstance, route: RouteOptions["url"], method: RouteOptions["method"]) {
  expect(app.hasRoute({ url: route, method })).toBe(true);
}

describe("server composition", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("boots once and exposes the expected route modules", async () => {
    const server = await loadServer();

    try {
      expectRoute(server.app, "/health", "GET");
      expectRoute(server.app, "/api/workers/ocr/health", "GET");
      expectRoute(server.app, "/api/cases", "GET");
      expectRoute(server.app, "/api/cases", "POST");
      expectRoute(server.app, "/api/document-types", "GET");
      expectRoute(server.app, "/dev/cases", "POST");
      expectRoute(server.app, "/api/connectors/practicepanther/status", "GET");
      expectRoute(server.app, "/api/cases/:caseId/review-queue", "GET");
      expectRoute(server.app, "/api/cases/:caseId/document-templates", "GET");
      expectRoute(server.app, "/api/cases/:caseId/exhibit-packets", "GET");
      expectRoute(server.app, "/api/cases/:caseId/exhibit-packets/:packetId/package-runs", "POST");
    } finally {
      await server.cleanup();
    }
  });
});
