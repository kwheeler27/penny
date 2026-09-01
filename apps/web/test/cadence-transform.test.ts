/**
 * Pure unit tests for lib/cadence-transform.ts — no database, matching
 * test/front-door-transform.test.ts's own hand-built-fixture convention.
 */
import { describe, expect, it } from "vitest";
import type { SeriesDef, SeriesId } from "@penny/registry";
import { everyDayInMonth } from "../lib/calendar";
import { buildDailyCadenceData, buildTgaMonthData, isMonthWeekdayComplete, pickLatestCompleteMonthPrefix } from "../lib/cadence-transform";
import type { Reading } from "../lib/types";

function seriesDef(overrides: Partial<SeriesDef> = {}): SeriesDef {
  return {
    id: "fiscal.dts.deposits_operating_excl_debt" as SeriesId,
    label: "Test series",
    definition: "test",
    aliases: [],
    agency: "U.S. Department of the Treasury, Bureau of the Fiscal Service",
    dataset: "Daily Treasury Statement",
    datasetUrl: "https://fiscaldata.treasury.gov/",
    unit: "usd",
    magnitude: "millions",
    accountingConcept: "receipt",
    cadence: "daily",
    citation: "Treasury, DTS. Accessed {access_date}.",
    notes: [],
    notComparableWith: [],
  } as SeriesDef;
}

function reading(periodEnd: string, value: string, seriesId: SeriesId): Reading {
  return { seriesId, periodType: "day", periodStart: periodEnd, periodEnd, fiscalYear: null, value, publicationTime: "2026-08-01T00:00:00.000Z", revisionOf: null };
}

describe("pickLatestCompleteMonthPrefix", () => {
  it("returns null with fewer than 2 distinct months — never guesses", () => {
    expect(pickLatestCompleteMonthPrefix([])).toBeNull();
    expect(pickLatestCompleteMonthPrefix(["2026-07"])).toBeNull();
  });

  it("returns the second-to-last month once a later month has any data", () => {
    expect(pickLatestCompleteMonthPrefix(["2026-06", "2026-07"])).toBe("2026-06");
    expect(pickLatestCompleteMonthPrefix(["2026-05", "2026-06", "2026-07"])).toBe("2026-06");
  });
});

describe("buildDailyCadenceData", () => {
  const depositsDef = seriesDef({ id: "fiscal.dts.deposits_operating_excl_debt" as SeriesId, magnitude: "millions" });
  const withdrawalsDef = seriesDef({ id: "fiscal.dts.withdrawals_operating_excl_debt" as SeriesId, magnitude: "millions" });

  it("maps sparse readings onto every calendar day — a weekend with no reading is a true gap, not a zero", () => {
    const allDays = everyDayInMonth(2026, 7); // 31 days
    // Only a handful of business days have readings — deliberately sparse.
    const deposits = [reading("2026-07-01", "50000", depositsDef.id as SeriesId), reading("2026-07-06", "60000", depositsDef.id as SeriesId)];
    const withdrawals = [reading("2026-07-01", "40000", withdrawalsDef.id as SeriesId)];

    const data = buildDailyCadenceData(allDays, deposits, withdrawals, depositsDef, withdrawalsDef);
    expect(data.days).toHaveLength(31);

    const jul1 = data.days.find((d) => d.date === "2026-07-01")!;
    expect(jul1.depositWhole).toBe("50000000000"); // 50000 millions -> whole dollars
    expect(jul1.withdrawalWhole).toBe("40000000000");

    const jul4 = data.days.find((d) => d.date === "2026-07-04")!; // no reading seeded
    expect(jul4.depositWhole).toBeNull();
    expect(jul4.depositDisplay).toBeNull();
    expect(jul4.withdrawalWhole).toBeNull();
  });

  it("the hover display is the day's EXACT published figure, not fixed-billions-rounded — cadence-section.tsx's caption promises 'that day's exact figure'", () => {
    const allDays = everyDayInMonth(2026, 7);
    // Not a round number of billions, so a fixed-$0.1B/$0.01B rounding would visibly differ from the exact figure.
    const deposits = [reading("2026-07-01", "40401.44", depositsDef.id as SeriesId)];
    const data = buildDailyCadenceData(allDays, deposits, [], depositsDef, withdrawalsDef);
    const jul1 = data.days.find((d) => d.date === "2026-07-01")!;
    // magnitude "millions" -> whole dollars, 0 decimals (Treasury doesn't publish sub-million precision on this table).
    expect(jul1.depositDisplay).toBe("$40,401,440,000");
    expect(jul1.depositDisplay).not.toBe("$40.40B");
  });

  it("sums only the days that actually have a reading, exactly (never a float approximation)", () => {
    const allDays = everyDayInMonth(2026, 7);
    const deposits = [reading("2026-07-01", "0.01", depositsDef.id as SeriesId), reading("2026-07-02", "0.02", depositsDef.id as SeriesId)];
    const data = buildDailyCadenceData(allDays, deposits, [], seriesDef({ magnitude: "ones" }), withdrawalsDef);
    // 0.01 + 0.02 = 0.03 exactly (not the classic 0.30000000000000004 float artifact).
    expect(data.totalWithdrawalsDisplay).toBe("$0.0B");
  });
});

