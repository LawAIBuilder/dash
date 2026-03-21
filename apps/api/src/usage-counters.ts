import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export interface DailyUsageQuotaResult {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
  retryAfterSeconds: number;
  usageDate: string;
}

function currentUsageDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function secondsUntilNextUtcDay(now = new Date()) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

export function consumeDailyUsageQuota(
  db: Database.Database,
  input: {
    caseId: string;
    counterKey: string;
    limit: number;
    units?: number;
    now?: Date;
  }
): DailyUsageQuotaResult {
  const now = input.now ?? new Date();
  const usageDate = currentUsageDate(now);
  const units = Math.max(1, Math.floor(input.units ?? 1));
  const limit = Math.max(1, Math.floor(input.limit));
  const retryAfterSeconds = secondsUntilNextUtcDay(now);

  const transaction = db.transaction(() => {
    const existing = db
      .prepare(
        `
          SELECT id, units
          FROM usage_counters
          WHERE case_id = ?
            AND counter_key = ?
            AND usage_date = ?
          LIMIT 1
        `
      )
      .get(input.caseId, input.counterKey, usageDate) as
      | {
          id: string;
          units: number;
        }
      | undefined;

    const used = existing?.units ?? 0;
    if (used + units > limit) {
      return {
        allowed: false,
        limit,
        used,
        remaining: Math.max(0, limit - used),
        retryAfterSeconds,
        usageDate
      } satisfies DailyUsageQuotaResult;
    }

    if (existing) {
      db.prepare(
        `
          UPDATE usage_counters
          SET units = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `
      ).run(used + units, existing.id);
    } else {
      db.prepare(
        `
          INSERT INTO usage_counters
            (id, case_id, counter_key, usage_date, units)
          VALUES
            (?, ?, ?, ?, ?)
        `
      ).run(randomUUID(), input.caseId, input.counterKey, usageDate, units);
    }

    const nextUsed = used + units;
    return {
      allowed: true,
      limit,
      used: nextUsed,
      remaining: Math.max(0, limit - nextUsed),
      retryAfterSeconds,
      usageDate
    } satisfies DailyUsageQuotaResult;
  });

  return transaction();
}
