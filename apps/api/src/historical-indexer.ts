import type Database from "better-sqlite3";

const EVENT_PATTERNS: Array<{ event_type: string; re: RegExp }> = [
  { event_type: "claim_petition", re: /claim petition/i },
  { event_type: "noid", re: /\bnoid\b|notice of intention to discontinue/i },
  { event_type: "narrative_request", re: /narrative request/i },
  { event_type: "narrative_report", re: /narrative/i },
  { event_type: "ime_report", re: /\bime\b|independent medical/i },
  { event_type: "pretrial_statement", re: /pretrial/i },
  { event_type: "intervention_notice", re: /notice of right to intervene|intervention notice/i },
  { event_type: "motion_to_intervene", re: /motion to intervene/i },
  { event_type: "hearing_notice", re: /notice hearing|hearing notice/i },
  { event_type: "exhibit_list", re: /exhibit list/i },
  { event_type: "hearing_prep_memo", re: /hearing prep|claims summary|prep memo/i },
  { event_type: "demand", re: /\bdemand\b/i },
  { event_type: "discovery_response", re: /discovery response|interrogator/i },
  { event_type: "discovery_demand", re: /request for production|discovery demand/i }
];

export function inferHistoricalEventType(title: string | null | undefined) {
  const value = title ?? "";
  for (const pattern of EVENT_PATTERNS) {
    if (pattern.re.test(value)) {
      return pattern.event_type;
    }
  }
  return null;
}

export function buildHistoricalCaseFlow(db: Database.Database, caseId: string) {
  const rows = db
    .prepare(
      `
        SELECT id, title, updated_at, created_at, source_kind, provider
        FROM source_items
        WHERE case_id = ?
        ORDER BY COALESCE(updated_at, created_at) ASC, title ASC
      `
    )
    .all(caseId) as Array<{
    id: string;
    title: string | null;
    updated_at: string | null;
    created_at: string | null;
    source_kind: string;
    provider: string;
  }>;

  return rows
    .map((row, index) => ({
      source_item_id: row.id,
      title: row.title,
      occurred_at: row.updated_at ?? row.created_at,
      source_kind: row.source_kind,
      provider: row.provider,
      event_type: inferHistoricalEventType(row.title),
      sequence_index: index
    }))
    .filter((row) => row.event_type !== null);
}

export function summarizeHistoricalCaseFlows(db: Database.Database) {
  const caseIds = db.prepare(`SELECT id FROM cases ORDER BY id ASC`).all() as Array<{ id: string }>;
  const eventCounts: Record<string, number> = {};
  const transitionCounts: Record<string, number> = {};
  const eventPositions: Record<string, number[]> = {};

  for (const row of caseIds) {
    const flow = buildHistoricalCaseFlow(db, row.id);
    for (let i = 0; i < flow.length; i++) {
      const current = flow[i]!;
      eventCounts[current.event_type!] = (eventCounts[current.event_type!] ?? 0) + 1;
      eventPositions[current.event_type!] ??= [];
      eventPositions[current.event_type!].push(i);
      const next = flow[i + 1];
      if (next?.event_type) {
        const transitionKey = `${current.event_type}->${next.event_type}`;
        transitionCounts[transitionKey] = (transitionCounts[transitionKey] ?? 0) + 1;
      }
    }
  }

  const avgPositionByEventType = Object.fromEntries(
    Object.entries(eventPositions).map(([eventType, positions]) => [
      eventType,
      positions.reduce((sum, position) => sum + position, 0) / positions.length
    ])
  );

  return {
    case_count: caseIds.length,
    event_counts: eventCounts,
    transition_counts: transitionCounts,
    average_sequence_index_by_event_type: avgPositionByEventType
  };
}

export function recommendNextHistoricalEvents(db: Database.Database, caseId: string) {
  const flow = buildHistoricalCaseFlow(db, caseId);
  const currentEvent = flow.length > 0 ? flow[flow.length - 1]!.event_type : null;
  const summary = summarizeHistoricalCaseFlows(db);

  if (!currentEvent) {
    const topEventTypes = Object.entries(summary.event_counts)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([eventType, count]) => ({
        event_type: eventType,
        sample_size: count,
        confidence: count >= 25 ? "high" : count >= 10 ? "medium" : "low"
      }));
    return {
      current_event: null,
      recommendations: topEventTypes
    };
  }

  const candidates = Object.entries(summary.transition_counts)
    .filter(([transition]) => transition.startsWith(`${currentEvent}->`))
    .map(([transition, count]) => ({
      event_type: transition.split("->")[1] ?? "unknown",
      sample_size: count
    }))
    .sort((left, right) => right.sample_size - left.sample_size);

  const total = candidates.reduce((sum, candidate) => sum + candidate.sample_size, 0);

  return {
    current_event: currentEvent,
    recommendations: candidates.map((candidate) => ({
      event_type: candidate.event_type,
      sample_size: candidate.sample_size,
      relative_frequency: total > 0 ? candidate.sample_size / total : 0,
      confidence:
        candidate.sample_size >= 25
          ? "high"
          : candidate.sample_size >= 10
            ? "medium"
            : "low"
    }))
  };
}
