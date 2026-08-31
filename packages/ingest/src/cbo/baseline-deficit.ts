/**
 * CBO has no API (PLAN.md §6) — `projection.cbo.baseline.deficit` is loaded
 * from a hand-extracted CSV committed at
 * db/fixtures/raw/cbo/baseline_deficit/, refreshed manually on CBO's own
 * release cadence (roughly twice a year). See that directory's SOURCE.md
 * for the exact workbook, sheet, row, retrieval date, and how it was
 * fetched (cbo.gov blocks scripted requests — see the ingest handoff
 * report).
 *
 * The CSV has exactly two columns: `fiscal_year` and
 * `total_deficit_usd_billions` — the "Total deficit (-)" row of CBO's
 * Table 1-1, in CBO's own published magnitude (billions of dollars,
 * matching the registry's `magnitude: "billions"` for this series — see
 * packages/ingest/README.md for which other series' registry-declared
 * magnitude does NOT check out against a live source; this one does).
 * Only PROJECTED fiscal years are
 * included; CBO's own "Actual," column for the just-completed fiscal year
 * is deliberately excluded — that number is Treasury's realized deficit,
 * already covered by fiscal.mts.deficit.total, and including it here would
 * blur an observed figure into what is supposed to be a strictly-projected
 * series.
 */
import { z } from "zod";

export const cboBaselineDeficitRowSchema = z.object({
  fiscal_year: z.string().regex(/^\d{4}$/),
  total_deficit_usd_billions: z.string().regex(/^-?\d+(\.\d+)?$/),
});

export type CboBaselineDeficitRow = z.infer<typeof cboBaselineDeficitRowSchema>;

const EXPECTED_HEADER = "fiscal_year,total_deficit_usd_billions";

/**
 * Parse the committed CBO baseline CSV. Deliberately not a general CSV
 * parser (no quoting/escaping support) — the file is hand-authored by us
 * with two plain numeric columns, not a passthrough of an arbitrary
 * external CSV, so a strict, obvious parser is more trustworthy here than
 * a dependency.
 */
export function parseCboBaselineCsv(csv: string): CboBaselineDeficitRow[] {
  const lines = csv
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  const [header, ...rows] = lines;
  if (header !== EXPECTED_HEADER) {
    throw new Error(`unexpected CBO baseline CSV header: ${JSON.stringify(header)}, expected ${JSON.stringify(EXPECTED_HEADER)}`);
  }
  return rows.map((line, i) => {
    const parts = line.split(",");
    if (parts.length !== 2) {
      throw new Error(`CBO baseline CSV row ${i + 2} has ${parts.length} columns, expected 2: ${JSON.stringify(line)}`);
    }
    const [fiscal_year, total_deficit_usd_billions] = parts as [string, string];
    return cboBaselineDeficitRowSchema.parse({ fiscal_year, total_deficit_usd_billions });
  });
}
