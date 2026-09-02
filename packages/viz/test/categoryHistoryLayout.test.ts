import { describe, expect, it } from "vitest";
import {
  computeCategoryHistoryGeometry,
  filterHistoryToWindow,
  findNearestHistoryPoint,
  placeEndLabels,
  computeMonotoneSegments,
  monotonePath,
  HISTORY_WINDOWS,
  type HistoryLayoutPoint,
  type PositionedHistoryPoint,
} from "../src/layout/categoryHistoryLayout";
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

describe("computeCategoryHistoryGeometry — y-axis value ticks", () => {
  it("emits exactly 3 value ticks at the data-fit domain's high/mid/low, with $-formatted, billions-scale labels — realistic MTS-category magnitudes ($100B-$150B/month)", () => {
    // Six months, $100B..$150B (whole-dollar decimal strings, matching
    // lib/front-door-transform.ts's own convention of scaling to actual
    // dollars before this module ever sees a value).
    const periodEnds = ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30"];
    const values = ["100000000000", "110000000000", "120000000000", "130000000000", "140000000000", "150000000000"];
    const points = monthly(periodEnds, values);
    const geometry = computeCategoryHistoryGeometry(points, [], OPTS);
    expect(geometry.valueTicks).toHaveLength(3);
    // Domain: lo = min(0, ...values) = 0 (all-positive series), hi = 150B.
    expect(geometry.valueTicks[0]!.label).toBe("$150.0B");
    expect(geometry.valueTicks[1]!.label).toBe("$75.0B");
    expect(geometry.valueTicks[2]!.label).toBe("$0");
    // Strictly ordered top-to-bottom on screen (hi at the smallest y).
    expect(geometry.valueTicks[0]!.y).toBeLessThan(geometry.valueTicks[1]!.y);
    expect(geometry.valueTicks[1]!.y).toBeLessThan(geometry.valueTicks[2]!.y);
  });

  it("deduplicates to a single tick — never three overlapping identical labels — when the whole domain is flat (e.g. every value is exactly 0)", () => {
    const points = monthly(["2026-01-31", "2026-02-28", "2026-03-31"], ["0", "0", "0"]);
    const geometry = computeCategoryHistoryGeometry(points, [], OPTS);
    expect(geometry.valueTicks).toHaveLength(1);
    expect(geometry.valueTicks[0]!.label).toBe("$0");
  });

  it("never uses a 'nice round number' scale — the domain stays exactly data-fit, matching the plotted points' own min/max", () => {
    const points = monthly(["2026-01-31", "2026-02-28"], ["123456789000", "987654321000"]);
    const geometry = computeCategoryHistoryGeometry(points, [], OPTS);
    // hi = 987.654321B (rounds to 987.7B at 1 decimal) — not rounded to a
    // "nice" $1,000B/$1T scale point.
    expect(geometry.valueTicks[0]!.value).toBeCloseTo(987654321000, 0);
    expect(geometry.valueTicks[0]!.label).toBe("$987.7B");
  });
});

