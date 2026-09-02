/**
 * CBO baseline outlays projection — sibling of jobs/cbo-baseline.ts (the
 * deficit series), same batch-not-cron shape (PLAN.md §6: CBO has no API
 * and refreshes roughly twice a year). Manual batch loader run by hand
 * after each new baseline is committed to
 * db/fixtures/raw/cbo/baseline_outlays/ (see that directory's SOURCE.md for
 * how to refresh it).
 *
 * publication_time = the CBO report's own release date (a real, published
 * date — not a proxy), read from SOURCE.md rather than hardcoded here so
 * refreshing the baseline means updating one file, not this job.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCboBaselineOutlaysCsv, type CboBaselineOutlaysRow } from "../cbo/baseline-outlays";
import { fiscalYearStart, lastDayOfMonth } from "../lib/period";
import { upsertObservations, type UpsertManySummary } from "../lib/upsert";
import type { RawObservation } from "../lib/types";
import { getDb, type PennyDb } from "@penny/db";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
export const CBO_BASELINE_OUTLAYS_CSV_PATH = join(REPO_ROOT, "db", "fixtures", "raw", "cbo", "baseline_outlays", "2026-02-baseline-outlays.csv");
export const CBO_BASELINE_OUTLAYS_PUBLICATION_DATE = "2026-02-11"; // The Budget and Economic Outlook: 2026 to 2036 — see db/fixtures/raw/cbo/baseline_outlays/SOURCE.md.

/** A full fiscal year's projected outlays has no natural "month" within it — period_start/period_end both cover the whole fiscal year (Oct 1–Sep 30), period_type "year". */
export function parseCboBaselineOutlaysRows(rows: readonly CboBaselineOutlaysRow[], publicationDate: string): RawObservation[] {
  return rows.map((row) => {
    const fiscalYear = Number(row.fiscal_year);
    return {
      seriesId: "projection.cbo.baseline.outlays",
      periodType: "year",
      periodStart: fiscalYearStart(fiscalYear),
      periodEnd: lastDayOfMonth(fiscalYear, 9),
      fiscalYear,
      value: row.total_outlays_usd_billions,
      publicationTime: `${publicationDate}T00:00:00Z`,
    };
  });
}

export interface CboBaselineOutlaysJobResult {
  csvPath: string;
  summary: UpsertManySummary;
}

export async function runCboBaselineOutlaysJob(db: PennyDb): Promise<CboBaselineOutlaysJobResult> {
  const csv = readFileSync(CBO_BASELINE_OUTLAYS_CSV_PATH, "utf8");
  const rows = parseCboBaselineOutlaysCsv(csv);
  const observations = parseCboBaselineOutlaysRows(rows, CBO_BASELINE_OUTLAYS_PUBLICATION_DATE);
  const summary = await upsertObservations(db, observations);
  return { csvPath: CBO_BASELINE_OUTLAYS_CSV_PATH, summary };
}

async function main() {
  const db = getDb();
  const result = await runCboBaselineOutlaysJob(db);
  console.log(`CBO baseline outlays ingest complete from ${result.csvPath}: +${result.summary.inserted} ~${result.summary.revised} =${result.summary.unchanged}`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
