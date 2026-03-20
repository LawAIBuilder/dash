import { afterEach, describe, expect, it } from "vitest";
import { runTrackedSourceSync, startSyncRun } from "../sync-lifecycle.js";
import { createTestDb, seedCase, seedSourceConnection } from "./test-helpers.js";

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
      .prepare(`SELECT status, cursor_after, error_message, completed_at FROM sync_runs WHERE id = ? LIMIT 1`)
      .get(syncRunId) as
      | {
          status: string;
          cursor_after: string | null;
          error_message: string | null;
          completed_at: string | null;
        }
      | undefined;
    expect(syncRun?.status).toBe("success");
    expect(syncRun?.cursor_after).toBe("cursor-after");
    expect(syncRun?.error_message).toBeNull();
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
      .prepare(`SELECT status, cursor_after, error_message FROM sync_runs WHERE id = ? LIMIT 1`)
      .get(syncRunId) as
      | {
          status: string;
          cursor_after: string | null;
          error_message: string | null;
        }
      | undefined;
    expect(syncRun?.status).toBe("failed");
    expect(syncRun?.cursor_after).toBeNull();
    expect(syncRun?.error_message).toBe("Simulated PP sync failure");

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
      .prepare(`SELECT status, error_message FROM sync_runs WHERE id = ? LIMIT 1`)
      .get(syncRunId) as
      | {
          status: string;
          error_message: string | null;
        }
      | undefined;
    expect(syncRun?.status).toBe("failed");
    expect(syncRun?.error_message).toBe("Primary sync failure");

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
});