describe("computeMonotoneSegments / monotonePath — monotone-x cubic interpolation, no overshoot", () => {
  const ZIGZAG: PositionedHistoryPoint[] = [
    { periodEnd: "2026-01-31", x: 0, y: 100 },
    { periodEnd: "2026-02-28", x: 10, y: 20 }, // sharp local min
    { periodEnd: "2026-03-31", x: 20, y: 90 },
    { periodEnd: "2026-04-30", x: 30, y: 95 }, // sharp local max
    { periodEnd: "2026-05-31", x: 40, y: 10 },
    { periodEnd: "2026-06-30", x: 50, y: 15 },
  ];

  it("passes through every input point exactly — an interpolating spline, never a fitted/smoothed curve that would distort a value", () => {
    const segments = computeMonotoneSegments(ZIGZAG);
    expect(segments).toHaveLength(ZIGZAG.length - 1);
    for (let i = 0; i < segments.length; i++) {
      expect(segments[i]!.end.x).toBeCloseTo(ZIGZAG[i + 1]!.x, 9);
      expect(segments[i]!.end.y).toBeCloseTo(ZIGZAG[i + 1]!.y, 9);
    }
    // The path string's own M/C endpoints agree (same guarantee, via the
    // string the component actually renders).
    const path = monotonePath(ZIGZAG);
    expect(path.startsWith(`M${ZIGZAG[0]!.x.toFixed(1)},${ZIGZAG[0]!.y.toFixed(1)}`)).toBe(true);
    expect(path).toContain(`${ZIGZAG[ZIGZAG.length - 1]!.x.toFixed(1)},${ZIGZAG[ZIGZAG.length - 1]!.y.toFixed(1)}`);
  });

  it("keeps every segment's two Bezier control points within [min(y0,y1), max(y0,y1)] — never overshooting beyond that segment's own data range, even at a sharp local max/min (the exact failure mode a plain Catmull-Rom spline has)", () => {
    const segments = computeMonotoneSegments(ZIGZAG);
    for (let i = 0; i < segments.length; i++) {
      const p0 = ZIGZAG[i]!;
      const p1 = ZIGZAG[i + 1]!;
      const lo = Math.min(p0.y, p1.y);
      const hi = Math.max(p0.y, p1.y);
      const EPS = 1e-6;
      expect(segments[i]!.cp1.y).toBeGreaterThanOrEqual(lo - EPS);
      expect(segments[i]!.cp1.y).toBeLessThanOrEqual(hi + EPS);
      expect(segments[i]!.cp2.y).toBeGreaterThanOrEqual(lo - EPS);
      expect(segments[i]!.cp2.y).toBeLessThanOrEqual(hi + EPS);
    }
  });

  it("keeps a flat run dead flat — no bump — when interior points share the same value", () => {
    const flat: PositionedHistoryPoint[] = [
      { periodEnd: "2026-01-31", x: 0, y: 50 },
      { periodEnd: "2026-02-28", x: 10, y: 100 },
      { periodEnd: "2026-03-31", x: 20, y: 100 },
      { periodEnd: "2026-04-30", x: 30, y: 100 },
      { periodEnd: "2026-05-31", x: 40, y: 40 },
    ];
    const segments = computeMonotoneSegments(flat);
    // The middle segment (index 1: point 1 -> point 2, both y=100) must be
    // perfectly flat — both control points exactly at y=100, no bump above
    // or below the flat run.
    expect(segments[1]!.cp1.y).toBeCloseTo(100, 9);
    expect(segments[1]!.cp2.y).toBeCloseTo(100, 9);
  });

  it("produces a straight line's worth of control points for exactly 2 points (no clamping needed — a=b=1 trivially)", () => {
    const two: PositionedHistoryPoint[] = [
      { periodEnd: "2026-01-31", x: 0, y: 0 },
      { periodEnd: "2026-02-28", x: 30, y: 90 },
    ];
    const segments = computeMonotoneSegments(two);
    expect(segments).toHaveLength(1);
    // For a straight 2-point interval, the Bezier control points sit exactly
    // 1/3 and 2/3 of the way along the segment — collinear with the line.
    expect(segments[0]!.cp1.x).toBeCloseTo(10, 5);
    expect(segments[0]!.cp1.y).toBeCloseTo(30, 5);
    expect(segments[0]!.cp2.x).toBeCloseTo(20, 5);
    expect(segments[0]!.cp2.y).toBeCloseTo(60, 5);
  });

  it("returns no segments, and a bare M with no curve, for 0 or 1 points", () => {
    expect(computeMonotoneSegments([])).toHaveLength(0);
    expect(computeMonotoneSegments([{ x: 5, y: 5 }])).toHaveLength(0);
    expect(monotonePath([])).toBe("");
    expect(monotonePath([{ x: 5, y: 5 }])).toBe("M5.0,5.0");
  });
});

