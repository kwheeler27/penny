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
  extractOwnPeriodMtsTotals,
  assertReceiptsCategoriesPresent,
  OUTLAYS_BY_FUNCTION_LABELS,
} from "../src/jobs/mts-monthly";
import { decimalSum, decimalEquals, decimalSubtract } from "../src/lib/decimal";
import { upsertObservation, upsertObservations } from "../src/lib/upsert";
import type { RawObservation } from "../src/lib/types";
import { loadRawFixture, loadObservationFixture } from "./helpers";

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

// ---------------------------------------------------------------------------
// Full-history backfill reconciliation (Penny Atlas beat 1) — every one of
// the 137 real MTS reports FiscalData publishes for record_date
// 2015-03-31..2026-07-31 (captured live 2026-09-01;
// db/fixtures/raw/fiscaldata/mts_table_{1,4,9}/2015-03-31_to_2026-07-31.json),
// not just the 4 hand-picked snapshots the describe blocks above exercise.
// ---------------------------------------------------------------------------

describe("MTS full-history backfill (2015-03..2026-07) — reconciliation across every backfilled month", () => {
  const RANGE_FILE = "2015-03-31_to_2026-07-31.json";
  const fullTable1 = mtsSummaryResponseSchema.parse(loadRawFixture(`fiscaldata/mts_table_1/${RANGE_FILE}`));
  const fullTable4 = mtsReceiptsResponseSchema.parse(loadRawFixture(`fiscaldata/mts_table_4/${RANGE_FILE}`));
  const fullTable9 = mtsOutlaysByFunctionResponseSchema.parse(loadRawFixture(`fiscaldata/mts_table_9/${RANGE_FILE}`));

  const recordDates = [...new Set(fullTable4.data.map((r) => r.record_date))].sort();
  const fullTotals = recordDates.flatMap((d) => extractOwnPeriodMtsTotals(fullTable1.data, d));
  const fullReceipts = parseMtsReceipts(fullTable4);
  const fullOutlays = parseMtsOutlaysByFunction(fullTable9);

  it("covers exactly 137 consecutive months, 2015-03 through 2026-07, with no gaps", () => {
    expect(recordDates).toHaveLength(137);
    expect(recordDates[0]).toBe("2015-03-31");
    expect(recordDates[recordDates.length - 1]).toBe("2026-07-31");
    for (let i = 1; i < recordDates.length; i++) {
      const [py, pm] = recordDates[i - 1]!.split("-").map(Number) as [number, number];
      const [cy, cm] = recordDates[i]!.split("-").map(Number) as [number, number];
      const expected = pm === 12 ? { y: py + 1, m: 1 } : { y: py, m: pm + 1 };
      expect({ y: cy, m: cm }, `gap between ${recordDates[i - 1]} and ${recordDates[i]}`).toEqual(expected);
    }
  });

  it("January and February 2015 are genuinely absent, never zero-filled — FiscalData has no MTS report at all for those record_dates on any of the 3 tables (earliest is 2015-03-31)", () => {
    expect(recordDates).not.toContain("2015-01-31");
    expect(recordDates).not.toContain("2015-02-28");
    expect(fullTotals.find((t) => t.periodEnd === "2015-01-31" || t.periodEnd === "2015-02-28")).toBeUndefined();
  });

  it("receipts categories sum to the published total, exactly, for EVERY one of the 137 backfilled months", () => {
    const monthReceipts = fullReceipts.filter((r) => r.periodType === "month");
    const monthTotals = fullTotals.filter((t) => t.seriesId === "fiscal.mts.receipts.total" && t.periodType === "month");
    expect(monthTotals).toHaveLength(137);
    const checks = reconcileCategoriesToTotal(monthReceipts, monthTotals);
    expect(checks).toHaveLength(137);
    for (const c of checks) {
      expect(c.ok, `${c.periodEnd}: published=${c.publishedTotal} sum=${c.sumOfCategories} diff=${c.difference}`).toBe(true);
    }
  });

  it("outlay-by-function categories sum to the published total, exactly, for EVERY one of the 137 backfilled months", () => {
    const monthOutlays = fullOutlays.filter((o) => o.periodType === "month");
    const monthTotals = fullTotals.filter((t) => t.seriesId === "fiscal.mts.outlays.total" && t.periodType === "month");
    expect(monthTotals).toHaveLength(137);
    const checks = reconcileCategoriesToTotal(monthOutlays, monthTotals);
    expect(checks).toHaveLength(137);
    for (const c of checks) {
      expect(c.ok, `${c.periodEnd}: published=${c.publishedTotal} sum=${c.sumOfCategories} diff=${c.difference}`).toBe(true);
    }
  });

  it("receipts categories sum to each report's own published FYTD total, exactly, for all 137 reports", () => {
    const fytdReceipts = fullReceipts.filter((r) => r.periodType === "fiscal_ytd");
    const fytdTotals = fullTotals.filter((t) => t.seriesId === "fiscal.mts.receipts.total" && t.periodType === "fiscal_ytd");
    expect(fytdTotals).toHaveLength(137);
    const checks = reconcileCategoriesToTotal(fytdReceipts, fytdTotals);
    for (const c of checks) expect(c.ok, `${c.periodEnd}: diff=${c.difference}`).toBe(true);
  });

  it("outlay categories sum to each report's own published FYTD total, exactly, for all 137 reports", () => {
    const fytdOutlays = fullOutlays.filter((o) => o.periodType === "fiscal_ytd");
    const fytdTotals = fullTotals.filter((t) => t.seriesId === "fiscal.mts.outlays.total" && t.periodType === "fiscal_ytd");
    expect(fytdTotals).toHaveLength(137);
    const checks = reconcileCategoriesToTotal(fytdOutlays, fytdTotals);
    for (const c of checks) expect(c.ok, `${c.periodEnd}: diff=${c.difference}`).toBe(true);
  });

  it("deficit identity (receipts - outlays = deficit) holds exactly for every one of the 274 own-period readings (137 months + 137 own-FYTDs)", () => {
    const checks = reconcileDeficitIdentity(fullTotals);
    expect(checks).toHaveLength(274);
    for (const c of checks) expect(c.ok, `${c.periodType} ${c.periodEnd}: diff=${c.difference}`).toBe(true);
  });

  it(
    "own-report FYTD readings (fiscalYear !== 2015) reconcile against the cumulative sum of that fiscal year's own-report months WITHIN AN EXPLICIT TOLERANCE, not exact equality — CLAUDE.md's reconciliation rule ('explicit tolerance, loud failure when exceeded') applied here because Treasury genuinely revises a month's outlays/deficit (and sometimes receipts) figure starting as soon as the VERY NEXT report, before that month's own category breakdown (which never gets restated) is ever touched. Verified live: October 2015's own report (record_date=2015-10-31) published October outlays of $347,578,330,203.66; November 2015's report, one month later, already carries a revised $347,595,667,058.01 for that same October — a genuine $17.3M correction, not a computation bug. Worst gap observed across all 390 checks: ~$5.09B against a ~$1.83T FY2024 deficit reading (0.43%).",
    () => {
      const TOLERANCE_USD = "10000000000"; // $10B: ~2x the largest gap actually observed (~$5.09B, FY2024's deficit), and negligible against the ~$0.6T-$6.8T magnitudes being compared.
      const ytdRows = fullTotals.filter((t) => t.periodType === "fiscal_ytd" && t.fiscalYear !== 2015);
      expect(ytdRows).toHaveLength(390); // (137 reports - 7 FY2015 reports) * 3 series (receipts/outlays/deficit).
      let exactMatches = 0;
      let maxAbsDiff = "0";
      for (const ytd of ytdRows) {
        const cumulativeMonths = fullTotals.filter(
          (m) => m.seriesId === ytd.seriesId && m.periodType === "month" && m.fiscalYear === ytd.fiscalYear && m.periodEnd <= ytd.periodEnd,
        );
        const summed = decimalSum(cumulativeMonths.map((m) => m.value));
        const diff = decimalSubtract(ytd.value, summed);
        if (decimalEquals(diff, "0")) exactMatches++;
        const absDiff = diff.startsWith("-") ? diff.slice(1) : diff;
        if (decimalSubtract(absDiff, maxAbsDiff).startsWith("-") === false) maxAbsDiff = absDiff;
        const exceedsTolerance = decimalSubtract(TOLERANCE_USD, absDiff).startsWith("-");
        expect(
          exceedsTolerance,
          `${ytd.seriesId} FY${ytd.fiscalYear} through ${ytd.periodEnd}: ${cumulativeMonths.length} own-report month(s) sum to ${summed}, published FYTD = ${ytd.value} (diff ${diff}) — exceeds the $${TOLERANCE_USD} tolerance`,
        ).toBe(false);
      }
      // Sanity: this must exercise BOTH genuine exact matches and genuine sub-tolerance revisions, not trivially all-zero (a broken test that can't fail) or all-nonzero-by-some-bug.
      expect(exactMatches, `expected some exact matches among the ${ytdRows.length} checks, got ${exactMatches}`).toBeGreaterThan(50);
      expect(exactMatches).toBeLessThan(ytdRows.length);
      expect(maxAbsDiff).toBe("5087828969.47"); // pins the exact worst case found live, so a future fixture refresh that changes this meaningfully gets noticed rather than silently drifting.
    },
  );

  it("FY2015 is the one fiscal year excluded from the tolerance check above: 5 of its 12 months (Oct 2014-Feb 2015) predate FiscalData's earliest MTS report (2015-03-31) entirely, so every one of its own-report FYTD readings is missing much more than a small revision's worth of months — pinned explicitly rather than silently excluded from the loop above", () => {
    const fy2015Ytd = fullTotals.filter((t) => t.periodType === "fiscal_ytd" && t.fiscalYear === 2015);
    expect(fy2015Ytd).toHaveLength(21); // March..September 2015's own reports (7) * 3 series.
    for (const ytd of fy2015Ytd) {
      const cumulativeMonths = fullTotals.filter(
        (m) => m.seriesId === ytd.seriesId && m.periodType === "month" && m.fiscalYear === 2015 && m.periodEnd <= ytd.periodEnd,
      );
      // Every one of these sums at most 7 months (March-September); the FYTD figure itself covers 12 (October 2014-onward) -- the gap here is structural (missing months), not a small revision, so it must dwarf the $10B tolerance used above.
      const summed = decimalSum(cumulativeMonths.map((m) => m.value));
      const diff = decimalSubtract(ytd.value, summed);
      const absDiff = diff.startsWith("-") ? diff.slice(1) : diff;
      expect(
        decimalSubtract(absDiff, "10000000000").startsWith("-"),
        `expected FY2015's ${ytd.periodEnd} ${ytd.seriesId} gap (${diff}) to exceed the $10B small-revision tolerance, proving this is a structural gap, not noise`,
      ).toBe(false);
    }
  });

  it("MTS Table 9's F/D budget-function labels are exhaustively mapped across the full history — no row was silently dropped (parseMtsOutlaysByFunction above would have thrown already if one were unmapped; this pins the exact set so a future relabeling that still happens to throw doesn't quietly redefine what counts as \"mapped\")", () => {
    const fdRows = fullTable9.data.filter((r) => r.record_type_cd === "F" && r.data_type_cd === "D");
    expect(fdRows.length).toBeGreaterThan(2500);
    const seenLabels = new Set(fdRows.map((r) => r.classification_desc));
    for (const label of seenLabels) {
      expect(Object.keys(OUTLAYS_BY_FUNCTION_LABELS)).toContain(label);
    }
  });

  it("parseMtsOutlaysByFunction throws loudly — not a silent drop — on a synthetically renamed budget-function label", () => {
    const targetIndex = fullTable9.data.findIndex((r) => r.record_type_cd === "F" && r.data_type_cd === "D");
    expect(targetIndex).toBeGreaterThanOrEqual(0);
    const mutated = {
      data: fullTable9.data.map((r, i) => (i === targetIndex ? { ...r, classification_desc: "Some Renamed Function" } : r)),
    };
    expect(() => parseMtsOutlaysByFunction(mutated)).toThrow(/unmapped classification_desc/);
  });

  it("assertReceiptsCategoriesPresent throws loudly — not a silent drop — on a synthetically renamed/missing receipts category for a real report, and passes for the unmutated report", () => {
    const recordDate = "2020-04-30";
    const mutated = fullTable4.data.map((r) =>
      r.record_date === recordDate && r.classification_desc === "Total -- Excise Taxes" ? { ...r, classification_desc: "Total -- Excise Taxes (renamed)" } : r,
    );
    expect(() => assertReceiptsCategoriesPresent(mutated, recordDate)).toThrow(/Total -- Excise Taxes/);
    expect(() => assertReceiptsCategoriesPresent(fullTable4.data, recordDate)).not.toThrow();
  });
});

