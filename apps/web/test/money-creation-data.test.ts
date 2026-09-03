/**
 * Integration test for lib/money-creation-data.ts against a real (in-memory
 * PGlite) database — verifies the DB -> lib/money-creation-transform.ts
 * wiring for both lines, INCLUDING the reserves-clipped-to-TGA's-window
 * behavior (clipReservesToTgaWindow) with real rows shaped like the actual
 * fixtures this branch ships with today: `fiscal.tga.closing_balance`
 * covering a few months, `monetary.fed.reserve_balances` carrying FRED's
 * full multi-year WRBWFRBL backfill. Mirrors test/cadence-data.test.ts's own
 * setup pattern.
 *
 * `monetary.fed.reserve_balances` is registered as of this test (a parallel
 * PR against this branch landed it — see lib/money-creation-data.ts's own
 * doc comment) — this test exercises the real, present-series path;
 * lib/money-creation-transform.test.ts's own "returns zero points... when
 * the series isn't registered yet" test is what keeps the OTHER path (the
 * one this build shipped against for most of its life) covered too.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, observation, series } from "@penny/db";
import { getSeries, type SeriesId } from "@penny/registry";
import { ensureMigrated } from "../lib/db";
import { getMoneyCreationChartData } from "../lib/money-creation-data";

const TGA_ID = "fiscal.tga.closing_balance" as SeriesId;
const RESERVES_ID = "monetary.fed.reserve_balances" as SeriesId;

beforeAll(async () => {
  await ensureMigrated();
  const db = getDb();

  const NEEDED_IDS = [TGA_ID, RESERVES_ID];
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
        accountingConcept: s.accountingConcept as "balance",
        cadence: s.cadence,
      };
    }),
  );

  const publicationTime = new Date("2026-08-27T00:00:00Z");
  const day = (seriesId: string, periodEnd: string, value: string) => ({
    seriesId,
    periodType: "day" as const,
    periodStart: periodEnd,
    periodEnd,
    fiscalYear: null,
    value,
    publicationTime,
  });

  await db.insert(observation).values([
    // TGA: a short real window (June-July 2026), matching what this branch's
    // own db/fixtures/observations/tga-closing-balance.json actually covers.
    day(TGA_ID, "2026-06-01", "856842"),
    day(TGA_ID, "2026-06-02", "866075"),
    day(TGA_ID, "2026-07-31", "900000"),

    // Reserves: FRED's real weekly-Wednesday cadence, deliberately spanning
    // YEARS before TGA's own window starts, to exercise the clip.
    day(RESERVES_ID, "2015-01-07", "2710273"),
    day(RESERVES_ID, "2024-01-03", "3400000"),
    day(RESERVES_ID, "2026-06-03", "2920000"), // inside TGA's window
    day(RESERVES_ID, "2026-06-10", "2930000"), // inside TGA's window
    day(RESERVES_ID, "2026-08-26", "2916824"), // AFTER TGA's own latest reading — must survive the clip
  ]);
});

describe("getMoneyCreationChartData", () => {
  it("returns the TGA line built from real DB rows, ascending, scaled through its own registered magnitude", async () => {
    const data = await getMoneyCreationChartData();
    expect(data.tga.points.map((p) => p.date)).toEqual(["2026-06-01", "2026-06-02", "2026-07-31"]);
    expect(data.tga.points[0]!.display).toBe("$856,842,000,000");
    expect(data.tga.label).toBe("Treasury General Account");
  });

  it("returns a real citation for the TGA line, with today's access date substituted", async () => {
    const data = await getMoneyCreationChartData();
    expect(data.tgaCitation.agency).toContain("Bureau of the Fiscal Service");
    expect(data.tgaCitation.citation).not.toContain("{access_date}");
  });

  it("clips the reserves line to TGA's own window — drops the 2015 and 2024 readings, keeps everything from TGA's earliest reading onward (including the one AFTER TGA's own latest reading)", async () => {
    const data = await getMoneyCreationChartData();
    expect(data.reserves.points.map((p) => p.date)).toEqual(["2026-06-03", "2026-06-10", "2026-08-26"]);
  });

  it("returns a real citation for the reserves line, naming FRED/WRBWFRBL, now that the series is registered", async () => {
    const data = await getMoneyCreationChartData();
    expect(data.reservesCitation).not.toBeNull();
    expect(data.reservesCitation!.datasetUrl).toContain("fred.stlouisfed.org");
    expect(data.reservesCitation!.citation).toContain("WRBWFRBL");
    expect(data.reservesCitation!.citation).not.toContain("{access_date}");
  });

  it("scales the reserves line through ITS OWN registered magnitude — never assumed, always read from the registry at render", async () => {
    const data = await getMoneyCreationChartData();
    const latest = data.reserves.points.find((p) => p.date === "2026-08-26")!;
    expect(latest.display).toBe("$2,916,824,000,000");
    expect(latest.scaledDisplay).toBe("$2.92T");
  });
});
