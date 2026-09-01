import { describe, expect, it } from "vitest";
import { computeCategoryHistoryGeometry, type HistoryLayoutPoint } from "../src/layout/categoryHistoryLayout";
import { addDecimal, sumDecimal } from "../src/money/decimal";

const OPTS = { width: 560, height: 130, padLeft: 8, padRight: 8, padTop: 18, padBottom: 20 };

function monthly(periodEnds: string[], values: string[]): HistoryLayoutPoint[] {
  return periodEnds.map((periodEnd, i) => ({ periodEnd, valueWhole: values[i]! }));
}

// A plain day-in-month lookup (leap years by the standard Gregorian rule) —
// never `Date`, matching the repo-wide convention that a calendar date is
// pure string/integer arithmetic, never round-tripped through `Date`.
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}
function lastDayOfMonth(y: number, m: number): number {
  return m === 2 && isLeapYear(y) ? 29 : DAYS_IN_MONTH[m - 1]!;
}

/** 46 consecutive months, Oct 2022 through Jul 2026, values just an ascending count string — exercises the same span the front door's real deficit/outlays.total series already carries. */
const FULL_MONTHS = (() => {
  const periodEnds: string[] = [];
  let y = 2022;
  let m = 10;
  for (let i = 0; i < 46; i++) {
    periodEnds.push(`${y}-${String(m).padStart(2, "0")}-${String(lastDayOfMonth(y, m)).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return periodEnds;
})();

describe("computeCategoryHistoryGeometry — bounds", () => {
  it("keeps every monthly and total point within the declared canvas extent", () => {
    const points = monthly(FULL_MONTHS, FULL_MONTHS.map((_, i) => String(1000 + i * 37)));
    const totalPoints = points.slice(11).map((p, i) => ({ periodEnd: p.periodEnd, valueWhole: sumDecimal(points.slice(i, i + 12).map((x) => x.valueWhole)) }));
    const geometry = computeCategoryHistoryGeometry(points, totalPoints, OPTS);
    for (const p of [...geometry.monthlyPoints, ...geometry.totalPoints]) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(OPTS.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(OPTS.height);
    }
  });

  it("handles a single monthly point without dividing by zero", () => {
    const geometry = computeCategoryHistoryGeometry([{ periodEnd: "2026-07-31", valueWhole: "500" }], [], OPTS);
    expect(geometry.monthlyPoints).toHaveLength(1);
    expect(Number.isFinite(geometry.monthlyPoints[0]!.x)).toBe(true);
    expect(Number.isFinite(geometry.monthlyPoints[0]!.y)).toBe(true);
  });

  it("returns empty geometry, never NaN paths, for an empty input", () => {
    const geometry = computeCategoryHistoryGeometry([], [], OPTS);
    expect(geometry.monthlyPath).toBe("");
    expect(geometry.totalPath).toBe("");
    expect(geometry.monthlyPoints).toHaveLength(0);
  });
});

describe("computeCategoryHistoryGeometry — monotonic x", () => {
  it("places consecutive ascending months at strictly increasing x", () => {
    const points = monthly(FULL_MONTHS, FULL_MONTHS.map(() => "100"));
    const geometry = computeCategoryHistoryGeometry(points, [], OPTS);
    for (let i = 1; i < geometry.monthlyPoints.length; i++) {
      expect(geometry.monthlyPoints[i]!.x).toBeGreaterThan(geometry.monthlyPoints[i - 1]!.x);
    }
  });

  it("widens the gap visually when months are missing (proportional to elapsed time, not array index)", () => {
    // Three points: Jan, Feb, then a jump to December of the SAME year —
    // the Feb->Dec gap (10 months) must be much wider than Jan->Feb (1 month).
    const points = monthly(["2026-01-31", "2026-02-28", "2026-12-31"], ["10", "20", "30"]);
    const geometry = computeCategoryHistoryGeometry(points, [], OPTS);
    const [p0, p1, p2] = geometry.monthlyPoints;
    const shortGap = p1!.x - p0!.x;
    const longGap = p2!.x - p1!.x;
    expect(longGap).toBeGreaterThan(shortGap * 5);
  });
});

describe("computeCategoryHistoryGeometry — 12-month window math (gating is the caller's job)", () => {
  it("draws no total line at all when the caller passes an empty total array (fewer than 12 months ingested)", () => {
    const points = monthly(FULL_MONTHS.slice(0, 6), FULL_MONTHS.slice(0, 6).map(() => "100"));
    const geometry = computeCategoryHistoryGeometry(points, [], OPTS);
    expect(geometry.totalPath).toBe("");
    expect(geometry.totalPoints).toHaveLength(0);
  });

  it("the total line's points come from exactly the total array supplied — 46 months in, 35 rolling totals out (46 - 12 + 1)", () => {
    const points = monthly(FULL_MONTHS, FULL_MONTHS.map((_, i) => String(1000 + i)));
    const totalPoints: HistoryLayoutPoint[] = [];
    for (let i = 11; i < points.length; i++) {
      totalPoints.push({ periodEnd: points[i]!.periodEnd, valueWhole: sumDecimal(points.slice(i - 11, i + 1).map((p) => p.valueWhole)) });
    }
    expect(totalPoints).toHaveLength(35);
    const geometry = computeCategoryHistoryGeometry(points, totalPoints, OPTS);
    expect(geometry.totalPoints).toHaveLength(35);
    // The total line's last point must align (same x) with the monthly line's last point — both end at the same period.
    expect(geometry.totalPoints[geometry.totalPoints.length - 1]!.x).toBeCloseTo(geometry.monthlyPoints[geometry.monthlyPoints.length - 1]!.x, 5);
  });
});

describe("computeCategoryHistoryGeometry — year ticks", () => {
  it("emits one tick per calendar year crossed, starting with the series' own first year", () => {
    const points = monthly(FULL_MONTHS, FULL_MONTHS.map(() => "100"));
    const geometry = computeCategoryHistoryGeometry(points, [], OPTS);
    const years = geometry.yearTicks.map((t) => t.label);
    expect(years[0]).toBe("2022");
    expect(years[years.length - 1]).toBe("2026");
    expect(new Set(years).size).toBeGreaterThanOrEqual(4); // 2022..2026 span
  });

  it("never emits the same year twice, even when the series ends partway through its final year (regression: a real 137-month Medicare history, Mar 2015-Jul 2026, produced two adjacent overlapping \"2026\" labels before this was fixed)", () => {
    // Starts mid-year (March) like the real fixture that exposed the bug —
    // the series' final year (2026) already gets ticked in January, long
    // before the series' actual last point in July of that same year.
    const periodEnds: string[] = [];
    let y = 2015;
    let m = 3;
    for (let i = 0; i < 137; i++) {
      periodEnds.push(`${y}-${String(m).padStart(2, "0")}-${String(lastDayOfMonth(y, m)).padStart(2, "0")}`);
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    const points = monthly(periodEnds, periodEnds.map(() => "100"));
    const geometry = computeCategoryHistoryGeometry(points, [], OPTS);
    const years = geometry.yearTicks.map((t) => t.label);
    expect(years).toEqual([...new Set(years)]); // no duplicates anywhere, not just adjacent
    expect(years[years.length - 1]).toBe("2026");
  });
});

// Sanity: addDecimal is exercised transitively via sumDecimal above; this
// just confirms the money-math import used to build fixtures behaves as
// documented (belt and suspenders for this test file's own fixture builder).
describe("fixture sanity", () => {
  it("addDecimal/sumDecimal are exact", () => {
    expect(addDecimal("1.10", "2.05")).toBe("3.15");
    expect(sumDecimal(["1", "2", "3"])).toBe("6");
  });
});
