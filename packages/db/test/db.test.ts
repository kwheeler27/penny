import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, type BuckDb } from "../src/client";
import { runMigrations } from "../src/migrate";
import { seedSeriesCatalog, seedObservationFixtures } from "../src/seed";
import { series, observation } from "../src/schema";

/** Fresh, isolated, in-memory PGlite instance, migrated and ready. */
async function freshDb(): Promise<BuckDb> {
  const db = createDb();
  await runMigrations(db);
  return db;
}

describe("@buck/db schema + migrations (PGlite)", () => {
  it("migrates cleanly and seeds the full @buck/registry catalog", async () => {
    const db = await freshDb();
    const count = await seedSeriesCatalog(db);
    expect(count).toBeGreaterThan(30);
    const rows = await db.select().from(series).where(eq(series.id, "fiscal.mts.receipts.total"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.accountingConcept).toBe("receipt");
    // The FiscalData API returns MTS amounts in whole dollars and cents —
    // magnitude "ones" (fixed 2026-08-29; was wrongly "millions" pre-fix,
    // which would have displayed every MTS dollar figure 10^6 too large).
    expect(rows[0]?.magnitude).toBe("ones");
  });

  it("seedSeriesCatalog is idempotent: re-running upserts, never duplicates", async () => {
    const db = await freshDb();
    const first = await seedSeriesCatalog(db);
    const before = await db.select().from(series);
    const second = await seedSeriesCatalog(db);
    const after = await db.select().from(series);
    expect(second).toBe(first);
    expect(after.length).toBe(before.length);
  });

  it("stores observation.value as an exact decimal string, never a float", async () => {
    const db = await freshDb();
    await seedSeriesCatalog(db);
    await db.insert(observation).values({
      seriesId: "fiscal.debt.total_public_debt_outstanding",
      periodType: "day",
      periodStart: "2026-08-28",
      periodEnd: "2026-08-28",
      fiscalYear: 2026,
      value: "36345909729842.98",
      publicationTime: new Date("2026-08-29T00:00:00Z"),
    });
    const rows = await db.select().from(observation);
    expect(rows).toHaveLength(1);
    expect(typeof rows[0]?.value).toBe("string");
    // scale 4 as declared — proves no float round-trip mangled the digits.
    expect(rows[0]?.value).toBe("36345909729842.9800");
  });

  it("fiscalYear is nullable for a series with no fiscal-year semantics (CPI)", async () => {
    const db = await freshDb();
    await seedSeriesCatalog(db);
    const [row] = await db
      .insert(observation)
      .values({
        seriesId: "price.cpi_u.all_items",
        periodType: "month",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        fiscalYear: null,
        value: "314.5400",
        publicationTime: new Date("2026-08-13T00:00:00Z"),
      })
      .returning();
    expect(row?.fiscalYear).toBeNull();
  });

  it("re-ingesting the identical (series, period_type, period_end, publication_time) is a no-op", async () => {
    const db = await freshDb();
    await seedSeriesCatalog(db);
    const row = {
      seriesId: "fiscal.tga.closing_balance",
      periodType: "day" as const,
      periodStart: "2026-08-28",
      periodEnd: "2026-08-28",
      fiscalYear: 2026,
      value: "700123",
      publicationTime: new Date("2026-08-29T00:00:00Z"),
    };
    await db.insert(observation).values(row).onConflictDoNothing();
    await db.insert(observation).values(row).onConflictDoNothing();
    const rows = await db.select().from(observation).where(eq(observation.seriesId, "fiscal.tga.closing_balance"));
    expect(rows).toHaveLength(1);
  });

  it("a changed value for the same period inserts as a NEW row chained via revision_of — never an in-place update", async () => {
    const db = await freshDb();
    await seedSeriesCatalog(db);
    const [original] = await db
      .insert(observation)
      .values({
        seriesId: "price.cpi_u.all_items",
        periodType: "month",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        fiscalYear: null,
        value: "314.5400",
        publicationTime: new Date("2026-08-13T00:00:00Z"),
      })
      .returning();
    expect(original).toBeDefined();

    const [revision] = await db
      .insert(observation)
      .values({
        seriesId: "price.cpi_u.all_items",
        periodType: "month",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        fiscalYear: null,
        value: "314.6000",
        publicationTime: new Date("2026-09-13T00:00:00Z"),
        revisionOf: original?.id,
      })
      .returning();

    const all = await db.select().from(observation).where(eq(observation.seriesId, "price.cpi_u.all_items"));
    expect(all).toHaveLength(2);
    expect(revision?.revisionOf).toBe(original?.id);
    // The original row is untouched — its value did not change in place.
    const originalReread = all.find((r) => r.id === original?.id);
    expect(originalReread?.value).toBe("314.5400");
  });

  it("rejects an observation for an unknown series_id (referential integrity)", async () => {
    const db = await freshDb();
    await seedSeriesCatalog(db);
    await expect(
      db.insert(observation).values({
        seriesId: "not.a.real.series",
        periodType: "day",
        periodStart: "2026-08-28",
        periodEnd: "2026-08-28",
        fiscalYear: 2026,
        value: "1",
        publicationTime: new Date("2026-08-29T00:00:00Z"),
      }),
    ).rejects.toThrow();
  });

  it("seedObservationFixtures loads the real db/fixtures/observations/*.json snapshots, converting publicationTime to a real Date (not the raw JSON string)", async () => {
    // Fixtures now exist (the ingest workstream landed real API snapshots) —
    // this exercises the real load path, including the seed.ts fix for the
    // bug where a fixture row's publicationTime (a JSON string) was passed
    // straight to Drizzle's timestamp column mapper, which calls
    // `.toISOString()` on it and throws (`TypeError: value.toISOString is
    // not a function`) because a string has no such method.
    const db = await freshDb();
    await seedSeriesCatalog(db); // observation.series_id is FK'd to series.id.
    const count = await seedObservationFixtures(db);
    expect(count).toBeGreaterThan(0);
    const rows = await db.select().from(observation).limit(1);
    expect(rows[0]?.publicationTime).toBeInstanceOf(Date);
  });
});
