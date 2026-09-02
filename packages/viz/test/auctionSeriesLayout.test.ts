import { describe, expect, it } from "vitest";
import { computeAuctionSeriesGeometry, type AuctionSeriesLayoutPoint } from "../src/layout/auctionSeriesLayout";

const OPTS = { width: 520, height: 175, padLeft: 40, padRight: 20, padTop: 20, padBottom: 25 };

// The approved mockup's real 14-auction 7-year bid-to-cover window
// (penny-auction-page.html) — used here purely as a realistic fixture shape,
// not asserted against the mockup's own pixel coordinates (this module's
// pixel math is independent of, and predates, that hand-authored SVG).
const BID_TO_COVER: AuctionSeriesLayoutPoint[] = [
  { date: "2025-07-29", valueWhole: "2.79" },
  { date: "2025-08-28", valueWhole: "2.49" },
  { date: "2025-09-25", valueWhole: "2.40" },
  { date: "2025-10-28", valueWhole: "2.46" },
  { date: "2025-11-26", valueWhole: "2.46" },
  { date: "2025-12-24", valueWhole: "2.51" },
  { date: "2026-01-29", valueWhole: "2.45" },
  { date: "2026-02-26", valueWhole: "2.50" },
  { date: "2026-03-26", valueWhole: "2.43" },
  { date: "2026-04-28", valueWhole: "2.51" },
  { date: "2026-05-28", valueWhole: "2.52" },
  { date: "2026-06-25", valueWhole: "2.50" },
  { date: "2026-07-28", valueWhole: "2.49" },
  { date: "2026-08-27", valueWhole: "2.50" },
];

