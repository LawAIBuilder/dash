import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { readWorkerHealth } from "../worker-health.js";

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
    const health = readWorkerHealth(db, "ocr");
    const now = Date.now();
    const heartbeatTime = health ? new Date(health.last_heartbeat_at).getTime() : 0;
    const ageMs = heartbeatTime > 0 ? Math.max(0, now - heartbeatTime) : null;
    const stale = ageMs === null ? true : ageMs > 45_000;

    return {
      ok: true,
      worker: health,
      stale,
      age_ms: ageMs
    };
  });
}
