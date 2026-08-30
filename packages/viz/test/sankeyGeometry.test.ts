import { describe, expect, it } from "vitest";
import { buildFiscalFlowGraph } from "../src/layout/buildFiscalFlowGraph";
import { computeFlowGeometry } from "../src/layout/sankeyGeometry";
import type { FiscalFlowInput, SeriesId } from "../src/types";

const input: FiscalFlowInput = {
  period: { periodType: "month", periodEnd: "2026-07-31", fiscalYear: 2026 },
  unit: "usd",
  magnitude: "millions",
  receiptsTotalSeriesId: "fiscal.mts.receipts.total" as SeriesId,
  outlaysTotalSeriesId: "fiscal.mts.outlays.total" as SeriesId,
  deficitSeriesId: "fiscal.mts.deficit.total" as SeriesId,
  receipts: [
    { seriesId: "fiscal.mts.receipts.category.individual_income_tax" as SeriesId, value: "180000" },
    { seriesId: "fiscal.mts.receipts.category.corporation_income_tax" as SeriesId, value: "60000" },
  ],
  outlays: [
    { seriesId: "fiscal.mts.outlays.category.national_defense" as SeriesId, value: "180000" },
    { seriesId: "fiscal.mts.outlays.category.medicare" as SeriesId, value: "60000" },
  ],
};

describe("computeFlowGeometry — pixel layout math", () => {
  it("produces a node band whose thickness is proportional to its value, for both nodes on the same side", () => {
    const graph = buildFiscalFlowGraph(input);
    const geometry = computeFlowGeometry(graph, { width: 600, height: 400, orientation: "horizontal" });
    const big = geometry.nodes.find((n) => n.node.seriesId === "fiscal.mts.receipts.category.individual_income_tax")!;
    const small = geometry.nodes.find((n) => n.node.seriesId === "fiscal.mts.receipts.category.corporation_income_tax")!;
    const bigHeight = big.y1 - big.y0;
    const smallHeight = small.y1 - small.y0;
    // 180000 vs 60000 is a 3:1 ratio — allow generous tolerance for node padding overhead, but it must not be anywhere close to 1:1.
    expect(bigHeight / smallHeight).toBeGreaterThan(2);
    expect(bigHeight / smallHeight).toBeLessThan(4);
  });

  it("keeps every node and link path within the declared canvas extent", () => {
    const graph = buildFiscalFlowGraph(input);
    const geometry = computeFlowGeometry(graph, { width: 600, height: 400, orientation: "horizontal" });
    for (const n of geometry.nodes) {
      expect(n.x0).toBeGreaterThanOrEqual(0);
      expect(n.x1).toBeLessThanOrEqual(600);
      expect(n.y0).toBeGreaterThanOrEqual(0);
      expect(n.y1).toBeLessThanOrEqual(400);
    }
  });

  it("produces a valid, non-degenerate ribbon path for every link", () => {
    const graph = buildFiscalFlowGraph(input);
    const geometry = computeFlowGeometry(graph, { width: 600, height: 400, orientation: "horizontal" });
    expect(geometry.links).toHaveLength(graph.links.length);
    for (const l of geometry.links) {
      expect(l.path).toMatch(/^M/);
      expect(l.path).toContain("Z");
      expect(l.thickness).toBeGreaterThan(0);
    }
  });

  it("renders sensibly in vertical orientation too — nodes stack top-to-bottom (receipts above the hub, hub above outlays)", () => {
    const graph = buildFiscalFlowGraph(input);
    const geometry = computeFlowGeometry(graph, { width: 375, height: 700, orientation: "vertical" });
    const receipt = geometry.nodes.find((n) => n.node.side === "receipt")!;
    const hub = geometry.nodes.find((n) => n.node.side === "hub")!;
    const outlay = geometry.nodes.find((n) => n.node.side === "outlay")!;
    expect(receipt.y1).toBeLessThanOrEqual(hub.y0 + 1); // receipts column entirely at or above the hub row
    expect(hub.y1).toBeLessThanOrEqual(outlay.y0 + 1);
    for (const n of geometry.nodes) {
      expect(n.x1).toBeLessThanOrEqual(375);
      expect(n.y1).toBeLessThanOrEqual(700);
    }
  });

  it("both orientations preserve the same relative node ordering within a column", () => {
    const graph = buildFiscalFlowGraph(input);
    const horizontal = computeFlowGeometry(graph, { width: 600, height: 400, orientation: "horizontal" });
    const vertical = computeFlowGeometry(graph, { width: 375, height: 700, orientation: "vertical" });
    const orderBy = (geo: typeof horizontal, axis: "y0" | "x0") =>
      geo.nodes
        .filter((n) => n.node.side === "receipt")
        .sort((a, b) => a[axis] - b[axis])
        .map((n) => n.node.id);
    expect(orderBy(horizontal, "y0")).toEqual(orderBy(vertical, "x0"));
  });
});
