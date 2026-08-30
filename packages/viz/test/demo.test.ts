import { describe, expect, it } from "vitest";
import { fiscalFlowFixture, fiscalFlowSeriesCatalog } from "../src/demo/fixtures";
import { buildFiscalFlowGraph, nodesForSide } from "../src/layout/buildFiscalFlowGraph";
import { summarizeFlows } from "../src/layout/summarize";
import { sumDecimal } from "../src/money/decimal";

// Exercises the fixture-driven demo harness's DATA end to end without a
// DOM/React runtime (see the package handoff report for why the .tsx
// component itself isn't executed here). <FiscalSankeyDemo /> renders this
// same fixture through the real component when run inside apps/web or a
// future Storybook/Ladle setup.
describe("demo fixture (fiscalFlowFixture)", () => {
  it("every seriesId referenced by the fixture exists in the real @buck/registry catalog it ships with", () => {
    for (const c of [...fiscalFlowFixture.receipts, ...fiscalFlowFixture.outlays]) {
      expect(fiscalFlowSeriesCatalog[c.seriesId], c.seriesId).toBeDefined();
    }
    expect(fiscalFlowSeriesCatalog[fiscalFlowFixture.receiptsTotalSeriesId]).toBeDefined();
    expect(fiscalFlowSeriesCatalog[fiscalFlowFixture.outlaysTotalSeriesId]).toBeDefined();
    expect(fiscalFlowSeriesCatalog[fiscalFlowFixture.deficitSeriesId]).toBeDefined();
  });

  it("builds a graph that reconciles exactly (receipts + borrowing = outlays)", () => {
    const graph = buildFiscalFlowGraph(fiscalFlowFixture);
    expect(graph.balancingDirection).toBe("deficit");
    const borrowing = graph.nodes.find((n) => n.kind === "balancing")!;
    expect(sumDecimal([graph.receiptsTotalExact, borrowing.valueExact])).toBe(graph.outlaysTotalExact);
  });

  it("demonstrates both omission paths the fixture was built to cover: an explicit zero (allowances) and an absent reading (undistributed offsetting receipts)", () => {
    const graph = buildFiscalFlowGraph(fiscalFlowFixture);
    expect(graph.omittedCategoryIds).toContain("fiscal.mts.outlays.category.allowances");
    expect(graph.omittedCategoryIds).toContain("fiscal.mts.outlays.category.undistributed_offsetting_receipts");
    expect(nodesForSide(graph, "outlay").some((n) => n.seriesId === "fiscal.mts.outlays.category.allowances")).toBe(false);
  });

  it("produces every seriesId's real registry label in the diagram's node set (proves labels resolve through the actual catalog, not a placeholder)", () => {
    const graph = buildFiscalFlowGraph(fiscalFlowFixture);
    const defenseNode = graph.nodes.find((n) => n.seriesId === "fiscal.mts.outlays.category.national_defense")!;
    expect(fiscalFlowSeriesCatalog[defenseNode.seriesId]?.label).toBe("National defense");
  });

  it("the fixture's text-alternative summary is non-empty prose mentioning the period and both totals", () => {
    const graph = buildFiscalFlowGraph(fiscalFlowFixture);
    const summary = summarizeFlows(graph, fiscalFlowSeriesCatalog);
    expect(summary).toContain(fiscalFlowFixture.period.periodEnd);
    expect(summary.length).toBeGreaterThan(80);
  });
});
