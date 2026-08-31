import { describe, expect, it } from "vitest";
import { toFiscalFlowInput } from "../lib/fiscal-flow-input";
import type { MtsFlow } from "../lib/series-data";
import type { SeriesId } from "@penny/registry";
import type { Reading } from "../lib/types";

function reading(seriesId: SeriesId, value: string): Reading {
  return {
    seriesId,
    periodType: "month",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    fiscalYear: 2026,
    value,
    publicationTime: "2026-08-12T00:00:00.000Z",
    revisionOf: null,
  };
}

describe("toFiscalFlowInput", () => {
  it("returns null when nothing has been ingested for this period at all", () => {
    const emptyFlow: MtsFlow = {
      periodType: "month",
      periodEnd: null,
      fiscalYear: null,
      receipts: { total: null, categories: [] },
      outlays: { total: null, categories: [] },
      deficit: null,
    };
    expect(toFiscalFlowInput(emptyFlow)).toBeNull();
  });

  it("returns null (not a degenerate empty diagram) when a period_end exists but every category is a gap", () => {
    const noCategoriesFlow: MtsFlow = {
      periodType: "month",
      periodEnd: "2026-07-31",
      fiscalYear: 2026,
      receipts: {
        total: reading("fiscal.mts.receipts.total" as SeriesId, "500000"),
        categories: [{ id: "fiscal.mts.receipts.category.excise_taxes" as SeriesId, label: "Excise taxes", reading: null }],
      },
      outlays: { total: null, categories: [{ id: "fiscal.mts.outlays.category.national_defense" as SeriesId, label: "National defense", reading: null }] },
      deficit: null,
    };
    expect(toFiscalFlowInput(noCategoriesFlow)).toBeNull();
  });

  it("maps a real flow to FiscalFlowInput, passing exact decimal strings straight through", () => {
    const flow: MtsFlow = {
      periodType: "fiscal_ytd",
      periodEnd: "2026-07-31",
      fiscalYear: 2026,
      receipts: {
        total: reading("fiscal.mts.receipts.total" as SeriesId, "500000"),
        categories: [
          { id: "fiscal.mts.receipts.category.individual_income_tax" as SeriesId, label: "Individual income taxes", reading: reading("fiscal.mts.receipts.category.individual_income_tax" as SeriesId, "300000") },
          { id: "fiscal.mts.receipts.category.excise_taxes" as SeriesId, label: "Excise taxes", reading: null },
        ],
      },
      outlays: {
        total: reading("fiscal.mts.outlays.total" as SeriesId, "600000"),
        categories: [{ id: "fiscal.mts.outlays.category.national_defense" as SeriesId, label: "National defense", reading: reading("fiscal.mts.outlays.category.national_defense" as SeriesId, "200000") }],
      },
      deficit: reading("fiscal.mts.deficit.total" as SeriesId, "-100000"),
    };

    const input = toFiscalFlowInput(flow);
    expect(input).not.toBeNull();
    expect(input?.period).toEqual({ periodType: "fiscal_ytd", periodEnd: "2026-07-31", fiscalYear: 2026 });
    expect(input?.unit).toBe("usd");
    expect(input?.magnitude).toBe("ones"); // read from the registry, not hardcoded
    expect(input?.receipts).toEqual([
      { seriesId: "fiscal.mts.receipts.category.individual_income_tax", value: "300000" },
      { seriesId: "fiscal.mts.receipts.category.excise_taxes", value: undefined },
    ]);
    expect(input?.outlays).toEqual([{ seriesId: "fiscal.mts.outlays.category.national_defense", value: "200000" }]);
    expect(input?.receiptsTotalSeriesId).toBe("fiscal.mts.receipts.total");
    expect(input?.outlaysTotalSeriesId).toBe("fiscal.mts.outlays.total");
    expect(input?.deficitSeriesId).toBe("fiscal.mts.deficit.total");
  });

  it("throws rather than silently mis-scaling a value when a referenced series' magnitude does not match the flow's shared magnitude", () => {
    // fiscal.mts.receipts.total is registry magnitude "ones";
    // projection.cbo.baseline.deficit is registry magnitude "billions". A
    // real MtsFlow could never actually mix these two under one category
    // list, but the check must not silently trust the input shape — it
    // walks every referenced id, so a real future series with a mismatched
    // magnitude is caught here rather than rendering 10^9 off.
    const flow: MtsFlow = {
      periodType: "month",
      periodEnd: "2026-07-31",
      fiscalYear: 2026,
      receipts: {
        total: reading("fiscal.mts.receipts.total" as SeriesId, "500000"),
        categories: [{ id: "projection.cbo.baseline.deficit" as SeriesId, label: "CBO baseline deficit", reading: reading("projection.cbo.baseline.deficit" as SeriesId, "1000") }],
      },
      outlays: { total: null, categories: [] },
      deficit: null,
    };
    expect(() => toFiscalFlowInput(flow)).toThrow(/magnitude/i);
  });
});
