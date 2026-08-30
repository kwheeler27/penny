/**
 * CBO baseline deficit projection — ORCHESTRATION_PROMPT.md Core flow 3.
 * Not a cron (PLAN.md §6: CBO has no API and refreshes roughly twice a
 * year); this is a manual batch loader run by hand after each new baseline
 * is committed to db/fixtures/raw/cbo/baseline_deficit/ (see that
 * directory's SOURCE.md for how to refresh it).
 *
 * publication_time = the CBO report's own release date (a real, published
 * date — not a proxy), read from SOURCE.md rather than hardcoded here so
 * refreshing the baseline means updating one file, not this job.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCboBaselineCsv, type CboBaselineDeficitRow } from "../cbo/baseline-deficit";
import { fiscalYearStart, lastDayOfMonth } from "../lib/period";
import { upsertObservations, type UpsertManySummary } from "../lib/upsert";
import type { RawObservation } from "../lib/types";
import { getDb, type BuckDb } from "@buck/db";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
export const CBO_BASELINE_CSV_PATH = join(REPO_ROOT, "db", "fixtures", "raw", "cbo", "baseline_deficit", "2026-02-baseline-deficit.csv");
export const CBO_BASELINE_PUBLICATION_DATE = "2026-02-11"; // The Budget and Economic Outlook: 2026 to 2036 — see db/fixtures/raw/cbo/baseline_deficit/SOURCE.md.

/** A full fiscal year's projected deficit has no natural "month" within it — period_start/period_end both cover the whole fiscal year (Oct 1–Sep 30), period_type "year". */
export function parseCboBaselineRows(rows: readonly CboBaselineDeficitRow[], publicationDate: string): RawObservation[] {
  return rows.map((row) => {
    const fiscalYear = Number(row.fiscal_year);
    return {
      seriesId: "projection.cbo.baseline.deficit",
      periodType: "year",
      periodStart: fiscalYearStart(fiscalYear),
      periodEnd: lastDayOfMonth(fiscalYear, 9),
      fiscalYear,
      value: row.total_deficit_usd_billions,
      publicationTime: `${publicationDate}T00:00:00Z`,
    };
  });
}

export interface CboBaselineJobResult {
  csvPath: string;
  summary: UpsertManySummary;
}

export async function runCboBaselineJob(db: BuckDb): Promise<CboBaselineJobResult> {
  const csv = readFileSync(CBO_BASELINE_CSV_PATH, "utf8");
  const rows = parseCboBaselineCsv(csv);
  const observations = parseCboBaselineRows(rows, CBO_BASELINE_PUBLICATION_DATE);
  const summary = await upsertObservations(db, observations);
  return { csvPath: CBO_BASELINE_CSV_PATH, summary };
}

async function main() {
  const db = getDb();
  const result = await runCboBaselineJob(db);
  console.log(`CBO baseline ingest complete from ${result.csvPath}: +${result.summary.inserted} ~${result.summary.revised} =${result.summary.unchanged}`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
