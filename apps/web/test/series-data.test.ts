/**
 * Integration tests against a real (in-memory PGlite) database — the
 * success path for every query in lib/series-data.ts, plus lib/db.ts's
 * failure path. `getDb()` resolves to a fresh in-memory PGlite under
 * vitest (see @buck/db's client.ts doc comment: `process.env.VITEST` is
 * set by the test runner), scoped to this test file's module instance —
 * seeded once in beforeAll and read (never mutated) by every `it()` below.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, observation, seedSeriesCatalog } from "@buck/db";
import { ensureMigrated, safely } from "../lib/db";
import { getLatestPeriodEnd, getLatestReading, getMtsFlow, getReadingsAt } from "../lib/series-data";
import type { SeriesId } from "@buck/registry";

const DEBT_ID = "fiscal.debt.total_public_debt_outstanding" as SeriesId;
const CPI_ID = "price.cpi_u.all_items" as SeriesId;
const TGA_ID = "fiscal.tga.closing_balance" as SeriesId; // deliberately left with zero observations
const RECEIPTS_TOTAL = "fiscal.mts.receipts.total" as SeriesId;
const OUTLAYS_TOTAL = "fiscal.mts.outlays.total" as SeriesId;
const DEFICIT_TOTAL = "fiscal.mts.deficit.total" as SeriesId;
const INDIVIDUAL_INCOME_TAX = "fiscal.mts.receipts.category.individual_income_tax" as SeriesId;
const CORPORATION_INCOME_TAX = "fiscal.mts.receipts.category.corporation_income_tax" as SeriesId;
const NATIONAL_DEFENSE = "fiscal.mts.outlays.category.national_defense" as SeriesId;

beforeAll(async () => {
  await ensureMigrated();
  const db = getDb();
  await seedSeriesCatalog(db);

  // Inserted separately (and .returning()'d) so the revision row below can
  // reference the original's real generated id rather than guessing one.
  const [cpiOriginal] = await db
    .insert(observation)
    .values({
      seriesId: CPI_ID,
      periodType: "month",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      fiscalYear: null,
      value: "314.540",
      publicationTime: new Date("2026-08-13T00:00:00Z"),
    })
    .returning();

  await db.insert(observation).values([
    // Two distinct days for a daily series -> getLatestReading picks the later period_end.
    {
      seriesId: DEBT_ID,
      periodType: "day",
      periodStart: "2026-08-27",
      periodEnd: "2026-08-27",
      fiscalYear: 2026,
      value: "36300000000000",
      publicationTime: new Date("2026-08-28T00:00:00Z"),
    },
    {
      seriesId: DEBT_ID,
      periodType: "day",
      periodStart: "2026-08-28",
      periodEnd: "2026-08-28",
      fiscalYear: 2026,
      value: "36345909729842.98",
      publicationTime: new Date("2026-08-29T00:00:00Z"),
    },
    // A revision of cpiOriginal — same series/period, later publication_time. Latest publication_time wins.
    {
      seriesId: CPI_ID,
      periodType: "month",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      fiscalYear: null,
      value: "314.600",
      publicationTime: new Date("2026-09-13T00:00:00Z"),
      revisionOf: cpiOriginal!.id,
    },
    // A full-ish MTS month: totals + a partial set of categories (the rest
    // stay ungiven on purpose, to exercise the per-category gap path).
    {
      seriesId: RECEIPTS_TOTAL,
      periodType: "month",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      fiscalYear: 2026,
      value: "500000",
      publicationTime: new Date("2026-08-12T00:00:00Z"),
    },
    {
      seriesId: OUTLAYS_TOTAL,
      periodType: "month",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      fiscalYear: 2026,
      value: "600000",
      publicationTime: new Date("2026-08-12T00:00:00Z"),
    },
    {
      seriesId: DEFICIT_TOTAL,
      periodType: "month",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      fiscalYear: 2026,
      value: "-100000",
      publicationTime: new Date("2026-08-12T00:00:00Z"),
    },
    {
      seriesId: INDIVIDUAL_INCOME_TAX,
      periodType: "month",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      fiscalYear: 2026,
      value: "300000",
      publicationTime: new Date("2026-08-12T00:00:00Z"),
    },
    {
      seriesId: CORPORATION_INCOME_TAX,
      periodType: "month",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      fiscalYear: 2026,
      value: "50000",
      publicationTime: new Date("2026-08-12T00:00:00Z"),
    },
    {
      seriesId: NATIONAL_DEFENSE,
      periodType: "month",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      fiscalYear: 2026,
      value: "200000",
      publicationTime: new Date("2026-08-12T00:00:00Z"),
    },
    // No fiscal_ytd rows at all -> getMtsFlow("fiscal_ytd") must resolve to a full gap.
  ]);
});

describe("getLatestReading", () => {
  it("returns a gap (null) for a series with zero observations", async () => {
    expect(await getLatestReading(TGA_ID)).toBeNull();
  });

  it("picks the latest period_end for a daily series", async () => {
    const reading = await getLatestReading(DEBT_ID, "day");
    expect(reading?.periodEnd).toBe("2026-08-28");
    expect(reading?.value).toBe("36345909729842.9800"); // numeric(20,4) round-trips with trailing zeros
  });

  it("picks the latest publication_time (the current revision) for the same period", async () => {
    const reading = await getLatestReading(CPI_ID, "month");
    expect(reading?.value).toBe("314.6000");
    expect(reading?.periodEnd).toBe("2026-07-31");
  });
});

describe("getLatestPeriodEnd", () => {
  it("finds the anchor period for a period_type that has data", async () => {
    expect(await getLatestPeriodEnd(RECEIPTS_TOTAL, "month")).toBe("2026-07-31");
  });

  it("returns null (a gap) for a period_type with no data at all", async () => {
    expect(await getLatestPeriodEnd(RECEIPTS_TOTAL, "fiscal_ytd")).toBeNull();
  });
});

describe("getReadingsAt", () => {
  it("returns only the ids that actually have a reading at that exact period, omitting the rest", async () => {
    const readings = await getReadingsAt([RECEIPTS_TOTAL, "fiscal.mts.receipts.category.excise_taxes" as SeriesId], "month", "2026-07-31");
    expect(readings.has(RECEIPTS_TOTAL)).toBe(true);
    expect(readings.has("fiscal.mts.receipts.category.excise_taxes" as SeriesId)).toBe(false);
  });

  it("returns an empty map for an empty id list without querying", async () => {
    expect((await getReadingsAt([], "month", "2026-07-31")).size).toBe(0);
  });
});

describe("getMtsFlow", () => {
  it("assembles the full month flow anchored on the shared latest period_end", async () => {
    const flow = await getMtsFlow("month");
    expect(flow.periodEnd).toBe("2026-07-31");
    expect(flow.fiscalYear).toBe(2026);
    // numeric(20,4) round-trips every value with 4 decimal places, per the
    // db schema's declared scale — see the same assertion pattern in
    // packages/db/test/db.test.ts.
    expect(flow.receipts.total?.value).toBe("500000.0000");
    expect(flow.outlays.total?.value).toBe("600000.0000");
    expect(flow.deficit?.value).toBe("-100000.0000");

    const individualIncomeTax = flow.receipts.categories.find((c) => c.id === INDIVIDUAL_INCOME_TAX);
    expect(individualIncomeTax?.reading?.value).toBe("300000.0000");

    // A category with no ingested observation is present in the array (so
    // a caller can render it as a per-category gap) but its reading is null.
    const excise = flow.receipts.categories.find((c) => c.id === "fiscal.mts.receipts.category.excise_taxes");
    expect(excise?.reading).toBeNull();

    const defense = flow.outlays.categories.find((c) => c.id === NATIONAL_DEFENSE);
    expect(defense?.reading?.value).toBe("200000.0000");
  });

  it("is a full gap for a period_type with nothing ingested (fiscal_ytd)", async () => {
    const flow = await getMtsFlow("fiscal_ytd");
    expect(flow.periodEnd).toBeNull();
    expect(flow.receipts.total).toBeNull();
    expect(flow.outlays.total).toBeNull();
    expect(flow.deficit).toBeNull();
    expect(flow.receipts.categories.every((c) => c.reading === null)).toBe(true);
  });
});

describe("safely (lib/db.ts) — the failure path", () => {
  it("returns the fallback instead of throwing when the query function rejects", async () => {
    const result = await safely<string>(async () => {
      throw new Error("simulated database outage");
    }, "fallback-for-a-gap");
    expect(result).toBe("fallback-for-a-gap");
  });
});
