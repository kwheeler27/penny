import { describe, expect, it } from "vitest";
import { buildFiscalFlowGraph } from "../src/layout/buildFiscalFlowGraph";
import { summarizeFlows } from "../src/layout/summarize";
import type { FiscalFlowInput, SeriesCatalog, SeriesDef, SeriesId } from "../src/types";

function fakeSeries(id: string, label: string): SeriesDef {
  return {
    id,
    label,
    definition: `${label} — test fixture definition.`,
    aliases: [],
    agency: "Test Agency",
    dataset: "Test Dataset",
    datasetUrl: "https://example.gov/test",
    unit: "usd",
    magnitude: "millions",
    accountingConcept: id.includes("receipt") ? "receipt" : id.includes("outlay") ? "outlay" : "deficit",
    cadence: "monthly",
    citation: "Test Agency, Test Dataset. Accessed {access_date}.",
    notes: [],
    notComparableWith: [],
  };
}

const CATALOG: SeriesCatalog = {
  "fiscal.mts.receipts.category.individual_income_tax": fakeSeries("fiscal.mts.receipts.category.individual_income_tax", "Individual income taxes"),
  "fiscal.mts.outlays.category.national_defense": fakeSeries("fiscal.mts.outlays.category.national_defense", "National defense"),
  "fiscal.mts.deficit.total": fakeSeries("fiscal.mts.deficit.total", "Budget deficit or surplus"),
};

const input: FiscalFlowInput = {
  period: { periodType: "month", periodEnd: "2026-07-31", fiscalYear: 2026 },
  unit: "usd",
  magnitude: "millions",
  receiptsTotalSeriesId: "fiscal.mts.receipts.total" as SeriesId,
  outlaysTotalSeriesId: "fiscal.mts.outlays.total" as SeriesId,
  deficitSeriesId: "fiscal.mts.deficit.total" as SeriesId,
  receipts: [{ seriesId: "fiscal.mts.receipts.category.individual_income_tax" as SeriesId, value: "180000" }],
  outlays: [{ seriesId: "fiscal.mts.outlays.category.national_defense" as SeriesId, value: "280000" }],
};

describe("summarizeFlows (SVG text alternative)", () => {
  it("names the period, both totals, top categories, and the deficit direction", () => {
    const graph = buildFiscalFlowGraph(input);
    const text = summarizeFlows(graph, CATALOG);
    expect(text).toContain("2026-07-31");
    expect(text).toContain("Individual income taxes");
    expect(text).toContain("National defense");
    expect(text).toMatch(/borrowing/i);
    expect(text).toContain("$180.0B");
    expect(text).toContain("$280.0B");
  });

  it("names a surplus correctly when receipts exceed outlays", () => {
    const graph = buildFiscalFlowGraph({ ...input, outlays: [{ seriesId: "fiscal.mts.outlays.category.national_defense" as SeriesId, value: "50000" }] });
    const text = summarizeFlows(graph, CATALOG);
    expect(text).toMatch(/surplus/i);
    expect(text).not.toMatch(/borrowing/i);
  });

  it("notes omitted categories by count without pretending they are zero", () => {
    const graph = buildFiscalFlowGraph({
      ...input,
      outlays: [
        { seriesId: "fiscal.mts.outlays.category.national_defense" as SeriesId, value: "280000" },
        { seriesId: "fiscal.mts.outlays.category.energy" as SeriesId, value: undefined },
      ],
    });
    const text = summarizeFlows(graph, CATALOG);
    expect(text).toMatch(/1 categor(y|ies) had no reading/);
  });
});
