/**
 * Plain-language text summary of a FiscalFlowGraph — the SVG's text
 * alternative (rendered as a visually-hidden <figcaption> and referenced
 * via aria-describedby, per the accessibility requirement that the chart
 * never be presented as image-only). Pure and unit-tested independent of
 * any rendering.
 */
import { formatSeriesValue } from "../money/format";
import { nodesForSide, resolveNodeLabel } from "./buildFiscalFlowGraph";
import type { FiscalFlowGraph, SeriesCatalog } from "../types";

function periodPhrase(graph: FiscalFlowGraph): string {
  return graph.period.periodType === "fiscal_ytd"
    ? `fiscal year ${graph.period.fiscalYear} through ${graph.period.periodEnd}`
    : graph.period.periodEnd;
}

function topCategoriesPhrase(graph: FiscalFlowGraph, side: "receipt" | "outlay", catalog: SeriesCatalog, n = 3): string {
  const nodes = nodesForSide(graph, side).filter((node) => node.kind === "category");
  const top = nodes.slice(0, n);
  if (top.length === 0) return "no categories reported";
  return top
    .map((node) => `${resolveNodeLabel(node, catalog)} (${formatSeriesValue(node.valueExact, graph.unit, graph.magnitude)})`)
    .join(", ");
}

/** Builds the full text alternative for the diagram. */
export function summarizeFlows(graph: FiscalFlowGraph, catalog: SeriesCatalog): string {
  const receiptsFmt = formatSeriesValue(graph.receiptsTotalExact, graph.unit, graph.magnitude);
  const outlaysFmt = formatSeriesValue(graph.outlaysTotalExact, graph.unit, graph.magnitude);
  const period = periodPhrase(graph);

  const balancingSentence =
    graph.balancingDirection === "deficit"
      ? `Outlays exceeded receipts by ${formatSeriesValue(graph.balancingExact, graph.unit, graph.magnitude)}, a gap covered by borrowing.`
      : graph.balancingDirection === "surplus"
        ? `Receipts exceeded outlays by ${formatSeriesValue(graph.balancingExact, graph.unit, graph.magnitude, { explicitSign: false })}, a surplus.`
        : "Receipts and outlays were exactly equal — no borrowing or surplus this period.";

  const omitted = graph.omittedCategoryIds.length > 0 ? ` ${graph.omittedCategoryIds.length} categories had no reading this period and are omitted, not shown as zero.` : "";

  return (
    `Federal receipts and outlays for ${period}. ` +
    `The government collected ${receiptsFmt} in receipts, led by ${topCategoriesPhrase(graph, "receipt", catalog)}. ` +
    `It paid out ${outlaysFmt} in outlays, led by ${topCategoriesPhrase(graph, "outlay", catalog)}. ` +
    `${balancingSentence}${omitted}`
  );
}
