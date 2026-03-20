import type { ParsedCSV, ParsedCSVRow } from "./types.js";

const DEFAULT_LOCALE = "en-US";

export function asNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!s) return null;
  const cleaned = s.replace(/[$,]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function money(n: number | null): string {
  const x = asNum(n);
  if (x === null) return "—";
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(x);
}

export function asISODate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v.valueOf())) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mm = String(m[1]).padStart(2, "0");
    const dd = String(m[2]).padStart(2, "0");
    return `${m[3]}-${mm}-${dd}`;
  }
  const d = new Date(s);
  if (!isNaN(d.valueOf())) return d.toISOString().slice(0, 10);
  return null;
}

export function daysBetweenISO(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`);
  const db = new Date(`${b}T00:00:00Z`);
  const ms = db.valueOf() - da.valueOf();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export function pickEffectiveRecord<T extends { effectiveDate: string }>(
  dateISO: string,
  records: readonly T[]
): T | null {
  if (!dateISO) return null;
  let best: T | null = null;
  for (const r of records) {
    if (!r.effectiveDate) continue;
    if (r.effectiveDate <= dateISO) best = r;
    else break;
  }
  return best;
}

export function parseSimpleCsv(text: string): ParsedCSV {
  const lines = String(text || "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  if (lines.length < 2) {
    throw new Error("CSV needs a header row and at least one data row.");
  }
  const delim = lines[0].includes("\t") && !lines[0].includes(",") ? "\t" : ",";
  const header = lines[0].split(delim).map((s) => s.trim().toLowerCase());
  const idxGross = header.findIndex((h) => ["gross", "gross_pay", "wages", "amount"].includes(h));
  const idxStart = header.findIndex((h) => ["period_start", "start", "start_date", "from"].includes(h));
  const idxEnd = header.findIndex((h) => ["period_end", "end", "end_date", "to"].includes(h));
  if (idxGross === -1) {
    throw new Error('CSV must include a "gross" column (gross pay for that pay period).');
  }

  const rows: ParsedCSVRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(delim).map((s) => s.trim());
    const gross = asNum(cols[idxGross]);
    if (gross === null) continue;
    const start = idxStart !== -1 ? asISODate(cols[idxStart]) : null;
    const end = idxEnd !== -1 ? asISODate(cols[idxEnd]) : null;
    rows.push({ gross, start, end });
  }
  if (rows.length === 0) {
    throw new Error("No rows with a parsable gross amount were found.");
  }
  return { header, rows };
}
