/**
 * Tests for the Daily Treasury Statement Deposits & Withdrawals ingest
 * (atlas beat 3, "When does the money move?"). Every numeric fixture here
 * is a real captured API response (db/fixtures/raw/fiscaldata/
 * deposits_withdrawals_operating_cash) fetched live 2026-08-29/2026-09-01
 * covering 2026-05-01 through 2026-08-28 — nothing is hand-invented. See
 * that directory and src/fiscaldata/deposits-withdrawals.ts's doc comment
 * for the verified source shape.
 */
import { describe, it, expect } from "vitest";
import { createDb, runMigrations, seedSeriesCatalog } from "@penny/db";
import { getSeries, incomparabilityReason, citationFor, type SeriesId } from "@penny/registry";
import { dtsDepositsWithdrawalsResponseSchema, type DtsDepositsWithdrawalsRecord } from "../src/fiscaldata/deposits-withdrawals";
import { parseDtsDepositsWithdrawals, splitIntoMonthChunks } from "../src/jobs/dts-cadence-daily";
import { decimalSum, decimalEquals } from "../src/lib/decimal";
import { upsertObservation, upsertObservations } from "../src/lib/upsert";
import type { RawObservation } from "../src/lib/types";
import { loadRawFixture } from "./helpers";

const DTS_MONTHS = [
  "2026-05-01_to_2026-05-31",
  "2026-06-01_to_2026-06-30",
  "2026-07-01_to_2026-07-31",
  "2026-08-01_to_2026-08-31",
] as const;

function loadMonth(range: string): DtsDepositsWithdrawalsRecord[] {
  return dtsDepositsWithdrawalsResponseSchema.parse(
    loadRawFixture(`fiscaldata/deposits_withdrawals_operating_cash/${range}.json`),
  ).data;
}

const allRawRows: DtsDepositsWithdrawalsRecord[] = DTS_MONTHS.flatMap(loadMonth);
const allObservations = parseDtsDepositsWithdrawals({ data: allRawRows });

function seriesFor(seriesId: SeriesId, periodEnd: string): RawObservation | undefined {
  return allObservations.find((o) => o.seriesId === seriesId && o.periodEnd === periodEnd);
}

