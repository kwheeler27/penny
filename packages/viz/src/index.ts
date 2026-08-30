// Public surface of @buck/viz. The living Sankey + scrollytelling
// primitives (ORCHESTRATION_PROMPT.md Core flow 4) — bespoke D3 + SVG
// React components, no chart-library dependency. Every number this
// package renders arrives via props (typed against @buck/registry /
// @buck/db); nothing here fetches.

// ---- types ----
export type {
  SeriesDef,
  SeriesId,
  Magnitude,
  Unit,
  FiscalFlowCategory,
  FlowPeriodType,
  FiscalFlowPeriod,
  FiscalFlowInput,
  SeriesCatalog,
  FlowSide,
  FlowNodeKind,
  FiscalFlowNode,
  FiscalFlowLink,
  BalancingDirection,
  FiscalFlowGraph,
  FlowDetail,
} from "./types";

// ---- money (exact decimal arithmetic + display formatting) ----
export {
  parseDecimal,
  formatDecimal,
  addDecimal,
  subtractDecimal,
  sumDecimal,
  compareDecimal,
  isZeroDecimal,
  isNegativeDecimal,
  negateDecimal,
  absDecimal,
  scaleByMagnitude,
  toWholeDollarsBigInt,
  type MagnitudeName,
} from "./money/decimal";
export { formatSeriesValue, formatUsd, magnitudeLabel, type FormatUnit, type FormatValueOptions } from "./money/format";

// ---- layout math (pure — unit-tested directly) ----
export {
  buildFiscalFlowGraph,
  nodesForSide,
  resolveNodeLabel,
  FISCAL_FLOW_HUB_ID,
  FISCAL_FLOW_BORROWING_ID,
  FISCAL_FLOW_SURPLUS_ID,
} from "./layout/buildFiscalFlowGraph";
export { getNodeDetail, getLinkDetail } from "./layout/detail";
export { computeFlowGeometry, type GeometryOptions, type PositionedNode, type PositionedLink, type FlowGeometry } from "./layout/sankeyGeometry";
export { placeLabels, type LabelBand, type LabelPlacement, type LabelAnchor, type LabelPlacementOptions } from "./layout/labelPlacement";
export { summarizeFlows } from "./layout/summarize";
export { chooseOrientation, VERTICAL_BREAKPOINT_PX, type FlowOrientation } from "./layout/orientation";

// ---- scrollytelling primitives ----
export { pickActiveStep, type StepIntersection } from "./scroll/pickActiveStep";
export { useScrollSteps, type UseScrollStepsOptions, type UseScrollStepsResult } from "./scroll/useScrollSteps";
export { usePrefersReducedMotion } from "./scroll/usePrefersReducedMotion";
export { ScrollStepContainer, type ScrollStepContainerProps, type ScrollStepRenderProps } from "./scroll/ScrollStepContainer";

// ---- components ----
export { FiscalSankey, type FiscalSankeyProps } from "./components/FiscalSankey";
export { DetailPanel, type DetailPanelProps } from "./components/DetailPanel";
export { VisuallyHidden } from "./components/VisuallyHidden";

// ---- demo / fixture harness (exercise the component without apps/web) ----
export { fiscalFlowFixture, fiscalFlowSeriesCatalog } from "./demo/fixtures";
export { FiscalSankeyDemo } from "./demo/FiscalSankeyDemo";
