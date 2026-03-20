/**
 * Deterministic, regex-based extractors over canonical page raw_text (MVP).
 * Schema keys / versions are stable for idempotent runs in extraction-runner.
 */

export const HEURISTIC_EXTRACTOR_VERSION = "heuristic-1";
export const SCHEMA_WC_LETTERHEAD_DATES = "wc_letterhead_dates.v1";
export const SCHEMA_WC_MEDICAL_IDENTIFIERS = "wc_medical_identifiers.v1";

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = v.trim();
    if (t.length === 0 || seen.has(t)) {
      continue;
    }
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** ISO YYYY-MM-DD */
const RE_ISO = /\b(20\d{2}|19\d{2})-(\d{2})-(\d{2})\b/g;
/** US slash dates */
const RE_US = /\b(\d{1,2})\/(\d{1,2})\/(20\d{2}|19\d{2}|\d{2})\b/g;
/** Month DD, YYYY */
const RE_LONG = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(20\d{2}|19\d{2})\b/gi;

export function extractLetterheadDatesPayload(rawText: string): Record<string, unknown> {
  const text = rawText ?? "";
  const dates: string[] = [];

  for (const re of [RE_ISO, RE_US]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      dates.push(m[0]);
    }
  }

  RE_LONG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_LONG.exec(text)) !== null) {
    dates.push(m[0]);
  }

  const reBlock = /^\s*RE:\s*(.+)$/gim;
  const reSubjects: string[] = [];
  while ((m = reBlock.exec(text)) !== null) {
    const line = m[1]?.trim();
    if (line) {
      reSubjects.push(line);
    }
  }

  return {
    dates: uniqueStrings(dates).slice(0, 50),
    re_subjects: uniqueStrings(reSubjects).slice(0, 20)
  };
}

const RE_MRN = /\bMRN\b[:\s#-]*([A-Z0-9][A-Z0-9\-]{4,40})\b/gi;
const RE_MEDICAL_RECORD = /\bmedical\s+record\b[:\s#]*([A-Z0-9][A-Z0-9\-]{4,40})\b/gi;
const RE_ACCOUNT = /\baccount\b[:\s#]*([A-Z0-9][A-Z0-9\-]{4,40})\b/gi;
const RE_PATIENT_ID = /\bpatient\s*(?:ID|Id)?[:\s#]*([A-Z0-9][A-Z0-9\-]{4,40})\b/gi;

export function extractMedicalIdentifiersPayload(rawText: string): Record<string, unknown> {
  const text = rawText ?? "";
  const mrns: string[] = [];
  const accounts: string[] = [];
  const patientIds: string[] = [];

  for (const re of [RE_MRN, RE_MEDICAL_RECORD]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[1]) {
        mrns.push(m[1]);
      }
    }
  }

  RE_ACCOUNT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_ACCOUNT.exec(text)) !== null) {
    if (m[1]) {
      accounts.push(m[1]);
    }
  }

  RE_PATIENT_ID.lastIndex = 0;
  while ((m = RE_PATIENT_ID.exec(text)) !== null) {
    if (m[1]) {
      patientIds.push(m[1]);
    }
  }

  return {
    mrns: uniqueStrings(mrns).slice(0, 30),
    account_numbers: uniqueStrings(accounts).slice(0, 20),
    patient_ids: uniqueStrings(patientIds).slice(0, 20)
  };
}
