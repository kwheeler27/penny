/**
 * Pure data transform: typed fiscal-flow input -> a node/link graph ready
 * for geometry (layout/sankeyGeometry.ts) or a text summary
 * (layout/summarize.ts). No rendering, no DOM, no React — this is the
 * "layout math" the brief asks be unit-tested directly.
 *
 * Node ordering (deterministic, tested):
 *  - within the receipts column and the outlays column, categories sort
 *    descending by value;
 *  - the synthetic balancing node (borrowing or surplus), when present,
 *    always sorts LAST in its column regardless of magnitude — it must
 *    read as "the gap", never blend in as just another big category.
 *
 * Conservation (tested):
 *  - deficit case:  receiptsTotal + borrowing = outlaysTotal
 *  - surplus case:  receiptsTotal = outlaysTotal + surplus
 *  - balanced case: no balancing node is emitted at all.
 *
 * Missing/zero handling (tested): a category with value undefined
 * (absent) OR exactly "0" is omitted before layout — never emitted as a
 * zero-height node/link. Absence is recorded in `omittedCategoryIds` for
 * a caller that wants to say "no reading yet" explicitly, distinct from
 * simply not rendering anything.
 */
import { sumDecimal, subtractDecimal, isZeroDecimal, isNegativeDecimal, negateDecimal, absDecimal, compareDecimal } from "../money/decimal";
import type { FiscalFlowInput, FiscalFlowGraph, FiscalFlowNode, FiscalFlowLink, FlowSide, SeriesId, SeriesCatalog } from "../types";

const HUB_ID = "hub:government";
const BORROWING_ID = "balancing:borrowing";
const SURPLUS_ID = "balancing:surplus";

function toApprox(exact: string): number {
  // Cosmetic only — see types.ts FiscalFlowNode.valueApprox doc. Safe here
  // because it never feeds a sum this module asserts is exact.
  return Number(exact);
}

interface PresentCategory {
  readonly seriesId: SeriesId;
  readonly valueExact: string;
}

function presentCategories(categories: FiscalFlowInput["receipts"]): {
  present: PresentCategory[];
  omitted: SeriesId[];
  omittedAsZero: SeriesId[];
} {
  const present: PresentCategory[] = [];
  const omitted: SeriesId[] = [];
  const omittedAsZero: SeriesId[] = [];
  for (const c of categories) {
    if (c.value === undefined || c.value === null) {
      omitted.push(c.seriesId);
      continue;
    }
    if (isZeroDecimal(c.value)) {
      // A genuine published "0" is still omitted from the render (never a
      // zero-height ghost node/link) but it is NOT the same fact as "no
      // reading" — callers that report why a category is missing (e.g. the
      // SVG's text alternative) must be able to tell the two apart.
      omitted.push(c.seriesId);
      omittedAsZero.push(c.seriesId);
      continue;
    }
    present.push({ seriesId: c.seriesId, valueExact: c.value });
  }
  // Deterministic descending-by-value order (ties broken by seriesId so
  // output order never depends on input/object-iteration order).
  present.sort((a, b) => {
    const cmp = compareDecimal(b.valueExact, a.valueExact);
    return cmp !== 0 ? cmp : a.seriesId.localeCompare(b.seriesId);
  });
  return { present, omitted, omittedAsZero };
}

function categoryNode(side: FlowSide, c: PresentCategory): FiscalFlowNode {
  return {
    id: c.seriesId,
    label: c.seriesId, // fallback only — see resolveNodeLabel
    side,
    kind: "category",
    seriesId: c.seriesId,
    valueExact: c.valueExact,
    valueApprox: toApprox(c.valueExact),
  };
}

