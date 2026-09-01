import { describe, expect, it } from "vitest";
import { computeDailyCadenceGeometry, type CadenceLayoutDay } from "../src/layout/dailyCadenceLayout";

const OPTS = { width: 640, height: 220, padTop: 10, padBottom: 10 };

/** 31 days of July, with weekends (Jul 2026: the 4th/5th, 11th/12th, 18th/19th, 25th/26th land on Sat/Sun) rendered as true gaps — deliberately not "every day has data," which is the realistic DTS shape. */
function julyDaysWithWeekendGaps(): CadenceLayoutDay[] {
  const weekends = new Set([4, 5, 11, 12, 18, 19, 25, 26]);
  const days: CadenceLayoutDay[] = [];
  for (let d = 1; d <= 31; d++) {
    const date = `2026-07-${String(d).padStart(2, "0")}`;
    if (weekends.has(d)) {
      days.push({ date, depositWhole: null, withdrawalWhole: null });
    } else {
      days.push({ date, depositWhole: String(1_000_000 + d * 1000), withdrawalWhole: String(900_000 + d * 500) });
    }
  }
  return days;
}

describe("computeDailyCadenceGeometry — bounds", () => {
  it("keeps every bar's x within the declared canvas width", () => {
    const geometry = computeDailyCadenceGeometry(julyDaysWithWeekendGaps(), OPTS);
    for (const bar of geometry.bars) {
      expect(bar.x).toBeGreaterThanOrEqual(0);
      expect(bar.x).toBeLessThanOrEqual(OPTS.width);
    }
  });

  it("never produces a negative bar height", () => {
    const geometry = computeDailyCadenceGeometry(julyDaysWithWeekendGaps(), OPTS);
    for (const bar of geometry.bars) {
      expect(bar.depositHeight).toBeGreaterThanOrEqual(0);
      expect(bar.withdrawalHeight).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps every deposit/withdrawal bar within its half of the plot height", () => {
    const geometry = computeDailyCadenceGeometry(julyDaysWithWeekendGaps(), OPTS);
    const plotHalf = (OPTS.height - OPTS.padTop - OPTS.padBottom) / 2;
    for (const bar of geometry.bars) {
      expect(bar.depositHeight).toBeLessThanOrEqual(plotHalf + 1e-6);
      expect(bar.withdrawalHeight).toBeLessThanOrEqual(plotHalf + 1e-6);
      expect(bar.depositTop).toBeGreaterThanOrEqual(OPTS.padTop - 1e-6);
    }
  });

  it("handles an empty day list without dividing by zero", () => {
    const geometry = computeDailyCadenceGeometry([], OPTS);
    expect(geometry.bars).toHaveLength(0);
    expect(Number.isFinite(geometry.zeroY)).toBe(true);
  });
});

describe("computeDailyCadenceGeometry — monotonic x", () => {
  it("places 31 calendar days at strictly increasing x, one column per day", () => {
    const geometry = computeDailyCadenceGeometry(julyDaysWithWeekendGaps(), OPTS);
    expect(geometry.bars).toHaveLength(31);
    for (let i = 1; i < geometry.bars.length; i++) {
      expect(geometry.bars[i]!.x).toBeGreaterThan(geometry.bars[i - 1]!.x);
    }
  });
});

describe("computeDailyCadenceGeometry — weekends/holidays render as true gaps", () => {
  it("a day with null deposit/withdrawal gets a column position but zero drawable height and hasDeposit/hasWithdrawal false", () => {
    const geometry = computeDailyCadenceGeometry(julyDaysWithWeekendGaps(), OPTS);
    const saturday = geometry.bars.find((b) => b.date === "2026-07-04")!;
    expect(saturday.hasDeposit).toBe(false);
    expect(saturday.hasWithdrawal).toBe(false);
    expect(saturday.depositHeight).toBe(0);
    expect(saturday.withdrawalHeight).toBe(0);
    // The column still exists (a real gap at the right position), not skipped entirely.
    const friday = geometry.bars.find((b) => b.date === "2026-07-03")!;
    expect(saturday.x).toBeGreaterThan(friday.x);
  });

  it("a business day with real readings gets hasDeposit/hasWithdrawal true and a positive height", () => {
    const geometry = computeDailyCadenceGeometry(julyDaysWithWeekendGaps(), OPTS);
    const monday = geometry.bars.find((b) => b.date === "2026-07-06")!;
    expect(monday.hasDeposit).toBe(true);
    expect(monday.hasWithdrawal).toBe(true);
    expect(monday.depositHeight).toBeGreaterThan(0);
    expect(monday.withdrawalHeight).toBeGreaterThan(0);
  });
});
