/**
 * Pure unit tests for lib/category-compare-transform.ts — no database,
 * hand-built fixtures only (mirrors test/front-door-transform.test.ts's own
 * convention). Values are round, billions-scale, whole-dollar decimal
 * strings chosen to make every computed figure legible in a formatUsdScale
 * "B" display, not an attempt to reproduce the real production numbers
 * (this repo's local PGlite test database never carries the full 11-year
 * MTS backfill the approved mockup's own reference figures were computed
 * from — see this PR's own summary for that call).
 */
import { describe, expect, it } from "vitest";
import type { Magnitude, SeriesId } from "@penny/registry";
import type { CategoryHistoryPoint } from "../lib/series-data";
import { buildCategoryCompareData, COMPARE_BASELINE_PERIOD_END, REST_SERIES_ID, REST_SERIES_LABEL, type CompareCategoryInput } from "../lib/category-compare-transform";

const ONES: Magnitude = "ones";

function isLeapYear(y: number): boolean {
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
}
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function lastDayOf(y: number, m: number): number {
  return m === 2 && isLeapYear(y) ? 29 : DAYS_IN_MONTH[m - 1]!;
}
function periodEndOf(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(lastDayOf(y, m)).padStart(2, "0")}`;
}

/** 24 consecutive months, Jan 2019 through Dec 2020, one value per month
 * from a caller-supplied (year, month) -> value function — every fixture
 * below is built from this, so every series shares the exact same
 * calendar. */
function months(valueFor: (year: number, month: number) => string | null): CategoryHistoryPoint[] {
  const points: CategoryHistoryPoint[] = [];
  for (let y = 2019; y <= 2020; y++) {
    for (let m = 1; m <= 12; m++) {
      const v = valueFor(y, m);
      if (v !== null) points.push({ periodEnd: periodEndOf(y, m), value: v, fiscalYear: m >= 10 ? y + 1 : y });
    }
  }
  return points;
}

function input(id: string, label: string, rawPoints: CategoryHistoryPoint[]): CompareCategoryInput {
  return { id: id as SeriesId, label, magnitude: ONES, rawPoints };
}

/** 12 consecutive months, Jan-Dec 2021, for the "genuinely receded" spike
 * fixture below — a third year appended onto `months`'s own 2019-2020
 * calendar, always at the same value each month. */
function months2021(valueFor: (year: number, month: number) => string): CategoryHistoryPoint[] {
  const points: CategoryHistoryPoint[] = [];
  for (let m = 1; m <= 12; m++) points.push({ periodEnd: periodEndOf(2021, m), value: valueFor(2021, m), fiscalYear: m >= 10 ? 2022 : 2021 });
  return points;
}

describe("buildCategoryCompareData", () => {
  // A flat $50B/month category — stands in for one of the fixed five;
  // nothing about its own math is interesting, it's here to confirm the
  // fixed series pass through untouched (order preserved, id/label kept,
  // rolled up into a 12-month total the same way lib/front-door-transform.ts
  // already does).
  const medicare = input("fiscal.mts.outlays.category.medicare", "Medicare", months(() => "50000000000"));

  // "Income security" — $10B/mo through 2019, jumps to $30B/mo in 2020.
  const incomeSecurity = input("fiscal.mts.outlays.category.income_security", "Income security", months((y) => (y === 2019 ? "10000000000" : "30000000000")));
  // "Commerce and housing credit" — $5B/mo through 2019, jumps to $15B/mo.
  const commerceHousing = input(
    "fiscal.mts.outlays.category.commerce_and_housing_credit",
    "Commerce and housing credit",
    months((y) => (y === 2019 ? "5000000000" : "15000000000")),
  );
  // "Undistributed offsetting receipts" — a constant, ordinarily-negative
  // category (never excluded from the sum despite its sign).
  const undistributed = input("fiscal.mts.outlays.category.undistributed_offsetting_receipts", "Undistributed offsetting receipts", months(() => "-2000000000"));

  it("passes the fixed series through untouched (order preserved) and appends the rest aggregate last", () => {
    const result = buildCategoryCompareData([medicare], [incomeSecurity, commerceHousing, undistributed]);
    expect(result.series).toHaveLength(2);
    expect(result.series[0]!.id).toBe("fiscal.mts.outlays.category.medicare");
    expect(result.series[0]!.label).toBe("Medicare");
    // $50B * 12 = $600B every rolling window (a flat series).
    expect(result.series[0]!.twelveMonthTotal.length).toBeGreaterThan(0);
    expect(result.series[0]!.twelveMonthTotal[0]!.valueWhole).toBe("600000000000");
    expect(result.series[1]!.id).toBe(REST_SERIES_ID);
    expect(result.series[1]!.label).toBe(REST_SERIES_LABEL);
  });

  it("the rest aggregate sums every OTHER category per month, INCLUDING the negative one — never excluded for its sign", () => {
    const result = buildCategoryCompareData([medicare], [incomeSecurity, commerceHousing, undistributed]);
    const rest = result.series[1]!.twelveMonthTotal;
    // 2019: (10 + 5 - 2) = 13B/mo * 12 = 156B — the baseline window.
    const baseline = rest.find((p) => p.periodEnd === COMPARE_BASELINE_PERIOD_END);
    expect(baseline).toBeDefined();
    expect(baseline!.valueWhole).toBe("156000000000");
    // 2020: (30 + 15 - 2) = 43B/mo * 12 = 516B — the last (and, since the
    // series only steps up, the peak) window.
    const peak = rest[rest.length - 1]!;
    expect(peak.periodEnd).toBe("2020-12-31");
    expect(peak.valueWhole).toBe("516000000000");
  });

  it("a category missing a reading for one month makes the WHOLE aggregate skip that month — never partially summed as if the category read zero", () => {
    // Drop commerce_and_housing_credit's very first month (Jan 2019) only —
    // income_security and undistributed both still have a Jan 2019 reading.
    const sparse = { ...commerceHousing, rawPoints: commerceHousing.rawPoints.slice(1) };
    const result = buildCategoryCompareData([medicare], [incomeSecurity, sparse, undistributed]);
    const rest = result.series[1]!.twelveMonthTotal;
    // Jan 2019 itself is missing from the monthly aggregate entirely (a
    // real gap, never a partial $8B reading that pretends commerce and
    // housing credit read zero that month) — so the 12-month window ending
    // Dec 2019 spans that gap and is skipped entirely, matching
    // rollingTwelveMonthTotal's own gap-skipping rule for the window one
    // level up.
    const baseline = rest.find((p) => p.periodEnd === COMPARE_BASELINE_PERIOD_END);
    expect(baseline).toBeUndefined();
    // 2020 is fully unaffected (every category has full 2020 data) — the
    // peak is still exactly correct.
    const peak = rest[rest.length - 1]!;
    expect(peak.periodEnd).toBe("2020-12-31");
    expect(peak.valueWhole).toBe("516000000000");
  });

  it("computes the annotation from the data — peak, delta vs the baseline window, and the top-2 positive contributors' computed share", () => {
    const result = buildCategoryCompareData([medicare], [incomeSecurity, commerceHousing, undistributed]);
    const annotation = result.annotation!;
    expect(annotation).not.toBeNull();
    expect(annotation.anchorPeriodEnd).toBe("2020-12-31");
    expect(annotation.windowLabel).toBe("2020");
    // This fixture's rest series never comes back down from its own peak
    // (2020 is flat-but-higher than 2019, and the data ends there) — the
    // peak IS simply the latest reading, so the title uses the neutral
    // "highest total" wording rather than asserting an unverified "spike"
    // shape the line itself doesn't show (see the dedicated spike-wording
    // tests below).
    expect(annotation.title).toBe("Highest 12-month total: Dec 2020, $516.0B");
    expect(annotation.body[0]).toBe("Up $360.0B vs the 12 months ending Dec 2019.");
    // Income security (+$240.0B) outranks commerce and housing credit
    // (+$120.0B); undistributed offsetting receipts (delta $0, and negative
    // in level) never appears — a non-positive delta is never a
    // "contributor to the increase". One contributor per body LINE (never
    // joined into one long sentence) — @penny/viz's CategoryCompareChart
    // renders each line right-anchored, growing leftward from the peak's own
    // x-position, and a single long joined line measurably overflowed the
    // chart's left edge in a real-browser screenshot against production
    // data (this PR's own reconciliation pass).
    expect(annotation.body[1]).toBe("Income security (+$240.0B) and");
    expect(annotation.body[2]).toBe("Commerce and housing credit (+$120.0B)");
    // The closing line states the top-2 contributors' own EXACT computed
    // share of the total delta ($240B + $120B = $360B, the whole delta
    // here) — never an unverified adjective like "accounted for most of
    // the increase."
    expect(annotation.body[3]).toBe("Together, 100% of the increase.");
    expect(annotation.body.join(" ")).not.toContain("Undistributed");
    expect(annotation.body.join(" ")).not.toContain("accounted for most");
  });

  it('titles it a "spike" only once the series has genuinely come back down from its own peak — a still-climbing series (peak = latest reading) never gets that word', () => {
    // Extend the same categories through 2021, receding most of the way
    // back toward 2019 levels — a real hump, not a plateau.
    const recedingIncome: CompareCategoryInput = {
      ...incomeSecurity,
      rawPoints: [...incomeSecurity.rawPoints, ...months2021(() => "12000000000")],
    };
    const recedingCommerce: CompareCategoryInput = {
      ...commerceHousing,
      rawPoints: [...commerceHousing.rawPoints, ...months2021(() => "6000000000")],
    };
    const recedingUndistributed: CompareCategoryInput = {
      ...undistributed,
      rawPoints: [...undistributed.rawPoints, ...months2021(() => "-2000000000")],
    };
    const result = buildCategoryCompareData([medicare], [recedingIncome, recedingCommerce, recedingUndistributed]);
    const annotation = result.annotation!;
    // The peak is still Dec 2020 (2021's own window total, 192B, is lower)
    // — but now the series' LATEST reading (Dec 2021) is well below it, so
    // "spike" is an honest description of the shape.
    expect(annotation.anchorPeriodEnd).toBe("2020-12-31");
    expect(annotation.title).toBe("The 2020 spike — Dec 2020 peak: $516.0B");
  });

  it("returns a null annotation when there is no reading at the baseline month — never a fabricated comparison", () => {
    // Start the data in 2020 only — no 2019-12-31 window exists at all.
    const lateStart = (v: CompareCategoryInput): CompareCategoryInput => ({ ...v, rawPoints: v.rawPoints.filter((p) => p.periodEnd.startsWith("2020")) });
    const result = buildCategoryCompareData([medicare], [lateStart(incomeSecurity), lateStart(commerceHousing), lateStart(undistributed)]);
    expect(result.annotation).toBeNull();
  });

  it("returns a null annotation when the series never exceeds its own baseline — no spike to call out", () => {
    const flat = input("fiscal.mts.outlays.category.agriculture", "Agriculture", months(() => "1000000000"));
    const result = buildCategoryCompareData([medicare], [flat]);
    expect(result.annotation).toBeNull();
  });

  it("returns a null annotation when there is no `other` data at all", () => {
    const result = buildCategoryCompareData([medicare], []);
    expect(result.series[1]!.twelveMonthTotal).toHaveLength(0);
    expect(result.annotation).toBeNull();
  });
});
