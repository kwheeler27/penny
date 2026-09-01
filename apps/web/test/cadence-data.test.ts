/**
 * Integration test for lib/cadence-data.ts against a real (in-memory
 * PGlite) database — verifies the DB -> lib/cadence-transform.ts wiring:
 * picking the latest COMPLETE month, mapping sparse daily readings onto a
 * full calendar month with true gaps, and the graceful gap state when
 * nothing has been ingested yet. Mirrors test/front-door-data.test.ts's own
 * setup pattern.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, observation, series } from "@penny/db";
import { getSeries, type SeriesId } from "@penny/registry";
import { ensureMigrated } from "../lib/db";
import { everyDayInMonth, isWeekday } from "../lib/calendar";
import { getCadenceData } from "../lib/cadence-data";

const DEPOSITS_ID = "fiscal.dts.deposits_operating_excl_debt";
const WITHDRAWALS_ID = "fiscal.dts.withdrawals_operating_excl_debt";
const TGA_ID = "fiscal.tga.closing_balance" as SeriesId;

beforeAll(async () => {
  await ensureMigrated();
  const db = getDb();

  const NEEDED_IDS = [DEPOSITS_ID, WITHDRAWALS_ID, TGA_ID];
  await db.insert(series).values(
    NEEDED_IDS.map((id) => {
      const s = getSeries(id)!;
      return {
        id: s.id,
        label: s.label,
        definition: s.definition,
        agency: s.agency,
        dataset: s.dataset,
        datasetUrl: s.datasetUrl,
        citation: s.citation,
        unit: s.unit as "usd",
        magnitude: s.magnitude,
        accountingConcept: s.accountingConcept as "balance" | "cash_deposit" | "cash_withdrawal",
        cadence: s.cadence,
      };
    }),
  );

  const publicationTime = new Date("2026-07-05T00:00:00Z");
  const day = (seriesId: string, periodEnd: string, value: string) => ({
    seriesId,
    periodType: "day" as const,
    periodStart: periodEnd,
    periodEnd,
    fiscalYear: null,
    value,
    publicationTime,
  });

  // June 2026: EVERY weekday has a reading (the Daily Treasury Statement's
  // real publication density) — genuine gaps only fall on Sat/Sun. This is
  // what isMonthWeekdayComplete (lib/cadence-transform.ts) now requires
  // before a month is ever certified "complete"; a sparser fixture (only a
  // handful of business days seeded) would make every getCadenceData test
  // below fall through to the graceful-gap state, since June would fail
  // that check. Values follow `50000 + (dayOfMonth - 1)` etc. so day 1
  // matches this file's original hand-picked figures exactly.
  const juneRows = everyDayInMonth(2026, 6)
    .filter(isWeekday)
    .flatMap((date) => {
      const d = Number(date.slice(8, 10));
      return [day(DEPOSITS_ID, date, String(50000 + (d - 1))), day(WITHDRAWALS_ID, date, String(40000 + (d - 1))), day(TGA_ID, date, String(900000 + (d - 1)))];
    });

  await db.insert(observation).values([
    ...juneRows,

    // July 2026: proof publication continued past June — makes June "complete".
    day(DEPOSITS_ID, "2026-07-01", "60000"),
    day(WITHDRAWALS_ID, "2026-07-01", "50000"),
    day(TGA_ID, "2026-07-01", "910000"),
  ]);
});

describe("getCadenceData", () => {
  it("picks June 2026 as the latest COMPLETE month — not July, which has no later month proving it's over", async () => {
    const data = await getCadenceData();
    expect(data.monthLabel).toBe("June 2026");
  });

  it("maps sparse readings onto the full calendar month, with the weekend rendered as a true gap (never a zero)", async () => {
    const data = await getCadenceData();
    expect(data.cadence).not.toBeNull();
    expect(data.cadence!.days).toHaveLength(30); // June has 30 days
    const jun1 = data.cadence!.days.find((d) => d.date === "2026-06-01")!;
    expect(jun1.depositWhole).toBe("50000000000"); // millions -> whole dollars
    const jun6 = data.cadence!.days.find((d) => d.date === "2026-06-06")!; // Saturday, unseeded
    expect(jun6.depositWhole).toBeNull();
    expect(jun6.depositDisplay).toBeNull();
    expect(jun6.withdrawalWhole).toBeNull();
  });

  it("maps the TGA balance onto the same calendar, gaps included", async () => {
    const data = await getCadenceData();
    expect(data.tga).not.toBeNull();
    const jun1 = data.tga!.days.find((d) => d.date === "2026-06-01")!;
    expect(jun1.valueWhole).toBe("900000000000");
    const jun7 = data.tga!.days.find((d) => d.date === "2026-06-07")!; // Sunday, unseeded
    expect(jun7.valueWhole).toBeNull();
  });

  it("returns real citations built from the registry, with today's access date substituted", async () => {
    const data = await getCadenceData();
    expect(data.depositsCitation!.agency).toContain("Bureau of the Fiscal Service");
    expect(data.depositsCitation!.citation).not.toContain("{access_date}");
    expect(data.tgaCitation.dataset).toContain("Daily Treasury Statement");
  });
});
