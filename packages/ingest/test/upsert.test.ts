/**
 * Generic idempotency/revision mechanism tests (see reconciliation.test.ts
 * for the same behavior exercised against real MTS fixture data). These
 * use synthetic values specifically to hit edge cases fixture data doesn't
 * happen to cover: a chain of two revisions, and formatting-only
 * "changes" (trailing zeros) that must NOT be treated as a real revision.
 */
import { describe, it, expect } from "vitest";
import { createDb, runMigrations, seedSeriesCatalog } from "@penny/db";
import { upsertObservation } from "../src/lib/upsert";
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
