import type {
  EscalationResult,
  EscalationStep,
  PTDResult,
  PresentDayValueResult,
  TPDResult,
  TTDResult
} from "./types.js";
import { asISODate, asNum, daysBetweenISO, pickEffectiveRecord, round2 } from "./utils.js";
import { getCompRates } from "./data.js";

export function calcTTD({ doiISO, aww }: { doiISO: string; aww: number }): TTDResult {
  const awwN = asNum(aww);
  if (awwN === null || awwN <= 0) {
    throw new Error("Average weekly wage (AWW) must be a positive number.");
  }
  const rates = getCompRates();
  const rec = pickEffectiveRecord(doiISO, rates);
  if (!rec) throw new Error("Could not find a compensation-rate row for that date of injury.");
  const raw = round2((2 / 3) * awwN);
  const cappedMax = round2(Math.min(raw, rec.maxCompRate));
  const actualMin = Math.min(rec.minCompRate, awwN);
  const withMin = round2(Math.max(cappedMax, actualMin));
  return {
    inputs: { doi: doiISO, aww: awwN },
    rateRow: rec,
    calc: {
      rawTwoThirds: raw,
      weeklyRate: withMin,
      appliedMax: rec.maxCompRate,
      appliedMin: actualMin
    }
  };
}

export function calcTPD({
  doiISO,
  aww,
  postInjuryWeeklyWage
}: {
  doiISO: string;
  aww: number;
  postInjuryWeeklyWage: number;
}): TPDResult {
  const awwN = asNum(aww);
  const postN = asNum(postInjuryWeeklyWage);
  if (awwN === null || awwN <= 0) throw new Error("AWW must be a positive number.");
  if (postN === null || postN < 0) throw new Error("Post-injury weekly wage must be 0 or a positive number.");
  const wageLoss = Math.max(awwN - postN, 0);
  const raw = round2((2 / 3) * wageLoss);
  const rates = getCompRates();
  const rec = pickEffectiveRecord(doiISO, rates);
  if (!rec) throw new Error("Could not find a compensation-rate row for that date of injury.");
  const weekly = round2(Math.min(raw, rec.maxCompRate));
  return {
    inputs: { doi: doiISO, aww: awwN, postInjuryWeeklyWage: postN },
    rateRow: rec,
    calc: {
      wageLoss,
      rawTwoThirdsWageLoss: raw,
      weeklyRate: weekly,
      appliedMax: rec.maxCompRate
    }
  };
}

function getEscalationWaitYears(doi: string): number {
  if (doi >= "2013-10-01") return 3;
  if (doi >= "1995-10-01") return 4;
  if (doi >= "1992-10-01") return 2;
  return 1;
}

function getEscalationCapPctForEffectiveDate(doi: string, annualAdjustmentEffectiveDate: string): number | null {
  if (doi >= "2013-10-01") return 0.03;
  if (doi >= "1995-10-01") return 0.02;
  if (annualAdjustmentEffectiveDate >= "1992-10-01") return 0.04;
  if (annualAdjustmentEffectiveDate >= "1977-10-01") return 0.06;
  return null;
}

function getEscalationRule(doi: string): { capPct: number | null; waitYears: number } {
  const waitYears = getEscalationWaitYears(doi);
  if (doi >= "2013-10-01") return { capPct: 0.03, waitYears };
  if (doi >= "1995-10-01") return { capPct: 0.02, waitYears };
  return { capPct: 0.04, waitYears };
}

