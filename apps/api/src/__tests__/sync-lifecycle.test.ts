import { afterEach, describe, expect, it } from "vitest";
import { reconcileStaleSyncRuns, runTrackedSourceSync, startSyncRun } from "../sync-lifecycle.js";
import { createTestDb, createThrowingJsonValue, seedCase, seedSourceConnection } from "./test-helpers.js";

describe("runTrackedSourceSync", () => {
  const openDbs: Array<{ close: () => void }> = [];

  afterEach(() => {
    for (const db of openDbs.splice(0)) {
      db.close();
    }
  });

  it("completes the sync run and clears connector errors on success", () => {
    const db = createTestDb();
    openDbs.push(db);
    const caseId = seedCase(db, {
      caseId: "case-sync-test",
      name: "Sync Test Matter"
    });
    const connectionId = seedSourceConnection(db, {
      connectionId: "conn-sync-test",
      provider: "box",
      accountLabel: "Test Box"
    });
    const syncRunId = startSyncRun(db, {
      sourceConnectionId: connectionId,
      caseId,
      syncType: "box_inventory",
      cursorBefore: "cursor-before"
    });

    let statusDuringRun: string | null = null;

    const { result, snapshotId } = runTrackedSourceSync({
      db,
      sourceConnectionId: connectionId,
      caseId,
      syncRunId,
      snapshotType: "box_inventory",
      sourceType: "box",
      cursorAfter: "cursor-after",
      run: () => {
        statusDuringRun = (
          db.prepare(`SELECT status FROM source_connections WHERE id = ? LIMIT 1`).get(connectionId) as
            | { status: string }
            | undefined
        )?.status ?? null;

        return {
          processedCount: 2,
          itemIds: ["box-1", "box-2"]
        };
      },
      buildSuccessManifest: (runResult) => ({
        item_count: runResult.processedCount,
        item_ids: runResult.itemIds
      }),
      buildFailureManifest: () => ({
        partial: true
      })
    });

    expect(statusDuringRun).toBe("syncing");
    expect(result).toEqual({
      processedCount: 2,
      itemIds: ["box-1", "box-2"]
    });

    const syncRun = db
      .prepare(`SELECT status, cursor_after, error_message, warning_message, completed_at FROM sync_runs WHERE id = ? LIMIT 1`)
      .get(syncRunId) as
      | {
          status: string;
          cursor_after: string | null;
          error_message: string | null;
          warning_message: string | null;
          completed_at: string | null;
        }
      | undefined;
    expect(syncRun?.status).toBe("success");
    expect(syncRun?.cursor_after).toBe("cursor-after");
    expect(syncRun?.error_message).toBeNull();
    expect(syncRun?.warning_message).toBeNull();
    expect(syncRun?.completed_at).not.toBeNull();

    const connection = db
      .prepare(`SELECT status, last_error_message FROM source_connections WHERE id = ? LIMIT 1`)
      .get(connectionId) as
      | {
          status: string;
          last_error_message: string | null;
        }
      | undefined;
    expect(connection?.status).toBe("active");
    expect(connection?.last_error_message).toBeNull();

    const snapshot = db
      .prepare(`SELECT id, manifest_json FROM source_snapshots WHERE id = ? LIMIT 1`)
      .get(snapshotId) as
      | {
          id: string;
          manifest_json: string;
        }
      | undefined;
    expect(snapshot?.id).toBe(snapshotId);
    expect(JSON.parse(snapshot?.manifest_json ?? "{}")).toEqual({
      item_count: 2,
      item_ids: ["box-1", "box-2"]
    });
  });

  it("records a partial failure snapshot and marks the connector errored", () => {
    const db = createTestDb();
    openDbs.push(db);
    const caseId = seedCase(db, {
      caseId: "case-sync-test",
      name: "Sync Test Matter"
    });
    const connectionId = seedSourceConnection(db, {
      connectionId: "conn-sync-test",
      provider: "box",
      accountLabel: "Test Box"
    });
    const syncRunId = startSyncRun(db, {
      sourceConnectionId: connectionId,
      caseId,
      syncType: "pp_incremental",
      cursorBefore: "cursor-before"
    });

    const syncedEntityIds: string[] = [];

    expect(() =>
      runTrackedSourceSync({
        db,
        sourceConnectionId: connectionId,
        caseId,
        syncRunId,
        snapshotType: "pp_state",
        sourceType: "pp",
        cursorAfter: "cursor-after",
        run: () => {
          syncedEntityIds.push("matter-1");
          syncedEntityIds.push("note-1");
          throw new Error("Simulated PP sync failure");
        },
        buildSuccessManifest: () => ({
          item_count: syncedEntityIds.length
        }),
        buildFailureManifest: (errorMessage) => ({
          item_count: syncedEntityIds.length,
          entity_ids: syncedEntityIds,
          partial: true,
          error_message: errorMessage
        })
      })
    ).toThrow("Simulated PP sync failure");

    const syncRun = db
      .prepare(`SELECT status, cursor_after, error_message, warning_message FROM sync_runs WHERE id = ? LIMIT 1`)
      .get(syncRunId) as
      | {
          status: string;
          cursor_after: string | null;
          error_message: string | null;
          warning_message: string | null;
        }
      | undefined;
    expect(syncRun?.status).toBe("failed");
    expect(syncRun?.cursor_after).toBeNull();
    expect(syncRun?.error_message).toBe("Simulated PP sync failure");
    expect(syncRun?.warning_message).toBeNull();

    const connection = db
      .prepare(`SELECT status, last_error_message FROM source_connections WHERE id = ? LIMIT 1`)
      .get(connectionId) as
      | {
          status: string;
          last_error_message: string | null;
        }
      | undefined;
    expect(connection?.status).toBe("error");
    expect(connection?.last_error_message).toBe("Simulated PP sync failure");

    const snapshots = db
      .prepare(`SELECT snapshot_type, manifest_json FROM source_snapshots ORDER BY created_at ASC`)
      .all() as Array<{ snapshot_type: string; manifest_json: string }>;
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.snapshot_type).toBe("pp_state");
    expect(JSON.parse(snapshots[0]?.manifest_json ?? "{}")).toEqual({
      item_count: 2,
      entity_ids: ["matter-1", "note-1"],
      partial: true,
      error_message: "Simulated PP sync failure"
    });
  });

  it("still closes the sync run when failure snapshot recording also fails", () => {
    const db = createTestDb();
    openDbs.push(db);
    const caseId = seedCase(db, {
      caseId: "case-sync-test",
      name: "Sync Test Matter"
    });
    const connectionId = seedSourceConnection(db, {
      connectionId: "conn-sync-test",
      provider: "box",
      accountLabel: "Test Box"
    });
    const syncRunId = startSyncRun(db, {
      sourceConnectionId: connectionId,
      caseId,
      syncType: "box_inventory",
      cursorBefore: "cursor-before"
    });

    const circular: { self?: unknown } = {};
    circular.self = circular;

    expect(() =>
      runTrackedSourceSync({
        db,
        sourceConnectionId: connectionId,
        caseId,
        syncRunId,
        snapshotType: "box_inventory",
        sourceType: "box",
        run: () => {
          throw new Error("Primary sync failure");
        },
        buildSuccessManifest: () => ({
          item_count: 0
        }),
        buildFailureManifest: () => ({
          partial: true,
          bad_payload: circular
        })
      })
    ).toThrow("Primary sync failure");

    const syncRun = db
      .prepare(`SELECT status, error_message, warning_message FROM sync_runs WHERE id = ? LIMIT 1`)
      .get(syncRunId) as
      | {
          status: string;
          error_message: string | null;
          warning_message: string | null;
        }
      | undefined;
    expect(syncRun?.status).toBe("failed");
    expect(syncRun?.error_message).toBe("Primary sync failure");
    expect(syncRun?.warning_message).toBeNull();

    const connection = db
      .prepare(`SELECT status, last_error_message FROM source_connections WHERE id = ? LIMIT 1`)
      .get(connectionId) as
      | {
          status: string;
          last_error_message: string | null;
        }
      | undefined;
    expect(connection?.status).toBe("error");
    expect(connection?.last_error_message).toBe("Primary sync failure");

    const snapshotCount = db
      .prepare(`SELECT COUNT(*) AS count FROM source_snapshots`)
      .get() as { count: number };
    expect(snapshotCount.count).toBe(0);
  });

  it("keeps success status when only success snapshot persistence fails", () => {
    const db = createTestDb();
    openDbs.push(db);
    const caseId = seedCase(db, {
      caseId: "case-sync-snapshot-warning",
      name: "Sync Snapshot Warning Matter"
    });
    const connectionId = seedSourceConnection(db, {
      connectionId: "conn-sync-snapshot-warning",
      provider: "box",
      accountLabel: "Test Box"
    });
    const syncRunId = startSyncRun(db, {
      sourceConnectionId: connectionId,
      caseId,
      syncType: "box_inventory",
      cursorBefore: "cursor-before"
    });

    const outcome = runTrackedSourceSync({
      db,
      sourceConnectionId: connectionId,
      caseId,
      syncRunId,
      snapshotType: "box_inventory",
      sourceType: "box",
      cursorAfter: "cursor-after",
      run: () => ({
        processedCount: 1
      }),
      buildSuccessManifest: () => ({
        item_count: 1,
        bad_payload: createThrowingJsonValue("success snapshot serialization failed")
      }),
      buildFailureManifest: () => ({
        partial: true
      })
    });

    expect(outcome.result).toEqual({ processedCount: 1 });
    expect(outcome.snapshotId).toBeNull();
    expect(outcome.warnings).toEqual([
      expect.stringContaining("snapshot_record_failed: success snapshot serialization failed")
    ]);

    const syncRun = db
      .prepare(`SELECT status, cursor_after, error_message, warning_message FROM sync_runs WHERE id = ? LIMIT 1`)
      .get(syncRunId) as
      | {
          status: string;
          cursor_after: string | null;
          error_message: string | null;
          warning_message: string | null;
        }
      | undefined;
    expect(syncRun?.status).toBe("success");
    expect(syncRun?.cursor_after).toBe("cursor-after");
    expect(syncRun?.error_message).toBeNull();
    expect(syncRun?.warning_message).toContain("snapshot_record_failed");

    const connection = db
      .prepare(`SELECT status, last_error_message FROM source_connections WHERE id = ? LIMIT 1`)
      .get(connectionId) as
      | {
          status: string;
          last_error_message: string | null;
        }
      | undefined;
    expect(connection?.status).toBe("active");
    expect(connection?.last_error_message).toBeNull();

    const snapshotCount = db
      .prepare(`SELECT COUNT(*) AS count FROM source_snapshots`)
      .get() as { count: number };
    expect(snapshotCount.count).toBe(0);
  });

  it("reconciles stale running sync rows and marks syncing connectors errored", () => {
    const db = createTestDb();
    openDbs.push(db);
    const caseId = seedCase(db, {
      caseId: "case-sync-stale",
      name: "Stale Sync Matter"
    });
    const connectionId = seedSourceConnection(db, {
      connectionId: "conn-sync-stale",
      provider: "box",
      accountLabel: "Test Box",
      status: "syncing"
    });

    db.prepare(
      `
        INSERT INTO sync_runs (id, source_connection_id, case_id, sync_type, status, started_at)
        VALUES (?, ?, ?, 'box_inventory', 'running', datetime('now', '-90 minutes'))
      `
    ).run("sync-run-stale-1", connectionId, caseId);

    const reconciled = reconcileStaleSyncRuns(db, {
      staleAfterMinutes: 30,
      errorMessage: "Recovered stale sync run"
    });
    expect(reconciled).toBe(1);

    const syncRun = db
      .prepare(`SELECT status, error_message, warning_message, completed_at FROM sync_runs WHERE id = ? LIMIT 1`)
      .get("sync-run-stale-1") as
      | {
          status: string;
          error_message: string | null;
          warning_message: string | null;
          completed_at: string | null;
        }
      | undefined;
    expect(syncRun?.status).toBe("failed");
    expect(syncRun?.error_message).toBe("Recovered stale sync run");
    expect(syncRun?.warning_message).toBeNull();
    expect(syncRun?.completed_at).not.toBeNull();

    const connection = db
      .prepare(`SELECT status, last_error_message FROM source_connections WHERE id = ? LIMIT 1`)
      .get(connectionId) as
      | {
          status: string;
          last_error_message: string | null;
        }
      | undefined;
    expect(connection?.status).toBe("error");
    expect(connection?.last_error_message).toBe("Recovered stale sync run");
  });
});
