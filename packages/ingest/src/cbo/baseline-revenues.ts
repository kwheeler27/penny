/**
 * CBO has no API (PLAN.md §6) — `projection.cbo.baseline.revenues` is
 * loaded from a hand-extracted CSV committed at
 * db/fixtures/raw/cbo/baseline_revenues/, refreshed manually on CBO's own
 * release cadence (roughly twice a year). See that directory's SOURCE.md
 * for the exact workbook, sheet, row, retrieval date, and how it was
 * fetched (cbo.gov blocks scripted requests — see the ingest handoff
 * report), plus the reconciliation check against the sibling
 * outlays/deficit CSVs extracted from the same workbook.
 *
 * The CSV has exactly two columns: `fiscal_year` and
 * `total_revenues_usd_billions` — the "Total" row of the "Revenues" block
 * of CBO's Table 1-1, in CBO's own published magnitude (billions of
 * dollars, matching the registry's `magnitude: "billions"` for this
 * series). Only PROJECTED fiscal years are included; CBO's own "Actual,"
 * column for the just-completed fiscal year is deliberately excluded —
 * that number is Treasury's realized receipts, already covered by
 * fiscal.mts.receipts.total, and including it here would blur an observed
 * figure into what is supposed to be a strictly-projected series.
 */
import { z } from "zod";

export const cboBaselineRevenuesRowSchema = z.object({
  fiscal_year: z.string().regex(/^\d{4}$/),
  total_revenues_usd_billions: z.string().regex(/^-?\d+(\.\d+)?$/),
});

export type CboBaselineRevenuesRow = z.infer<typeof cboBaselineRevenuesRowSchema>;

const EXPECTED_HEADER = "fiscal_year,total_revenues_usd_billions";

/**
 * Parse the committed CBO baseline revenues CSV. Deliberately not a
 * general CSV parser (no quoting/escaping support) — the file is
 * hand-authored by us with two plain numeric columns, not a passthrough of
 * an arbitrary external CSV, so a strict, obvious parser is more
 * trustworthy here than a dependency (mirrors ../cbo/baseline-deficit.ts's
 * own parser exactly).
 */
export function parseCboBaselineRevenuesCsv(csv: string): CboBaselineRevenuesRow[] {
  const lines = csv
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  const [header, ...rows] = lines;
  if (header !== EXPECTED_HEADER) {
    throw new Error(`unexpected CBO baseline revenues CSV header: ${JSON.stringify(header)}, expected ${JSON.stringify(EXPECTED_HEADER)}`);
  }
  return rows.map((line, i) => {
    const parts = line.split(",");
    if (parts.length !== 2) {
      throw new Error(`CBO baseline revenues CSV row ${i + 2} has ${parts.length} columns, expected 2: ${JSON.stringify(line)}`);
    }
    const [fiscal_year, total_revenues_usd_billions] = parts as [string, string];
    return cboBaselineRevenuesRowSchema.parse({ fiscal_year, total_revenues_usd_billions });
  });
}
