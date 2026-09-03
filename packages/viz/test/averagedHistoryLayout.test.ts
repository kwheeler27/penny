import { describe, expect, it } from "vitest";
import { rollingAverage, clipToWindow, nudgeHoverLabelAwayFromAverage, type HistoryChartPoint } from "../src/layout/averagedHistoryLayout";
import { divideDecimalByInt } from "../src/money/decimal";
import { formatUsd } from "../src/money/format";

// A plain day-in-month lookup (leap years by the standard Gregorian rule) —
// never `Date`, matching categoryHistoryLayout.test.ts's own fixture
// builder convention.
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}
function lastDayOfMonth(y: number, m: number): number {
  return m === 2 && isLeapYear(y) ? 29 : DAYS_IN_MONTH[m - 1]!;
}

function monthSeries(startYear: number, startMonth: number, count: number, valueOf: (i: number) => string): HistoryChartPoint[] {
  const out: HistoryChartPoint[] = [];
  let y = startYear;
  let m = startMonth;
  for (let i = 0; i < count; i++) {
    const periodEnd = `${y}-${String(m).padStart(2, "0")}-${String(lastDayOfMonth(y, m)).padStart(2, "0")}`;
    const valueWhole = valueOf(i);
    out.push({ periodEnd, valueWhole, display: formatUsd(valueWhole, { compact: false }), label: `${y}-${m}` });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

describe("divideDecimalByInt — exact-as-representable BigInt long division", () => {
  it("divides evenly with no remainder exactly", () => {
    expect(divideDecimalByInt("120", 12)).toBe("10.000000");
    expect(divideDecimalByInt("100", 4)).toBe("25.000000");
  });

  it("rounds a repeating decimal half-up at the extra-scale boundary, never via Number()/parseFloat", () => {
    // 100/3 = 33.333333... repeating forever — must round at exactly the
    // requested extra precision, never approximate via float division.
    expect(divideDecimalByInt("100", 3, 4)).toBe("33.3333");
    expect(divideDecimalByInt("100", 3, 2)).toBe("33.33");
  });

  it("preserves the sign of a negative dividend", () => {
    expect(divideDecimalByInt("-100", 4)).toBe("-25.000000");
  });

  it("never returns a negative zero", () => {
    expect(divideDecimalByInt("0", 5)).toBe("0.000000");
  });

  it("respects the input's own existing decimal scale (extraScale is IN ADDITION to it)", () => {
    expect(divideDecimalByInt("10.50", 2, 2)).toBe("5.2500"); // scale 2 + extraScale 2 = 4 digits
  });

  it("rejects a non-positive or non-integer count", () => {
    expect(() => divideDecimalByInt("100", 0)).toThrow();
    expect(() => divideDecimalByInt("100", -3)).toThrow();
    expect(() => divideDecimalByInt("100", 2.5)).toThrow();
  });

  it("a real-scale example: summing 12 MTS-scale monthly outlay figures and dividing back out reproduces a sane whole-dollar average", () => {
    // 12 months averaging ~$94.0B each (Medicare-scale, real MTS figures
    // rounded for this fixture) — the exact sum divided by 12 should
    // round, at the whole-dollar display boundary, back to something in
    // that neighborhood, never wildly off through a float error.
    const monthly = ["94000000000", "95000000000", "93500000000", "94200000000", "93800000000", "94600000000", "93900000000", "94300000000", "94100000000", "93700000000", "94400000000", "94500000000"];
    const sum = monthly.reduce((acc, v) => (BigInt(acc) + BigInt(v)).toString(), "0");
    const avg = divideDecimalByInt(sum, 12);
    expect(Number(avg)).toBeGreaterThan(93_000_000_000);
    expect(Number(avg)).toBeLessThan(95_000_000_000);
  });
});

describe("rollingAverage — window math, exactness, and full-then-clip semantics", () => {
  it("throws for a non-positive or non-integer window", () => {
    const points = monthSeries(2024, 1, 3, () => "100");
    expect(() => rollingAverage(points, 0)).toThrow();
    expect(() => rollingAverage(points, -1)).toThrow();
    expect(() => rollingAverage(points, 1.5)).toThrow();
  });

  it("returns nothing until at least `windowMonths` points exist", () => {
    const points = monthSeries(2024, 1, 5, () => "1200");
    expect(rollingAverage(points, 12)).toHaveLength(0);
  });

  it("the FIRST output point lands at index windowMonths-1, using the WINDOW'S LAST month's periodEnd/label", () => {
    const points = monthSeries(2024, 1, 13, (i) => String(1000 + i)); // Jan 2024 .. Jan 2025
    const avg = rollingAverage(points, 12);
    expect(avg).toHaveLength(2); // 13 - 12 + 1
    expect(avg[0]!.periodEnd).toBe(points[11]!.periodEnd); // Dec 2024 — the 12th month
    expect(avg[0]!.label).toBe(points[11]!.label);
    expect(avg[1]!.periodEnd).toBe(points[12]!.periodEnd); // Jan 2025
  });

  it("computes an EXACT sum/N average — verified against sumDecimal/divideDecimalByInt directly, never a float approximation", () => {
    const values = ["100000000000.10", "200000000000.20", "150000000000.30"];
    const points = monthSeries(2024, 1, 3, (i) => values[i]!);
    const avg = rollingAverage(points, 3);
    expect(avg).toHaveLength(1);
    const expectedSum = "450000000000.60";
    const expectedAvg = divideDecimalByInt(expectedSum, 3);
    expect(avg[0]!.valueWhole).toBe(expectedAvg);
  });

  it("a 46-month series produces exactly 35 12-month averages (46 - 12 + 1), matching categoryHistoryLayout's own 12-month-total window math", () => {
    const points = monthSeries(2022, 10, 46, (i) => String(1000 + i));
    const avg = rollingAverage(points, 12);
    expect(avg).toHaveLength(35);
    expect(avg[avg.length - 1]!.periodEnd).toBe(points[points.length - 1]!.periodEnd);
  });

  it('a "1-month average" is just the identity — every point averages with itself', () => {
    const points = monthSeries(2024, 1, 4, (i) => String(500 + i * 10));
    const avg = rollingAverage(points, 1);
    expect(avg).toHaveLength(4);
    for (let i = 0; i < points.length; i++) {
      expect(Number(avg[i]!.valueWhole)).toBeCloseTo(Number(points[i]!.valueWhole), 5);
    }
  });

  it("skips (never fabricates) every window that spans a gap in the backfill", () => {
    // Jan..Apr 2024 (4 months), then a gap, then Sep..Dec 2024 (4 months) —
    // 8 points total. windowMonths=6 means EVERY possible trailing window
    // (there are only 3: starting at index 0, 1, 2) necessarily straddles
    // the gap, since neither side alone has 6 real consecutive months —
    // so none survives.
    const first = monthSeries(2024, 1, 4, (i) => String(100 + i));
    const second = monthSeries(2024, 9, 4, (i) => String(200 + i));
    const points = [...first, ...second];
    const avg = rollingAverage(points, 6);
    expect(avg).toHaveLength(0);
  });

  it("a window entirely on one side of a gap still produces a valid average — only windows crossing the gap are skipped", () => {
    const first = monthSeries(2024, 1, 6, (i) => String(100 + i)); // Jan..Jun, 6 consecutive months
    const second = monthSeries(2024, 9, 6, (i) => String(200 + i)); // Sep..Feb next year, 6 consecutive months
    const points = [...first, ...second];
    const avg = rollingAverage(points, 6);
    // Exactly one valid window on each side of the gap (the first 6
    // months, and the last 6 months) — none spanning it.
    expect(avg).toHaveLength(2);
    expect(avg[0]!.periodEnd).toBe(first[5]!.periodEnd);
    expect(avg[1]!.periodEnd).toBe(second[5]!.periodEnd);
  });

  it("display/scaledDisplay come from this package's own single shared formatter (formatUsd), never a bespoke formatter", () => {
    const points = monthSeries(2024, 1, 12, () => "94000000000"); // flat $94.0B/mo
    const avg = rollingAverage(points, 12);
    expect(avg).toHaveLength(1);
    expect(avg[0]!.display).toBe(formatUsd(avg[0]!.valueWhole, { compact: false }));
    expect(avg[0]!.scaledDisplay).toBe(formatUsd(avg[0]!.valueWhole, { compact: true }));
    expect(avg[0]!.scaledDisplay).toBe("$94.0B");
  });
});

describe("clipToWindow — delegates to filterHistoryToWindow's own anchor/cutoff math", () => {
  it('"all" returns the input completely unfiltered', () => {
    const points = monthSeries(2020, 1, 24, (i) => String(i));
    expect(clipToWindow(points, "all")).toEqual(points);
  });

  it('"1y" keeps exactly the trailing 12 entries, anchored on the array\'s OWN last point', () => {
    const points = monthSeries(2020, 1, 24, (i) => String(i));
    const clipped = clipToWindow(points, "1y");
    expect(clipped).toHaveLength(12);
    expect(clipped[0]!.periodEnd).toBe(points[12]!.periodEnd);
    expect(clipped[clipped.length - 1]!.periodEnd).toBe(points[23]!.periodEnd);
  });

  it("called once on `monthly` and once on a full rollingAverage() result, both windows anchor on the SAME month whenever the average has no trailing gap", () => {
    const monthly = monthSeries(2020, 1, 30, (i) => String(1000 + i));
    const average = rollingAverage(monthly, 12);
    const clippedMonthly = clipToWindow(monthly, "1y");
    const clippedAverage = clipToWindow(average, "1y");
    expect(clippedMonthly[clippedMonthly.length - 1]!.periodEnd).toBe(clippedAverage[clippedAverage.length - 1]!.periodEnd);
  });

  it("clips the FULL-series average rather than recomputing on a truncated window — clipped values are bit-for-bit identical to the full computation's own tail", () => {
    const monthly = monthSeries(2020, 1, 30, (i) => String(1000 + i * 7));
    const fullAverage = rollingAverage(monthly, 12);
    const clippedAverage = clipToWindow(fullAverage, "1y");
    expect(clippedAverage).toEqual(fullAverage.slice(-12));
  });

  it("returns an empty array, never throwing, for an empty input", () => {
    expect(clipToWindow([], "1y")).toHaveLength(0);
  });
});

describe("nudgeHoverLabelAwayFromAverage — Frame A's two-label hover collision guard", () => {
  it("leaves the monthly label untouched when there is no average value to collide with (avgY null — a gap the rolling average skipped)", () => {
    expect(nudgeHoverLabelAwayFromAverage(100, null)).toBe(100);
  });

  it("leaves the monthly label untouched when it's already far enough from the average label", () => {
    expect(nudgeHoverLabelAwayFromAverage(100, 50)).toBe(100);
  });

  it("nudges the monthly label down (below its own dot) when the two would collide", () => {
    expect(nudgeHoverLabelAwayFromAverage(100, 105, 22, 20)).toBe(120);
  });

  it("respects custom minGap/nudge amounts", () => {
    expect(nudgeHoverLabelAwayFromAverage(100, 100, 5, 30)).toBe(130);
    expect(nudgeHoverLabelAwayFromAverage(100, 110, 5, 30)).toBe(100); // 10px apart already clears a 5px minGap
  });
});
