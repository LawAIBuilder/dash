import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { buildReadinessSnapshot } from "../readiness.js";
import { getWorkerHealthSummary } from "../worker-health.js";

export interface RegisterOpsRoutesInput {
  app: FastifyInstance;
  db: Database.Database;
  startupRecovery: Record<string, number>;
}

export function registerOpsRoutes(input: RegisterOpsRoutesInput) {
  const { app, db, startupRecovery } = input;

  app.get("/health", async () => ({
    ok: true,
    service: "wc-authoritative-api",
    seeded_at_startup: true,
    startup_recovery: startupRecovery
  }));

  app.get("/api/workers/ocr/health", async () => {
    const summary = getWorkerHealthSummary(db, "ocr");

    return {
      ok: true,
      worker: summary.worker,
      stale: summary.stale,
      age_ms: summary.ageMs
    };
  });

  app.get("/api/ops/readiness", async () => buildReadinessSnapshot(db, startupRecovery));
}
