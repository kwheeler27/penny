import { describe, expect, it } from "vitest";
import { buildFiscalFlowGraph, FISCAL_FLOW_HUB_ID } from "../src/layout/buildFiscalFlowGraph";
import { getNodeDetail, getLinkDetail } from "../src/layout/detail";
import { fiscalFlowFixture, fiscalFlowSeriesCatalog } from "../src/demo/fixtures";

const graph = buildFiscalFlowGraph(fiscalFlowFixture);
const ACCESS_DATE = "2026-08-29";

describe("getNodeDetail / getLinkDetail — the hover/tap detail affordance", () => {
  it("resolves a category node's value, real registry definition, and citation with the access date substituted", () => {
    const detail = getNodeDetail(graph, "fiscal.mts.outlays.category.national_defense", fiscalFlowSeriesCatalog, ACCESS_DATE);
    expect(detail.node).toBeDefined();
    expect(detail.series?.definition).toMatch(/military spending/i);
    expect(detail.citation).toContain(ACCESS_DATE);
    expect(detail.citation).not.toContain("{access_date}");
    // fiscal.mts.outlays.category.national_defense is magnitude "ones" in the
    // real registry (the FiscalData API returns MTS amounts in whole dollars
    // and cents, not millions — fixed 2026-08-29); the demo fixture's raw
    // "80000" is therefore $80,000, not $80 billion.
    expect(detail.formattedValue).toBe("$80.0K");
  });

  it("resolves the balancing node using fiscal.mts.deficit.total's own definition, with an explicit + sign", () => {
    const borrowing = graph.nodes.find((n) => n.kind === "balancing")!;
    const detail = getNodeDetail(graph, borrowing.id, fiscalFlowSeriesCatalog, ACCESS_DATE);
    expect(detail.series?.definition).toMatch(/balancing figure/i);
    expect(detail.formattedValue).toMatch(/^\+\$/);
  });

  it("resolves the hub node with a synthesized definition, not the raw receipts-total definition verbatim", () => {
    const detail = getNodeDetail(graph, FISCAL_FLOW_HUB_ID, fiscalFlowSeriesCatalog, ACCESS_DATE);
    expect(detail.series?.definition).toMatch(/Summary of Receipts and Outlays/);
    expect(detail.series?.definition).not.toBe(fiscalFlowSeriesCatalog[fiscalFlowFixture.receiptsTotalSeriesId]?.definition);
  });

  it("a link's detail resolves to the same content as its non-hub endpoint node", () => {
    const link = graph.links.find((l) => l.targetId === "fiscal.mts.outlays.category.medicare")!;
    const nodeDetail = getNodeDetail(graph, "fiscal.mts.outlays.category.medicare", fiscalFlowSeriesCatalog, ACCESS_DATE);
    const linkDetail = getLinkDetail(graph, link.id, fiscalFlowSeriesCatalog, ACCESS_DATE);
    expect(linkDetail.formattedValue).toBe(nodeDetail.formattedValue);
    expect(linkDetail.series?.definition).toBe(nodeDetail.series?.definition);
    expect(linkDetail.link).toBe(link);
  });

  it("returns an empty (node: undefined) detail for an unknown id rather than throwing", () => {
    const detail = getNodeDetail(graph, "not-a-real-node", fiscalFlowSeriesCatalog, ACCESS_DATE);
    expect(detail.node).toBeUndefined();
    expect(detail.formattedValue).toBe("");
  });
});
