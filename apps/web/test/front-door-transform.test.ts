/**
 * Pure unit tests for lib/front-door-transform.ts — no database, hand-built
 * fixtures only (mirrors test/fiscal-flow-input.test.ts's convention for
 * the living Sankey's own pure transform).
 */
import { describe, expect, it } from "vitest";
import type { SeriesId } from "@penny/registry";
import type { CategoryFlow, CategoryHistoryPoint } from "../lib/series-data";
import type { Reading } from "../lib/types";
import {
  buildBridge,
  buildCategoryHistoryLineSeries,
  buildCategoryHistoryPanel,
  buildDebtPerHouseholdFact,
  buildDebtPerResidentFact,
  buildDeficitChart,
  buildInterestPerTaxDollarFact,
  buildMonthStepper,
  buildPerHouseholdSpendFact,
  buildRankedPeriod,
  buildToplineCells,
} from "../lib/front-door-transform";

const SOCIAL_SECURITY = "fiscal.mts.outlays.category.social_security" as SeriesId;
const NATIONAL_DEFENSE = "fiscal.mts.outlays.category.national_defense" as SeriesId;
const UNDISTRIBUTED = "fiscal.mts.outlays.category.undistributed_offsetting_receipts" as SeriesId;
const OUTLAYS_TOTAL = "fiscal.mts.outlays.total" as SeriesId;
const RECEIPTS_TOTAL = "fiscal.mts.receipts.total" as SeriesId;
const DEFICIT_TOTAL = "fiscal.mts.deficit.total" as SeriesId;
const DEBT_ID = "fiscal.debt.total_public_debt_outstanding" as SeriesId;
const NET_INTEREST = "fiscal.mts.outlays.category.net_interest" as SeriesId;
const INDIVIDUAL_INCOME_TAX = "fiscal.mts.receipts.category.individual_income_tax" as SeriesId;
const HOUSEHOLDS = "census.households.total" as SeriesId;
const POPULATION = "census.population.resident_total" as SeriesId;
const OUTLAYS_PROJECTION = "projection.cbo.baseline.outlays" as SeriesId;
const RECEIPTS_PROJECTION = "projection.cbo.baseline.revenues" as SeriesId;
const DEFICIT_PROJECTION = "projection.cbo.baseline.deficit" as SeriesId;

/** A CBO baseline projection reading — period_type "year", the Feb 2026
 * baseline's own publication date, unless overridden. */
function projectionReading(seriesId: SeriesId, value: string, overrides: Partial<Reading> = {}): Reading {
  return reading(seriesId, value, {
    periodType: "year",
    periodStart: "2025-10-01",
    periodEnd: "2026-09-30",
    fiscalYear: 2026,
    publicationTime: "2026-02-11T00:00:00.000Z",
    ...overrides,
  });
}

function reading(seriesId: SeriesId, value: string, overrides: Partial<Reading> = {}): Reading {
  return {
    seriesId,
    periodType: "fiscal_ytd",
    periodStart: "2025-10-01",
    periodEnd: "2026-07-31",
    fiscalYear: 2026,
    value,
    publicationTime: "2026-08-12T00:00:00.000Z",
    revisionOf: null,
    ...overrides,
  };
}

describe("buildRankedPeriod", () => {
  it("ranks rows descending by value, drops categories with no reading, and computes signed shares", () => {
    const categories: CategoryFlow[] = [
      { id: NATIONAL_DEFENSE, label: "National defense", reading: reading(NATIONAL_DEFENSE, "803701596629.04") },
      { id: SOCIAL_SECURITY, label: "Social Security", reading: reading(SOCIAL_SECURITY, "1384438183069.17") },
      { id: UNDISTRIBUTED, label: "Undistributed offsetting receipts", reading: reading(UNDISTRIBUTED, "-136620830131.93") },
      { id: "fiscal.mts.outlays.category.energy" as SeriesId, label: "Energy", reading: null }, // a gap — never a zero row
    ];
    const total = reading(OUTLAYS_TOTAL, "6284235715734.18");

    const period = buildRankedPeriod(categories, total, "FY 2026 through July", "Total outlays");
    expect(period).not.toBeNull();
    expect(period!.rows.map((r) => r.id)).toEqual([SOCIAL_SECURITY, NATIONAL_DEFENSE, UNDISTRIBUTED]);

    const ss = period!.rows[0]!;
    expect(ss.scaledDisplay).toBe("$1,384.4B");
    expect(ss.shareDisplay).toBe("22.0%");
    expect(ss.negative).toBe(false);

    const undistributed = period!.rows[2]!;
    expect(undistributed.negative).toBe(true);
    expect(undistributed.shareDisplay.startsWith("−")).toBe(true);
    expect(undistributed.scaledDisplay).toBe("−$136.6B");

    expect(period!.totalDisplay).toBe("Total outlays, FY 2026 through July: $6,284.2B");
  });

  it("returns null when the period's own total is a gap — never ranks against nothing", () => {
    expect(buildRankedPeriod([{ id: SOCIAL_SECURITY, label: "Social Security", reading: reading(SOCIAL_SECURITY, "100") }], null, "x", "Total outlays")).toBeNull();
  });
});