describe("DTS deposits/withdrawals — derivation correctness (hand-computed against the raw fixtures)", () => {
  it("2026-08-27: a heavy debt-settlement day — public debt cash issues/redemptions dwarf every other operating flow combined", () => {
    // Hand-computed from the raw fixture: Total Deposits row = 288576,
    // Public Debt Cash Issues row = 278792 -> excl-debt = 9784. Total
    // Withdrawals row = 297207, Public Debt Cash Redemp row = 274205 ->
    // excl-debt = 23002. (All in whole millions, as Treasury publishes.)
    expect(seriesFor("fiscal.dts.public_debt_cash_issues", "2026-08-27")?.value).toBe("278792");
    expect(seriesFor("fiscal.dts.public_debt_cash_redemptions", "2026-08-27")?.value).toBe("274205");
    expect(seriesFor("fiscal.dts.deposits_operating_excl_debt", "2026-08-27")?.value).toBe("9784");
    expect(seriesFor("fiscal.dts.withdrawals_operating_excl_debt", "2026-08-27")?.value).toBe("23002");

    // The story this series exists to tell: debt issuance (278792) is
    // roughly 28x every other deposit combined (9784) on this day.
    const issues = Number(seriesFor("fiscal.dts.public_debt_cash_issues", "2026-08-27")?.value);
    const otherDeposits = Number(seriesFor("fiscal.dts.deposits_operating_excl_debt", "2026-08-27")?.value);
    expect(issues / otherDeposits).toBeGreaterThan(20);
  });

  it("2026-05-01: a light debt-settlement day — hand-computed against the raw fixture", () => {
    // Hand-computed: Total Deposits = 43050, Public Debt Cash Issues =
    // 1865 -> excl-debt = 41185. Total Withdrawals = 155122, Public Debt
    // Cash Redemp = 3746 -> excl-debt = 151376.
    expect(seriesFor("fiscal.dts.public_debt_cash_issues", "2026-05-01")?.value).toBe("1865");
    expect(seriesFor("fiscal.dts.deposits_operating_excl_debt", "2026-05-01")?.value).toBe("41185");
    expect(seriesFor("fiscal.dts.public_debt_cash_redemptions", "2026-05-01")?.value).toBe("3746");
    expect(seriesFor("fiscal.dts.withdrawals_operating_excl_debt", "2026-05-01")?.value).toBe("151376");
  });

  it("fiscal year, period_type, and period_end are stamped correctly, not derived ad hoc at query time", () => {
    const row = seriesFor("fiscal.dts.deposits_operating_excl_debt", "2026-08-27");
    expect(row?.fiscalYear).toBe(2026);
    expect(row?.periodType).toBe("day");
    expect(row?.periodStart).toBe("2026-08-27");
    expect(row?.publicationTime).toBe("2026-08-27T00:00:00Z");
  });

  it("every derived excl-debt value reconciles EXACTLY to (published total row) - (published debt row), across all 84 business days in the fixture — not just the two spot-checked days", () => {
    const byDate = new Map<string, DtsDepositsWithdrawalsRecord[]>();
    for (const r of allRawRows) {
      const list = byDate.get(r.record_date);
      if (list) list.push(r);
      else byDate.set(r.record_date, [r]);
    }
    expect(byDate.size).toBeGreaterThanOrEqual(80); // sanity: this must actually exercise ~84 business days, not silently pass on a handful.

    let checked = 0;
    for (const [date, rows] of byDate) {
      const totalDep = rows.find((r) => r.account_type === "Treasury General Account Total Deposits")!;
      const totalWd = rows.find((r) => r.account_type === "Treasury General Account Total Withdrawals")!;
      const debtIssue = rows.find((r) => r.transaction_catg === "Public Debt Cash Issues (Table IIIB)")!;
      const debtRedeem = rows.find((r) => r.transaction_catg === "Public Debt Cash Redemp. (Table IIIB)")!;

      const expectedExclDep = decimalSum([totalDep.transaction_today_amt, `-${debtIssue.transaction_today_amt}`]);
      const expectedExclWd = decimalSum([totalWd.transaction_today_amt, `-${debtRedeem.transaction_today_amt}`]);

      const actualExclDep = seriesFor("fiscal.dts.deposits_operating_excl_debt", date)!.value;
      const actualExclWd = seriesFor("fiscal.dts.withdrawals_operating_excl_debt", date)!.value;

      expect(decimalEquals(actualExclDep, expectedExclDep), `${date}: excl-debt deposits`).toBe(true);
      expect(decimalEquals(actualExclWd, expectedExclWd), `${date}: excl-debt withdrawals`).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(80);
  });

  it("public_debt_cash_issues + deposits_operating_excl_debt reconstructs the published Total Deposits row exactly (the two are meant to be summed — same accounting_concept by design)", () => {
    const byDate = new Map<string, DtsDepositsWithdrawalsRecord[]>();
    for (const r of allRawRows) {
      const list = byDate.get(r.record_date);
      if (list) list.push(r);
      else byDate.set(r.record_date, [r]);
    }
    for (const [date, rows] of byDate) {
      const totalDep = rows.find((r) => r.account_type === "Treasury General Account Total Deposits")!;
      const reconstructed = decimalSum([
        seriesFor("fiscal.dts.deposits_operating_excl_debt", date)!.value,
        seriesFor("fiscal.dts.public_debt_cash_issues", date)!.value,
      ]);
      expect(decimalEquals(reconstructed, totalDep.transaction_today_amt), `${date}`).toBe(true);
    }
  });
});

describe("DTS deposits/withdrawals — gap behavior (weekends and federal holidays are absent, never a zero)", () => {
  it("no observation exists for a Saturday, a Sunday, or a federal holiday inside the fixture's range", () => {
    for (const seriesId of [
      "fiscal.dts.deposits_operating_excl_debt",
      "fiscal.dts.withdrawals_operating_excl_debt",
      "fiscal.dts.public_debt_cash_issues",
      "fiscal.dts.public_debt_cash_redemptions",
    ] as const) {
      expect(seriesFor(seriesId, "2026-05-02")).toBeUndefined(); // Saturday
      expect(seriesFor(seriesId, "2026-05-03")).toBeUndefined(); // Sunday
      expect(seriesFor(seriesId, "2026-05-25")).toBeUndefined(); // Memorial Day
      expect(seriesFor(seriesId, "2026-06-19")).toBeUndefined(); // Juneteenth
    }
  });

  it("covers 84 business days per series over the 4-month fixture range — fewer than the 122 calendar days in range, proving gaps were genuinely skipped", () => {
    const daysInRange = Math.round((new Date("2026-08-28").getTime() - new Date("2026-05-01").getTime()) / 86_400_000) + 1;
    for (const seriesId of [
      "fiscal.dts.deposits_operating_excl_debt",
      "fiscal.dts.withdrawals_operating_excl_debt",
      "fiscal.dts.public_debt_cash_issues",
      "fiscal.dts.public_debt_cash_redemptions",
    ] as const) {
      const rows = allObservations.filter((o) => o.seriesId === seriesId);
      expect(rows).toHaveLength(84);
      expect(rows.length).toBeLessThan(daysInRange);
      expect(rows.every((o) => /^-?\d+$/.test(o.value))).toBe(true); // a plain whole-million integer string — never the "null" sentinel, never empty.
    }
  });

  it("a business day present in the response but missing one of the four required rows throws loudly rather than silently emitting a partial derivation", () => {
    const dayRows = allRawRows.filter((r) => r.record_date === "2026-08-27");
    const withoutDebtIssues = dayRows.filter(
      (r) => !(r.account_type === "Treasury General Account (TGA)" && r.transaction_catg === "Public Debt Cash Issues (Table IIIB)"),
    );
    expect(() => parseDtsDepositsWithdrawals({ data: withoutDebtIssues })).toThrow(/missing one of the four required rows/);
  });

  it("a required row present but carrying the FISCAL_DATA_NULL sentinel is treated as a gap for that day only, not a zero", () => {
    const dayRows = allRawRows.filter((r) => r.record_date === "2026-08-27");
    const nulledOut = dayRows.map((r) =>
      r.account_type === "Treasury General Account Total Deposits" ? { ...r, transaction_today_amt: "null" } : r,
    );
    const observations = parseDtsDepositsWithdrawals({ data: nulledOut });
    expect(observations.find((o) => o.periodEnd === "2026-08-27")).toBeUndefined();
  });
});

describe("DTS deposits/withdrawals — citation fields (every number traces to a cited, defined series)", () => {
  const IDS = [
    "fiscal.dts.deposits_operating_excl_debt",
    "fiscal.dts.withdrawals_operating_excl_debt",
    "fiscal.dts.public_debt_cash_issues",
    "fiscal.dts.public_debt_cash_redemptions",
  ] as const;

  it("every series is defined in the registry with a full citation, unit, and magnitude", () => {
    for (const id of IDS) {
      const def = getSeries(id);
      expect(def, `${id} must be defined`).toBeDefined();
      expect(def?.unit).toBe("usd");
      expect(def?.magnitude).toBe("millions");
      expect(def?.cadence).toBe("daily");
      expect(def?.citation.length).toBeGreaterThan(10);
      expect(def?.agency).toContain("Treasury");
      expect(citationFor(id, "2026-09-01")).toContain("Accessed 2026-09-01");
    }
  });

  it("deposits/withdrawals excl-debt series share their accounting_concept with the matching public-debt series (summable back to the published total), and are marked incomparable with the MTS receipt/outlay totals (different accounting basis)", () => {
    expect(getSeries("fiscal.dts.deposits_operating_excl_debt")?.accountingConcept).toBe("cash_deposit");
    expect(getSeries("fiscal.dts.public_debt_cash_issues")?.accountingConcept).toBe("cash_deposit");
    expect(getSeries("fiscal.dts.withdrawals_operating_excl_debt")?.accountingConcept).toBe("cash_withdrawal");
    expect(getSeries("fiscal.dts.public_debt_cash_redemptions")?.accountingConcept).toBe("cash_withdrawal");

    // Same concept -> the generic guard allows combining (summable, by design).
    expect(incomparabilityReason("fiscal.dts.deposits_operating_excl_debt", "fiscal.dts.public_debt_cash_issues")).toBeNull();

    // Different concept from MTS receipts/outlays, AND an explicit declared reason (not just the generic fallback).
    const depositsVsReceipts = incomparabilityReason("fiscal.dts.deposits_operating_excl_debt", "fiscal.mts.receipts.total");
    expect(depositsVsReceipts).not.toBeNull();
    expect(depositsVsReceipts).toContain("basis");

    const withdrawalsVsOutlays = incomparabilityReason("fiscal.dts.withdrawals_operating_excl_debt", "fiscal.mts.outlays.total");
    expect(withdrawalsVsOutlays).not.toBeNull();
    expect(withdrawalsVsOutlays).toContain("basis");
  });

  it("public debt cash issues/redemptions are marked incomparable with the debt-outstanding BALANCE series (flow vs. stock)", () => {
    const issuesVsStock = incomparabilityReason("fiscal.dts.public_debt_cash_issues", "fiscal.debt.total_public_debt_outstanding");
    expect(issuesVsStock).not.toBeNull();
    expect(issuesVsStock).toMatch(/stock|flow/i);
  });
});

describe("DTS deposits/withdrawals — idempotency and revisions, against real fixture-derived observations in PGlite", () => {
  async function freshDb() {
    const db = createDb();
    await runMigrations(db);
    await seedSeriesCatalog(db); // observation.series_id is FK'd to series.id — every series (including the two new accounting_concept values) must exist and be insertable before an observation can reference it.
    return db;
  }

  it("seedSeriesCatalog accepts the two new accounting_concept enum values (cash_deposit, cash_withdrawal) without a Postgres enum violation", async () => {
    const db = await freshDb();
    for (const id of [
      "fiscal.dts.deposits_operating_excl_debt",
      "fiscal.dts.withdrawals_operating_excl_debt",
      "fiscal.dts.public_debt_cash_issues",
      "fiscal.dts.public_debt_cash_redemptions",
    ] as const) {
      const row = await upsertObservation(db, seriesFor(id, "2026-08-27")!);
      expect(row.outcome).toBe("inserted");
    }
  });

  it("re-ingesting the identical 4-month fixture twice is a no-op the second time (336 observations, 0 revised, 0 re-inserted)", async () => {
    const db = await freshDb();
    const first = await upsertObservations(db, allObservations);
    expect(first.inserted).toBe(allObservations.length);
    expect(first.revised).toBe(0);

    const second = await upsertObservations(db, allObservations);
    expect(second.inserted).toBe(0);
    expect(second.revised).toBe(0);
    expect(second.unchanged).toBe(allObservations.length);
  });

  it("a later run re-stating the SAME day with a genuinely different value inserts a revision, not a duplicate or an update", async () => {
    const db = await freshDb();
    const original = seriesFor("fiscal.dts.public_debt_cash_issues", "2026-08-27")!;

    const firstResult = await upsertObservation(db, original);
    expect(firstResult.outcome).toBe("inserted");

    // A synthetic test-only mutation (Treasury does not actually revise a
    // published DTS day; this exercises the revision code path against
    // otherwise-real data, same approach as reconciliation.test.ts's MTS
    // revision test).
    const revised: RawObservation = { ...original, value: "278800", publicationTime: "2026-08-28T00:00:00Z" };
    const revisionResult = await upsertObservation(db, revised);
    expect(revisionResult.outcome).toBe("revised");
    expect(revisionResult.id).not.toBe(firstResult.id);

    const reapplyRevised = await upsertObservation(db, revised);
    expect(reapplyRevised.outcome).toBe("unchanged");
    expect(reapplyRevised.id).toBe(revisionResult.id);
  });
});

describe("splitIntoMonthChunks — calendar-month-aligned chunking so no single FiscalData request exceeds the politeness ceiling", () => {
  it("a range within one calendar month is a single chunk, bounded by the exact requested dates (not widened to the full month)", () => {
    expect(splitIntoMonthChunks("2026-08-05", "2026-08-20")).toEqual([{ from: "2026-08-05", to: "2026-08-20" }]);
  });

  it("a range spanning multiple months splits at calendar-month boundaries, first/last chunk clipped to the requested dates", () => {
    expect(splitIntoMonthChunks("2026-06-15", "2026-08-10")).toEqual([
      { from: "2026-06-15", to: "2026-06-30" },
      { from: "2026-07-01", to: "2026-07-31" },
      { from: "2026-08-01", to: "2026-08-10" },
    ]);
  });

  it("a range spanning a calendar-year boundary rolls the year over correctly", () => {
    expect(splitIntoMonthChunks("2025-11-20", "2026-01-10")).toEqual([
      { from: "2025-11-20", to: "2025-11-30" },
      { from: "2025-12-01", to: "2025-12-31" },
      { from: "2026-01-01", to: "2026-01-10" },
    ]);
  });

  it("a single-day range still produces exactly one chunk", () => {
    expect(splitIntoMonthChunks("2026-08-27", "2026-08-27")).toEqual([{ from: "2026-08-27", to: "2026-08-27" }]);
  });
});
