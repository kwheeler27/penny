import { describe, expect, it } from "vitest";
import { buildFiscalFlowGraph, nodesForSide, FISCAL_FLOW_HUB_ID, FISCAL_FLOW_BORROWING_ID, FISCAL_FLOW_SURPLUS_ID } from "../src/layout/buildFiscalFlowGraph";
import { sumDecimal } from "../src/money/decimal";
import type { FiscalFlowInput, SeriesId } from "../src/types";

const PERIOD = { periodType: "month" as const, periodEnd: "2026-07-31", fiscalYear: 2026 };
const RECEIPTS_TOTAL = "fiscal.mts.receipts.total" as SeriesId;
const OUTLAYS_TOTAL = "fiscal.mts.outlays.total" as SeriesId;
const DEFICIT = "fiscal.mts.deficit.total" as SeriesId;

function baseInput(overrides: Partial<FiscalFlowInput> = {}): FiscalFlowInput {
  return {
    period: PERIOD,
    unit: "usd",
    magnitude: "millions",
    receiptsTotalSeriesId: RECEIPTS_TOTAL,
    outlaysTotalSeriesId: OUTLAYS_TOTAL,
    deficitSeriesId: DEFICIT,
    receipts: [
      { seriesId: "fiscal.mts.receipts.category.individual_income_tax" as SeriesId, value: "180000" },
      { seriesId: "fiscal.mts.receipts.category.corporation_income_tax" as SeriesId, value: "35000" },
      { seriesId: "fiscal.mts.receipts.category.social_insurance_retirement" as SeriesId, value: "120000" },
    ],
    outlays: [
      { seriesId: "fiscal.mts.outlays.category.national_defense" as SeriesId, value: "80000" },
      { seriesId: "fiscal.mts.outlays.category.social_security" as SeriesId, value: "130000" },
      { seriesId: "fiscal.mts.outlays.category.medicare" as SeriesId, value: "95000" },
    ],
    ...overrides,
  };
}

describe("buildFiscalFlowGraph — node ordering", () => {
  it("orders category nodes descending by value within each side", () => {
    // baseInput() is a surplus month (receipts 335000 > outlays 305000), so
    // nodesForSide(..., "outlay") also carries the trailing surplus node —
    // that placement is asserted separately below; here we isolate category
    // ordering by filtering it out.
    const graph = buildFiscalFlowGraph(baseInput());
    const receiptOrder = nodesForSide(graph, "receipt")
      .filter((n) => n.kind === "category")
      .map((n) => n.seriesId);
    expect(receiptOrder).toEqual([
      "fiscal.mts.receipts.category.individual_income_tax", // 180000
      "fiscal.mts.receipts.category.social_insurance_retirement", // 120000
      "fiscal.mts.receipts.category.corporation_income_tax", // 35000
    ]);
    const outlayOrder = nodesForSide(graph, "outlay")
      .filter((n) => n.kind === "category")
      .map((n) => n.seriesId);
    expect(outlayOrder).toEqual([
      "fiscal.mts.outlays.category.social_security", // 130000
      "fiscal.mts.outlays.category.medicare", // 95000
      "fiscal.mts.outlays.category.national_defense", // 80000
    ]);
  });

  it("places the balancing (borrowing) node LAST in its column regardless of its magnitude, never sorted among categories by value", () => {
    // Force a deficit: outlays (405000) > receipts (335000), so borrowing
    // (70000) lands on the receipt side. It is bigger than the smallest
    // real receipt category (corporation income tax, 35000) but must still
    // render last, never reordered up by value.
    const graph = buildFiscalFlowGraph(
      baseInput({
        outlays: [
          { seriesId: "fiscal.mts.outlays.category.national_defense" as SeriesId, value: "180000" },
          { seriesId: "fiscal.mts.outlays.category.social_security" as SeriesId, value: "130000" },
          { seriesId: "fiscal.mts.outlays.category.medicare" as SeriesId, value: "95000" },
        ],
      }),
    );
    expect(graph.balancingDirection).toBe("deficit");
    expect(graph.balancingExact).toBe("70000");
    const receiptOrder = nodesForSide(graph, "receipt").map((n) => n.id);
    expect(receiptOrder[receiptOrder.length - 1]).toBe(FISCAL_FLOW_BORROWING_ID);
    // and it's genuinely bigger than at least one category ranked ahead of it — this isn't passing merely because it's the smallest value too.
    const corpTaxIndex = receiptOrder.indexOf("fiscal.mts.receipts.category.corporation_income_tax" as SeriesId);
    expect(corpTaxIndex).toBeLessThan(receiptOrder.length - 1);
  });

  it("breaks ties deterministically by seriesId, independent of input array order", () => {
    const tiedInput = baseInput({
      receipts: [
        { seriesId: "fiscal.mts.receipts.category.social_insurance_retirement" as SeriesId, value: "100000" },
        { seriesId: "fiscal.mts.receipts.category.individual_income_tax" as SeriesId, value: "100000" },
      ],
    });
    const a = nodesForSide(buildFiscalFlowGraph(tiedInput), "receipt").map((n) => n.seriesId);
    const b = nodesForSide(
      buildFiscalFlowGraph({
        ...tiedInput,
        receipts: [...tiedInput.receipts].reverse(),
      }),
      "receipt",
    ).map((n) => n.seriesId);
    expect(a).toEqual(b);
  });
});

