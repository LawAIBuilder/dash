const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short"
});

export function formatLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Not yet";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return dateFormatter.format(date);
}

export function truncateMiddle(value: string, lead = 8, tail = 6): string {
  if (value.length <= lead + tail + 3) {
    return value;
  }

  return `${value.slice(0, lead)}...${value.slice(-tail)}`;
}

export function summarizeRawJson(raw: string | null): string | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return raw.length > 90 ? `${raw.slice(0, 87)}...` : raw;
    }

    const entries = Object.entries(parsed).slice(0, 3);
    return entries.map(([key, value]) => `${formatLabel(key)}: ${String(value)}`).join(" | ");
  } catch {
    return raw.length > 90 ? `${raw.slice(0, 87)}...` : raw;
  }
}

export function summarizeKeyValueRecord(record: Record<string, string> | null | undefined): string {
  const entries = Object.entries(record ?? {});
  if (entries.length === 0) {
    return "None captured";
  }

  return entries.map(([key, value]) => `${formatLabel(key)}: ${truncateMiddle(value)}`).join(" | ");
}

export function countLabels(values: Array<string | null | undefined>): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const value of values) {
    const key = value?.trim() || "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return counts;
}

export function summarizeCountRecord(counts: Record<string, number> | null | undefined): string {
  const entries = Object.entries(counts ?? {});
  if (entries.length === 0) {
    return "No state captured";
  }

  return entries
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, value]) => `${value} ${formatLabel(key)}`)
    .join(" | ");
}

export function formatConfidence(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "Unavailable";
  }

  return `${Math.round(value * 100)}%`;
}

export function toneForStatus(status: string): "neutral" | "good" | "warn" | "bad" {
  const value = status.toLowerCase();
  if (value === "active" || value === "ready" || value === "complete" || value === "completed") {
    return "good";
  }

  if (value === "blocked" || value === "error" || value === "failed") {
    return "bad";
  }

  if (
    value === "pending" ||
    value === "queued" ||
    value === "in_review" ||
    value === "waiting" ||
    value === "syncing" ||
    value === "auth_pending"
  ) {
    return "warn";
  }

  return "neutral";
}