describe("buildCategoryHistoryPanel", () => {
  // Values are the registry's real "ones" magnitude (whole dollars and
  // cents) — the mockup's $-millions HIST table figures, scaled up by 1e6
  // to what the database actually stores.
  const points: CategoryHistoryPoint[] = [
    { periodEnd: "2024-09-30", value: "9170000000", fiscalYear: 2024 },
    { periodEnd: "2025-07-31", value: "6397000000", fiscalYear: 2025 },
    { periodEnd: "2026-06-30", value: "8760000000", fiscalYear: 2026 },
    { periodEnd: "2026-07-31", value: "12795000000", fiscalYear: 2026 },
  ];

  it("uses the real fiscal_ytd total for the anchor chip when it's available — never the September MONTH figure standing in for the fiscal YEAR figure", () => {
    // The real FY2024 full-year total for this category — a different,
    // larger number than the September 2024 MONTH figure ($9.17B) above, on
    // purpose: this is what distinguishes "the fiscal year's last month"
    // from "the fiscal year," the exact accounting-concept mix the anchor
    // chip must never silently make.
    const priorFyTotal = reading(NATIONAL_DEFENSE, "803701596629.04", { periodType: "fiscal_ytd", periodEnd: "2024-09-30", fiscalYear: 2024 });
    const panel = buildCategoryHistoryPanel(NATIONAL_DEFENSE, points, priorFyTotal);
    expect(panel).not.toBeNull();
    expect(panel!.points).toHaveLength(4);
    expect(panel!.chips[0]).toEqual({ kind: "anchor", label: "FY2024 full year", display: "$803.7B" });
  });

  it("falls back to an honestly-labeled September MONTH figure when no real fiscal_ytd total is available", () => {
    const panel = buildCategoryHistoryPanel(NATIONAL_DEFENSE, points, null);
    expect(panel).not.toBeNull();
    expect(panel!.chips[0]).toEqual({ kind: "anchor", label: "September 2024 (prior FY's final month)", display: "$9.2B" });
  });

  it("falls back the same way when the prior-FY total isn't passed at all (optional parameter)", () => {
    const panel = buildCategoryHistoryPanel(NATIONAL_DEFENSE, points);
    expect(panel).not.toBeNull();
    expect(panel!.chips[0]!.kind).toBe("anchor");
    expect(panel!.chips[0]!.label).toBe("September 2024 (prior FY's final month)");
  });

  it("uses a percent-change delta chip when both endpoints are positive", () => {
    const panel = buildCategoryHistoryPanel(NATIONAL_DEFENSE, points)!;
    // vs. June 2026: 8760 -> 12795, both positive.
    const juneChip = panel.chips.find((c) => c.label === "vs. June 2026")!;
    expect(juneChip.display.startsWith("+")).toBe(true);
    expect(juneChip.display.endsWith("%")).toBe(true);
  });

  it("falls back to an absolute-dollar delta chip when an endpoint is zero or negative", () => {
    const withNegative: CategoryHistoryPoint[] = [
      { periodEnd: "2026-06-30", value: "-5000", fiscalYear: 2026 },
      { periodEnd: "2026-07-31", value: "3000", fiscalYear: 2026 },
    ];
    const panel = buildCategoryHistoryPanel(NATIONAL_DEFENSE, withNegative)!;
    expect(panel.chips).toHaveLength(1);
    expect(panel.chips[0]!.display).not.toContain("%");
    expect(panel.chips[0]!.display.startsWith("+")).toBe(true); // -5000 -> 3000 is an increase
  });

  it("generalizes to fewer than 4 points (no forced 'prior FY-end' framing) and to a single point (no chips)", () => {
    const two = buildCategoryHistoryPanel(NATIONAL_DEFENSE, points.slice(2))!;
    expect(two.chips).toHaveLength(1);
    expect(two.chips[0]!.kind).toBe("delta");

    const one = buildCategoryHistoryPanel(NATIONAL_DEFENSE, points.slice(3))!;
    expect(one.chips).toHaveLength(0);
  });

  it("returns null for an empty history", () => {
    expect(buildCategoryHistoryPanel(NATIONAL_DEFENSE, [])).toBeNull();
  });
});

