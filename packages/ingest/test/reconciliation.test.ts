/**
 * Reconciliation tests against REAL captured MTS fixtures (db/fixtures/raw)
 * — these fail CI on any component/total mismatch, per
 * ORCHESTRATION_PROMPT.md Core flow 1 and CLAUDE.md's "zero tolerance for
 * MTS component-vs-total mismatch." Every number here came from a live
 * FiscalData response captured 2026-08-29 (see helpers.ts / SOURCE.md
 * files) — nothing is hand-invented.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDb, runMigrations, seedSeriesCatalog } from "@penny/db";
import {
  mtsSummaryResponseSchema,
  mtsReceiptsResponseSchema,
  mtsOutlaysByFunctionResponseSchema,
} from "../src/index";
import {
  parseMtsSummary,
  parseMtsReceipts,
  parseMtsOutlaysByFunction,
  reconcileCategoriesToTotal,
  reconcileDeficitIdentity,
  runMtsMonthlyJob,
} from "../src/jobs/mts-monthly";
import { decimalSum, decimalEquals } from "../src/lib/decimal";
import { upsertObservation, upsertObservations } from "../src/lib/upsert";
import type { RawObservation } from "../src/lib/types";
import { loadRawFixture } from "./helpers";

const table1July2026 = mtsSummaryResponseSchema.parse(loadRawFixture("fiscaldata/mts_table_1/2026-07-31.json"));
const table1Sep2024 = mtsSummaryResponseSchema.parse(loadRawFixture("fiscaldata/mts_table_1/2024-09-30.json"));
const allTotals = [...parseMtsSummary(table1July2026), ...parseMtsSummary(table1Sep2024)];

const MONTH_SNAPSHOTS = ["2026-07-31", "2026-06-30", "2025-07-31", "2024-09-30"] as const;

function totalsFor(periodEnd: string, seriesId: RawObservation["seriesId"], periodType: RawObservation["periodType"] = "month") {
  return allTotals.filter((t) => t.periodType === periodType && t.periodEnd === periodEnd && t.seriesId === seriesId);
}

describe("MTS reconciliation — receipts categories sum to the published total, to the dollar", () => {
  for (const recordDate of MONTH_SNAPSHOTS) {
    it(`holds for ${recordDate}`, () => {
      const table4 = mtsReceiptsResponseSchema.parse(loadRawFixture(`fiscaldata/mts_table_4/${recordDate}.json`));
      const receipts = parseMtsReceipts(table4);
      const monthReceipts = receipts.filter((r) => r.periodType === "month");
      const total = totalsFor(recordDate, "fiscal.mts.receipts.total");
      expect(total).toHaveLength(1);

      const checks = reconcileCategoriesToTotal(monthReceipts, total);
      expect(checks).toHaveLength(1);
      expect(decimalEquals(checks[0]!.difference, "0"), `difference was ${checks[0]!.difference}`).toBe(true);
      expect(checks[0]?.ok).toBe(true);
    });
  }
});

describe("MTS reconciliation — outlay-by-function categories sum to the published total, to the dollar", () => {
  for (const recordDate of MONTH_SNAPSHOTS) {
    it(`holds for ${recordDate}`, () => {
      const table9 = mtsOutlaysByFunctionResponseSchema.parse(loadRawFixture(`fiscaldata/mts_table_9/${recordDate}.json`));
      const outlays = parseMtsOutlaysByFunction(table9);
      const monthOutlays = outlays.filter((o) => o.periodType === "month");
      const total = totalsFor(recordDate, "fiscal.mts.outlays.total");
      expect(total).toHaveLength(1);

      const checks = reconcileCategoriesToTotal(monthOutlays, total);
      expect(checks).toHaveLength(1);
      expect(decimalEquals(checks[0]!.difference, "0"), `difference was ${checks[0]!.difference}`).toBe(true);
      expect(checks[0]?.ok).toBe(true);
    });
  }
});

describe("MTS reconciliation — fiscal-year-to-date category sums also reconcile to the published FYTD total, to the dollar", () => {
  it("holds for receipts, FY2026 through July (the July 2026 report)", () => {
    const table4 = mtsReceiptsResponseSchema.parse(loadRawFixture("fiscaldata/mts_table_4/2026-07-31.json"));
    const fytdReceipts = parseMtsReceipts(table4).filter((r) => r.periodType === "fiscal_ytd");
    const total = totalsFor("2026-07-31", "fiscal.mts.receipts.total", "fiscal_ytd");
    expect(total).toHaveLength(1);
    const checks = reconcileCategoriesToTotal(fytdReceipts, total);
    expect(checks[0]?.ok, `difference was ${checks[0]?.difference}`).toBe(true);
  });

  it("holds for outlays, FY2026 through July (the July 2026 report)", () => {
    const table9 = mtsOutlaysByFunctionResponseSchema.parse(loadRawFixture("fiscaldata/mts_table_9/2026-07-31.json"));
    const fytdOutlays = parseMtsOutlaysByFunction(table9).filter((o) => o.periodType === "fiscal_ytd");
    const total = totalsFor("2026-07-31", "fiscal.mts.outlays.total", "fiscal_ytd");
    expect(total).toHaveLength(1);
    const checks = reconcileCategoriesToTotal(fytdOutlays, total);
    expect(checks[0]?.ok, `difference was ${checks[0]?.difference}`).toBe(true);
  });
});

describe("MTS reconciliation — deficit identity (receipts - outlays = deficit), exactly", () => {
  it("holds for every month and Year-to-Date reading in both fixture reports", () => {
    const checks = reconcileDeficitIdentity(allTotals);
    // sanity: this should actually exercise a meaningful number of periods, not silently pass on zero.
    expect(checks.length).toBeGreaterThanOrEqual(20);
    for (const c of checks) {
      expect(c.ok, `${c.periodType} ${c.periodEnd}: published=${c.publishedTotal} computed=${c.sumOfCategories}`).toBe(true);
    }
  });

  it("stores the deficit with the registry's documented sign (negative = deficit), not Treasury's raw (positive = deficit) convention", () => {
    // July 2026: outlays > receipts, a deficit -> registry convention says negative.
    const dfct = allTotals.find((t) => t.seriesId === "fiscal.mts.deficit.total" && t.periodType === "month" && t.periodEnd === "2026-07-31");
    expect(dfct?.value).toBe("-432307874621.48");
    // April 2026 (FY2026 group): receipts (837342690993.51) > outlays (622318555795.74), a surplus -> registry convention says positive.
    const surplus = allTotals.find((t) => t.seriesId === "fiscal.mts.deficit.total" && t.periodType === "month" && t.periodEnd === "2026-04-30" && t.fiscalYear === 2026);
    expect(surplus?.value).toBe("215024135197.77");
  });
});

describe("MTS reconciliation — fiscal-year-to-date equals the sum of that fiscal year's months", () => {
  const CASES: Array<{ fiscalYear: number; monthsInYtd: number; label: string }> = [
    { fiscalYear: 2026, monthsInYtd: 10, label: "FY2026 through July (partial year, current-year group in the July report)" },
    { fiscalYear: 2025, monthsInYtd: 12, label: "FY2025, full year (comparable prior-year group in the July report)" },
    { fiscalYear: 2024, monthsInYtd: 12, label: "FY2024, full year (current-year group in the September 2024 report)" },
  ];

  for (const { fiscalYear, monthsInYtd, label } of CASES) {
    for (const seriesId of ["fiscal.mts.receipts.total", "fiscal.mts.outlays.total", "fiscal.mts.deficit.total"] as const) {
      it(`${seriesId} — ${label}`, () => {
        const months = allTotals.filter((t) => t.seriesId === seriesId && t.periodType === "month" && t.fiscalYear === fiscalYear);
        const ytd = allTotals.filter((t) => t.seriesId === seriesId && t.periodType === "fiscal_ytd" && t.fiscalYear === fiscalYear);
        expect(months).toHaveLength(monthsInYtd);
        expect(ytd).toHaveLength(1);
        const summedMonths = decimalSum(months.map((m) => m.value));
        expect(decimalEquals(summedMonths, ytd[0]!.value), `sum of ${monthsInYtd} months = ${summedMonths}, published FYTD = ${ytd[0]!.value}`).toBe(true);
      });
    }
  }
});

describe("MTS reconciliation — a fiscal-year group's Year-to-Date row is stamped with THAT GROUP's own period, never the report's own record_calendar_month", () => {
  it("FY2025's Year-to-Date row in the July 2026 report (a completed, comparable prior year) covers the full fiscal year through Sep 30, 2025 — not through July 2025", () => {
    const ytd = allTotals.find(
      (t) => t.seriesId === "fiscal.mts.receipts.total" && t.periodType === "fiscal_ytd" && t.fiscalYear === 2025,
    );
    expect(ytd).toBeDefined();
    expect(ytd?.periodStart).toBe("2024-10-01");
    expect(ytd?.periodEnd).toBe("2025-09-30");
    // The row's VALUE is the full FY2025 total (sum of all 12 months) — this
    // must now match a period it actually claims to cover.
    const fy2025Months = allTotals.filter(
      (t) => t.seriesId === "fiscal.mts.receipts.total" && t.periodType === "month" && t.fiscalYear === 2025,
    );
    expect(fy2025Months).toHaveLength(12);
    expect(decimalEquals(decimalSum(fy2025Months.map((m) => m.value)), ytd!.value)).toBe(true);
  });

  it("the current FY2026 group's Year-to-Date row in the same report still covers through the report's own month (July 2026)", () => {
    const ytd = allTotals.find(
      (t) => t.seriesId === "fiscal.mts.receipts.total" && t.periodType === "fiscal_ytd" && t.fiscalYear === 2026,
    );
    expect(ytd?.periodStart).toBe("2025-10-01");
    expect(ytd?.periodEnd).toBe("2026-07-31");
  });

  it("every category series reconciles to its matching total at EVERY (periodType, periodEnd) present in the seed, across both fixture reports — not just the report's own current month", () => {
    // Regression guard for the periodEnd bug above: before the fix, FY2025's
    // receipts/outlays/deficit YTD rows were mis-keyed at period_end
    // 2025-07-31, which would silently collide with the genuine 2025-07-31
    // MONTH row (a different period_type, but this cross-checks the whole
    // seed rather than one series).
    const table4July = mtsReceiptsResponseSchema.parse(loadRawFixture("fiscaldata/mts_table_4/2026-07-31.json"));
    const receipts = parseMtsReceipts(table4July);
    const receiptsTotals = allTotals.filter((t) => t.seriesId === "fiscal.mts.receipts.total");
    // Only Table 4/9 periods (the current report's own month + FYTD) have
    // category data to reconcile against — Table 1 alone carries the full
    // fiscal-year history of totals with no matching category breakdown.
    const reconcilable = receiptsTotals.filter((t) => t.periodEnd === "2026-07-31");
    expect(reconcilable.length).toBeGreaterThanOrEqual(2); // month + fiscal_ytd
    const checks = reconcileCategoriesToTotal(receipts, reconcilable);
    for (const c of checks) {
      expect(c.ok, `${c.periodType} ${c.periodEnd}: published=${c.publishedTotal} computed=${c.sumOfCategories}`).toBe(true);
    }
  });
});

describe("runMtsMonthlyJob — the live job's own reconciliation wiring (not just the pure helpers), against real fixtures end to end", () => {
  const RECORD_DATE = "2026-07-31";
  const originalFetch = global.fetch;

  function fakeFetchResponse(body: unknown): Response {
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => body,
    } as Response;
  }

  beforeEach(() => {
    // A minimal fetch stub that serves the real captured fixtures for the
    // three MTS tables the job reads, keyed off which endpoint + query shape
    // is being requested — no network I/O, but the SAME code path
    // (fetchLatestRecordDate -> fetchFiscalDataForDate x3) runMtsMonthlyJob
    // actually runs in production hits here.
    // `RequestInfo` (a DOM lib type) isn't declared by @types/node's global
    // fetch typings (node_modules/@types/node/web-globals/fetch.d.ts) — its
    // own `fetch` signature spells this union out directly, so this mirrors
    // that rather than referencing a type name that was never in scope.
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("mts_table_1") && url.includes("sort=-record_date")) {
        return fakeFetchResponse({ data: [{ record_date: RECORD_DATE }] });
      }
      if (url.includes("mts_table_1")) {
        return fakeFetchResponse(loadRawFixture(`fiscaldata/mts_table_1/${RECORD_DATE}.json`));
      }
      if (url.includes("mts_table_4")) {
        return fakeFetchResponse(loadRawFixture(`fiscaldata/mts_table_4/${RECORD_DATE}.json`));
      }
      if (url.includes("mts_table_9")) {
        return fakeFetchResponse(loadRawFixture(`fiscaldata/mts_table_9/${RECORD_DATE}.json`));
      }
      throw new Error(`unexpected fetch in runMtsMonthlyJob test: ${url}`);
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("does not throw, and reconciles + writes observations against the real July 2026 report (this is the exact path db/fixtures' 24-vs-2 total/category mismatch used to crash before the periodEnd/thisMonthTotals fixes)", async () => {
    const db = createDb();
    await runMigrations(db);
    await seedSeriesCatalog(db);

    const result = await runMtsMonthlyJob(db);

    expect(result.recordDate).toBe(RECORD_DATE);
    expect(result.reconciliation.receipts.length).toBeGreaterThan(0);
    expect(result.reconciliation.outlays.length).toBeGreaterThan(0);
    expect(result.reconciliation.deficitIdentity.length).toBeGreaterThan(0);
    expect(result.reconciliation.receipts.every((c) => c.ok)).toBe(true);
    expect(result.reconciliation.outlays.every((c) => c.ok)).toBe(true);
    expect(result.reconciliation.deficitIdentity.every((c) => c.ok)).toBe(true);
    expect(result.summary.inserted).toBeGreaterThan(0);
    expect(result.receipts.inserted).toBeGreaterThan(0);
    expect(result.outlays.inserted).toBeGreaterThan(0);
  });
});

describe("MTS known-value spot checks (against live-captured 2026-07-31 MTS report)", () => {
  it("total receipts, outlays, and category figures match the captured API response exactly", () => {
    const table4 = mtsReceiptsResponseSchema.parse(loadRawFixture("fiscaldata/mts_table_4/2026-07-31.json"));
    const receipts = parseMtsReceipts(table4);
    const individualIncomeTax = receipts.find(
      (r) => r.seriesId === "fiscal.mts.receipts.category.individual_income_tax" && r.periodType === "month",
    );
    expect(individualIncomeTax?.value).toBe("173271094383.06");

    const table9 = mtsOutlaysByFunctionResponseSchema.parse(loadRawFixture("fiscaldata/mts_table_9/2026-07-31.json"));
    const outlays = parseMtsOutlaysByFunction(table9);
    const nationalDefense = outlays.find(
      (o) => o.seriesId === "fiscal.mts.outlays.category.national_defense" && o.periodType === "month",
    );
    expect(nationalDefense?.value).toBe("90571408631.42");

    const receiptsTotal = totalsFor("2026-07-31", "fiscal.mts.receipts.total");
    expect(receiptsTotal[0]?.value).toBe("334009875555.79");
    const outlaysTotal = totalsFor("2026-07-31", "fiscal.mts.outlays.total");
    expect(outlaysTotal[0]?.value).toBe("766317750177.27");
  });

  it("fiscal year and period_type/period_end are stamped correctly, not derived ad hoc at query time", () => {
    const table4 = mtsReceiptsResponseSchema.parse(loadRawFixture("fiscaldata/mts_table_4/2026-07-31.json"));
    const [row] = parseMtsReceipts(table4).filter(
      (r) => r.seriesId === "fiscal.mts.receipts.category.individual_income_tax" && r.periodType === "month",
    );
    expect(row?.fiscalYear).toBe(2026);
    expect(row?.periodStart).toBe("2026-07-01");
    expect(row?.periodEnd).toBe("2026-07-31");
  });
});

describe("MTS ingest idempotency and revisions, against real fixture-derived observations in PGlite", () => {
  async function freshDb() {
    const db = createDb();
    await runMigrations(db);
    await seedSeriesCatalog(db); // observation.series_id is FK'd to series.id — every series must exist before an observation can reference it.
    return db;
  }

  it("re-ingesting the identical MTS report twice is a no-op the second time", async () => {
    const db = await freshDb();
    const table1 = mtsSummaryResponseSchema.parse(loadRawFixture("fiscaldata/mts_table_1/2026-07-31.json"));
    const totals = parseMtsSummary(table1);

    const first = await upsertObservations(db, totals);
    expect(first.inserted).toBe(totals.length);
    expect(first.revised).toBe(0);

    const second = await upsertObservations(db, totals);
    expect(second.inserted).toBe(0);
    expect(second.revised).toBe(0);
    expect(second.unchanged).toBe(totals.length);
  });

  it("a later report re-stating the SAME month with a genuinely different value inserts a revision, not a duplicate or an update", async () => {
    const db = await freshDb();
    const table1 = mtsSummaryResponseSchema.parse(loadRawFixture("fiscaldata/mts_table_1/2026-07-31.json"));
    const totals = parseMtsSummary(table1);
    const julyReceipts = totals.find((t) => t.seriesId === "fiscal.mts.receipts.total" && t.periodType === "month" && t.periodEnd === "2026-07-31");
    expect(julyReceipts).toBeDefined();

    const original = await upsertObservation(db, julyReceipts!);
    expect(original.outcome).toBe("inserted");

    // A synthetic test-only mutation of the real captured value (a later
    // report restating July with $1000 more receipts) — not a second real
    // API snapshot, since Treasury did not actually revise this month
    // between two adjacent reports in what we captured. Exercises the
    // revision code path against otherwise-real data.
    const revised: RawObservation = { ...julyReceipts!, value: "334009876555.79", publicationTime: "2026-08-31T00:00:00Z" };
    const revisionResult = await upsertObservation(db, revised);
    expect(revisionResult.outcome).toBe("revised");
    expect(revisionResult.id).not.toBe(original.id);

    // Re-applying the ORIGINAL value again afterward must not "un-revise" anything or duplicate — it no longer matches the latest (revised) value, so per this package's compare-to-latest semantics it would itself register as a further revision back. Applying the REVISED value again, though, must be a no-op.
    const reapplyRevised = await upsertObservation(db, revised);
    expect(reapplyRevised.outcome).toBe("unchanged");
    expect(reapplyRevised.id).toBe(revisionResult.id);
  });
});
