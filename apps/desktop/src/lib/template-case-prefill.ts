import type { CaseListItem } from "@/types/cases";

/**
 * Maps common placeholder names to case list fields from the API.
 * Only non-empty case fields are included.
 */
export function buildCasePlaceholderHints(caseData: CaseListItem | undefined): Record<string, string> {
  if (!caseData) {
    return {};
  }
  const out: Record<string, string> = {};
  const add = (key: string, val: string | null | undefined) => {
    if (val != null && String(val).trim() !== "") {
      out[key] = String(val).trim();
    }
  };
  add("matter_name", caseData.name);
  add("case_name", caseData.name);
  add("employee_name", caseData.employee_name);
  add("claimant_name", caseData.employee_name);
  add("applicant_name", caseData.employee_name);
  add("employer_name", caseData.employer_name);
  add("insurer_name", caseData.insurer_name);
  add("hearing_date", caseData.hearing_date);
  return out;
}

/**
 * Overlay case hints only for keys that are not yet present — avoids clobbering user edits,
 * including cleared fields (empty string is intentional once set).
 */
export function mergeCaseHintsIntoFillValues(
  prev: Record<string, string>,
  fieldNames: string[],
  caseData: CaseListItem | undefined
): Record<string, string> {
  const hints = buildCasePlaceholderHints(caseData);
  const next = { ...prev };
  for (const name of fieldNames) {
    const h = hints[name];
    if (!h) {
      continue;
    }
    if (!(name in next)) {
      next[name] = h;
    }
  }
  return next;
}