describe("buildCategoryHistoryLineSeries", () => {
  /** 46 consecutive months, Oct 2022 through Jul 2026 — the same span the real outlays.total/deficit.total series already carry. */
  function fullHistory(): CategoryHistoryPoint[] {
    const points: CategoryHistoryPoint[] = [];
    let y = 2022;
    let m = 10;
    for (let i = 0; i < 46; i++) {
      const lastDay = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
      points.push({ periodEnd: `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`, value: String(1_000_000_000 + i * 1_000_000), fiscalYear: y });
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return points;
  }

  it("returns null for the today's-seed shape — 4 or fewer points — so the caller falls back to the dot plot", () => {
    expect(buildCategoryHistoryLineSeries(NATIONAL_DEFENSE, [])).toBeNull();
    expect(buildCategoryHistoryLineSeries(NATIONAL_DEFENSE, fullHistory().slice(0, 4))).toBeNull();
  });

  it("returns a monthly series for every ingested point once the backfill exceeds 4 periods", () => {
    const series = buildCategoryHistoryLineSeries(NATIONAL_DEFENSE, fullHistory())!;
    expect(series).not.toBeNull();
    expect(series.monthly).toHaveLength(46);
    expect(series.monthly[0]!.periodEnd).toBe("2022-10-31");
    expect(series.monthly[45]!.periodEnd).toBe("2026-07-31");
  });

  it("each monthly point's exactDisplay is the full-precision figure, distinct from scaledDisplay's fixed-billions rounding — the hover title's 'exact figure' claim depends on this", () => {
    const points = fullHistory();
    points[0] = { ...points[0]!, value: "1234567890.42" }; // not a round billion
    const series = buildCategoryHistoryLineSeries(NATIONAL_DEFENSE, points)!;
    // national_defense is magnitude "ones" -> 2 decimal places, to the cent.
    expect(series.monthly[0]!.exactDisplay).toBe("$1,234,567,890.42");
    expect(series.monthly[0]!.scaledDisplay).toBe("$1.2B");
    expect(series.monthly[0]!.exactDisplay).not.toBe(series.monthly[0]!.scaledDisplay);
  });

  it("the 12-month rolling total also carries an exact (never fixed-billions-rounded) exactDisplay", () => {
    const series = buildCategoryHistoryLineSeries(NATIONAL_DEFENSE, fullHistory())!;
    const firstTotal = series.twelveMonthTotal[0]!;
    expect(firstTotal.exactDisplay.startsWith("$")).toBe(true);
    expect(firstTotal.exactDisplay).not.toContain("B"); // no scale suffix — a full dollar figure, unlike scaledDisplay.
  });

  it("the 12-month rolling total only starts once 12 consecutive months exist — 46 months in, 35 rolling totals out", () => {
    const series = buildCategoryHistoryLineSeries(NATIONAL_DEFENSE, fullHistory())!;
    expect(series.twelveMonthTotal).toHaveLength(35); // 46 - 12 + 1
    expect(series.twelveMonthTotal[0]!.periodEnd).toBe("2023-09-30"); // the 12th month
  });

  it("never fabricates a 12-month total across a gap in the backfill", () => {
    const points = fullHistory();
    // Remove one month in the middle (simulating a category the backfill hasn't fully reached).
    const withGap = [...points.slice(0, 20), ...points.slice(21)]; // 45 points, a real gap at index 20
    const series = buildCategoryHistoryLineSeries(NATIONAL_DEFENSE, withGap)!;
    // No 12-month window may span the removed month — every emitted total's
    // window must be exactly 12 consecutive calendar months.
    for (const total of series.twelveMonthTotal) {
      const idx = withGap.findIndex((p) => p.periodEnd === total.periodEnd);
      const windowStart = withGap[idx - 11];
      expect(windowStart).toBeDefined();
      const startIdx = Number(windowStart!.periodEnd.slice(0, 4)) * 12 + Number(windowStart!.periodEnd.slice(5, 7));
      const endIdx = Number(total.periodEnd.slice(0, 4)) * 12 + Number(total.periodEnd.slice(5, 7));
      expect(endIdx - startIdx).toBe(11);
    }
    // Strictly fewer valid windows than the no-gap case (some windows near the gap are skipped).
    expect(series.twelveMonthTotal.length).toBeLessThan(35);
  });

  it("the 12-month total is an exact sum, never a float approximation", () => {
    const points = fullHistory().map((p, i) => ({ ...p, value: i < 12 ? "0.01" : p.value })); // 12 months of exactly one cent each
    const series = buildCategoryHistoryLineSeries(NATIONAL_DEFENSE, points)!;
    // $0.01 * 12 = $0.12, scaled to whole dollars/rounded for display -> $0.0B (well under a billion), but the point is the underlying sum must be exact.
    expect(series.twelveMonthTotal[0]!.valueWhole).toBe("0.12");
  });
});

describe("buildMonthStepper", () => {
  const MONTHS = ["2022-10-31", "2022-11-30", "2022-12-31", "2023-01-31"];

  it("returns null when no month has any data at all", () => {
    expect(buildMonthStepper([], null)).toBeNull();
  });

  it("defaults to the latest available month when no month is requested", () => {
    const stepper = buildMonthStepper(MONTHS, null)!;
    expect(stepper.currentPeriodEnd).toBe("2023-01-31");
    expect(stepper.nextPeriodEnd).toBeNull(); // at the newest edge
    expect(stepper.prevPeriodEnd).toBe("2022-12-31");
    expect(stepper.monthCount).toBe(4);
  });

  it("falls back to the latest month for an invalid/unknown request, never an error", () => {
    const stepper = buildMonthStepper(MONTHS, "1999-01-31")!;
    expect(stepper.currentPeriodEnd).toBe("2023-01-31");
  });

  it("steps to a valid requested month and computes both neighbors", () => {
    const stepper = buildMonthStepper(MONTHS, "2022-11-30")!;
    expect(stepper.currentPeriodEnd).toBe("2022-11-30");
    expect(stepper.prevPeriodEnd).toBe("2022-10-31");
    expect(stepper.nextPeriodEnd).toBe("2022-12-31");
    expect(stepper.currentLabel).toBe("November 2022");
  });

  it("disables the previous step at the oldest available month", () => {
    const stepper = buildMonthStepper(MONTHS, "2022-10-31")!;
    expect(stepper.prevPeriodEnd).toBeNull();
    expect(stepper.nextPeriodEnd).toBe("2022-11-30");
  });
});

describe("buildDeficitChart", () => {
  it("renders one column per reading and never hardcodes the count", () => {
    const readings: Reading[] = Array.from({ length: 46 }, (_, i) => {
      const year = 2022 + Math.floor((i + 9) / 12);
      const month = ((i + 9) % 12) + 1;
      const periodEnd = `${year}-${String(month).padStart(2, "0")}-28`;
      const value = i % 6 === 0 ? "50000000000" : "-200000000000"; // an occasional surplus among deficits
      return reading(DEFICIT_TOTAL, value, { periodType: "month", periodEnd, fiscalYear: year });
    });
    const chart = buildDeficitChart(readings);
    expect(chart).not.toBeNull();
    expect(chart!.columns).toHaveLength(46);
    expect(chart!.monthCount).toBe(46);
    expect(chart!.columns.some((c) => c.isDeficit)).toBe(true);
    expect(chart!.columns.some((c) => !c.isDeficit)).toBe(true);
    // Axis labels are picked from the real data, always including the first and last month.
    expect(chart!.axisLabels[0]).toBe(chart!.columns[0]!.monthLabel);
    expect(chart!.axisLabels[chart!.axisLabels.length - 1]).toBe(chart!.columns[45]!.monthLabel);
    expect(chart!.axisLabels.length).toBeLessThanOrEqual(5);
  });

  it("returns null for no history at all", () => {
    expect(buildDeficitChart([])).toBeNull();
  });

  describe("surplusCaption — derived from the columns actually rendered, never a hardcoded seasonal claim", () => {
    it("names every calendar month that actually ran a surplus in this window, not just the most common one", () => {
      // April surplus 4 times, September 2, August 1, June 1 — mirrors the
      // real seeded 46-month history (Oct 2022-Jul 2026): a caption that
      // named only April would be false against this exact data.
      const months: [string, boolean][] = [
        ["2023-04", true],
        ["2023-08", true],
        ["2024-04", true],
        ["2024-09", true],
        ["2025-04", true],
        ["2025-06", true],
        ["2025-09", true],
        ["2026-04", true],
      ];
      const surplusEnds = new Set(months.map(([ym]) => `${ym}-28`));
      const readings: Reading[] = Array.from({ length: 46 }, (_, i) => {
        const year = 2022 + Math.floor((i + 9) / 12);
        const month = ((i + 9) % 12) + 1;
        const periodEnd = `${year}-${String(month).padStart(2, "0")}-28`;
        const value = surplusEnds.has(periodEnd) ? "50000000000" : "-200000000000";
        return reading(DEFICIT_TOTAL, value, { periodType: "month", periodEnd, fiscalYear: year });
      });
      const chart = buildDeficitChart(readings)!;
      expect(chart.surplusCaption).toContain("8 ran a surplus");
      expect(chart.surplusCaption).toContain("April (4)");
      expect(chart.surplusCaption).toContain("September (2)");
      expect(chart.surplusCaption).toContain("August (1)");
      expect(chart.surplusCaption).toContain("June (1)");
    });

    it("states no surplus occurred when every column is a deficit", () => {
      const readings: Reading[] = Array.from({ length: 3 }, (_, i) =>
        reading(DEFICIT_TOTAL, "-1000", { periodType: "month", periodEnd: `2026-0${i + 1}-28`, fiscalYear: 2026 }),
      );
      const chart = buildDeficitChart(readings)!;
      expect(chart.surplusCaption).toBe("None of the 3 months shown ran a surplus.");
    });
  });
});

describe("buildBridge", () => {
  it("computes a signed gap, cosmetic percentages, a trillions-worded debt figure, and the debt's own as-of date — a deficit period", () => {
    const bridge = buildBridge(
      reading(OUTLAYS_TOTAL, "6284235715734.18"),
      reading(RECEIPTS_TOTAL, "4485419503881.15"),
      reading(DEBT_ID, "40077529831942.94", { periodType: "day", periodEnd: "2026-08-27" }),
    );
    expect(bridge).not.toBeNull();
    expect(bridge!.direction).toBe("deficit");
    expect(bridge!.outlaysDisplay).toBe("$6,284.2B");
    expect(bridge!.receiptsDisplay).toBe("$4,485.4B");
    expect(bridge!.gapDisplay).toBe("$1,798.8B");
    expect(bridge!.smallerPercentOfLarger).toBeCloseTo(71.4, 1); // receipts / outlays (outlays is larger)
    expect(bridge!.gapPercentOfLarger).toBeGreaterThan(0);
    expect(bridge!.debtTrillionsDisplay).toBe("$40.08 trillion");
    expect(bridge!.debtAsOfDisplay).toBe("Aug 27, 2026");
  });

  it("derives 'surplus' and non-negative percentages when receipts exceed outlays — never a negative CSS width", () => {
    const bridge = buildBridge(
      reading(OUTLAYS_TOTAL, "4485419503881.15"),
      reading(RECEIPTS_TOTAL, "6284235715734.18"),
      reading(DEBT_ID, "40077529831942.94", { periodType: "day" }),
    );
    expect(bridge).not.toBeNull();
    expect(bridge!.direction).toBe("surplus");
    expect(bridge!.gapDisplay).toBe("$1,798.8B"); // unsigned magnitude — direction carries the sign
    expect(bridge!.smallerPercentOfLarger).toBeGreaterThanOrEqual(0);
    expect(bridge!.gapPercentOfLarger).toBeGreaterThanOrEqual(0);
  });

  it("derives 'balanced' when outlays and receipts are equal — a zero gap, not a false deficit", () => {
    const bridge = buildBridge(reading(OUTLAYS_TOTAL, "1000"), reading(RECEIPTS_TOTAL, "1000"), reading(DEBT_ID, "1", { periodType: "day" }));
    expect(bridge).not.toBeNull();
    expect(bridge!.direction).toBe("balanced");
    expect(bridge!.gapPercentOfLarger).toBe(0);
  });

  it("returns null when any input is a gap", () => {
    expect(buildBridge(null, reading(RECEIPTS_TOTAL, "1"), reading(DEBT_ID, "1"))).toBeNull();
  });
});

describe("buildToplineCells", () => {
  it("pairs each observed FYTD figure with CBO's same-fiscal-year projection, in dek order (spending, revenue, borrowed)", () => {
    const cells = buildToplineCells(
      reading(OUTLAYS_TOTAL, "6284235715734.18"),
      projectionReading(OUTLAYS_PROJECTION, "7448.619"),
      reading(RECEIPTS_TOTAL, "4485419503881.15"),
      projectionReading(RECEIPTS_PROJECTION, "5595.916"),
      reading(DEFICIT_TOTAL, "-1798816211853.03"),
      projectionReading(DEFICIT_PROJECTION, "-1852.703"),
    );
    expect(cells).toHaveLength(3);

    const [spending, revenue, borrowed] = cells;
    expect(spending!.label).toBe("Spending, FY 2026");
    expect(spending!.observedDisplay).toBe("$6,284.2B so far");
    expect(spending!.observedSourceLine).toBe("Monthly Treasury Statement · through July");
    expect(spending!.projectedLine).toBe("CBO projected $7,448.6B for the full year (Feb 2026 baseline)");

    expect(revenue!.label).toBe("Revenue, FY 2026");
    expect(revenue!.observedDisplay).toBe("$4,485.4B so far");
    expect(revenue!.projectedLine).toBe("CBO projected $5,595.9B for the full year (Feb 2026 baseline)");

    expect(borrowed!.label).toBe("Borrowed to cover the gap, FY 2026");
    expect(borrowed!.observedDisplay).toBe("$1,798.8B borrowed so far");
    expect(borrowed!.projectedLine).toBe("CBO projected $1,852.7B borrowed for the full year (Feb 2026 baseline)");
  });

  it("never claims a surplus period 'borrowed' anything — sign-neutral label and phrasing, like the standalone deficit cell already learned", () => {
    const cells = buildToplineCells(
      reading(OUTLAYS_TOTAL, "4485419503881.15"),
      null,
      reading(RECEIPTS_TOTAL, "6284235715734.18"),
      null,
      reading(DEFICIT_TOTAL, "1798816211853.03"), // receipts exceeded outlays: a surplus, not a deficit
      null,
    );
    const borrowed = cells[2]!;
    expect(borrowed.label).toBe("Surplus, FY 2026 so far");
    expect(borrowed.observedDisplay).toBe("$1,798.8B left over so far");
    expect(borrowed.observedDisplay).not.toMatch(/borrowed/);
  });

  it("a balanced period (outlays == receipts) never claims a borrowed OR a surplus", () => {
    const cells = buildToplineCells(reading(OUTLAYS_TOTAL, "1000"), null, reading(RECEIPTS_TOTAL, "1000"), null, reading(DEFICIT_TOTAL, "0"), null);
    const borrowed = cells[2]!;
    expect(borrowed.label).toBe("Balanced, FY 2026 so far");
    expect(borrowed.observedDisplay).toBe("Nothing borrowed so far");
  });

  it("derives the projected direction independently from the observed direction — an observed deficit against a (hypothetical) projected surplus never gets mislabeled", () => {
    const cells = buildToplineCells(
      reading(OUTLAYS_TOTAL, "6284235715734.18"),
      null,
      reading(RECEIPTS_TOTAL, "4485419503881.15"),
      null,
      reading(DEFICIT_TOTAL, "-1798816211853.03"), // observed: a deficit
      projectionReading(DEFICIT_PROJECTION, "500"), // projected: a (hypothetical) surplus — independent sign
    );
    const borrowed = cells[2]!;
    expect(borrowed.label).toBe("Borrowed to cover the gap, FY 2026"); // observed direction, unaffected by the projection
    expect(borrowed.projectedLine).toBe("CBO projected $500.0B left over for the full year (Feb 2026 baseline)");
  });

  it("renders a graceful gap on the projected line — never a zero, never a fabricated figure — when the projection series has no reading yet", () => {
    const cells = buildToplineCells(reading(OUTLAYS_TOTAL, "6284235715734.18"), null, reading(RECEIPTS_TOTAL, "4485419503881.15"), null, reading(DEFICIT_TOTAL, "-1798816211853.03"), null);
    expect(cells.every((c) => c.projectedLine === null)).toBe(true);
    // The observed side still renders in full — a MISSING projection is not treated as a missing observed figure.
    expect(cells[0]!.observedDisplay).toBe("$6,284.2B so far");
  });

  it("renders a graceful gap on the OBSERVED side too — never a zero — when no MTS report has been ingested for this fiscal year at all", () => {
    const cells = buildToplineCells(null, projectionReading(OUTLAYS_PROJECTION, "7448.619"), null, null, null, null);
    const spending = cells[0]!;
    expect(spending.observedDisplay).toBeNull();
    expect(spending.observedSourceLine).toContain("not yet ingested");
    // A gap cell never renders the projection either — there is no fiscal year to pair it against.
    expect(spending.projectedLine).toBeNull();
  });
});

describe("for-scale facts", () => {
  it("computes a 3-significant-figure per-household spend fact when Census data exists, with both readings' own as-of dates in the source line", () => {
    // census.households.total is registered magnitude "thousands" — 132,200 thousand = 132.2M.
    const householdsReading = reading(HOUSEHOLDS, "132200", { periodType: "year", periodEnd: "2025-12-31", fiscalYear: null });
    const outlaysReading = reading(OUTLAYS_TOTAL, "6284235715734.18");
    const fact = buildPerHouseholdSpendFact(outlaysReading, householdsReading);
    expect(fact).not.toBeNull();
    expect(fact!.valueDisplay).toBe("≈ $47,500");
    // The MTS reading's own fiscal-year/through-month...
    expect(fact!.sourceLine).toContain("FY2026 through July");
    // ...and the Census reading's own vintage year, never presented undated.
    expect(fact!.sourceLine).toContain("2025 estimate");
  });

  it("returns null (a gap) when the Census reading is absent — never a fabricated figure", () => {
    expect(buildPerHouseholdSpendFact(reading(OUTLAYS_TOTAL, "6284235715734.18"), null)).toBeNull();
  });

  it("computes cents-per-tax-dollar without needing Census at all, and names the fiscal year/through-month", () => {
    const fact = buildInterestPerTaxDollarFact(reading(NET_INTEREST, "931356018861.05"), reading(INDIVIDUAL_INCOME_TAX, "2368957104098.08"));
    expect(fact).not.toBeNull();
    expect(fact!.valueDisplay).toBe("39¢ per $1");
    expect(fact!.sourceLine).toContain("FY2026 through July");
  });

  it("computes debt-per-household and debt-per-resident at 3 significant figures, each with the debt reading's own as-of date and the Census reading's own vintage", () => {
    const debt = reading(DEBT_ID, "40077529831942.94", { periodType: "day", periodEnd: "2026-08-27" });
    // census.households.total is registered magnitude "thousands" — 132,200 thousand = 132.2M.
    const householdsReading = reading(HOUSEHOLDS, "132200", { periodType: "year", periodEnd: "2025-12-31", fiscalYear: null });
    const perHousehold = buildDebtPerHouseholdFact(debt, householdsReading);
    expect(perHousehold!.valueDisplay).toBe("≈ $303,000");
    expect(perHousehold!.sourceLine).toContain("Aug 27, 2026");
    expect(perHousehold!.sourceLine).toContain("2025 estimate");

    const populationReading = reading(POPULATION, "342000000", { periodType: "day", periodEnd: "2025-07-01", fiscalYear: null });
    const perResident = buildDebtPerResidentFact(debt, populationReading);
    expect(perResident!.valueDisplay).toBe("≈ $117,000");
    expect(perResident!.sourceLine).toContain("Aug 27, 2026");
    expect(perResident!.sourceLine).toContain("Jul 1, 2025");
  });
});
