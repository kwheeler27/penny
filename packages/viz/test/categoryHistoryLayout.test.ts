import { describe, expect, it } from "vitest";
import { computeCategoryHistoryGeometry, filterHistoryToWindow, HISTORY_WINDOWS, type HistoryLayoutPoint } from "../src/layout/categoryHistoryLayout";
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

  it('drops a year tick that would visually collide with the one before it — regression: a real 10Y time-window starting mid-year (Aug 2016) put "2016" and "2017" (only 5 months later) close enough to merge into one illegible label', () => {
    const periodEnds: string[] = [];
    let y = 2016;
    let m = 8;
    for (let i = 0; i < 120; i++) {
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
    // The series' own first year always ticks...
    expect(years[0]).toBe("2016");
    // ...but "2017" — only 5 months later — is close enough to collide with
    // it that it's dropped rather than rendered overlapping.
    expect(years).not.toContain("2017");
    // Ticking resumes normally once the gap is wide enough again (every
    // later calendar year is a full 12 months apart).
    expect(years).toEqual(expect.arrayContaining(["2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"]));
    // No two consecutive kept ticks ever land within a few pixels of each
    // other, matching the same legibility guarantee visually confirmed via
    // real-browser screenshots at 1440px (CLAUDE.md: curl is not
    // verification for anything visual — this test guards the underlying
    // pixel math the screenshot spot-checked).
    for (let i = 1; i < geometry.yearTicks.length; i++) {
      expect(geometry.yearTicks[i]!.x - geometry.yearTicks[i - 1]!.x).toBeGreaterThanOrEqual(26);
    }
  });
});

describe("filterHistoryToWindow — window math and clipping (never recomputing)", () => {
  // 46 months (Oct 2022 - Jul 2026) with a real, exactly-computed trailing
  // 12-month total (35 entries, i.e. months 12..46) — mirrors the "12-month
  // window math" describe block above, so this section's fixture is known
  // correct before any windowing happens.
  const points = monthly(FULL_MONTHS, FULL_MONTHS.map((_, i) => String(1000 + i)));
  const fullTotal: HistoryLayoutPoint[] = [];
  for (let i = 11; i < points.length; i++) {
    fullTotal.push({ periodEnd: points[i]!.periodEnd, valueWhole: sumDecimal(points.slice(i - 11, i + 1).map((p) => p.valueWhole)) });
  }

  it("HISTORY_WINDOWS lists exactly [1Y, 5Y, 10Y, All] in that order — the buttons' own labels, kept in sync with the filtering keys", () => {
    expect(HISTORY_WINDOWS.map((w) => w.key)).toEqual(["1y", "5y", "10y", "all"]);
    expect(HISTORY_WINDOWS.map((w) => w.label)).toEqual(["1Y", "5Y", "10Y", "All"]);
  });

  it('"all" returns both series completely unfiltered — the default, current behavior', () => {
    const windowed = filterHistoryToWindow(points, fullTotal, "all");
    expect(windowed.monthly).toEqual(points);
    expect(windowed.total).toEqual(fullTotal);
  });

  it('"1y" keeps exactly the trailing 12 months, anchored on the series’ own last point', () => {
    const windowed = filterHistoryToWindow(points, fullTotal, "1y");
    expect(windowed.monthly).toHaveLength(12);
    expect(windowed.monthly[0]!.periodEnd).toBe(points[points.length - 12]!.periodEnd);
    expect(windowed.monthly[windowed.monthly.length - 1]!.periodEnd).toBe(points[points.length - 1]!.periodEnd);
  });

  it(
    "clips the trailing-12-month total from the FULL-series computation rather than recomputing it on the truncated window — the clipped values equal the full-series computation exactly, digit for digit (CLAUDE.md: never fabricate)",
    () => {
      const windowed = filterHistoryToWindow(points, fullTotal, "1y");
      // A recompute on only the truncated 12-month window could produce at
      // most ONE valid trailing-12-month sum (the window's own last month —
      // the only one with 11 real preceding months inside the truncated
      // set); every earlier month in the window would be missing its
      // preceding context. The correct behavior — a clip of the full-series
      // computation — instead has all 12 entries, and they must be
      // BIT-FOR-BIT the same values the full, untruncated computation
      // produced (fullTotal's own last 12 entries).
      expect(windowed.total).toHaveLength(12);
      expect(windowed.total).toEqual(fullTotal.slice(-12));
    },
  );

  it('"5y" and "10y" both return everything on a 46-month (< 4-year) series — the window never trims more than the data actually spans', () => {
    const fiveYear = filterHistoryToWindow(points, fullTotal, "5y");
    const tenYear = filterHistoryToWindow(points, fullTotal, "10y");
    expect(fiveYear.monthly).toEqual(points);
    expect(fiveYear.total).toEqual(fullTotal);
    expect(tenYear.monthly).toEqual(points);
    expect(tenYear.total).toEqual(fullTotal);
  });

  it("returns empty for both series when the monthly input is empty, regardless of window", () => {
    const windowed = filterHistoryToWindow([], [], "1y");
    expect(windowed.monthly).toHaveLength(0);
    expect(windowed.total).toHaveLength(0);
  });

  it("clips the total to empty when the window predates any 12-month total (fewer than 12 months in the window)", () => {
    // A 6-month-old total series (no 12-month window has ever completed) —
    // clipping to "1y" must not fabricate total entries that were never
    // computed.
    const shortPoints = points.slice(0, 6);
    const windowed = filterHistoryToWindow(shortPoints, [], "1y");
    expect(windowed.monthly).toHaveLength(6);
    expect(windowed.total).toHaveLength(0);
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
