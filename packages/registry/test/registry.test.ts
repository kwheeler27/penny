import { describe, expect, it } from "vitest";
import { SERIES, SERIES_IDS, getSeries, citationFor, incomparabilityReason } from "../src/index";

describe("@penny/registry generated catalog", () => {
  it("seeds every Phase 1 series family", () => {
    // Not an exhaustive list — a sample from each family, so this test
    // fails loudly if codegen silently drops a whole branch of series/**.
    const expectedSample = [
      "fiscal.mts.receipts.total",
      "fiscal.mts.receipts.category.individual_income_tax",
      "fiscal.mts.outlays.total",
      "fiscal.mts.outlays.category.national_defense",
      "fiscal.mts.outlays.category.net_interest",
      "fiscal.mts.deficit.total",
      "fiscal.debt.total_public_debt_outstanding",
      "fiscal.debt.interest_expense_total",
      "fiscal.tga.closing_balance",
      "price.cpi_u.all_items",
      "projection.cbo.baseline.deficit",
      "census.population.resident_total",
      "census.households.total",
    ];
    for (const id of expectedSample) {
      expect(SERIES_IDS).toContain(id);
    }
  });

  it("has 7 receipt categories that are distinct from the 20 outlay budget functions", () => {
    const receiptCategories = SERIES_IDS.filter((id) => id.startsWith("fiscal.mts.receipts.category."));
    const outlayCategories = SERIES_IDS.filter((id) => id.startsWith("fiscal.mts.outlays.category."));
    expect(receiptCategories).toHaveLength(7);
    expect(outlayCategories).toHaveLength(20);
  });

  it("every series carries the fields the objectivity hard rule requires", () => {
    for (const id of SERIES_IDS) {
      const def = SERIES[id];
      expect(def.agency, id).toBeTruthy();
      expect(def.dataset, id).toBeTruthy();
      expect(def.datasetUrl, id).toMatch(/^https:\/\//);
      expect(def.citation, id).toBeTruthy();
      expect(def.definition.length, id).toBeGreaterThan(10);
      expect(["usd", "index_point", "persons", "households"], id).toContain(def.unit);
      expect(["ones", "thousands", "millions", "billions"], id).toContain(def.magnitude);
    }
  });

  it("getSeries returns undefined (not a throw) for an unknown id", () => {
    expect(getSeries("not.a.real.series")).toBeUndefined();
  });

  it("citationFor substitutes {access_date} and never leaves the token behind", () => {
    const text = citationFor("fiscal.debt.total_public_debt_outstanding", "2026-08-29");
    expect(text).toContain("2026-08-29");
    for (const id of SERIES_IDS) {
      expect(citationFor(id, "2026-08-29")).not.toContain("{access_date}");
    }
  });

  it("flags CBO's projection as incomparable with MTS's observed deficit", () => {
    const reason = incomparabilityReason("projection.cbo.baseline.deficit", "fiscal.mts.deficit.total");
    expect(reason).toBeTruthy();
    expect(reason).toMatch(/projection|observed/i);
  });

  it("flags gross interest expense as incomparable with the net-interest outlay function", () => {
    const reason = incomparabilityReason(
      "fiscal.debt.interest_expense_total",
      "fiscal.mts.outlays.category.net_interest",
    );
    expect(reason).toBeTruthy();
  });

  it("falls back to a generic accounting_concept-mismatch reason when no edge is declared", () => {
    const reason = incomparabilityReason("fiscal.debt.total_public_debt_outstanding", "fiscal.mts.deficit.total");
    expect(reason).toMatch(/accounting concept/i);
  });

  it("returns null for two series with the same accounting_concept and no declared edge", () => {
    const reason = incomparabilityReason(
      "fiscal.mts.outlays.category.national_defense",
      "fiscal.mts.outlays.category.medicare",
    );
    expect(reason).toBeNull();
  });

  it("returns null comparing a series with itself", () => {
    expect(incomparabilityReason("fiscal.mts.receipts.total", "fiscal.mts.receipts.total")).toBeNull();
  });

  it("Census population/households series carry the persons/households unit and accounting_concept", () => {
    const pop = SERIES["census.population.resident_total"];
    const hh = SERIES["census.households.total"];
    expect(pop.unit).toBe("persons");
    expect(pop.accountingConcept).toBe("population");
    expect(hh.unit).toBe("households");
    expect(hh.accountingConcept).toBe("households");
    // Both are Census estimates, not dollar figures — measurement honesty.
    expect(pop.definition.toLowerCase()).toContain("estimate");
    expect(hh.definition.toLowerCase()).toContain("estimate");
  });

  it("flags Census population and households as incomparable with each other (declared edge)", () => {
    const reason = incomparabilityReason("census.population.resident_total", "census.households.total");
    expect(reason).toBeTruthy();
    expect(reason).toMatch(/household|person/i);
  });

  it("flags a Census demographic series as incomparable with a fiscal usd series (generic concept-mismatch guard)", () => {
    const reason = incomparabilityReason("census.population.resident_total", "fiscal.debt.total_public_debt_outstanding");
    expect(reason).toMatch(/accounting concept/i);
  });
});
