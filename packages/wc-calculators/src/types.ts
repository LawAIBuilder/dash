export interface CompRatesMetadata {
  source: string;
  sourceDocument: string;
  extractedBy: string;
  extractedDate: string;
}

export interface RawCompRateRow {
  effectiveDate: string;
  saww: number;
  minCompRate: number;
  maxCompRate: number;
  annualAdjustmentPct: number | null;
  suppBenefitPre1992Pct: number | null;
  suppBenefit1992to1995Pct: number | null;
  suppBenefit1995to2013Pct: number | null;
  suppBenefit2013laterPct: number | null;
  minRateOrActualWage: number | null;
}

export interface RawCompRatesData {
  _metadata: CompRatesMetadata;
  compensationRates: RawCompRateRow[];
}

export interface CompRateRow {
  effectiveDate: string;
  saww: number;
  minCompRate: number;
  maxCompRate: number;
  annualAdjustment: number | null;
  minRateOrActualWage: number | null;
}

export interface CompRatesTable {
  metadata: CompRatesMetadata;
  rows: readonly CompRateRow[];
  verifiedThrough: string | null;
}

export interface AWWResult {
  weeksCounted: number;
  totalWages: number;
  aww: number;
}

export interface TTDResult {
  inputs: { doi: string; aww: number };
  rateRow: CompRateRow;
  calc: {
    rawTwoThirds: number;
    weeklyRate: number;
    appliedMax: number;
    appliedMin: number;
  };
}

export interface TPDResult {
  inputs: { doi: string; aww: number; postInjuryWeeklyWage: number };
  rateRow: CompRateRow;
  calc: {
    wageLoss: number;
    rawTwoThirdsWageLoss: number;
    weeklyRate: number;
    appliedMax: number;
  };
}

export interface PresentDayValueResult {
  presentValue: number;
  nominalValue: number;
  reduction: number;
}

export interface EscalationStep {
  periodStart: string;
  periodEnd: string;
  rate: number;
  appliedAdjustmentOn: string | null;
  sourceAnnualAdjustmentEffectiveDate?: string | null;
  adjustmentPct: number | null;
  cappedFrom: number | null;
}

export interface EscalationResult {
  inputs: {
    doi: string;
    through: string;
    aww: number;
    baseWeeklyRate: number;
  };
  rule: {
    capPct: number | null;
    waitYears: number;
    firstEligible: string;
  };
  steps: EscalationStep[];
  currentWeeklyRate: number;
}

export interface PTDResult {
  inputs: {
    doi: string;
    asOf: string;
    aww: number;
    birthDate?: string | null;
    ptdStartDate?: string | null;
    offsetMonthlyGovtBenefits?: number | null;
    offsetWeeklyGovtBenefits?: number | null;
    offsetMonthlyPERA?: number | null;
    offsetWeeklyPERA?: number | null;
    assumeOffsetAppliesNow: boolean;
    isMinorOrApprentice: boolean;
  };
  rateRow: CompRateRow;
  calc: {
    rawTwoThirds: number;
    maxWeekly: number;
    minWeekly: number;
    baseWeeklyRate: number;
    adjustedWeeklyRateAsOf: number;
    offsetThresholdDollars: number;
    approxWeeksUntilOffset: number | null;
    totalWeeklyOffset: number | null;
    weeklyAfterOffsetIfApplied: number | null;
    benefitEndDate: string | null;
    benefitWeeksFromStart: number | null;
    benefitYearsFromStart: number | null;
  };
  escalation: {
    rule: {
      capPct: number | null;
      waitYears: number;
      firstEligible: string;
    };
    steps: EscalationStep[];
  };
}

export interface ParsedCSVRow {
  gross: number;
  start: string | null;
  end: string | null;
}

export interface ParsedCSV {
  header: string[];
  rows: ParsedCSVRow[];
}
