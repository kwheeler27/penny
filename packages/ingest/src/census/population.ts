/**
 * Census Bureau Population Estimates Program (PEP), Vintage 2025 national
 * total — feeds `census.population.resident_total`. Like CBO (see
 * ../cbo/baseline-deficit.ts), Census's national/state population totals
 * dataset has no query API for this repo's purposes (PEP publishes static
 * CSV/XLSX files per vintage, not a keyless REST endpoint) — this is a
 * hand-extracted CSV committed at
 * db/fixtures/raw/census/population/, refreshed manually whenever a new
 * vintage is released (roughly once a year; see that directory's SOURCE.md
 * for the exact file, URL, and retrieval method).
 *
 * The CSV keeps only the national row (SUMLEV=010, STATE=00) from Census's
 * own NST-EST2025-ALLDATA.csv, with the six annual POPESTIMATE20XX columns
 * (2020-2025) — Census's own "population as of July 1 of year X" reading.
 */
import { z } from "zod";

const YEAR_COLUMNS = [2020, 2021, 2022, 2023, 2024, 2025] as const;
export type PopulationEstimateYear = (typeof YEAR_COLUMNS)[number];

const NUMERIC_STRING_RE = /^\d+$/;

export const censusPopulationRowSchema = z
  .object({
    SUMLEV: z.string(),
    STATE: z.string(),
    NAME: z.string(),
  })
  .catchall(z.string().regex(NUMERIC_STRING_RE));

export type CensusPopulationRow = z.infer<typeof censusPopulationRowSchema>;

const EXPECTED_HEADER =
  "SUMLEV,STATE,NAME,POPESTIMATE2020,POPESTIMATE2021,POPESTIMATE2022,POPESTIMATE2023,POPESTIMATE2024,POPESTIMATE2025";

/**
 * Parse the committed Census national-population CSV. Deliberately not a
 * general CSV parser (no quoting/escaping support) — the file is a
 * hand-trimmed subset of a real Census download with plain numeric columns
 * and no embedded commas, not a passthrough of an arbitrary external CSV —
 * same reasoning as ../cbo/baseline-deficit.ts's parser.
 */
export function parseCensusPopulationCsv(csv: string): CensusPopulationRow[] {
  const lines = csv
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  const [header, ...rows] = lines;
  if (header !== EXPECTED_HEADER) {
    throw new Error(`unexpected Census population CSV header: ${JSON.stringify(header)}, expected ${JSON.stringify(EXPECTED_HEADER)}`);
  }
  const columns = header!.split(",");
  return rows.map((line, i) => {
    const parts = line.split(",");
    if (parts.length !== columns.length) {
      throw new Error(`Census population CSV row ${i + 2} has ${parts.length} columns, expected ${columns.length}: ${JSON.stringify(line)}`);
    }
    const record: Record<string, string> = {};
    columns.forEach((col, idx) => {
      record[col] = parts[idx]!;
    });
    return censusPopulationRowSchema.parse(record);
  });
}

/** The single national row (SUMLEV 010, STATE 00, "United States") — throws if it's missing or duplicated, since every downstream observation depends on there being exactly one. */
export function findNationalRow(rows: readonly CensusPopulationRow[]): CensusPopulationRow {
  const matches = rows.filter((r) => r.SUMLEV === "010" && r.STATE === "00");
  if (matches.length !== 1) {
    throw new Error(`expected exactly one national row (SUMLEV=010, STATE=00), found ${matches.length}`);
  }
  return matches[0]!;
}

/** The exact published value (whole persons, as a decimal string — never Number()'d) for a given POPESTIMATE year column. */
export function populationEstimateFor(row: CensusPopulationRow, year: PopulationEstimateYear): string {
  const value = row[`POPESTIMATE${year}`];
  if (value === undefined) throw new Error(`row has no POPESTIMATE${year} column`);
  return value;
}

export { YEAR_COLUMNS as POPULATION_ESTIMATE_YEARS };
