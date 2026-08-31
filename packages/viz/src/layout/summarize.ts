/**
 * Plain-language text summary of a FiscalFlowGraph — the SVG's text
 * alternative (rendered as a visually-hidden <figcaption> and referenced
 * via aria-describedby, per the accessibility requirement that the chart
 * never be presented as image-only). Pure and unit-tested independent of
 * any rendering.
 */
import { formatSeriesValue } from "../money/format";
import { absDecimal } from "../money/decimal";
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

/**
 * Describes every omitted category honestly, WITHOUT conflating "no reading
 * published this period" (a real gap) with "published as an explicit 0"
 * (a real, reported figure) — buildFiscalFlowGraph puts both in
 * `omittedCategoryIds` because both are dropped before layout, but a reader
 * hearing this caption must not be told a genuine zero "had no reading."
 */
function omittedPhrase(graph: FiscalFlowGraph): string {
  const zeroCount = graph.omittedAsZeroCategoryIds.length;
  const noReadingCount = graph.omittedCategoryIds.length - zeroCount;
  const parts: string[] = [];
  if (noReadingCount > 0) {
    parts.push(
      `${noReadingCount} categor${noReadingCount === 1 ? "y" : "ies"} had no reading this period and ${noReadingCount === 1 ? "is" : "are"} omitted, not shown as zero`,
    );
  }
  if (zeroCount > 0) {
    parts.push(
      `${zeroCount} categor${zeroCount === 1 ? "y" : "ies"} reported exactly zero and ${zeroCount === 1 ? "is" : "are"} omitted rather than drawn as a zero-height flow`,
    );
  }
  return parts.length > 0 ? ` ${parts.join("; ")}.` : "";
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
        ? // graph.balancingExact is outlays - receipts, i.e. NEGATIVE in a
          // surplus (receipts > outlays) — absDecimal it before formatting so
          // this sentence states the surplus's magnitude, never "by -$X".
          `Receipts exceeded outlays by ${formatSeriesValue(absDecimal(graph.balancingExact), graph.unit, graph.magnitude)}, a surplus.`
        : "Receipts and outlays were exactly equal — no borrowing or surplus this period.";

  const omitted = omittedPhrase(graph);

  return (
    `Federal receipts and outlays for ${period}. ` +
    `The government collected ${receiptsFmt} in receipts, led by ${topCategoriesPhrase(graph, "receipt", catalog)}. ` +
    `It paid out ${outlaysFmt} in outlays, led by ${topCategoriesPhrase(graph, "outlay", catalog)}. ` +
    `${balancingSentence}${omitted}`
  );
}