describe("MTS full-history backfill — the SHIPPED db/fixtures/observations/*.json files (not just the in-memory re-derivation above)", () => {
  const totals = loadObservationFixture("mts-totals.json");
  const receipts = loadObservationFixture("mts-receipts-categories.json");
  const outlays = loadObservationFixture("mts-outlays-categories.json");

  it("carries all 137 backfilled months for totals, receipts, and outlays", () => {
    expect(totals).toHaveLength(822); // 137 reports * (receipts/outlays/deficit) * (month/fiscal_ytd) = 137*6.
    expect(new Set(receipts.filter((r) => r.periodType === "month").map((r) => r.periodEnd))).toHaveProperty("size", 137);
    expect(new Set(outlays.filter((o) => o.periodType === "month").map((o) => o.periodEnd))).toHaveProperty("size", 137);
  });

  it("reconciles exactly, read straight from disk, for every month and every FYTD reading", () => {
    for (const periodType of ["month", "fiscal_ytd"] as const) {
      const receiptsTotals = totals.filter((t) => t.seriesId === "fiscal.mts.receipts.total" && t.periodType === periodType);
      const outlaysTotals = totals.filter((t) => t.seriesId === "fiscal.mts.outlays.total" && t.periodType === periodType);
      const receiptsChecks = reconcileCategoriesToTotal(receipts.filter((r) => r.periodType === periodType), receiptsTotals);
      const outlaysChecks = reconcileCategoriesToTotal(outlays.filter((o) => o.periodType === periodType), outlaysTotals);
      for (const c of [...receiptsChecks, ...outlaysChecks]) {
        expect(c.ok, `${periodType} ${c.periodEnd}: diff=${c.difference}`).toBe(true);
      }
    }
  });

  it("has no row at all for January or February 2015 (the documented source-coverage gap), in any of the three files", () => {
    for (const rows of [totals, receipts, outlays]) {
      expect(rows.find((r) => r.periodEnd === "2015-01-31" || r.periodEnd === "2015-02-28")).toBeUndefined();
    }
  });
});
