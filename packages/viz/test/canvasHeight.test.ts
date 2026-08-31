import { describe, expect, it } from "vitest";
import { buildFiscalFlowGraph } from "../src/layout/buildFiscalFlowGraph";
import { resolveCanvasHeight, MIN_HORIZONTAL_HEIGHT_PX, VERTICAL_HEIGHT_PX } from "../src/layout/canvasHeight";
import type { FiscalFlowInput, SeriesId } from "../src/types";

const NODE_THICKNESS = 20;
const NODE_PADDING = 14;

function inputWithOutlayCount(outlayCount: number): FiscalFlowInput {
  const outlays = Array.from({ length: outlayCount }, (_, i) => ({
    seriesId: `fiscal.mts.outlays.category.cat_${i}` as SeriesId,
    value: "1000",
  }));
  return {
    period: { periodType: "month" as const, periodEnd: "2026-07-31", fiscalYear: 2026 },
    unit: "usd",
    magnitude: "ones",
    receiptsTotalSeriesId: "fiscal.mts.receipts.total" as SeriesId,
    outlaysTotalSeriesId: "fiscal.mts.outlays.total" as SeriesId,
    deficitSeriesId: "fiscal.mts.deficit.total" as SeriesId,
    receipts: [{ seriesId: "fiscal.mts.receipts.category.individual_income_tax" as SeriesId, value: "500" }],
    outlays,
  };
}

describe("resolveCanvasHeight", () => {
  // The regression this file exists for (production, 2026-08-31): the
  // viewBox height must be derived from graph content + orientation ONLY.
  // The old code fed the measured container height back into the viewBox,
  // and since the container contains the SVG, every ResizeObserver tick
  // grew the diagram without bound. The signature makes the fix structural
  // (there is no container-height parameter to misuse); these tests pin
  // the intended values so a future "just use the measured height" change
  // has to delete them to compile.

  it("small graphs get the minimum horizontal height, exactly", () => {
    const graph = buildFiscalFlowGraph(inputWithOutlayCount(3));
    expect(resolveCanvasHeight(graph, "horizontal", NODE_THICKNESS, NODE_PADDING)).toBe(MIN_HORIZONTAL_HEIGHT_PX);
  });

  it("dense graphs get room for the densest side column", () => {
    const graph = buildFiscalFlowGraph(inputWithOutlayCount(20));
    const outlaySideCount = graph.nodes.filter((n) => n.side === "outlay").length;
    const expected = outlaySideCount * (NODE_THICKNESS + NODE_PADDING) + NODE_PADDING;
    expect(expected).toBeGreaterThan(MIN_HORIZONTAL_HEIGHT_PX);
    expect(resolveCanvasHeight(graph, "horizontal", NODE_THICKNESS, NODE_PADDING)).toBe(expected);
  });

  it("vertical orientation is a fixed flow-axis length regardless of content", () => {
    expect(resolveCanvasHeight(buildFiscalFlowGraph(inputWithOutlayCount(3)), "vertical", NODE_THICKNESS, NODE_PADDING)).toBe(VERTICAL_HEIGHT_PX);
    expect(resolveCanvasHeight(buildFiscalFlowGraph(inputWithOutlayCount(25)), "vertical", NODE_THICKNESS, NODE_PADDING)).toBe(VERTICAL_HEIGHT_PX);
  });

  it("is deterministic for the same graph", () => {
    const graph = buildFiscalFlowGraph(inputWithOutlayCount(12));
    const first = resolveCanvasHeight(graph, "horizontal", NODE_THICKNESS, NODE_PADDING);
    expect(resolveCanvasHeight(graph, "horizontal", NODE_THICKNESS, NODE_PADDING)).toBe(first);
  });
});
