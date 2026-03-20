import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { writeCaseEvent } from "./events.js";

export interface ReadSyncCursorInput {
  sourceConnectionId: string;
  caseId: string;
  cursorKey: string;
}

export function readSyncCursorValue(
  db: Database.Database,
  input: ReadSyncCursorInput
) {
  const existing = db
    .prepare(
      `
        SELECT cursor_value
        FROM sync_cursors
        WHERE source_connection_id = ? AND case_id = ? AND cursor_key = ?
        LIMIT 1
      `
    )
    .get(input.sourceConnectionId, input.caseId, input.cursorKey) as { cursor_value: string } | undefined;

  return existing?.cursor_value ?? null;
}

export interface UpsertSyncCursorInput {
  sourceConnectionId: string;
  caseId: string;
  cursorKey: string;
  cursorValue: string;
}

export function upsertSyncCursor(
  db: Database.Database,
  input: UpsertSyncCursorInput
) {
  const existing = db
    .prepare(
      `
        SELECT id
        FROM sync_cursors
        WHERE source_connection_id = ? AND case_id = ? AND cursor_key = ?
        LIMIT 1
      `
    )
    .get(input.sourceConnectionId, input.caseId, input.cursorKey) as { id: string } | undefined;

  db.prepare(
    `
      INSERT INTO sync_cursors
        (id, source_connection_id, case_id, cursor_key, cursor_value)
      VALUES
        (?, ?, ?, ?, ?)
      ON CONFLICT(source_connection_id, case_id, cursor_key) DO UPDATE SET
        cursor_value = excluded.cursor_value,
        updated_at = CURRENT_TIMESTAMP
    `
  ).run(
    existing?.id ?? randomUUID(),
    input.sourceConnectionId,
    input.caseId,
    input.cursorKey,
    input.cursorValue
  );
}

export interface StartSyncRunInput {
  sourceConnectionId: string;
  caseId: string;
  syncType: string;
  cursorBefore?: string | null;
}

export function startSyncRun(
  db: Database.Database,
  input: StartSyncRunInput
) {
  const syncRunId = randomUUID();
  db.prepare(
    `
      INSERT INTO sync_runs
        (id, source_connection_id, case_id, sync_type, status, cursor_before)
      VALUES
        (?, ?, ?, ?, 'running', ?)
    `
  ).run(
    syncRunId,
    input.sourceConnectionId,
    input.caseId,
    input.syncType,
    input.cursorBefore ?? null
  );

  return syncRunId;
}

export interface CompleteSyncRunInput {
  syncRunId: string;
  cursorAfter?: string | null;
  status?: "success" | "failed";
  errorMessage?: string | null;
}

export function completeSyncRun(
  db: Database.Database,
  input: CompleteSyncRunInput
) {
  db.prepare(
    `
      UPDATE sync_runs
      SET status = ?,
          completed_at = CURRENT_TIMESTAMP,
          cursor_after = ?,
          error_message = ?
      WHERE id = ?
    `
  ).run(
    input.status ?? "success",
    input.cursorAfter ?? null,
    input.errorMessage ?? null,
    input.syncRunId
  );
}

export interface SetSourceConnectionStatusInput {
  sourceConnectionId: string;
  status: string;
  lastErrorMessage?: string | null;
}

export function setSourceConnectionStatus(
  db: Database.Database,
  input: SetSourceConnectionStatusInput
) {
  db.prepare(
    `
      UPDATE source_connections
      SET status = ?,
          last_error_message = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
  ).run(
    input.status,
    input.lastErrorMessage ?? null,
    input.sourceConnectionId
  );
}

export interface RecordSourceSnapshotInput {
  caseId: string;
  sourceConnectionId: string;
  snapshotType: string;
  sourceType: "box" | "pp";
  manifest: Record<string, unknown>;
}

export function recordSourceSnapshot(
  db: Database.Database,
  input: RecordSourceSnapshotInput
) {
  const snapshotId = randomUUID();
  db.prepare(
    `
      INSERT INTO source_snapshots
        (id, case_id, source_connection_id, snapshot_type, manifest_json)
      VALUES
        (?, ?, ?, ?, ?)
    `
  ).run(
    snapshotId,
    input.caseId,
    input.sourceConnectionId,
    input.snapshotType,
    JSON.stringify(input.manifest)
  );

  writeCaseEvent(db, {
    caseId: input.caseId,
    eventName: "snapshot.created",
    sourceType: input.sourceType,
    sourceId: snapshotId,
    payload: {
      snapshot_id: snapshotId,
      snapshot_type: input.snapshotType,
      item_count: input.manifest.item_count ?? 0,
      source_connection_id: input.sourceConnectionId
    }
  });

  return snapshotId;
}

export interface RunTrackedSourceSyncInput<TResult> {
  db: Database.Database;
  sourceConnectionId: string;
  caseId: string;
  syncRunId: string;
  snapshotType: string;
  sourceType: "box" | "pp";
  cursorAfter?: string | null;
  run: () => TResult;
  buildSuccessManifest: (result: TResult) => Record<string, unknown>;
  buildFailureManifest: (errorMessage: string) => Record<string, unknown>;
}

export function runTrackedSourceSync<TResult>(
  input: RunTrackedSourceSyncInput<TResult>
) {
  setSourceConnectionStatus(input.db, {
    sourceConnectionId: input.sourceConnectionId,
    status: "syncing"
  });

  try {
    const result = input.run();
    const snapshotId = recordSourceSnapshot(input.db, {
      caseId: input.caseId,
      sourceConnectionId: input.sourceConnectionId,
      snapshotType: input.snapshotType,
      sourceType: input.sourceType,
      manifest: input.buildSuccessManifest(result)
    });

    completeSyncRun(input.db, {
      syncRunId: input.syncRunId,
      cursorAfter: input.cursorAfter ?? null
    });
    setSourceConnectionStatus(input.db, {
      sourceConnectionId: input.sourceConnectionId,
      status: "active",
      lastErrorMessage: null
    });

    return {
      result,
      snapshotId
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown sync failure";

    try {
      recordSourceSnapshot(input.db, {
        caseId: input.caseId,
        sourceConnectionId: input.sourceConnectionId,
        snapshotType: input.snapshotType,
        sourceType: input.sourceType,
        manifest: input.buildFailureManifest(errorMessage)
      });
    } catch {
      // Preserve the original sync failure if snapshot recording also fails.
    }

    completeSyncRun(input.db, {
      syncRunId: input.syncRunId,
      status: "failed",
      errorMessage
    });
    setSourceConnectionStatus(input.db, {
      sourceConnectionId: input.sourceConnectionId,
      status: "error",
      lastErrorMessage: errorMessage
    });

    throw error;
  }
}