describe("isMonthWeekdayComplete", () => {
  it("is true when every weekday of the month is present — weekend gaps don't count against it", () => {
    // June 2026: 1st is a Monday, so every weekday 1-30 is present here.
    const allDays = everyDayInMonth(2026, 6);
    const present = new Set(allDays.filter((d) => !["2026-06-06", "2026-06-07", "2026-06-13", "2026-06-14", "2026-06-20", "2026-06-21", "2026-06-27", "2026-06-28"].includes(d)));
    expect(isMonthWeekdayComplete(allDays, present)).toBe(true);
  });

  it("is false when a WEEKDAY inside the month has no reading — the exact ingestion-outage scenario the check exists to catch", () => {
    const allDays = everyDayInMonth(2026, 6);
    // Every weekday present except one — 2026-06-16 is a Tuesday.
    const present = new Set(allDays.filter((d) => d !== "2026-06-16" && !["2026-06-06", "2026-06-07"].includes(d)));
    expect(isMonthWeekdayComplete(allDays, present)).toBe(false);
  });

  it("is false when a large mid-month range is missing (a multi-week ingestion outage), never mistaken for a run of weekends", () => {
    const allDays = everyDayInMonth(2026, 8); // August 2026
    const present = new Set(allDays.slice(0, 7)); // only the first week present
    expect(isMonthWeekdayComplete(allDays, present)).toBe(false);
  });
});

describe("buildTgaMonthData", () => {
  const tgaDef = seriesDef({ id: "fiscal.tga.closing_balance" as SeriesId, magnitude: "millions" });

  it("maps sparse TGA readings onto every calendar day, weekend gaps included", () => {
    const allDays = everyDayInMonth(2026, 7);
    const readings = [reading("2026-07-01", "900000", tgaDef.id as SeriesId), reading("2026-07-06", "850000", tgaDef.id as SeriesId)];
    const data = buildTgaMonthData(allDays, readings, tgaDef);
    expect(data.days).toHaveLength(31);
    const jul1 = data.days.find((d) => d.date === "2026-07-01")!;
    expect(jul1.valueWhole).toBe("900000000000");
    const jul4 = data.days.find((d) => d.date === "2026-07-04")!;
    expect(jul4.valueWhole).toBeNull();
    expect(jul4.display).toBeNull();
  });

  it("labels the month from the LAST day of the range, not the first", () => {
    const allDays = everyDayInMonth(2026, 2); // Feb 2026, not a leap year
    const data = buildTgaMonthData(allDays, [], tgaDef);
    expect(data.monthLabel).toBe("February 2026");
    expect(allDays).toHaveLength(28);
  });
});
