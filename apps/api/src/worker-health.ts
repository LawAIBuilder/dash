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
        SELECT worker_name, last_started_at
        FROM worker_heartbeats
        WHERE worker_name = ?
        LIMIT 1
      `
    )
    .get(input.workerName) as { worker_name: string; last_started_at: string | null } | undefined;

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
    input.processedCount ?? 0,
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
