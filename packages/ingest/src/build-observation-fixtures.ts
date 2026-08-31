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
import { interestExpenseResponseSchema } from "./fiscaldata/interest-expense";
import { blsResponseSchema } from "./bls/cpi";
import { parseCboBaselineCsv } from "./cbo/baseline-deficit";
import { parseMtsSummary, parseMtsReceipts, parseMtsOutlaysByFunction } from "./jobs/mts-monthly";
import { parseDebtToPenny } from "./jobs/debt-daily";
import { parseTgaClosingBalance } from "./jobs/tga-daily";
import { parseInterestExpense } from "./jobs/interest-expense-monthly";
import { parseCpi } from "./jobs/cpi-monthly";
import { parseCboBaselineRows, CBO_BASELINE_CSV_PATH, CBO_BASELINE_PUBLICATION_DATE } from "./jobs/cbo-baseline";
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
  const MTS_MONTHS = ["2026-07-31", "2026-06-30", "2025-07-31", "2024-09-30"] as const;

  const totals = dedupe([
    ...parseMtsSummary(mtsSummaryResponseSchema.parse(loadRaw("fiscaldata/mts_table_1/2026-07-31.json"))),
    ...parseMtsSummary(mtsSummaryResponseSchema.parse(loadRaw("fiscaldata/mts_table_1/2024-09-30.json"))),
  ]);
  write("mts-totals.json", totals);

  const receipts = dedupe(
    MTS_MONTHS.flatMap((d) => parseMtsReceipts(mtsReceiptsResponseSchema.parse(loadRaw(`fiscaldata/mts_table_4/${d}.json`)))),
  );
  write("mts-receipts-categories.json", receipts);

  const outlays = dedupe(
    MTS_MONTHS.flatMap((d) =>
      parseMtsOutlaysByFunction(mtsOutlaysByFunctionResponseSchema.parse(loadRaw(`fiscaldata/mts_table_9/${d}.json`))),
    ),
  );
  write("mts-outlays-categories.json", outlays);

  const debt = parseDebtToPenny(
    debtToPennyResponseSchema.parse(loadRaw("fiscaldata/debt_to_penny/2026-06-01_to_2026-08-27.json")),
  );
  write("debt-to-penny.json", debt);

  const tga = parseTgaClosingBalance(
    operatingCashBalanceResponseSchema.parse(loadRaw("fiscaldata/operating_cash_balance/2026-06-01_to_2026-08-27.json")),
  );
  write("tga-closing-balance.json", tga);

  const interest = parseInterestExpense(
    interestExpenseResponseSchema.parse(loadRaw("fiscaldata/interest_expense/2024-08-31_to_2026-07-31.json")),
  );
  write("interest-expense.json", interest);

  const cpi = parseCpi(blsResponseSchema.parse(loadRaw("bls/cpi_u_all_items/2021_to_2026.json")), "2026-08-29T00:00:00Z");
  write("cpi.json", cpi);

  const cboRows = parseCboBaselineCsv(readFileSync(CBO_BASELINE_CSV_PATH, "utf8"));
  const cbo = parseCboBaselineRows(cboRows, CBO_BASELINE_PUBLICATION_DATE);
  write("cbo-baseline-deficit.json", cbo);
}

main();
