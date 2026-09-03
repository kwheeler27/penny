import { describe, expect, it } from "vitest";
import { computeDualHistoryGeometry, findNearestDualPoint, type DualHistoryLayoutPoint } from "../src/layout/dualCadenceHistoryLayout";

const OPTS = { width: 640, height: 200, padLeft: 50, padRight: 90, padTop: 20, padBottom: 24 };

function point(date: string, value: number): DualHistoryLayoutPoint {
  return { date, valueWhole: String(value) };
}

// TGA-shaped: dense, most business days across ~2 months.
const DAILY = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05", "2026-06-08", "2026-06-09", "2026-07-01", "2026-07-02", "2026-07-31"].map((d, i) =>
  point(d, 850_000_000_000 + i * 3_000_000_000),
);

// Reserves-shaped: sparse, one point roughly every 7 days, much larger magnitude.
const WEEKLY = ["2026-06-03", "2026-06-10", "2026-06-17", "2026-06-24", "2026-07-01", "2026-07-08", "2026-07-29"].map((d, i) => point(d, 2_900_000_000_000 + i * 5_000_000_000));

describe("computeDualHistoryGeometry — bounds", () => {
  it("keeps every point on both lines within the declared canvas extent", () => {
    const g = computeDualHistoryGeometry(DAILY, WEEKLY, OPTS);
    for (const p of [...g.aPoints, ...g.bPoints]) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(OPTS.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(OPTS.height);
    }
  });

  it("returns the empty geometry (never NaN paths) when both series are empty", () => {
    const g = computeDualHistoryGeometry([], [], OPTS);
    expect(g.aPath).toBe("");
    expect(g.bPath).toBe("");
    expect(g.aPoints).toHaveLength(0);
    expect(g.bPoints).toHaveLength(0);
    expect(g.valueTicks).toHaveLength(0);
    expect(g.dateTicks).toHaveLength(0);
  });

  it("lays out line A normally when line B is entirely empty (the not-yet-registered-series gap state)", () => {
    const g = computeDualHistoryGeometry(DAILY, [], OPTS);
    expect(g.aPoints).toHaveLength(DAILY.length);
    expect(g.bPoints).toHaveLength(0);
    expect(g.bPath).toBe("");
    expect(g.aPath.startsWith("M")).toBe(true);
    for (const p of g.aPoints) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it("handles a single point on each line without dividing by zero", () => {
    const g = computeDualHistoryGeometry([point("2026-06-01", 900_000_000_000)], [point("2026-06-01", 3_000_000_000_000)], OPTS);
    expect(g.aPoints).toHaveLength(1);
    expect(g.bPoints).toHaveLength(1);
    expect(Number.isFinite(g.aPoints[0]!.x)).toBe(true);
    expect(Number.isFinite(g.bPoints[0]!.y)).toBe(true);
  });
});

describe("computeDualHistoryGeometry — real calendar-day spacing, shared across both lines", () => {
  it("places each line's own points at non-decreasing x", () => {
    const g = computeDualHistoryGeometry(DAILY, WEEKLY, OPTS);
    for (let i = 1; i < g.aPoints.length; i++) expect(g.aPoints[i]!.x).toBeGreaterThanOrEqual(g.aPoints[i - 1]!.x);
    for (let i = 1; i < g.bPoints.length; i++) expect(g.bPoints[i]!.x).toBeGreaterThanOrEqual(g.bPoints[i - 1]!.x);
  });

  it("widens the gap proportionally to real elapsed days, not array index — June 9 -> July 1 (a 22-day jump) is much wider than June 1 -> June 2 (1 day)", () => {
    const g = computeDualHistoryGeometry(DAILY, [], OPTS);
    const shortGap = g.aPoints[1]!.x - g.aPoints[0]!.x; // Jun 1 -> Jun 2
    const idxJun9 = DAILY.findIndex((p) => p.date === "2026-06-09");
    const idxJul1 = DAILY.findIndex((p) => p.date === "2026-07-01");
    const longGap = g.aPoints[idxJul1]!.x - g.aPoints[idxJun9]!.x;
    expect(longGap).toBeGreaterThan(shortGap * 10);
  });

  it("positions the two lines on ONE shared x scale — a shared date lands both lines at (nearly) the same x", () => {
    const g = computeDualHistoryGeometry(DAILY, WEEKLY, OPTS);
    const aJun3 = g.aPoints[DAILY.findIndex((p) => p.date === "2026-06-03")]!;
    const bJun3 = g.bPoints[WEEKLY.findIndex((p) => p.date === "2026-06-03")]!;
    expect(aJun3.x).toBeCloseTo(bJun3.x, 5);
  });
});

describe("computeDualHistoryGeometry — shared value domain (one $ axis)", () => {
  it("value ticks span the COMBINED high/low across both series, not either series alone", () => {
    const g = computeDualHistoryGeometry(DAILY, WEEKLY, OPTS);
    const allValues = [...DAILY, ...WEEKLY].map((p) => Number(p.valueWhole));
    const hi = Math.max(...allValues);
    const lo = Math.min(...allValues);
    expect(g.valueTicks).toHaveLength(3);
    expect(g.valueTicks[0]!.value).toBe(hi);
    expect(g.valueTicks[2]!.value).toBe(lo);
  });

  it("formats value-tick labels at a fixed trillions scale (never switching to billions for the smaller series)", () => {
    const g = computeDualHistoryGeometry(DAILY, WEEKLY, OPTS);
    for (const tick of g.valueTicks) expect(tick.label).toMatch(/^\$\d+\.\d{2}T$/);
  });

  it("the larger series (reserves) plots higher on the shared axis than the smaller series (TGA) — smaller y, since SVG y grows downward", () => {
    const g = computeDualHistoryGeometry(DAILY, WEEKLY, OPTS);
    const avgY = (pts: typeof g.aPoints) => pts.reduce((s, p) => s + p.y, 0) / pts.length;
    expect(avgY(g.bPoints)).toBeLessThan(avgY(g.aPoints));
  });
});

describe("computeDualHistoryGeometry — date ticks", () => {
  it("emits exactly 3 ticks spanning the combined date range's start, midpoint, and end", () => {
    const g = computeDualHistoryGeometry(DAILY, WEEKLY, OPTS);
    expect(g.dateTicks).toHaveLength(3);
    expect(g.dateTicks[0]!.x).toBeLessThan(g.dateTicks[1]!.x);
    expect(g.dateTicks[1]!.x).toBeLessThan(g.dateTicks[2]!.x);
  });
});

describe("computeDualHistoryGeometry — straight segments only (no overshoot)", () => {
  it("every path is built from M/L commands only — never a curve that could overshoot a local max/min", () => {
    const g = computeDualHistoryGeometry(DAILY, WEEKLY, OPTS);
    expect(g.aPath).toMatch(/^[ML0-9.,\s-]*$/);
    expect(g.bPath).toMatch(/^[ML0-9.,\s-]*$/);
    expect(g.aPath).not.toContain("C");
    expect(g.bPath).not.toContain("C");
  });
});

describe("findNearestDualPoint", () => {
  it("returns null when both lines are empty", () => {
    expect(findNearestDualPoint([], [], 100, 100)).toBeNull();
  });

  it("picks the closer line by x-distance", () => {
    const aPoints = [{ date: "2026-06-01", x: 10, y: 50 }];
    const bPoints = [{ date: "2026-06-01", x: 90, y: 50 }];
    expect(findNearestDualPoint(aPoints, bPoints, 15, 50)).toEqual({ series: "a", index: 0 });
    expect(findNearestDualPoint(aPoints, bPoints, 85, 50)).toEqual({ series: "b", index: 0 });
  });

  it("breaks an x-distance tie by y-distance", () => {
    const aPoints = [{ date: "2026-06-01", x: 50, y: 10 }];
    const bPoints = [{ date: "2026-06-01", x: 50, y: 90 }];
    expect(findNearestDualPoint(aPoints, bPoints, 50, 20)).toEqual({ series: "a", index: 0 });
    expect(findNearestDualPoint(aPoints, bPoints, 50, 80)).toEqual({ series: "b", index: 0 });
  });

  it("finds the correct index among several points on the same line", () => {
    const aPoints = [
      { date: "2026-06-01", x: 0, y: 50 },
      { date: "2026-06-02", x: 50, y: 50 },
      { date: "2026-06-03", x: 100, y: 50 },
    ];
    expect(findNearestDualPoint(aPoints, [], 48, 50)).toEqual({ series: "a", index: 1 });
  });
});
