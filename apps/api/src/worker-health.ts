import type Database from "better-sqlite3";

export interface WorkerHealthRecord {
  worker_name: string;
  status: string;
  last_heartbeat_at: string;
  last_started_at: string | null;
  last_stopped_at: string | null;
  last_error_message: string | null;
  last_processed_count: number;
  metadata_json: string | null;
}

export interface WorkerHealthSummary {
  worker: WorkerHealthRecord | null;
  heartbeatPresent: boolean;
  stale: boolean;
  ageMs: number | null;
  lastHeartbeatAt: string | null;
  status: string | null;
}

function nowIso() {
  return new Date().toISOString();
}

export function writeWorkerHeartbeat(
  db: Database.Database,
  input: {
    workerName: string;
    status: "starting" | "idle" | "processing" | "error" | "stopped";
    processedCount?: number;
    errorMessage?: string | null;
    metadata?: Record<string, unknown> | null;
  }
) {
  const timestamp = nowIso();
  const existing = db
    .prepare(
      `
        SELECT worker_name, last_started_at, last_processed_count
        FROM worker_heartbeats
        WHERE worker_name = ?
        LIMIT 1
      `
    )
    .get(input.workerName) as
    | {
        worker_name: string;
        last_started_at: string | null;
        last_processed_count: number | null;
      }
    | undefined;

  db.prepare(
    `
      INSERT INTO worker_heartbeats
        (
          worker_name,
          status,
          last_heartbeat_at,
          last_started_at,
          last_stopped_at,
          last_error_message,
          last_processed_count,
          metadata_json
        )
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(worker_name) DO UPDATE SET
        status = excluded.status,
        last_heartbeat_at = excluded.last_heartbeat_at,
        last_started_at = excluded.last_started_at,
        last_stopped_at = excluded.last_stopped_at,
        last_error_message = excluded.last_error_message,
        last_processed_count = excluded.last_processed_count,
        metadata_json = excluded.metadata_json
    `
  ).run(
    input.workerName,
    input.status,
    timestamp,
    input.status === "starting" ? timestamp : existing?.last_started_at ?? timestamp,
    input.status === "stopped" ? timestamp : null,
    input.errorMessage ?? null,
    input.processedCount ?? existing?.last_processed_count ?? 0,
    input.metadata ? JSON.stringify(input.metadata) : null
  );
}

export function readWorkerHealth(
  db: Database.Database,
  workerName: string
): WorkerHealthRecord | null {
  const row = db
    .prepare(
      `
        SELECT worker_name, status, last_heartbeat_at, last_started_at, last_stopped_at, last_error_message, last_processed_count, metadata_json
        FROM worker_heartbeats
        WHERE worker_name = ?
        LIMIT 1
      `
    )
    .get(workerName) as WorkerHealthRecord | undefined;

  return row ?? null;
}

export function getWorkerHealthSummary(
  db: Database.Database,
  workerName: string,
  staleAfterMs = 45_000
): WorkerHealthSummary {
  const worker = readWorkerHealth(db, workerName);
  const now = Date.now();
  const heartbeatTime = worker ? new Date(worker.last_heartbeat_at).getTime() : 0;
  const ageMs = heartbeatTime > 0 ? Math.max(0, now - heartbeatTime) : null;

  return {
    worker,
    heartbeatPresent: Boolean(worker),
    stale: ageMs === null ? true : ageMs > staleAfterMs,
    ageMs,
    lastHeartbeatAt: worker?.last_heartbeat_at ?? null,
    status: worker?.status ?? null
  };
}

export function probeWorkerHeartbeatWrite(
  db: Database.Database,
  workerName = "__worker_health_probe__"
) {
  const savepointName = "worker_health_probe";

  try {
    db.exec(`SAVEPOINT ${savepointName}`);
    writeWorkerHeartbeat(db, {
      workerName,
      status: "starting",
      metadata: { probe: true }
    });
    db.exec(`ROLLBACK TO ${savepointName}`);
    db.exec(`RELEASE ${savepointName}`);
    return true;
  } catch {
    try {
      db.exec(`ROLLBACK TO ${savepointName}`);
    } catch {
      // Ignore cleanup failures if the savepoint was never established.
    }
    try {
      db.exec(`RELEASE ${savepointName}`);
    } catch {
      // Ignore cleanup failures during probe rollback.
    }
    return false;
  }
}
