/**
 * Pure unit tests for lib/money-creation-transform.ts — no database, a
 * hand-built Reading[] fixture only. Mirrors test/cadence-transform.test.ts's
 * own convention for this repo's DB/transform split.
 */
import { describe, expect, it } from "vitest";
import { getSeries, type SeriesId } from "@penny/registry";
import { buildMoneyCreationLine, clipReservesToTgaWindow } from "../lib/money-creation-transform";
import type { Reading } from "../lib/types";

const TGA_ID = "fiscal.tga.closing_balance" as SeriesId;
const TGA_DEF = getSeries(TGA_ID)!;

function reading(periodEnd: string, value: string): Reading {
  return { seriesId: TGA_ID, periodType: "day", periodStart: periodEnd, periodEnd, fiscalYear: null, value, publicationTime: `${periodEnd}T00:00:00Z`, revisionOf: null };
}

describe("buildMoneyCreationLine", () => {
  it("returns zero points (a graceful gap, not a crash) when the series isn't registered yet", () => {
    const line = buildMoneyCreationLine([reading("2026-06-01", "856842")], undefined, "Bank reserves", "weekly, Wednesdays");
    expect(line.points).toHaveLength(0);
    expect(line.label).toBe("Bank reserves");
    expect(line.cadenceLabel).toBe("weekly, Wednesdays");
  });

  it("scales through the series' own registered magnitude (millions -> whole dollars), never a hardcoded assumption", () => {
    const line = buildMoneyCreationLine([reading("2026-06-01", "856842")], TGA_DEF, "Treasury General Account", "most business days");
    expect(line.points).toHaveLength(1);
    expect(line.points[0]!.valueWhole).toBe("856842000000");
    expect(line.points[0]!.display).toBe("$856,842,000,000");
  });

  it("formats the rounded display at a fixed trillions scale, 2 decimals", () => {
    const line = buildMoneyCreationLine([reading("2026-06-01", "2924936")], TGA_DEF, "Bank reserves", "weekly, Wednesdays");
    expect(line.points[0]!.scaledDisplay).toBe("$2.92T");
  });

  it("carries each reading's own date through as both the point's date and a short human label", () => {
    const line = buildMoneyCreationLine([reading("2026-06-01", "1")], TGA_DEF, "x", "y");
    expect(line.points[0]!.date).toBe("2026-06-01");
    expect(line.points[0]!.label).toBe("Jun 1, 2026");
  });

  it("preserves input order and produces one point per reading, including a real gap-in-cadence (no interpolation, no fabricated zero)", () => {
    const line = buildMoneyCreationLine([reading("2026-06-01", "800000"), reading("2026-07-31", "810000")], TGA_DEF, "x", "y");
    expect(line.points.map((p) => p.date)).toEqual(["2026-06-01", "2026-07-31"]);
  });

  it("returns zero points for zero readings (registered series, nothing ingested yet)", () => {
    const line = buildMoneyCreationLine([], TGA_DEF, "Treasury General Account", "most business days");
    expect(line.points).toHaveLength(0);
  });
});

describe("clipReservesToTgaWindow", () => {
  // monetary.fed.reserve_balances carries FRED's full 2015-to-present
  // WRBWFRBL backfill; fiscal.tga.closing_balance currently carries only the
  // daily ingest's own (much shorter) window — this is the guard against
  // plotting 11 years of reserves against a few months of TGA (see this
  // function's own doc comment in lib/money-creation-transform.ts).
  const reserves = [
    reading("2015-01-07", "2710273"),
    reading("2024-01-03", "3400000"),
    reading("2026-06-03", "2920000"),
    reading("2026-06-10", "2930000"),
    reading("2026-08-26", "2916824"),
  ];

  it("drops every reserves reading dated before TGA's own earliest reading", () => {
    const tga = [reading("2026-06-01", "856842"), reading("2026-07-31", "900000")];
    const clipped = clipReservesToTgaWindow(tga, reserves);
    expect(clipped.map((r) => r.periodEnd)).toEqual(["2026-06-03", "2026-06-10", "2026-08-26"]);
  });

  it("keeps a reserves reading dated AFTER TGA's own latest reading — only the start is clipped, not the end", () => {
    const tga = [reading("2026-06-01", "856842")];
    const clipped = clipReservesToTgaWindow(tga, reserves);
    expect(clipped.map((r) => r.periodEnd)).toContain("2026-08-26");
  });

  it("returns reserves completely unclipped when TGA has no readings at all yet — a real chart beats an empty one", () => {
    expect(clipReservesToTgaWindow([], reserves)).toEqual(reserves);
  });

  it("returns an empty array when reserves has nothing in TGA's window", () => {
    const tga = [reading("2030-01-01", "1")];
    expect(clipReservesToTgaWindow(tga, reserves)).toEqual([]);
  });
});
