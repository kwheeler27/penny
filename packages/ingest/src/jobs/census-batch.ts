/**
 * Census Bureau batch ingest — feeds `census.population.resident_total`
 * (Population Estimates Program, Vintage 2025) and `census.households.total`
 * (Historical Households Tables, Table HH-1). Neither source has a query
 * API for this repo's purposes (PLAN.md §6-style constraint, same as CBO's
 * baseline — see ../cbo/baseline-deficit.ts); both are manual batch loaders
 * run by hand after a refreshed CSV is committed to
 * db/fixtures/raw/census/{population,households}/ — see those directories'
 * SOURCE.md for how each was extracted and how to refresh them.
 *
 * publication_time for every row in a given batch is that batch's own
 * release date (a real, published date — not a proxy): the Vintage 2025
 * press release date for population, the Table HH-1 release date for
 * households (see households/SOURCE.md for why that one is a reasoned
 * inference rather than a Bureau-confirmed exact day).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  parseCensusPopulationCsv,
  findNationalRow,
  populationEstimateFor,
  POPULATION_ESTIMATE_YEARS,
} from "../census/population";
import { parseCensusHouseholdsCsv, type CensusHouseholdsRow } from "../census/households";
import { upsertObservations, type UpsertManySummary } from "../lib/upsert";
import type { RawObservation } from "../lib/types";
import { getDb, type PennyDb } from "@penny/db";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..");

export const CENSUS_POPULATION_CSV_PATH = join(
  REPO_ROOT,
  "db",
  "fixtures",
  "raw",
  "census",
  "population",
  "NST-EST2025-ALLDATA-national.csv",
);
// Press release CB26-20, "U.S. Population Growth Slows Due to Historic
// Decline in Net International Migration" — see
// db/fixtures/raw/census/population/SOURCE.md.
export const CENSUS_POPULATION_PUBLICATION_DATE = "2026-01-27";

export const CENSUS_HOUSEHOLDS_CSV_PATH = join(
  REPO_ROOT,
  "db",
  "fixtures",
  "raw",
  "census",
  "households",
  "hh1-total-households.csv",
);
// Table HH-1's own "Internet Release Date: December 2025" plus the
// concurrent CB25-197 press release date — see
// db/fixtures/raw/census/households/SOURCE.md for why this is a reasoned
// inference, not a Bureau-confirmed exact day.
export const CENSUS_HOUSEHOLDS_PUBLICATION_DATE = "2025-12-02";

/** Each POPESTIMATE year is a point-in-time reading as of July 1 of that year (periodType "day", periodStart = periodEnd), same shape as fiscal.debt/fiscal.tga's daily point-in-time series — population is a stock, not a period flow. fiscalYear is null: this is a calendar reference date, not a federal fiscal year. */
export function parseCensusPopulationRows(csv: string, publicationDate: string): RawObservation[] {
  const rows = parseCensusPopulationCsv(csv);
  const national = findNationalRow(rows);
  return POPULATION_ESTIMATE_YEARS.map((year) => {
    const asOf = `${year}-07-01`;
    return {
      seriesId: "census.population.resident_total",
      periodType: "day",
      periodStart: asOf,
      periodEnd: asOf,
      fiscalYear: null,
      value: populationEstimateFor(national, year),
      publicationTime: `${publicationDate}T00:00:00Z`,
    };
  });
}

/** Table HH-1 labels each row by calendar year, not a specific day (the CPS ASEC survey is fielded primarily in March, but the source publishes no more granular date) — periodType "year" spanning the full calendar year is the closest honest fit to how Census itself labels the row; see the registry entry's notes for the caveat that this is a spring-survey snapshot, not a full-year average. fiscalYear is null: a calendar-year label, not a federal fiscal year. */
export function parseCensusHouseholdsRows(csv: string, publicationDate: string): RawObservation[] {
  const rows: CensusHouseholdsRow[] = parseCensusHouseholdsCsv(csv);
  return rows.map((row) => {
    const year = Number(row.year);
    return {
      seriesId: "census.households.total",
      periodType: "year",
      periodStart: `${year}-01-01`,
      periodEnd: `${year}-12-31`,
      fiscalYear: null,
      value: row.total_households_thousands,
      publicationTime: `${publicationDate}T00:00:00Z`,
    };
  });
}

export interface CensusBatchJobResult {
  populationCsvPath: string;
  householdsCsvPath: string;
  summary: UpsertManySummary;
}

export async function runCensusBatchJob(db: PennyDb): Promise<CensusBatchJobResult> {
  const populationCsv = readFileSync(CENSUS_POPULATION_CSV_PATH, "utf8");
  const householdsCsv = readFileSync(CENSUS_HOUSEHOLDS_CSV_PATH, "utf8");
  const observations: RawObservation[] = [
    ...parseCensusPopulationRows(populationCsv, CENSUS_POPULATION_PUBLICATION_DATE),
    ...parseCensusHouseholdsRows(householdsCsv, CENSUS_HOUSEHOLDS_PUBLICATION_DATE),
  ];
  const summary = await upsertObservations(db, observations);
  return { populationCsvPath: CENSUS_POPULATION_CSV_PATH, householdsCsvPath: CENSUS_HOUSEHOLDS_CSV_PATH, summary };
}

async function main() {
  const db = getDb();
  const result = await runCensusBatchJob(db);
  console.log(
    `Census batch ingest complete from ${result.populationCsvPath} + ${result.householdsCsvPath}: +${result.summary.inserted} ~${result.summary.revised} =${result.summary.unchanged}`,
  );
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
