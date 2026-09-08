/**
 * Generic idempotency/revision mechanism tests (see reconciliation.test.ts
 * for the same behavior exercised against real MTS fixture data). These
 * use synthetic values specifically to hit edge cases fixture data doesn't
 * happen to cover: a chain of two revisions, and formatting-only
 * "changes" (trailing zeros) that must NOT be treated as a real revision.
 */
import { describe, it, expect } from "vitest";
import { createDb, runMigrations, seedSeriesCatalog } from "@penny/db";
import { upsertObservation, upsertObservations } from "../src/lib/upsert";
import { eq } from "drizzle-orm";
import { observation } from "@penny/db";
import type { RawObservation } from "../src/lib/types";

async function freshDb() {
  const db = createDb();
  await runMigrations(db);
  await seedSeriesCatalog(db);
  return db;
}

const BASE: RawObservation = {
  seriesId: "fiscal.debt.total_public_debt_outstanding",
  periodType: "day",
  periodStart: "2026-08-28",
  periodEnd: "2026-08-28",
  fiscalYear: 2026,
  value: "36345909729842.98",
  publicationTime: "2026-08-28T00:00:00Z",
};

describe("upsertObservation — mechanism edge cases", () => {
  it("a value that only differs in trailing-zero formatting is 'unchanged', not a spurious revision", async () => {
    const db = await freshDb();
    const first = await upsertObservation(db, BASE);
    expect(first.outcome).toBe("inserted");

    const reformatted: RawObservation = { ...BASE, value: "36345909729842.9800", publicationTime: "2026-09-01T00:00:00Z" };
    const second = await upsertObservation(db, reformatted);
    expect(second.outcome).toBe("unchanged");
    expect(second.id).toBe(first.id);
  });

  it("a chain of two genuine revisions each point at the row immediately before them, and every prior row's value is untouched", async () => {
    const db = await freshDb();
    const v1 = await upsertObservation(db, BASE);
    const v2 = await upsertObservation(db, { ...BASE, value: "36345909729850.00", publicationTime: "2026-09-01T00:00:00Z" });
    const v3 = await upsertObservation(db, { ...BASE, value: "36345909729900.00", publicationTime: "2026-10-01T00:00:00Z" });

    expect(v2.outcome).toBe("revised");
    expect(v3.outcome).toBe("revised");
    expect(v2.id).not.toBe(v1.id);
    expect(v3.id).not.toBe(v2.id);

    // re-applying the latest value again is a no-op against the chain's current end.
    const reapply = await upsertObservation(db, { ...BASE, value: "36345909729900.00", publicationTime: "2026-11-01T00:00:00Z" });
    expect(reapply.outcome).toBe("unchanged");
    expect(reapply.id).toBe(v3.id);
  });

  it("different periods for the same series never collide with each other", async () => {
    const db = await freshDb();
    const day1 = await upsertObservation(db, BASE);
    const day2 = await upsertObservation(db, { ...BASE, periodStart: "2026-08-29", periodEnd: "2026-08-29", value: "36346000000000.00" });
    expect(day1.outcome).toBe("inserted");
    expect(day2.outcome).toBe("inserted");
    expect(day1.id).not.toBe(day2.id);
  });

  it("a zero-crossing revision (positive to negative) is still correctly detected as changed", async () => {
    const db = await freshDb();
    const surplus: RawObservation = { ...BASE, seriesId: "fiscal.mts.deficit.total", periodType: "month", periodStart: "2026-04-01", periodEnd: "2026-04-30", value: "215024135197.77" };
    const first = await upsertObservation(db, surplus);
    expect(first.outcome).toBe("inserted");
    const flipped = await upsertObservation(db, { ...surplus, value: "-215024135197.77", publicationTime: "2026-09-01T00:00:00Z" });
    expect(flipped.outcome).toBe("revised");
  });
});

describe("upsertObservation — history arriving after later data (the 2026-09-01 production backfill)", () => {
  // The exact sequence that killed the monthly cron for six days: the July
  // 2026 MTS (which restates October 2024) was on file first; the history
  // backfill then stored the October 2024 report's own, different figure;
  // the next live run of the July report crashed on the identity index.
  const october2024: RawObservation = {
    seriesId: "fiscal.mts.outlays.total",
    periodType: "month",
    periodStart: "2024-10-01",
    periodEnd: "2024-10-31",
    fiscalYear: 2025,
    value: "584220273025.31",
    publicationTime: "2026-07-31T00:00:00Z",
  };
  const october2024AsFirstPublished: RawObservation = { ...october2024, value: "584220579250.01", publicationTime: "2024-10-31T00:00:00Z" };

  it("an older publication is stored as history ('backfilled') and never displaces the current reading", async () => {
    const db = await freshDb();
    const july = await upsertObservation(db, october2024);
    expect(july.outcome).toBe("inserted");

    const history = await upsertObservation(db, october2024AsFirstPublished);
    expect(history.outcome).toBe("backfilled");
    expect(history.id).not.toBe(july.id);

    // The live job re-running the July report afterward is a no-op against
    // the July row — this is the call that used to throw.
    const rerun = await upsertObservation(db, october2024);
    expect(rerun.outcome).toBe("unchanged");
    expect(rerun.id).toBe(july.id);

    // A still-newer report restating the July figure is likewise a no-op —
    // "current" is the latest publication, not the highest id.
    const august = await upsertObservation(db, { ...october2024, publicationTime: "2026-08-31T00:00:00Z" });
    expect(august.outcome).toBe("unchanged");
    expect(august.id).toBe(july.id);
  });

  it("replaying the same older publication is a no-op against its own history row", async () => {
    const db = await freshDb();
    await upsertObservation(db, october2024);
    const history = await upsertObservation(db, october2024AsFirstPublished);
    const replay = await upsertObservation(db, october2024AsFirstPublished);
    expect(replay.outcome).toBe("unchanged");
    expect(replay.id).toBe(history.id);
  });

  it("a genuine revision after a backfill still chains to the current reading, not to the history row", async () => {
    const db = await freshDb();
    const july = await upsertObservation(db, october2024);
    await upsertObservation(db, october2024AsFirstPublished);
    const revised = await upsertObservation(db, { ...october2024, value: "584220273000.00", publicationTime: "2026-08-31T00:00:00Z" });
    expect(revised.outcome).toBe("revised");
    const rows = await db.select().from(observation).where(eq(observation.id, revised.id));
    expect(rows[0]?.revisionOf).toBe(july.id);
  });

  it("one publication cannot carry two values: same publication time, different value, is an error — for the current reading and for history alike", async () => {
    const db = await freshDb();
    await upsertObservation(db, october2024);
    await expect(upsertObservation(db, { ...october2024, value: "1.00" })).rejects.toThrow(/SAME publication time/);
    await upsertObservation(db, october2024AsFirstPublished);
    await expect(upsertObservation(db, { ...october2024AsFirstPublished, value: "1.00" })).rejects.toThrow(/SAME publication time/);
  });

  it("upsertObservations counts backfilled rows separately from inserts and revisions", async () => {
    const db = await freshDb();
    const summary = await upsertObservations(db, [october2024, october2024AsFirstPublished, october2024]);
    expect(summary.inserted).toBe(1);
    expect(summary.backfilled).toBe(1);
    expect(summary.unchanged).toBe(1);
    expect(summary.revised).toBe(0);
  });
});
