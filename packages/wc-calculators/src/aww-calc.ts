import type { AWWResult, ParsedCSVRow } from "./types.js";
import { asNum, daysBetweenISO, round2 } from "./utils.js";

export function calcAWWFromWeeklyEntries(weeklyWages: number[]): AWWResult {
  if (!Array.isArray(weeklyWages) || weeklyWages.length === 0) {
    throw new Error("Enter at least one weekly wage.");
  }
  const sum = weeklyWages.reduce((a, b) => a + b, 0);
  const avg = sum / weeklyWages.length;
  return { weeksCounted: weeklyWages.length, totalWages: round2(sum), aww: round2(avg) };
}

export function calcAWWFromPayPeriods(rows: ParsedCSVRow[], fallbackWeeksCovered?: number | string | null): AWWResult {
  const totalGross = rows.reduce((a, r) => a + (r.gross || 0), 0);
  const dated = rows.filter((r) => r.start && r.end);
  let weeksCovered: number;

  if (dated.length > 0) {
    const sorted = [...dated].sort((a, b) => a.start!.localeCompare(b.start!));
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].start! <= sorted[i - 1].end!) {
        throw new Error(
          `Pay periods overlap: period ending ${sorted[i - 1].end} overlaps with period starting ${sorted[i].start}. Fix the dates so periods don't overlap.`
        );
      }
    }
    const totalDays = sorted.reduce((sum, r) => {
      const d = daysBetweenISO(r.start!, r.end!) + 1;
      return sum + Math.max(d, 1);
    }, 0);
    weeksCovered = totalDays / 7;
  } else {
    const w = asNum(fallbackWeeksCovered);
    if (w === null || w <= 0) {
      throw new Error('If your CSV has no period_start/period_end columns, enter "Weeks covered".');
    }
    weeksCovered = w;
  }

  const aww = totalGross / weeksCovered;
  return {
    weeksCounted: round2(weeksCovered),
    totalWages: round2(totalGross),
    aww: round2(aww)
  };
}
