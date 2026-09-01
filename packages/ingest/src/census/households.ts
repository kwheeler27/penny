/**
 * Census Bureau Historical Households Tables, Table HH-1 ("Households by
 * Type: 1940 to Present") — feeds `census.households.total`. Like CBO and
 * the Census population estimates (see ../cbo/baseline-deficit.ts,
 * ./population.ts), this table has no query API — it's a static workbook
 * (legacy .xls) updated roughly once a year alongside the Bureau's
 * "America's Families and Living Arrangements" release. This is a
 * hand-extracted CSV committed at db/fixtures/raw/census/households/,
 * refreshed manually on that release cadence — see that directory's
 * SOURCE.md for the exact workbook, cell locations, footnote text, and
 * retrieval method (parsed locally with Python's `xlrd`, not retyped by
 * hand off a rendering).
 *
 * The CSV keeps only the "Total households" column (thousands, as
 * published) for 2020-2025, using each year's most-current row where the
 * source table itself carries a revision (2021 has both a superseded
 * "2021" row and a current "2021r" row — see SOURCE.md).
 */
import { z } from "zod";

export const censusHouseholdsRowSchema = z.object({
  year: z.string().regex(/^\d{4}$/),
  total_households_thousands: z.string().regex(/^\d+$/),
  /** Table HH-1's own footnote marker for that row ("r" = revised on updated decennial-census population controls, "t" = reflects the Vintage 2025 population-estimate methodology change), or "" when the source row carries no footnote. Never affects the numeric value — carried through purely so a reader can see why a given year looks unusual. */
  footnote: z.string(),
});

export type CensusHouseholdsRow = z.infer<typeof censusHouseholdsRowSchema>;

const EXPECTED_HEADER = "year,total_households_thousands,footnote";

/**
 * Parse the committed Census households CSV. Deliberately not a general CSV
 * parser (no quoting/escaping support) — same reasoning as
 * ../cbo/baseline-deficit.ts's parser: this file is hand-authored by us
 * from a real source, with plain columns and no embedded commas.
 */
export function parseCensusHouseholdsCsv(csv: string): CensusHouseholdsRow[] {
  const lines = csv
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  const [header, ...rows] = lines;
  if (header !== EXPECTED_HEADER) {
    throw new Error(`unexpected Census households CSV header: ${JSON.stringify(header)}, expected ${JSON.stringify(EXPECTED_HEADER)}`);
  }
  return rows.map((line, i) => {
    const parts = line.split(",");
    if (parts.length !== 3) {
      throw new Error(`Census households CSV row ${i + 2} has ${parts.length} columns, expected 3: ${JSON.stringify(line)}`);
    }
    const [year, total_households_thousands, footnote] = parts as [string, string, string];
    return censusHouseholdsRowSchema.parse({ year, total_households_thousands, footnote });
  });
}
