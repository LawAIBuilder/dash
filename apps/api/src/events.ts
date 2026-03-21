import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { DomainEvent, EventName } from "@wc/domain-core";

type EventSourceType = DomainEvent["source_type"];

export interface WriteCaseEventInput<TPayload = Record<string, unknown>> {
  caseId: string;
  eventName: EventName;
  sourceType: EventSourceType;
  sourceId: string;
  payload: TPayload;
  branchInstanceId?: string | null;
  presetId?: string | null;
  occurredAt?: string;
}

function lookupDefaultBranchContext(db: Database.Database, caseId: string) {
  return db
    .prepare(
      `
        SELECT mbi.id AS branch_instance_id, mbi.product_preset_id AS preset_id
        FROM matter_branch_instances mbi
        WHERE mbi.case_id = ?
        ORDER BY mbi.priority ASC, mbi.started_at ASC
        LIMIT 1
      `
    )
    .get(caseId) as
    | {
        branch_instance_id: string;
        preset_id: string | null;
      }
    | undefined;
}

export function writeCaseEvent<TPayload = Record<string, unknown>>(
  db: Database.Database,
  input: WriteCaseEventInput<TPayload>
) {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const fallbackContext = lookupDefaultBranchContext(db, input.caseId);
  const branchInstanceId = input.branchInstanceId ?? fallbackContext?.branch_instance_id ?? null;
  const presetId = input.presetId ?? fallbackContext?.preset_id ?? null;

  const event: DomainEvent<TPayload> = {
    event_id: randomUUID(),
    event_name: input.eventName,
    case_id: input.caseId,
    preset_id: presetId,
    branch_instance_id: branchInstanceId,
    source_type: input.sourceType,
    source_id: input.sourceId,
    occurred_at: occurredAt,
    payload_json: input.payload
  };

  db.transaction(() => {
    db.prepare(
      `
        INSERT INTO case_events
          (id, case_id, branch_instance_id, preset_id, event_name, source_type, source_id, occurred_at, payload_json)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      event.event_id,
      event.case_id,
      branchInstanceId,
      presetId,
      event.event_name,
      event.source_type,
      event.source_id,
      event.occurred_at,
      JSON.stringify(event)
    );

    if (!branchInstanceId) {
      return;
    }

    db.prepare(
      `
        INSERT INTO branch_events
          (id, matter_branch_instance_id, event_type, event_source, source_id, event_time, payload)
        VALUES
          (@id, @matter_branch_instance_id, @event_type, @event_source, @source_id, @event_time, @payload)
      `
    ).run({
      id: event.event_id,
      matter_branch_instance_id: branchInstanceId,
      event_type: event.event_name,
      event_source: event.source_type,
      source_id: event.source_id,
      event_time: event.occurred_at,
      payload: JSON.stringify(event)
    });
  })();

  return event;
}
