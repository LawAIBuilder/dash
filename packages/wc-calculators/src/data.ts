import { asISODate, pickEffectiveRecord } from "./utils.js";
import type { CompRateRow, CompRatesMetadata, CompRatesTable, RawCompRatesData } from "./types.js";
import rawCompRates from "./data/comp-rates.json" with { type: "json" };

function normalizeCompRates(raw: RawCompRatesData): readonly CompRateRow[] {
  const rows = raw.compensationRates
    .map((r) =>
      Object.freeze({
        effectiveDate: r.effectiveDate,
        saww: r.saww,
        minCompRate: r.minCompRate,
        maxCompRate: r.maxCompRate,
        annualAdjustment: r.annualAdjustmentPct != null ? r.annualAdjustmentPct / 100 : null,
        minRateOrActualWage: r.minRateOrActualWage
      })
    )
    .sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate));

  return Object.freeze(rows);
}

function normalizeMetadata(raw: RawCompRatesData): CompRatesMetadata {
  return Object.freeze({
    source: raw._metadata.source,
    sourceDocument: raw._metadata.sourceDocument,
    extractedBy: raw._metadata.extractedBy,
    extractedDate: raw._metadata.extractedDate
  });
}

let cachedCompRatesTable: CompRatesTable | null = null;

function getCachedCompRatesTable() {
  if (!cachedCompRatesTable) {
    const normalized = rawCompRates as RawCompRatesData;
    const rows = normalizeCompRates(normalized);
    cachedCompRatesTable = Object.freeze({
      metadata: normalizeMetadata(normalized),
      rows,
      verifiedThrough: rows.at(-1)?.effectiveDate ?? null
    });
  }

  return cachedCompRatesTable;
}

export function getCompRates(): readonly CompRateRow[] {
  return getCachedCompRatesTable().rows;
}

export function getCompRatesMetadata(): CompRatesMetadata {
  return getCachedCompRatesTable().metadata;
}

export function getCompRatesTable(): CompRatesTable {
  return getCachedCompRatesTable();
}

export function getCompRateForDate(date: string): CompRateRow | null {
  const dateISO = asISODate(date);
  if (!dateISO) return null;
  return pickEffectiveRecord(dateISO, getCompRates());
}

export function getLatestCompRate(): CompRateRow | null {
  const rows = getCompRates();
  return rows.length > 0 ? rows[rows.length - 1] : null;
}

export const RATES_VERIFIED_THROUGH = getCachedCompRatesTable().verifiedThrough;
