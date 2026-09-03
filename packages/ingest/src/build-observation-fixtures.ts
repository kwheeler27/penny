/**
 * Regenerates db/fixtures/observations/*.json — the pre-transformed rows
 * `@penny/db`'s `pnpm seed` loads into local PGlite with zero credentials
 * and zero live API calls (ORCHESTRATION_PROMPT.md). Run this after
 * changing any parser in src/jobs/* or refreshing db/fixtures/raw/*.
 *
 * This intentionally does NOT go through lib/upsert.ts's revision logic —
 * every raw snapshot captured under db/fixtures/raw covers a distinct
 * period with no overlapping revision (verified in
 * test/reconciliation.test.ts's idempotency tests, which exercise the
 * revision path against synthetic mutations instead), so a flat
 * deduplicated list is the correct seed content; `@penny/db`'s seed script
 * inserts it with a plain `onConflictDoNothing()`.
 *
 * CLI: `pnpm --filter @penny/ingest run build-fixtures`.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mtsSummaryResponseSchema } from "./fiscaldata/mts-summary";
import { mtsReceiptsResponseSchema } from "./fiscaldata/mts-receipts";
import { mtsOutlaysByFunctionResponseSchema } from "./fiscaldata/mts-outlays";
import { debtToPennyResponseSchema } from "./fiscaldata/debt-to-penny";
import { operatingCashBalanceResponseSchema } from "./fiscaldata/operating-cash-balance";
import { dtsDepositsWithdrawalsResponseSchema } from "./fiscaldata/deposits-withdrawals";
import { interestExpenseResponseSchema } from "./fiscaldata/interest-expense";
import { blsResponseSchema } from "./bls/cpi";
import { parseCboBaselineCsv } from "./cbo/baseline-deficit";
import { parseCboBaselineOutlaysCsv } from "./cbo/baseline-outlays";
import { parseCboBaselineRevenuesCsv } from "./cbo/baseline-revenues";
import { parseMtsReceipts, parseMtsOutlaysByFunction, extractOwnPeriodMtsTotals, assertReceiptsCategoriesPresent } from "./jobs/mts-monthly";
import { parseDebtToPenny } from "./jobs/debt-daily";
import { parseTgaClosingBalance } from "./jobs/tga-daily";
import { parseDtsDepositsWithdrawals } from "./jobs/dts-cadence-daily";
import { parseInterestExpense } from "./jobs/interest-expense-monthly";
import { parseCpi } from "./jobs/cpi-monthly";
import { parseCboBaselineRows, CBO_BASELINE_CSV_PATH, CBO_BASELINE_PUBLICATION_DATE } from "./jobs/cbo-baseline";
import { parseCboBaselineOutlaysRows, CBO_BASELINE_OUTLAYS_CSV_PATH, CBO_BASELINE_OUTLAYS_PUBLICATION_DATE } from "./jobs/cbo-baseline-outlays";
import { parseCboBaselineRevenuesRows, CBO_BASELINE_REVENUES_CSV_PATH, CBO_BASELINE_REVENUES_PUBLICATION_DATE } from "./jobs/cbo-baseline-revenues";
import { parseWrbwfrblCsv, parseWrbwfrblObservations } from "./fred/wrbwfrbl";
import type { RawObservation } from "./lib/types";
import { readFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/ingest/src -> repo root is three levels up.
const REPO_ROOT = join(HERE, "..", "..", "..");
const RAW_ROOT = join(REPO_ROOT, "db", "fixtures", "raw");
const OUT_DIR = join(REPO_ROOT, "db", "fixtures", "observations");

function loadRaw(relPath: string): unknown {
  return JSON.parse(readFileSync(join(RAW_ROOT, relPath), "utf8"));
}

/** De-dupe by (seriesId, periodType, periodEnd) — later entries win, so a month present in more than one fetched report (e.g. via Table 1's multi-fiscal-year rows) is only written once. */
function dedupe(observations: readonly RawObservation[]): RawObservation[] {
  const map = new Map<string, RawObservation>();
  for (const o of observations) {
    map.set(`${o.seriesId}|${o.periodType}|${o.periodEnd}`, o);
  }
  return [...map.values()];
}

function write(filename: string, observations: readonly RawObservation[]): void {
  const path = join(OUT_DIR, filename);
  writeFileSync(path, JSON.stringify(observations, null, 2) + "\n");
  console.log(`wrote ${observations.length} observation(s) to db/fixtures/observations/${filename}`);
}

