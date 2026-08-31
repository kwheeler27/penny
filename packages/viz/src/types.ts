/**
 * Public data contracts for @penny/viz. Every type here is either imported
 * directly from the frozen @penny/registry / @penny/db contracts, or a thin
 * shape built only from those — this package never invents its own notion
 * of what a series or an observation is. Components consume this data via
 * props; nothing in this package fetches.
 */
import type { SeriesDef, SeriesId, Magnitude, Unit } from "@penny/registry";
import type { Observation } from "@penny/db";

export type { SeriesDef, SeriesId, Magnitude, Unit };

/** One category's reading for a single period — a receipt category or an outlay budget function. */
export interface FiscalFlowCategory {
  readonly seriesId: SeriesId;
  /**
   * The observation's decimal-string value (Observation["value"]), in the
   * series' published unit/magnitude — never a JS number. Omit the entry
   * entirely (or pass `value: undefined`) when the source has no reading
   * for this category this period; it is dropped before layout, never
   * rendered as a zero-height flow (CLAUDE.md: missing data is a gap, not
   * a zero).
   */
  readonly value: Observation["value"] | undefined;
}

export type FlowPeriodType = "month" | "fiscal_ytd";

export interface FiscalFlowPeriod {
  readonly periodType: FlowPeriodType;
  /** ISO calendar date (YYYY-MM-DD) — the period's as-of/end date, for citation display. Never timezone-shifted through a Date round-trip. */
  readonly periodEnd: string;
  readonly fiscalYear: number;
}

/**
 * Input to buildFiscalFlowGraph / <FiscalSankey>. Receipts and outlays
 * share one magnitude/unit deliberately — MTS publishes both in the same
 * magnitude for a given release, and requiring one shared value here makes
 * a silent unit-mixing bug structurally harder to introduce than if each
 * category carried its own. A caller combining series of different
 * magnitudes must convert before calling; this component does not guess.
 */
export interface FiscalFlowInput {
  readonly period: FiscalFlowPeriod;
  readonly receipts: readonly FiscalFlowCategory[];
  readonly outlays: readonly FiscalFlowCategory[];
  readonly unit: Extract<Unit, "usd">;
  readonly magnitude: Magnitude;
  /**
   * The registry series id backing the receipts/outlays totals themselves
   * (fiscal.mts.receipts.total / fiscal.mts.outlays.total) — used only to
   * label the hub node's detail affordance. Category series ids are on
   * each FiscalFlowCategory.
   */
  readonly receiptsTotalSeriesId: SeriesId;
  readonly outlaysTotalSeriesId: SeriesId;
  /**
   * The deficit/surplus series id (fiscal.mts.deficit.total) — its own
   * `definition` already reads "this is what financing must cover", which
   * is exactly the balancing-flow story, so the synthetic borrowing/surplus
   * node cites this real registry series rather than inventing a new one.
   */
  readonly deficitSeriesId: SeriesId;
}

/** Registry lookup the component renders definitions/citations from — passed by the caller (which already holds @penny/registry's SERIES map), never fetched here. */
export type SeriesCatalog = Readonly<Record<string, SeriesDef>>;

export type FlowSide = "receipt" | "outlay";
export type FlowNodeKind = "category" | "balancing" | "hub";

export interface FiscalFlowNode {
  readonly id: string;
  /** Fallback label (the series id, or a static hub/balancing description) used only when the caller's SeriesCatalog has no entry for this node's seriesId — prefer resolveNodeLabel(node, catalog) for display. */
  readonly label: string;
  readonly side: FlowSide | "hub";
  readonly kind: FlowNodeKind;
  readonly seriesId: SeriesId;
  /** Exact decimal string, in the input's published magnitude — the total value flowing through this node. */
  readonly valueExact: string;
  /** Cosmetic-only float mirror of valueExact, for D3 scale/layout math. Never used for a sum that must be exact. */
  readonly valueApprox: number;
}

export interface FiscalFlowLink {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly kind: FlowNodeKind;
  /** Always a non-negative magnitude — direction (sourceId/targetId) encodes
   * the sign, never the value. */
  readonly valueExact: string;
  readonly valueApprox: number;
  /**
   * True when this category's published value was negative (e.g. undistributed
   * offsetting receipts): the link's sourceId/targetId run the OPPOSITE of
   * that side's normal convention (an outlay category normally runs
   * hub->category; a reversed one runs category->hub instead, and vice versa
   * for receipts) so the flow is drawn as what it actually is — money moving
   * the other way — rather than clamped to an invisible zero-width sliver.
   * Always false for a hub or balancing link.
   */
  readonly reversed: boolean;
}

export type BalancingDirection = "deficit" | "surplus" | "balanced";

export interface FiscalFlowGraph {
  readonly period: FiscalFlowPeriod;
  readonly unit: Extract<Unit, "usd">;
  readonly magnitude: Magnitude;
  readonly nodes: readonly FiscalFlowNode[];
  readonly links: readonly FiscalFlowLink[];
  readonly receiptsTotalExact: string;
  readonly outlaysTotalExact: string;
  /** outlaysTotalExact - receiptsTotalExact. Positive = deficit (borrowing), negative = surplus, zero = balanced. */
  readonly balancingExact: string;
  readonly balancingDirection: BalancingDirection;
  readonly receiptsTotalSeriesId: SeriesId;
  readonly outlaysTotalSeriesId: SeriesId;
  readonly deficitSeriesId: SeriesId;
  /** Every category present in the input whose value was omitted before layout — either no reading at all, or an explicit zero. Surfaced so a caller/test can distinguish "no data yet" from "silently dropped for another reason". */
  readonly omittedCategoryIds: readonly SeriesId[];
  /** The subset of `omittedCategoryIds` that WERE reported, as an explicit "0" — a real published reading, not a missing one. Never conflate the two in reader-facing copy (a genuine zero is not "no reading"). */
  readonly omittedAsZeroCategoryIds: readonly SeriesId[];
}

export interface FlowDetail {
  readonly node: FiscalFlowNode | undefined;
  readonly link: FiscalFlowLink | undefined;
  readonly series: SeriesDef | undefined;
  readonly formattedValue: string;
  readonly citation: string;
}
