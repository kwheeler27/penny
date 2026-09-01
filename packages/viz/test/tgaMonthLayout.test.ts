import { describe, expect, it } from "vitest";
import { computeTgaMonthGeometry, type TgaLayoutDay } from "../src/layout/tgaMonthLayout";

const OPTS = { width: 640, height: 140, padLeft: 8, padRight: 8, padTop: 12, padBottom: 12 };

function julyDaysWithWeekendGaps(): TgaLayoutDay[] {
  const weekends = new Set([4, 5, 11, 12, 18, 19, 25, 26]);
  const days: TgaLayoutDay[] = [];
  for (let d = 1; d <= 31; d++) {
    const date = `2026-07-${String(d).padStart(2, "0")}`;
    days.push({ date, valueWhole: weekends.has(d) ? null : String(900_000_000 - d * 1_000_000) });
  }
  return days;
}

describe("computeTgaMonthGeometry — bounds", () => {
  it("keeps every point within the declared canvas extent", () => {
    const geometry = computeTgaMonthGeometry(julyDaysWithWeekendGaps(), OPTS);
    for (const p of geometry.points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(OPTS.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(OPTS.height);
    }
  });

  it("returns empty geometry for an all-gap month, never NaN", () => {
    const allGaps: TgaLayoutDay[] = julyDaysWithWeekendGaps().map((d) => ({ date: d.date, valueWhole: null }));
    const geometry = computeTgaMonthGeometry(allGaps, OPTS);
    expect(geometry.points).toHaveLength(0);
    expect(geometry.path).toBe("");
  });

  it("handles a single known day without dividing by zero", () => {
    const geometry = computeTgaMonthGeometry([{ date: "2026-07-01", valueWhole: "500" }], OPTS);
    expect(geometry.points).toHaveLength(1);
    expect(Number.isFinite(geometry.points[0]!.x)).toBe(true);
    expect(Number.isFinite(geometry.points[0]!.y)).toBe(true);
  });
});

describe("computeTgaMonthGeometry — monotonic x", () => {
  it("places known days at strictly increasing x, in calendar order", () => {
    const geometry = computeTgaMonthGeometry(julyDaysWithWeekendGaps(), OPTS);
    for (let i = 1; i < geometry.points.length; i++) {
      expect(geometry.points[i]!.x).toBeGreaterThan(geometry.points[i - 1]!.x);
    }
  });
});

describe("computeTgaMonthGeometry — gap days are skipped, never fabricated", () => {
  it("the line's point count equals only the days WITH a reading (23 business days out of 31 in this fixture)", () => {
    const geometry = computeTgaMonthGeometry(julyDaysWithWeekendGaps(), OPTS);
    expect(geometry.points).toHaveLength(23);
    expect(geometry.points.some((p) => p.date === "2026-07-04")).toBe(false); // Saturday — a true gap
  });

  it("the path connects the two real points straddling a gap directly (no fabricated point in between)", () => {
    const geometry = computeTgaMonthGeometry(julyDaysWithWeekendGaps(), OPTS);
    const friday = geometry.points.find((p) => p.date === "2026-07-03")!;
    const monday = geometry.points.find((p) => p.date === "2026-07-06")!;
    const fridayIdx = geometry.points.indexOf(friday);
    const mondayIdx = geometry.points.indexOf(monday);
    // Adjacent in the points array — the weekend produced no entry between them.
    expect(mondayIdx).toBe(fridayIdx + 1);
  });
});