function main() {
  // Full-history backfill (Penny Atlas beat 1: the ‹ › month stepper + every
  // category's history line). db/fixtures/raw/fiscaldata/mts_table_{1,4,9}/
  // 2015-03-31_to_2026-07-31.json are one real, unedited FiscalData response
  // per table, captured live 2026-09-01 — the FULL range FiscalData has for
  // all three MTS tables (verified live: no MTS report of any kind, on any
  // table, exists before record_date=2015-03-31; see mts-backfill.ts's doc
  // comment). Table 4's own record_date set is the limiting resource — only
  // a month that's actually SOMEONE's report has a category breakdown at
  // all — so it drives which months make it into the fixtures; Table 1's
  // totals are then pulled per-report via extractOwnPeriodMtsTotals so every
  // included month's total is guaranteed to sum exactly against that same
  // report's categories (see that function's doc comment for why the naive
  // "parse the whole multi-report blob and dedupe" approach would NOT
  // guarantee that: MTS restates outlay/deficit figures by small amounts
  // across later reports, but Table 4/9 never re-publish a historical
  // month's category breakdown to match).
  const MTS_RANGE_FILE = "2015-03-31_to_2026-07-31.json";
  const table1Full = mtsSummaryResponseSchema.parse(loadRaw(`fiscaldata/mts_table_1/${MTS_RANGE_FILE}`));
  const table4Full = mtsReceiptsResponseSchema.parse(loadRaw(`fiscaldata/mts_table_4/${MTS_RANGE_FILE}`));
  const table9Full = mtsOutlaysByFunctionResponseSchema.parse(loadRaw(`fiscaldata/mts_table_9/${MTS_RANGE_FILE}`));

  const recordDates = [...new Set(table4Full.data.map((r) => r.record_date))].sort();
  console.log(`MTS full history: ${recordDates.length} report(s), ${recordDates[0]}..${recordDates[recordDates.length - 1]}`);

  const totals: RawObservation[] = [];
  for (const recordDate of recordDates) {
    assertReceiptsCategoriesPresent(table4Full.data, recordDate); // throws loudly on a renamed/missing receipts label instead of silently shrinking a category.
    totals.push(...extractOwnPeriodMtsTotals(table1Full.data, recordDate));
  }
  write("mts-totals.json", dedupe(totals));

  // parseMtsOutlaysByFunction itself throws on an unmapped Table 9 label (a
  // closed set) — see mts-monthly.ts. Neither table needs per-report
  // slicing here: each report's Table 4/9 rows only ever describe that
  // report's own month, so feeding the whole multi-report blob through the
  // existing parsers in one call is already correct (verified live: zero
  // cross-report duplication, zero dollar mismatches across all 137
  // reports) — dedupe() below is a defensive no-op, not load-bearing.
  write("mts-receipts-categories.json", dedupe(parseMtsReceipts(table4Full)));
  write("mts-outlays-categories.json", dedupe(parseMtsOutlaysByFunction(table9Full)));

  const debt = parseDebtToPenny(
    debtToPennyResponseSchema.parse(loadRaw("fiscaldata/debt_to_penny/2026-06-01_to_2026-08-27.json")),
  );
  write("debt-to-penny.json", debt);

  const tga = parseTgaClosingBalance(
    operatingCashBalanceResponseSchema.parse(loadRaw("fiscaldata/operating_cash_balance/2026-06-01_to_2026-08-27.json")),
  );
  write("tga-closing-balance.json", tga);

  const DTS_MONTHS = [
    "2026-05-01_to_2026-05-31",
    "2026-06-01_to_2026-06-30",
    "2026-07-01_to_2026-07-31",
    "2026-08-01_to_2026-08-31",
  ] as const;
  const dtsCadence = dedupe(
    DTS_MONTHS.flatMap((range) =>
      parseDtsDepositsWithdrawals(
        dtsDepositsWithdrawalsResponseSchema.parse(loadRaw(`fiscaldata/deposits_withdrawals_operating_cash/${range}.json`)),
      ),
    ),
  );
  write("dts-deposits-withdrawals.json", dtsCadence);

  const interest = parseInterestExpense(
    interestExpenseResponseSchema.parse(loadRaw("fiscaldata/interest_expense/2024-08-31_to_2026-07-31.json")),
  );
  write("interest-expense.json", interest);

  const cpi = parseCpi(blsResponseSchema.parse(loadRaw("bls/cpi_u_all_items/2021_to_2026.json")), "2026-08-29T00:00:00Z");
  write("cpi.json", cpi);

  const cboRows = parseCboBaselineCsv(readFileSync(CBO_BASELINE_CSV_PATH, "utf8"));
  const cbo = parseCboBaselineRows(cboRows, CBO_BASELINE_PUBLICATION_DATE);
  write("cbo-baseline-deficit.json", cbo);

  const cboOutlaysRows = parseCboBaselineOutlaysCsv(readFileSync(CBO_BASELINE_OUTLAYS_CSV_PATH, "utf8"));
  const cboOutlays = parseCboBaselineOutlaysRows(cboOutlaysRows, CBO_BASELINE_OUTLAYS_PUBLICATION_DATE);
  write("cbo-baseline-outlays.json", cboOutlays);

  const cboRevenuesRows = parseCboBaselineRevenuesCsv(readFileSync(CBO_BASELINE_REVENUES_CSV_PATH, "utf8"));
  const cboRevenues = parseCboBaselineRevenuesRows(cboRevenuesRows, CBO_BASELINE_REVENUES_PUBLICATION_DATE);
  write("cbo-baseline-revenues.json", cboRevenues);

  // Reserve balances at the Fed (H.4.1, FRED WRBWFRBL — "Wednesday Level,"
  // not the week-average WRESBAL; see fred/wrbwfrbl.ts's header comment) —
  // see db/fixtures/raw/fred/wrbwfrbl/SOURCE.md for the exact fetch and the
  // spot-checked known value. asOf is the raw snapshot's own retrieval
  // date (see this file's doc comment on why WRBWFRBL has no honest
  // per-point publish date to derive from instead — same reasoning as the
  // CPI-U fixture's fetchedAt above).
  const wrbwfrblRows = parseWrbwfrblCsv(readFileSync(join(RAW_ROOT, "fred", "wrbwfrbl", "2015-01-07_to_2026-08-26.csv"), "utf8"));
  const wrbwfrbl = parseWrbwfrblObservations(wrbwfrblRows, "2026-09-02T00:00:00Z");
  write("fed-reserve-balances.json", wrbwfrbl);
}

main();