describe("findNearestHistoryPoint — pure pixel hit-testing for the hover/focus tooltip", () => {
  const monthlyPoints: PositionedHistoryPoint[] = [
    { periodEnd: "2026-01-31", x: 0, y: 100 },
    { periodEnd: "2026-02-28", x: 20, y: 80 },
    { periodEnd: "2026-03-31", x: 40, y: 60 },
  ];
  // A 12-month total exists only at the LAST month, matching production
  // shape (the total series is always a suffix of the monthly one).
  const totalPoints: PositionedHistoryPoint[] = [{ periodEnd: "2026-03-31", x: 40, y: 10 }];

  it("finds the nearest month by x when there is no 12-month total at that month at all", () => {
    const hit = findNearestHistoryPoint(monthlyPoints, [], 19, 999);
    expect(hit).toEqual({ series: "monthly", index: 1 });
  });

  it("picks the TOTAL line when its y at the nearest month is closer to the pointer than the monthly line's own y", () => {
    // x=41 -> nearest month is index 2 (x=40). Pointer y=15 is close to the
    // total point's y=10, far from the monthly point's y=60.
    const hit = findNearestHistoryPoint(monthlyPoints, totalPoints, 41, 15);
    expect(hit).toEqual({ series: "total", index: 0 });
  });

  it("picks the MONTHLY line when its y at the nearest month is closer to the pointer than the total line's own y", () => {
    const hit = findNearestHistoryPoint(monthlyPoints, totalPoints, 41, 58);
    expect(hit).toEqual({ series: "monthly", index: 2 });
  });

  it("breaks an exact y-distance tie in favor of the total line", () => {
    // Monthly y=60, total y=10 at x=40 -> midpoint y=35 is equidistant from both.
    const hit = findNearestHistoryPoint(monthlyPoints, totalPoints, 40, 35);
    expect(hit).toEqual({ series: "total", index: 0 });
  });

  it("returns null when there are no monthly points to hit-test at all", () => {
    expect(findNearestHistoryPoint([], [], 0, 0)).toBeNull();
  });
});

describe("placeEndLabels — collision guard for the two right-edge line labels", () => {
  it("leaves both labels unchanged when they're already far enough apart", () => {
    expect(placeEndLabels(20, 60)).toEqual({ totalY: 20, monthlyY: 60 });
  });

  it("pushes them apart symmetrically, preserving order (total stays above monthly), when they'd collide", () => {
    const placed = placeEndLabels(50, 55);
    expect(placed.totalY).toBeLessThan(placed.monthlyY);
    expect(placed.monthlyY! - placed.totalY!).toBeCloseTo(12, 5);
    // Symmetric around the original midpoint (52.5).
    expect((placed.totalY! + placed.monthlyY!) / 2).toBeCloseTo(52.5, 5);
  });

  it("pushes them apart symmetrically, preserving REVERSED order, when the monthly line's last point happens to sit above the total line's", () => {
    const placed = placeEndLabels(55, 50);
    expect(placed.totalY).toBeGreaterThan(placed.monthlyY);
    expect(placed.totalY! - placed.monthlyY!).toBeCloseTo(12, 5);
  });

  it("breaks an exact tie (both lines ending at the same y) by placing the total label above", () => {
    const placed = placeEndLabels(40, 40);
    expect(placed.totalY).toBeLessThan(placed.monthlyY);
    expect(placed.monthlyY! - placed.totalY!).toBeCloseTo(12, 5);
  });

  it("passes monthlyY through unchanged and totalY through as null when there is no 12-month total line at all", () => {
    expect(placeEndLabels(null, 42)).toEqual({ totalY: null, monthlyY: 42 });
  });

  it("respects a custom minGap", () => {
    const placed = placeEndLabels(50, 54, 20);
    expect(placed.monthlyY! - placed.totalY!).toBeCloseTo(20, 5);
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
