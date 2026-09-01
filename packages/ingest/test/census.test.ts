/**
 * Census batch ingest tests — fixture loads, values exact (decimal-string
 * equality, never a float compare), and registry citation fields present.
 * Mirrors the rigor of test/reconciliation.test.ts and the CBO baseline's
 * own coverage, scaled to what a two-series, non-API batch source needs.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { SERIES } from "@penny/registry";
import {
  parseCensusPopulationCsv,
  findNationalRow,
  populationEstimateFor,
  POPULATION_ESTIMATE_YEARS,
} from "../src/census/population";
import { parseCensusHouseholdsCsv } from "../src/census/households";
import {
  parseCensusPopulationRows,
  parseCensusHouseholdsRows,
  runCensusBatchJob,
  CENSUS_POPULATION_CSV_PATH,
  CENSUS_HOUSEHOLDS_CSV_PATH,
  CENSUS_POPULATION_PUBLICATION_DATE,
  CENSUS_HOUSEHOLDS_PUBLICATION_DATE,
} from "../src/jobs/census-batch";
import { createDb, runMigrations, seedSeriesCatalog } from "@penny/db";
import { observation } from "@penny/db";
import { eq } from "drizzle-orm";

const populationCsv = readFileSync(CENSUS_POPULATION_CSV_PATH, "utf8");
const householdsCsv = readFileSync(CENSUS_HOUSEHOLDS_CSV_PATH, "utf8");

describe("Census population CSV parsing", () => {
  it("loads the committed fixture and finds exactly one national row", () => {
    const rows = parseCensusPopulationCsv(populationCsv);
    expect(rows.length).toBeGreaterThan(0);
    const national = findNationalRow(rows);
    expect(national.NAME).toBe("United States");
    expect(national.SUMLEV).toBe("010");
    expect(national.STATE).toBe("00");
  });

  it("reports the exact Vintage 2025 national estimate for every year, verbatim as published (no float coercion)", () => {
    const rows = parseCensusPopulationCsv(populationCsv);
    const national = findNationalRow(rows);
    // Verified 2026-08-31 against the live NST-EST2025-ALLDATA.csv download
    // — see db/fixtures/raw/census/population/SOURCE.md.
    const expected: Record<(typeof POPULATION_ESTIMATE_YEARS)[number], string> = {
      2020: "331578104",
      2021: "332100166",
      2022: "333996304",
      2023: "336755052",
      2024: "340003797",
      2025: "341784857",
    };
    for (const year of POPULATION_ESTIMATE_YEARS) {
      expect(populationEstimateFor(national, year), `year ${year}`).toBe(expected[year]);
    }
  });

  it("rejects a CSV with an unexpected header (fail loudly on drift, never silently misparse)", () => {
    expect(() => parseCensusPopulationCsv("WRONG,HEADER\n1,2\n")).toThrow(/unexpected Census population CSV header/);
  });
});

describe("Census households CSV parsing", () => {
  it("loads the committed fixture with exact thousands values and footnotes preserved", () => {
    const rows = parseCensusHouseholdsCsv(householdsCsv);
    // Verified 2026-08-31 against the live hh1.xls download — see
    // db/fixtures/raw/census/households/SOURCE.md.
    expect(rows).toEqual([
      { year: "2020", total_households_thousands: "128451", footnote: "" },
      { year: "2021", total_households_thousands: "129224", footnote: "r" },
      { year: "2022", total_households_thousands: "131202", footnote: "" },
      { year: "2023", total_households_thousands: "131434", footnote: "" },
      { year: "2024", total_households_thousands: "132216", footnote: "" },
      { year: "2025", total_households_thousands: "134790", footnote: "t" },
    ]);
  });

  it("rejects a CSV with an unexpected header", () => {
    expect(() => parseCensusHouseholdsCsv("WRONG,HEADER\n1,2\n")).toThrow(/unexpected Census households CSV header/);
  });
});

describe("Census batch -> RawObservation transform", () => {
  it("population: periodType 'day', period_start = period_end = July 1 of the year, fiscalYear null, magnitude-exact value", () => {
    const rows = parseCensusPopulationRows(populationCsv, CENSUS_POPULATION_PUBLICATION_DATE);
    expect(rows).toHaveLength(6);
    const fy2025 = rows.find((r) => r.periodEnd === "2025-07-01");
    expect(fy2025).toEqual({
      seriesId: "census.population.resident_total",
      periodType: "day",
      periodStart: "2025-07-01",
      periodEnd: "2025-07-01",
      fiscalYear: null,
      value: "341784857",
      publicationTime: "2026-01-27T00:00:00Z",
    });
  });

  it("households: periodType 'year', period spans the calendar year, fiscalYear null, thousands-magnitude value carried through verbatim", () => {
    const rows = parseCensusHouseholdsRows(householdsCsv, CENSUS_HOUSEHOLDS_PUBLICATION_DATE);
    expect(rows).toHaveLength(6);
    const y2025 = rows.find((r) => r.periodStart === "2025-01-01");
    expect(y2025).toEqual({
      seriesId: "census.households.total",
      periodType: "year",
      periodStart: "2025-01-01",
      periodEnd: "2025-12-31",
      fiscalYear: null,
      value: "134790",
      publicationTime: "2025-12-02T00:00:00Z",
    });
  });
});

describe("Census batch job — idempotent upsert against a real (in-memory) PGlite instance", () => {
  it("inserts 12 observations, idempotent on re-run", async () => {
    const db = createDb();
    await runMigrations(db);
    await seedSeriesCatalog(db);

    const first = await runCensusBatchJob(db);
    expect(first.summary.inserted).toBe(12);
    expect(first.summary.revised).toBe(0);

    const second = await runCensusBatchJob(db);
    expect(second.summary.inserted).toBe(0);
    expect(second.summary.unchanged).toBe(12);

    const popRows = await db.select().from(observation).where(eq(observation.seriesId, "census.population.resident_total"));
    expect(popRows).toHaveLength(6);
    const hhRows = await db.select().from(observation).where(eq(observation.seriesId, "census.households.total"));
    expect(hhRows).toHaveLength(6);
  });
});

describe("Registry citation fields — objectivity hard rule (CLAUDE.md)", () => {
  it("both Census series carry agency/dataset/datasetUrl/citation/definition, and flag themselves as estimates", () => {
    for (const id of ["census.population.resident_total", "census.households.total"] as const) {
      const def = SERIES[id];
      expect(def, id).toBeDefined();
      expect(def.agency, id).toBe("U.S. Census Bureau");
      expect(def.dataset, id).toBeTruthy();
      expect(def.datasetUrl, id).toMatch(/^https:\/\/www\.census\.gov\//);
      expect(def.citation, id).toBeTruthy();
      expect(def.citation, id).toContain("{access_date}"); // substituted only at render time by citationFor() — see registry.test.ts
      expect(def.definition.length, id).toBeGreaterThan(10);
      expect(def.cadence, id).toBe("annual");
      // Measurement honesty: these are estimates, never presented as an exact count.
      expect(def.definition.toLowerCase() + def.notes.join(" ").toLowerCase(), id).toContain("estimate");
    }
  });

  it("population series: unit persons, magnitude ones, accounting_concept population", () => {
    const def = SERIES["census.population.resident_total"];
    expect(def.unit).toBe("persons");
    expect(def.magnitude).toBe("ones");
    expect(def.accountingConcept).toBe("population");
  });

  it("households series: unit households, magnitude thousands (as published), accounting_concept households", () => {
    const def = SERIES["census.households.total"];
    expect(def.unit).toBe("households");
    expect(def.magnitude).toBe("thousands");
    expect(def.accountingConcept).toBe("households");
  });
});
