import { afterEach, describe, expect, it } from "vitest";
import { hydratePracticePantherState } from "../runtime.js";
import { createSeededTestDb, createThrowingJsonValue } from "./test-helpers.js";

describe("hydratePracticePantherState", () => {
  const openDbs: Array<{ close: () => void }> = [];

  afterEach(() => {
    for (const db of openDbs.splice(0)) {
      db.close();
    }
  });

  it("creates source items and applies the matter patch", () => {
    const db = createSeededTestDb();
    openDbs.push(db);

    const result = hydratePracticePantherState(db, {
      caseId: "case-pp-matter",
      entities: [
        {
          entity_type: "matter",
          pp_entity_id: "pp-123",
          raw_json: {
            name: "Smith v. Acme",
            pp_matter_id: "pp-123",
            box_root_folder_id: "folder-456"
          }
        }
      ]
    });

    expect(result.synced_count).toBe(1);

    const sourceItem = db.prepare(
      `
        SELECT provider, source_kind, title
        FROM source_items
        WHERE case_id = ?
        LIMIT 1
      `
    ).get("case-pp-matter") as
      | {
          provider: string;
          source_kind: string;
          title: string | null;
        }
      | undefined;

    expect(sourceItem).toEqual({
      provider: "practicepanther",
      source_kind: "matter",
      title: "Smith v. Acme"
    });

    const caseRow = db.prepare(
      `
        SELECT name, pp_matter_id, box_root_folder_id
        FROM cases
        WHERE id = ?
        LIMIT 1
      `
    ).get("case-pp-matter") as
      | {
          name: string;
          pp_matter_id: string | null;
          box_root_folder_id: string | null;
        }
      | undefined;

    expect(caseRow).toEqual({
      name: "Smith v. Acme",
      pp_matter_id: "pp-123",
      box_root_folder_id: "folder-456"
    });
  });

  it("persists custom field definitions and values", () => {
    const db = createSeededTestDb();
    openDbs.push(db);

    hydratePracticePantherState(db, {
      caseId: "case-pp-fields",
      entities: [
        {
          entity_type: "matter",
          pp_entity_id: "pp-123",
          raw_json: {
            name: "Smith v. Acme"
          },
          custom_fields: [
            {
              pp_field_id: "cf-text",
              field_key: "claim_status",
              label: "Claim Status",
              value: "Open",
              normalized_text: "Open"
            },
            {
              pp_field_id: "cf-number",
              field_key: "reserve_amount",
              label: "Reserve Amount",
              value: 12500,
              normalized_number: 12500
            },
            {
              pp_field_id: "cf-date",
              field_key: "hearing_date",
              label: "Hearing Date",
              value: "2026-04-01",
              normalized_date: "2026-04-01"
            }
          ]
        }
      ]
    });

    const defCount = db.prepare(`SELECT COUNT(*) AS count FROM pp_custom_field_defs`).get() as { count: number };
    const valueCount = db.prepare(`SELECT COUNT(*) AS count FROM pp_custom_field_values`).get() as { count: number };

    expect(defCount.count).toBe(3);
    expect(valueCount.count).toBe(3);

    const values = db.prepare(
      `
        SELECT field_key, normalized_text, normalized_number, normalized_date
        FROM pp_custom_field_values
        ORDER BY field_key ASC
      `
    ).all() as Array<{
      field_key: string;
      normalized_text: string | null;
      normalized_number: number | null;
      normalized_date: string | null;
    }>;

    expect(values).toEqual([
      {
        field_key: "claim_status",
        normalized_text: "Open",
        normalized_number: null,
        normalized_date: null
      },
      {
        field_key: "hearing_date",
        normalized_text: null,
        normalized_number: null,
        normalized_date: "2026-04-01"
      },
      {
        field_key: "reserve_amount",
        normalized_text: null,
        normalized_number: 12500,
        normalized_date: null
      }
    ]);
  });

  it("handles mixed entity types and only patches the case from the matter entity", () => {
    const db = createSeededTestDb();
    openDbs.push(db);

    hydratePracticePantherState(db, {
      caseId: "case-pp-mixed",
      entities: [
        {
          entity_type: "matter",
          pp_entity_id: "pp-123",
          raw_json: {
            name: "Smith v. Acme",
            pp_matter_id: "pp-123",
            box_root_folder_id: "folder-456"
          }
        },
        {
          entity_type: "note",
          pp_entity_id: "note-1",
          raw_json: {
            summary: "Client note"
          }
        },
        {
          entity_type: "task",
          pp_entity_id: "task-1",
          raw_json: {
            summary: "Call client"
          }
        }
      ]
    });

    const sourceItems = db.prepare(
      `
        SELECT source_kind
        FROM source_items
        WHERE case_id = ?
        ORDER BY source_kind ASC
      `
    ).all("case-pp-mixed") as Array<{ source_kind: string }>;

    expect(sourceItems).toEqual([
      { source_kind: "matter" },
      { source_kind: "note" },
      { source_kind: "task" }
    ]);

    const rawCounts = db.prepare(
      `
        SELECT entity_type, COUNT(*) AS count
        FROM pp_entities_raw
        WHERE case_id = ?
        GROUP BY entity_type
        ORDER BY entity_type ASC
      `
    ).all("case-pp-mixed") as Array<{
      entity_type: string;
      count: number;
    }>;

    expect(rawCounts).toEqual([
      { entity_type: "matter", count: 1 },
      { entity_type: "note", count: 1 },
      { entity_type: "task", count: 1 }
    ]);

    const caseRow = db.prepare(
      `
        SELECT name, pp_matter_id, box_root_folder_id
        FROM cases
        WHERE id = ?
        LIMIT 1
      `
    ).get("case-pp-mixed") as
      | {
          name: string;
          pp_matter_id: string | null;
          box_root_folder_id: string | null;
        }
      | undefined;

    expect(caseRow).toEqual({
      name: "Smith v. Acme",
      pp_matter_id: "pp-123",
      box_root_folder_id: "folder-456"
    });
  });

  it("records a partial failure snapshot on orchestrator error", () => {
    const db = createSeededTestDb();
    openDbs.push(db);

    expect(() =>
      hydratePracticePantherState(db, {
        caseId: "case-pp-failure",
        entities: [
          {
            entity_type: "matter",
            pp_entity_id: "pp-123",
            raw_json: {
              name: "Smith v. Acme",
              pp_matter_id: "pp-123"
            }
          },
          {
            entity_type: "note",
            pp_entity_id: "note-1",
            raw_json: {
              explode: createThrowingJsonValue("PP persistence failure")
            }
          }
        ]
      })
    ).toThrow("PP persistence failure");

    const syncRun = db.prepare(
      `
        SELECT status, error_message
        FROM sync_runs
        WHERE case_id = ?
        ORDER BY started_at DESC
        LIMIT 1
      `
    ).get("case-pp-failure") as
      | {
          status: string;
          error_message: string | null;
        }
      | undefined;

    expect(syncRun?.status).toBe("failed");
    expect(syncRun?.error_message).toBe("PP persistence failure");

    const connection = db.prepare(
      `
        SELECT status, last_error_message
        FROM source_connections
        WHERE provider = 'practicepanther'
        LIMIT 1
      `
    ).get() as
      | {
          status: string;
          last_error_message: string | null;
        }
      | undefined;

    expect(connection?.status).toBe("error");
    expect(connection?.last_error_message).toBe("PP persistence failure");

    const snapshots = db.prepare(
      `
        SELECT snapshot_type, manifest_json
        FROM source_snapshots
        WHERE case_id = ?
        ORDER BY created_at ASC
      `
    ).all("case-pp-failure") as Array<{
      snapshot_type: string;
      manifest_json: string;
    }>;

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.snapshot_type).toBe("pp_state");

    const manifest = JSON.parse(snapshots[0]?.manifest_json ?? "{}") as {
      item_count: number;
      entity_ids: string[];
      entity_types: string[];
      partial: boolean;
      error_message: string;
    };

    expect(manifest.item_count).toBe(1);
    expect(manifest.entity_ids).toEqual(["pp-123"]);
    expect(manifest.entity_types).toEqual(["matter"]);
    expect(manifest.partial).toBe(true);
    expect(manifest.error_message).toBe("PP persistence failure");
  });
});
