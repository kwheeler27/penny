/**
 * Pure resolution of the hover/tap "detail affordance" content (value,
 * plain-language definition, citation) for one node or link in a
 * FiscalFlowGraph. Split out from the component so it is directly
 * unit-testable without rendering anything.
 *
 * Every category and balancing node cites a real @penny/registry series
 * (never invented copy): categories cite themselves; the hub cites the
 * receipts-total series (same MTS Table 1 the outlays total comes from);
 * the balancing node cites fiscal.mts.deficit.total, whose own definition
 * already reads correctly for both a deficit and a surplus.
 */
import { formatSeriesValue } from "../money/format";
import type { FiscalFlowGraph, FiscalFlowNode, FiscalFlowLink, SeriesCatalog, FlowDetail } from "../types";

const HUB_DEFINITION =
  "Where receipts — plus any borrowing needed to cover a gap — become outlays. Not itself a published series; its values tie exactly to the Monthly Treasury Statement's Table 1, Summary of Receipts and Outlays, the same table both totals come from.";

function citationTextFor(catalog: SeriesCatalog, seriesId: string, accessDate: string): string {
  const def = catalog[seriesId];
  if (!def) return "";
  return def.citation.replaceAll("{access_date}", accessDate);
}

/** Resolves detail content for a node by id. Returns node: undefined when no such node exists in the graph. */
export function getNodeDetail(
  graph: FiscalFlowGraph,
  nodeId: string,
  catalog: SeriesCatalog,
  accessDate: string,
): FlowDetail {
  const node = graph.nodes.find((n) => n.id === nodeId);
  return buildDetail(node, undefined, catalog, accessDate);
}

/** Resolves detail content for a link by id (value is the flow's own value; definition/citation follow the same series the link's kind implies). */
export function getLinkDetail(
  graph: FiscalFlowGraph,
  linkId: string,
  catalog: SeriesCatalog,
  accessDate: string,
): FlowDetail {
  const link = graph.links.find((l) => l.id === linkId);
  if (!link) return buildDetail(undefined, undefined, catalog, accessDate);
  // A link's "definitional" node is whichever endpoint isn't the hub —
  // that is the category (or balancing flow) the link actually represents.
  const node = graph.nodes.find((n) => n.id === link.sourceId && n.kind !== "hub") ?? graph.nodes.find((n) => n.id === link.targetId);
  return buildDetail(node, link, catalog, accessDate);
}

function buildDetail(
  node: FiscalFlowNode | undefined,
  link: FiscalFlowLink | undefined,
  catalog: SeriesCatalog,
  accessDate: string,
): FlowDetail {
  if (!node) {
    return { node: undefined, link, series: undefined, formattedValue: "", citation: "" };
  }
  const isHub = node.kind === "hub";
  const seriesDef = catalog[node.seriesId];
  const unit = seriesDef?.unit ?? "usd";
  // "ones" (no scaling) is the safe fallback for an unresolved series — a
  // wrong guess of "millions" would silently inflate an unknown value 10^6x,
  // exactly the magnitude-mixing CLAUDE.md's hard rules forbid.
  const magnitude = seriesDef?.magnitude ?? "ones";
  const formattedValue = formatSeriesValue(node.valueExact, unit, magnitude, {
    explicitSign: node.kind === "balancing",
  });
  const citation = citationTextFor(catalog, node.seriesId, accessDate);
  const series: import("../types").SeriesDef | undefined = isHub && seriesDef
    ? { ...seriesDef, definition: HUB_DEFINITION }
    : seriesDef;
  return { node, link, series, formattedValue, citation };
}