describe("computeAuctionSeriesGeometry — bounds and ordering", () => {
  it("keeps every point within the declared canvas extent", () => {
    const geometry = computeAuctionSeriesGeometry(BID_TO_COVER, OPTS);
    for (const p of geometry.points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(OPTS.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(OPTS.height);
    }
    for (const t of geometry.valueTicks) {
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThanOrEqual(OPTS.height);
    }
  });

  it("spaces x strictly increasing, proportional to real calendar-day distance (not evenly by index)", () => {
    const geometry = computeAuctionSeriesGeometry(BID_TO_COVER, OPTS);
    for (let i = 1; i < geometry.points.length; i++) {
      expect(geometry.points[i]!.x).toBeGreaterThan(geometry.points[i - 1]!.x);
    }
    // Dec 24 -> Jan 29 (36 days) is a visibly wider gap than the ~28-31-day
    // gaps around it (e.g. Aug 28 -> Sep 25, 28 days) — a real schedule
    // irregularity should widen on the page, never compress to look uniform.
    const deltaDecToJan = geometry.points[6]!.x - geometry.points[5]!.x; // Dec 24 -> Jan 29
    const deltaAugToSep = geometry.points[1]!.x - geometry.points[0]!.x; // Jul 29 -> Aug 28
    expect(deltaDecToJan).toBeGreaterThan(deltaAugToSep);
  });

  it("never divides by zero for a single point, and centers it", () => {
    const geometry = computeAuctionSeriesGeometry([{ date: "2026-08-27", valueWhole: "2.50" }], OPTS);
    expect(geometry.points).toHaveLength(1);
    expect(Number.isFinite(geometry.points[0]!.x)).toBe(true);
    expect(Number.isFinite(geometry.points[0]!.y)).toBe(true);
  });

  it("never divides by zero for a perfectly flat series", () => {
    const flat: AuctionSeriesLayoutPoint[] = [
      { date: "2026-06-25", valueWhole: "2.50" },
      { date: "2026-07-28", valueWhole: "2.50" },
      { date: "2026-08-27", valueWhole: "2.50" },
    ];
    const geometry = computeAuctionSeriesGeometry(flat, OPTS);
    for (const p of geometry.points) {
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it("returns empty geometry, never NaN paths, for an empty input", () => {
    const geometry = computeAuctionSeriesGeometry([], OPTS);
    expect(geometry.points).toEqual([]);
    expect(geometry.linePath).toBe("");
    expect(geometry.referenceY).toBeNull();
    expect(geometry.valueTicks).toEqual([]);
    expect(geometry.dateTicks).toEqual([]);
  });

  it("nudges same-day points apart rather than overlapping or dividing by zero", () => {
    const sameDay: AuctionSeriesLayoutPoint[] = [
      { date: "2026-08-27", valueWhole: "2.40" },
      { date: "2026-08-27", valueWhole: "2.60" },
    ];
    const geometry = computeAuctionSeriesGeometry(sameDay, OPTS);
    expect(geometry.points[1]!.x).toBeGreaterThan(geometry.points[0]!.x);
  });
});

describe("computeAuctionSeriesGeometry — reference line", () => {
  it("places the reference value inside the y-domain, distinct from any single point's y unless equal", () => {
    const geometry = computeAuctionSeriesGeometry(BID_TO_COVER, { ...OPTS, referenceValue: 2.5 });
    expect(geometry.referenceY).not.toBeNull();
    expect(geometry.referenceY!).toBeGreaterThanOrEqual(0);
    expect(geometry.referenceY!).toBeLessThanOrEqual(OPTS.height);
  });

  it("folds an extreme reference value into the domain so it never clips off-canvas", () => {
    const geometry = computeAuctionSeriesGeometry(BID_TO_COVER, { ...OPTS, referenceValue: 5 });
    expect(geometry.referenceY!).toBeGreaterThanOrEqual(OPTS.padTop);
    expect(geometry.referenceY!).toBeLessThanOrEqual(OPTS.height - OPTS.padBottom + 0.01);
  });

  it("is null when no reference value is supplied", () => {
    const geometry = computeAuctionSeriesGeometry(BID_TO_COVER, OPTS);
    expect(geometry.referenceY).toBeNull();
  });

  it("is null for a non-finite reference value (NaN/Infinity) rather than corrupting the domain", () => {
    const geometry = computeAuctionSeriesGeometry(BID_TO_COVER, { ...OPTS, referenceValue: NaN });
    expect(geometry.referenceY).toBeNull();
  });
});

describe("computeAuctionSeriesGeometry — value tick labels", () => {
  it("formats each tick with the caller's decimals and suffix", () => {
    const geometry = computeAuctionSeriesGeometry(BID_TO_COVER, { ...OPTS, valueFormat: { decimals: 1, suffix: "×" } });
    expect(geometry.valueTicks).toHaveLength(3);
    for (const t of geometry.valueTicks) {
      expect(t.label).toMatch(/^-?\d+\.\d×$/);
    }
    // Ticks run top (highest value) to bottom (lowest value).
    expect(geometry.valueTicks[0]!.value).toBeGreaterThan(geometry.valueTicks[2]!.value);
  });

  it("falls back to a bare number when no format is given", () => {
    const geometry = computeAuctionSeriesGeometry(BID_TO_COVER, OPTS);
    expect(geometry.valueTicks[0]!.label).not.toContain("×");
    expect(geometry.valueTicks[0]!.label).not.toBe("");
  });
});

describe("computeAuctionSeriesGeometry — date ticks", () => {
  it("labels the first, a middle, and the last point (never more than the point count)", () => {
    const geometry = computeAuctionSeriesGeometry(BID_TO_COVER, OPTS);
    expect(geometry.dateTicks).toHaveLength(3);
    expect(geometry.dateTicks[0]!.label).toBe("Jul '25");
    expect(geometry.dateTicks[geometry.dateTicks.length - 1]!.label).toBe("Aug '26");
  });

  it("never produces more date ticks than points for a two-point series", () => {
    const two: AuctionSeriesLayoutPoint[] = [
      { date: "2026-07-28", valueWhole: "2.49" },
      { date: "2026-08-27", valueWhole: "2.50" },
    ];
    const geometry = computeAuctionSeriesGeometry(two, OPTS);
    expect(geometry.dateTicks.length).toBeLessThanOrEqual(2);
  });
});
