import { describe, expect, it } from "vitest";
import { calcAWWFromPayPeriods, calcAWWFromWeeklyEntries } from "../aww-calc.js";
import { calcTTD } from "../comp-calcs.js";
import {
  RATES_VERIFIED_THROUGH,
  getCompRateForDate,
  getCompRates,
  getCompRatesMetadata,
  getCompRatesTable,
  getLatestCompRate
} from "../data.js";

describe("wc-calculators foundation imports", () => {
  it("calculates average weekly wage from weekly entries", () => {
    const result = calcAWWFromWeeklyEntries([1000, 1200, 800]);
    expect(result.weeksCounted).toBe(3);
    expect(result.totalWages).toBe(3000);
    expect(result.aww).toBe(1000);
  });

  it("calculates average weekly wage from pay period dates", () => {
    const result = calcAWWFromPayPeriods([
      { gross: 1200, start: "2024-01-01", end: "2024-01-07" },
      { gross: 900, start: "2024-01-08", end: "2024-01-14" }
    ]);

    expect(result.weeksCounted).toBe(2);
    expect(result.totalWages).toBe(2100);
    expect(result.aww).toBe(1050);
  });

  it("exposes imported compensation-rate metadata and a stable table", () => {
    const metadata = getCompRatesMetadata();
    expect(metadata.source).toContain("Minnesota DLI");
    expect(metadata.sourceDocument).toContain("benefit adjustments");

    const table = getCompRatesTable();
    expect(table.rows).toBe(getCompRates());
    expect(table.verifiedThrough).toBe(RATES_VERIFIED_THROUGH);
    expect(table.rows[0]?.effectiveDate).toBe("2021-10-01");
  });

  it("looks up the effective compensation-rate row by injury date", () => {
    expect(getCompRateForDate("2024-11-01")?.effectiveDate).toBe("2024-10-01");
    expect(getCompRateForDate("2025-12-15")?.effectiveDate).toBe("2025-10-01");
    expect(getLatestCompRate()?.effectiveDate).toBe("2025-10-01");
  });

  it("calculates a TTD rate using imported compensation rate data", () => {
    const result = calcTTD({ doiISO: "2024-11-01", aww: 1500 });
    expect(result.inputs.doi).toBe("2024-11-01");
    expect(result.calc.weeklyRate).toBeGreaterThan(0);
    expect(result.rateRow.effectiveDate).toBe("2024-10-01");
    expect(result.calc.weeklyRate).toBe(1000);
  });
});