function addYearsISO(dateISO: string, years: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

function buildEscalationFromBase({
  doi,
  through,
  baseWeeklyRate
}: {
  doi: string;
  through: string;
  baseWeeklyRate: number;
}): { rule: EscalationResult["rule"]; steps: EscalationStep[]; currentWeeklyRate: number } {
  const ruleRaw = getEscalationRule(doi);
  const firstEligible = addYearsISO(doi, ruleRaw.waitYears);
  const rates = getCompRates();
  const eligible = rates.filter((r) => r.annualAdjustment != null);

  const anniversaries: string[] = [];
  for (let years = ruleRaw.waitYears; ; years += 1) {
    const ann = addYearsISO(doi, years);
    if (ann > through) break;
    if (ann > doi) anniversaries.push(ann);
  }

  let current = baseWeeklyRate;
  const steps: EscalationStep[] = [];
  let lastDate = doi;

  for (const anniversary of anniversaries) {
    const rec = pickEffectiveRecord(anniversary, eligible);
    if (!rec || rec.annualAdjustment == null) continue;

    const rawPct = Math.max(rec.annualAdjustment, 0);
    const capPctForStep = getEscalationCapPctForEffectiveDate(doi, rec.effectiveDate);
    const cappedFrom = capPctForStep !== null && rawPct > capPctForStep ? rawPct : null;
    const appliedPct = capPctForStep !== null ? Math.min(rawPct, capPctForStep) : rawPct;

    steps.push({
      periodStart: lastDate,
      periodEnd: anniversary,
      rate: round2(current),
      appliedAdjustmentOn: anniversary,
      sourceAnnualAdjustmentEffectiveDate: rec.effectiveDate,
      adjustmentPct: appliedPct,
      cappedFrom
    });
    current = round2(current * (1 + appliedPct));
    lastDate = anniversary;
  }

  steps.push({
    periodStart: lastDate,
    periodEnd: through,
    rate: round2(current),
    appliedAdjustmentOn: null,
    sourceAnnualAdjustmentEffectiveDate: null,
    adjustmentPct: null,
    cappedFrom: null
  });

  return {
    rule: { capPct: ruleRaw.capPct, waitYears: ruleRaw.waitYears, firstEligible },
    steps,
    currentWeeklyRate: round2(current)
  };
}

export function calcEscalation({
  doiISO,
  throughISO,
  aww
}: {
  doiISO: string;
  throughISO: string;
  aww: number;
}): EscalationResult {
  const awwN = asNum(aww);
  if (awwN === null || awwN <= 0) throw new Error("Average weekly wage must be a positive number.");
  const doi = asISODate(doiISO);
  const through = asISODate(throughISO);
  if (!doi || !through) throw new Error("Date of injury and estimate-through date are required.");
  if (through < doi) throw new Error('"Estimate through" date must be on or after date of injury.');

  const ttdResult = calcTTD({ doiISO: doi, aww: awwN });
  const base = ttdResult.calc.weeklyRate;

  const built = buildEscalationFromBase({
    doi,
    through,
    baseWeeklyRate: base
  });

  return {
    inputs: { doi, through, aww: awwN, baseWeeklyRate: base },
    rule: built.rule,
    steps: built.steps,
    currentWeeklyRate: built.currentWeeklyRate
  };
}

export function calcPresentDayValue(opts: {
  weeklyRate: number;
  years: number;
  discountRate: number;
}): PresentDayValueResult {
  const annualPayment = opts.weeklyRate * 52;
  const r = opts.discountRate;
  const n = opts.years;
  if (r <= 0 || n <= 0) {
    return { presentValue: annualPayment * n, nominalValue: annualPayment * n, reduction: 0 };
  }
  const pvFactor = (1 - Math.pow(1 + r, -n)) / r;
  const presentValue = round2(annualPayment * pvFactor);
  const nominalValue = round2(annualPayment * n);
  const reduction = round2(nominalValue - presentValue);
  return { presentValue, nominalValue, reduction };
}

export function calcPTD(opts: {
  doiISO: string;
  asOfISO: string;
  aww: number;
  birthDateISO?: string;
  ptdStartISO?: string;
  offsetMonthlyGovtBenefits?: number;
  offsetMonthlyPERA?: number;
  assumeOffsetAppliesNow?: boolean;
  isMinorOrApprentice?: boolean;
}): PTDResult {
  const doi = asISODate(opts.doiISO);
  const asOf = asISODate(opts.asOfISO);
  if (!doi || !asOf) throw new Error("Date of injury and as-of date are required.");
  if (asOf < doi) throw new Error('"As of" date must be on or after date of injury.');

  const awwN = asNum(opts.aww);
  if (awwN === null || awwN <= 0) throw new Error("Average weekly wage (AWW) must be a positive number.");

  const rates = getCompRates();
  const rec = pickEffectiveRecord(doi, rates);
  if (!rec) throw new Error("Could not find a compensation-rate row for that date of injury.");

  const maxWeekly = rec.maxCompRate;
  const minWeekly = round2(rec.saww * 0.65);
  const rawTwoThirds = round2((2 / 3) * awwN);

  const isMinorOrApprentice = Boolean(opts.isMinorOrApprentice);
  const baseWeeklyRate = isMinorOrApprentice
    ? maxWeekly
    : round2(Math.max(Math.min(rawTwoThirds, maxWeekly), minWeekly));

  const escalationBuilt = buildEscalationFromBase({
    doi,
    through: asOf,
    baseWeeklyRate
  });

  const adjustedWeeklyRateAsOf = escalationBuilt.currentWeeklyRate;

  const offsetThresholdDollars = 25000;
  const offsetMonthly = asNum(opts.offsetMonthlyGovtBenefits);
  const offsetWeekly = offsetMonthly !== null ? round2((offsetMonthly * 12) / 52) : null;

  const peraMonthly = asNum(opts.offsetMonthlyPERA);
  const peraWeekly = peraMonthly !== null ? round2((peraMonthly * 12) / 52) : null;

  const totalWeeklyOffset =
    offsetWeekly !== null || peraWeekly !== null ? round2((offsetWeekly ?? 0) + (peraWeekly ?? 0)) : null;

  const assumeOffsetAppliesNow = Boolean(opts.assumeOffsetAppliesNow);
  const retentionFloor = round2(adjustedWeeklyRateAsOf * 0.2);
  const weeklyAfterOffsetIfApplied =
    assumeOffsetAppliesNow && totalWeeklyOffset !== null
      ? round2(Math.max(adjustedWeeklyRateAsOf - totalWeeklyOffset, retentionFloor))
      : null;

  const approxWeeksUntilOffset = baseWeeklyRate > 0 ? round2(offsetThresholdDollars / baseWeeklyRate) : null;

  const birth = opts.birthDateISO ? asISODate(opts.birthDateISO) : null;
  const ptdStart = opts.ptdStartISO ? asISODate(opts.ptdStartISO) : null;

  let benefitEndDate: string | null = null;
  let benefitWeeksFromStart: number | null = null;

  if (birth && ptdStart) {
    const birthday67 = addYearsISO(birth, 67);
    const birthday72 = addYearsISO(birth, 72);
    const injuredAfter67 = doi > birthday67;
    benefitEndDate = injuredAfter67 ? addYearsISO(doi, 5) : birthday72;
    if (benefitEndDate < ptdStart) benefitWeeksFromStart = 0;
    else benefitWeeksFromStart = round2((daysBetweenISO(ptdStart, benefitEndDate) + 1) / 7);
  }

  const benefitYearsFromStart = benefitWeeksFromStart !== null ? round2(benefitWeeksFromStart / 52) : null;

  return {
    inputs: {
      doi,
      asOf,
      aww: awwN,
      birthDate: birth,
      ptdStartDate: ptdStart,
      offsetMonthlyGovtBenefits: offsetMonthly,
      offsetWeeklyGovtBenefits: offsetWeekly,
      offsetMonthlyPERA: peraMonthly,
      offsetWeeklyPERA: peraWeekly,
      assumeOffsetAppliesNow,
      isMinorOrApprentice
    },
    rateRow: rec,
    calc: {
      rawTwoThirds,
      maxWeekly,
      minWeekly,
      baseWeeklyRate,
      adjustedWeeklyRateAsOf,
      offsetThresholdDollars,
      approxWeeksUntilOffset,
      totalWeeklyOffset,
      weeklyAfterOffsetIfApplied,
      benefitEndDate,
      benefitWeeksFromStart,
      benefitYearsFromStart
    },
    escalation: {
      rule: escalationBuilt.rule,
      steps: escalationBuilt.steps
    }
  };
}