describe("buildFiscalFlowGraph — exact conservation", () => {
  it("rendered flow totals equal input totals exactly (decimal-safe, not float)", () => {
    const graph = buildFiscalFlowGraph(baseInput());
    const receiptLinkSum = sumDecimal(graph.links.filter((l) => l.kind === "category" && l.targetId === FISCAL_FLOW_HUB_ID).map((l) => l.valueExact));
    const outlayLinkSum = sumDecimal(graph.links.filter((l) => l.kind === "category" && l.sourceId === FISCAL_FLOW_HUB_ID).map((l) => l.valueExact));
    expect(receiptLinkSum).toBe(graph.receiptsTotalExact);
    expect(outlayLinkSum).toBe(graph.outlaysTotalExact);
    expect(graph.receiptsTotalExact).toBe("335000");
    expect(graph.outlaysTotalExact).toBe("305000");
  });

  it("deficit case: receipts + borrowing = outlays, exactly", () => {
    // receipts 335000 < outlays 305000? no — flip fixture so outlays > receipts for a real deficit.
    const graph = buildFiscalFlowGraph(
      baseInput({
        outlays: [
          { seriesId: "fiscal.mts.outlays.category.national_defense" as SeriesId, value: "280000" },
          { seriesId: "fiscal.mts.outlays.category.social_security" as SeriesId, value: "130000" },
          { seriesId: "fiscal.mts.outlays.category.medicare" as SeriesId, value: "95000" },
        ],
      }),
    );
    expect(graph.balancingDirection).toBe("deficit");
    const borrowing = graph.nodes.find((n) => n.id === FISCAL_FLOW_BORROWING_ID);
    expect(borrowing).toBeDefined();
    expect(sumDecimal([graph.receiptsTotalExact, borrowing!.valueExact])).toBe(graph.outlaysTotalExact);
    expect(graph.nodes.find((n) => n.id === FISCAL_FLOW_SURPLUS_ID)).toBeUndefined();
  });

  it("surplus case: receipts = outlays + surplus, exactly, and no borrowing node exists", () => {
    const graph = buildFiscalFlowGraph(baseInput()); // receipts 335000 > outlays 305000
    expect(graph.balancingDirection).toBe("surplus");
    const surplus = graph.nodes.find((n) => n.id === FISCAL_FLOW_SURPLUS_ID);
    expect(surplus).toBeDefined();
    expect(sumDecimal([graph.outlaysTotalExact, surplus!.valueExact])).toBe(graph.receiptsTotalExact);
    expect(graph.nodes.find((n) => n.id === FISCAL_FLOW_BORROWING_ID)).toBeUndefined();
  });

  it("balanced case: no balancing node/link at all when receipts exactly equal outlays", () => {
    const graph = buildFiscalFlowGraph(
      baseInput({
        outlays: [
          { seriesId: "fiscal.mts.outlays.category.national_defense" as SeriesId, value: "80000" },
          { seriesId: "fiscal.mts.outlays.category.social_security" as SeriesId, value: "130000" },
          { seriesId: "fiscal.mts.outlays.category.medicare" as SeriesId, value: "125000" }, // sum = 335000 = receipts
        ],
      }),
    );
    expect(graph.balancingDirection).toBe("balanced");
    expect(graph.balancingExact).toBe("0");
    expect(graph.nodes.find((n) => n.kind === "balancing")).toBeUndefined();
    expect(graph.links.find((l) => l.kind === "balancing")).toBeUndefined();
  });

  it("negative-valued categories (e.g. undistributed offsetting receipts) still sum exactly into the total, even though they are not yet visually distinguishable in the rendered ribbon (see sankeyGeometry known-gap note)", () => {
    const graph = buildFiscalFlowGraph(
      baseInput({
        outlays: [
          { seriesId: "fiscal.mts.outlays.category.national_defense" as SeriesId, value: "80000" },
          { seriesId: "fiscal.mts.outlays.category.undistributed_offsetting_receipts" as SeriesId, value: "-25000" },
        ],
      }),
    );
    expect(graph.outlaysTotalExact).toBe("55000");
  });
});

describe("buildFiscalFlowGraph — missing/zero category handling", () => {
  it("omits a category with value undefined (no reading this period) — never a zero-height node", () => {
    const graph = buildFiscalFlowGraph(
      baseInput({
        outlays: [
          { seriesId: "fiscal.mts.outlays.category.national_defense" as SeriesId, value: "80000" },
          { seriesId: "fiscal.mts.outlays.category.energy" as SeriesId, value: undefined },
        ],
      }),
    );
    expect(graph.nodes.find((n) => n.seriesId === "fiscal.mts.outlays.category.energy")).toBeUndefined();
    expect(graph.omittedCategoryIds).toContain("fiscal.mts.outlays.category.energy");
    expect(graph.outlaysTotalExact).toBe("80000");
  });

  it("omits a category with an explicit zero value — never rendered as a zero-height ghost", () => {
    const graph = buildFiscalFlowGraph(
      baseInput({
        outlays: [
          { seriesId: "fiscal.mts.outlays.category.national_defense" as SeriesId, value: "80000" },
          { seriesId: "fiscal.mts.outlays.category.allowances" as SeriesId, value: "0" },
        ],
      }),
    );
    expect(graph.nodes.find((n) => n.seriesId === "fiscal.mts.outlays.category.allowances")).toBeUndefined();
    expect(graph.links.some((l) => l.sourceId === "fiscal.mts.outlays.category.allowances" || l.targetId === "fiscal.mts.outlays.category.allowances")).toBe(false);
    expect(graph.omittedCategoryIds).toContain("fiscal.mts.outlays.category.allowances");
  });

  it("an entirely empty side (no receipts at all) reconciles to a total of 0, not an error", () => {
    const graph = buildFiscalFlowGraph(baseInput({ receipts: [] }));
    expect(graph.receiptsTotalExact).toBe("0");
    expect(nodesForSide(graph, "receipt").filter((n) => n.kind === "category")).toHaveLength(0);
  });
});