/** Builds the full flow graph from typed input. Pure — no I/O, no fetching. */
export function buildFiscalFlowGraph(input: FiscalFlowInput): FiscalFlowGraph {
  const receiptsPresent = presentCategories(input.receipts);
  const outlaysPresent = presentCategories(input.outlays);

  const receiptsTotalExact = sumDecimal(receiptsPresent.present.map((c) => c.valueExact));
  const outlaysTotalExact = sumDecimal(outlaysPresent.present.map((c) => c.valueExact));
  const balancingExact = subtractDecimal(outlaysTotalExact, receiptsTotalExact);

  const balancingDirection = isZeroDecimal(balancingExact)
    ? "balanced"
    : isNegativeDecimal(balancingExact)
      ? "surplus"
      : "deficit";

  const nodes: FiscalFlowNode[] = [];
  const links: FiscalFlowLink[] = [];

  // Hub throughput = total inflow (receipts, plus borrowing when there is a deficit) — equal to total outflow by construction except in the surplus case, where outflow includes the surplus sink.
  const hubInflowExact = balancingDirection === "deficit" ? outlaysTotalExact : receiptsTotalExact;

  nodes.push({
    id: HUB_ID,
    label: "Federal government (unified budget)",
    side: "hub",
    kind: "hub",
    seriesId: input.receiptsTotalSeriesId,
    valueExact: hubInflowExact,
    valueApprox: toApprox(hubInflowExact),
  });

  // A category's link value fed to the geometry layer must always be a
  // non-negative magnitude — direction (source/target) carries the sign.
  // Receipts normally flow category->hub; a NEGATIVE receipt category is
  // really money leaving through that channel, so its link reverses to
  // hub->category, at its absolute magnitude. Symmetrically, outlays
  // normally flow hub->category; a negative one (undistributed offsetting
  // receipts) is really money flowing back in, so its link reverses to
  // category->hub. Either way the hub's total inflow still equals its total
  // outflow exactly (see money/decimal-driven proof in this package's tests)
  // — never a phantom gap from silently clamping a negative value to zero.
  for (const c of receiptsPresent.present) {
    const node = categoryNode("receipt", c);
    nodes.push(node);
    const reversed = isNegativeDecimal(c.valueExact);
    const magnitude = reversed ? absDecimal(c.valueExact) : c.valueExact;
    links.push({
      id: `${node.id}<->${HUB_ID}`,
      sourceId: reversed ? HUB_ID : node.id,
      targetId: reversed ? node.id : HUB_ID,
      kind: "category",
      reversed,
      valueExact: magnitude,
      valueApprox: toApprox(magnitude),
    });
  }

  for (const c of outlaysPresent.present) {
    const node = categoryNode("outlay", c);
    nodes.push(node);
    const reversed = isNegativeDecimal(c.valueExact);
    const magnitude = reversed ? absDecimal(c.valueExact) : c.valueExact;
    links.push({
      id: `${HUB_ID}<->${node.id}`,
      sourceId: reversed ? node.id : HUB_ID,
      targetId: reversed ? HUB_ID : node.id,
      kind: "category",
      reversed,
      valueExact: magnitude,
      valueApprox: toApprox(magnitude),
    });
  }

  if (balancingDirection === "deficit") {
    const borrowingExact = balancingExact; // outlays - receipts, positive
    nodes.push({
      id: BORROWING_ID,
      label: "Borrowing (fills the gap between receipts and outlays)",
      side: "receipt",
      kind: "balancing",
      seriesId: input.deficitSeriesId,
      valueExact: borrowingExact,
      valueApprox: toApprox(borrowingExact),
    });
    links.push({
      id: `${BORROWING_ID}->${HUB_ID}`,
      sourceId: BORROWING_ID,
      targetId: HUB_ID,
      kind: "balancing",
      reversed: false,
      valueExact: borrowingExact,
      valueApprox: toApprox(borrowingExact),
    });
  } else if (balancingDirection === "surplus") {
    const surplusExact = negateDecimal(balancingExact); // receipts - outlays, positive
    nodes.push({
      id: SURPLUS_ID,
      label: "Surplus (collected but not spent this period)",
      side: "outlay",
      kind: "balancing",
      seriesId: input.deficitSeriesId,
      valueExact: surplusExact,
      valueApprox: toApprox(surplusExact),
    });
    links.push({
      id: `${HUB_ID}->${SURPLUS_ID}`,
      sourceId: HUB_ID,
      targetId: SURPLUS_ID,
      kind: "balancing",
      reversed: false,
      valueExact: surplusExact,
      valueApprox: toApprox(surplusExact),
    });
  }
  // balanced: no balancing node/link at all — nothing to fill.

  return {
    period: input.period,
    unit: input.unit,
    magnitude: input.magnitude,
    nodes,
    links,
    receiptsTotalExact,
    outlaysTotalExact,
    balancingExact,
    balancingDirection,
    receiptsTotalSeriesId: input.receiptsTotalSeriesId,
    outlaysTotalSeriesId: input.outlaysTotalSeriesId,
    deficitSeriesId: input.deficitSeriesId,
    omittedCategoryIds: [...receiptsPresent.omitted, ...outlaysPresent.omitted],
    omittedAsZeroCategoryIds: [...receiptsPresent.omittedAsZero, ...outlaysPresent.omittedAsZero],
  };
}

/** Nodes for one side of the diagram (receipts or outlays), in render order: categories descending by value, then the balancing node last if present on that side. */
export function nodesForSide(graph: FiscalFlowGraph, side: FlowSide): readonly FiscalFlowNode[] {
  const onSide = graph.nodes.filter((n) => n.side === side);
  const categories = onSide.filter((n) => n.kind === "category");
  const balancing = onSide.filter((n) => n.kind === "balancing");
  return [...categories, ...balancing];
}

/** Display label for a node: the registry's plain-language `label` when the catalog has the series, else the node's static fallback. */
export function resolveNodeLabel(node: FiscalFlowNode, catalog: SeriesCatalog): string {
  if (node.kind === "category") return catalog[node.seriesId]?.label ?? node.label;
  return node.label;
}

export const FISCAL_FLOW_HUB_ID = HUB_ID;
export const FISCAL_FLOW_BORROWING_ID = BORROWING_ID;
export const FISCAL_FLOW_SURPLUS_ID = SURPLUS_ID;
