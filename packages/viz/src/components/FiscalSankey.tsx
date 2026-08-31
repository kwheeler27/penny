import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import { buildFiscalFlowGraph, resolveNodeLabel, FISCAL_FLOW_HUB_ID } from "../layout/buildFiscalFlowGraph";
import { computeFlowGeometry, type PositionedNode } from "../layout/sankeyGeometry";
import { chooseOrientation, type FlowOrientation } from "../layout/orientation";
import { placeLabels, type LabelBand } from "../layout/labelPlacement";
import { summarizeFlows } from "../layout/summarize";
import { getNodeDetail, getLinkDetail } from "../layout/detail";
import { formatSeriesValue } from "../money/format";
import { useContainerSize } from "../useContainerSize";
import { FISCAL_SANKEY_CLASS, fiscalSankeyStyleTag, colorForSide, BALANCING_COLOR, HATCH_PATTERN_ID } from "../tokens";
import { VisuallyHidden } from "./VisuallyHidden";
import { DetailPanel } from "./DetailPanel";
import type { FiscalFlowInput, SeriesCatalog, FlowDetail, FiscalFlowLink, FiscalFlowGraph } from "../types";

export interface FiscalSankeyProps {
  readonly input: FiscalFlowInput;
  /** The @penny/registry SERIES map (or a subset covering every seriesId referenced by `input`) — the component never fetches or imports the registry's data itself. */
  readonly seriesCatalog: SeriesCatalog;
  /** Citation access-date (YYYY-MM-DD). Passed in, never computed with `new Date()` inside the component, so rendering stays deterministic/SSR-safe. */
  readonly accessDate: string;
  /** Explicit pixel size. When omitted, measured from the wrapping element via ResizeObserver — the common case for a responsive report page. */
  readonly width?: number;
  readonly height?: number;
  readonly className?: string;
  /** Fires whenever the hover/tap selection changes (including to null on deselect) — a report page can use this to sync prose to the diagram. */
  readonly onSelect?: (detail: FlowDetail | null) => void;
}

const DEFAULT_WIDTH = 640;
const NODE_THICKNESS = 20;
const NODE_PADDING = 14;
const INLINE_LABEL_GAP = 6;
const OUTSIDE_LABEL_GAP = 26;

function bandFor(positioned: PositionedNode, orientation: FlowOrientation): LabelBand {
  const [start, end] = orientation === "horizontal" ? [positioned.y0, positioned.y1] : [positioned.x0, positioned.x1];
  return { id: positioned.node.id, start, end, text: positioned.node.label };
}

/** Every category link touches the hub at exactly one end; the OTHER end is
 * always the category node itself, whose own declared `side` tells us which
 * side of the diagram it belongs to. This deliberately does NOT infer side
 * from which end is the hub — a reversed (negative-valued) category link
 * points the opposite way from its side's normal convention, so direction
 * alone would misclassify it (a balancing link is colored separately and
 * never calls this). */
function sideForCategoryLink(link: FiscalFlowLink, graph: FiscalFlowGraph): "receipt" | "outlay" {
  const categoryId = link.sourceId === FISCAL_FLOW_HUB_ID ? link.targetId : link.sourceId;
  const categoryNode = graph.nodes.find((n) => n.id === categoryId);
  return categoryNode?.side === "outlay" ? "outlay" : "receipt";
}

function labelAnchor(
  p: PositionedNode,
  orientation: FlowOrientation,
  gap: number,
): { x: number; y: number; textAnchor: "start" | "end" | "middle" } {
  if (orientation === "horizontal") {
    const cy = (p.y0 + p.y1) / 2;
    if (p.node.side === "receipt") return { x: p.x0 - gap, y: cy, textAnchor: "end" };
    if (p.node.side === "outlay") return { x: p.x1 + gap, y: cy, textAnchor: "start" };
    return { x: (p.x0 + p.x1) / 2, y: p.y0 - gap, textAnchor: "middle" };
  }
  const cx = (p.x0 + p.x1) / 2;
  if (p.node.side === "receipt") return { x: cx, y: p.y0 - gap, textAnchor: "middle" };
  if (p.node.side === "outlay") return { x: cx, y: p.y1 + gap, textAnchor: "middle" };
  return { x: p.x0 - gap, y: (p.y0 + p.y1) / 2, textAnchor: "end" };
}

/**
 * The living Sankey: receipts (by category) -> the federal government ->
 * outlays (by budget function), with the deficit/surplus rendered as a
 * visually distinct balancing flow (a third hue + diagonal hatch + dashed
 * outline + its own label wording) so it reads as "borrowing fills the
 * gap," never as another spending category. Fetches nothing — every value,
 * definition, and citation arrives via `input` / `seriesCatalog` props.
 */
export function FiscalSankey({ input, seriesCatalog, accessDate, width, height, className, onSelect }: FiscalSankeyProps) {
  const [containerRef, measured] = useContainerSize<HTMLDivElement>({ width: DEFAULT_WIDTH, height: 420 });
  const captionId = useId();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);

  // Malformed input (e.g. a value string that isn't a plain decimal) throws
  // from buildFiscalFlowGraph — caught here so one bad observation renders a
  // loud, visible error affordance instead of crashing the whole page. Every
  // hook below still needs *something* graph-shaped to run against, so a
  // failure falls back to an empty graph and the error UI takes over at
  // render time, never silently swallowed (logged via console.error).
  const { graph, buildError } = useMemo(() => {
    try {
      return { graph: buildFiscalFlowGraph(input), buildError: null as string | null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[FiscalSankey] failed to build flow graph:", message);
      return {
        graph: buildFiscalFlowGraph({ ...input, receipts: [], outlays: [] }),
        buildError: message,
      };
    }
  }, [input]);

  const isEmpty = !buildError && graph.nodes.every((n) => n.kind !== "category");

  const effectiveWidth = width ?? measured.width ?? DEFAULT_WIDTH;
  const orientation = chooseOrientation(effectiveWidth);
  const effectiveHeight = height ?? (orientation === "vertical" ? Math.max(measured.height, 720) : Math.max(measured.height, 420));

  const geometry = useMemo(
    () => computeFlowGeometry(graph, { width: effectiveWidth, height: effectiveHeight, orientation, nodeThickness: NODE_THICKNESS, nodePadding: NODE_PADDING }),
    [graph, effectiveWidth, effectiveHeight, orientation],
  );

  const labelsByNodeId = useMemo(() => {
    const bySide = { receipt: [] as PositionedNode[], outlay: [] as PositionedNode[], hub: [] as PositionedNode[] };
    for (const p of geometry.nodes) bySide[p.node.side].push(p);
    const placements = new Map<string, ReturnType<typeof placeLabels>[number]>();
    for (const side of ["receipt", "outlay", "hub"] as const) {
      const bands = bySide[side].map((p) => bandFor(p, orientation));
      for (const placement of placeLabels(bands)) placements.set(placement.id, placement);
    }
    return placements;
  }, [geometry, orientation]);

  const activeId = pinnedId ?? hoveredId;

  const detail = useMemo<FlowDetail | null>(() => {
    if (!activeId) return null;
    if (graph.links.some((l) => l.id === activeId)) return getLinkDetail(graph, activeId, seriesCatalog, accessDate);
    if (graph.nodes.some((n) => n.id === activeId)) return getNodeDetail(graph, activeId, seriesCatalog, accessDate);
    return null;
  }, [activeId, graph, seriesCatalog, accessDate]);

  useEffect(() => {
    onSelect?.(detail);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onSelect intentionally not a dep: callers rarely memoize it, and re-invoking on identity change alone would fire on every render.
  }, [detail]);

  const select = (id: string) => setPinnedId((current) => (current === id ? null : id));

  const summary = summarizeFlows(graph, seriesCatalog);
  const totalFmt = formatSeriesValue(graph.receiptsTotalExact, graph.unit, graph.magnitude);

  const wrapperClassName = [FISCAL_SANKEY_CLASS, className].filter(Boolean).join(" ");

  if (buildError) {
    return (
      <div ref={containerRef} className={wrapperClassName} style={{ width: "100%" }}>
        <style>{fiscalSankeyStyleTag}</style>
        <div
          role="alert"
          style={{ border: "1px solid var(--bfs-gridline)", borderRadius: 8, padding: 16, background: "var(--bfs-surface)", color: "var(--bfs-text-primary)" }}
        >
          <strong>This chart couldn&rsquo;t render.</strong>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--bfs-text-secondary)" }}>{buildError}</p>
        </div>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div ref={containerRef} className={wrapperClassName} style={{ width: "100%" }}>
        <style>{fiscalSankeyStyleTag}</style>
        <p style={{ color: "var(--bfs-text-secondary)", fontSize: 13, margin: 0 }}>No receipts or outlays reported for {input.period.periodEnd} yet.</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={wrapperClassName} style={{ width: "100%" }}>
      <style>{fiscalSankeyStyleTag}</style>
      <Legend />
      <svg
        width="100%"
        viewBox={`0 0 ${effectiveWidth} ${effectiveHeight}`}
        role="img"
        aria-describedby={captionId}
        style={{ display: "block", maxWidth: "100%", overflow: "visible" }}
      >
        <title>{`Federal receipts and outlays, ${input.period.periodEnd} — total receipts ${totalFmt}`}</title>
        <defs>
          {/* Shared by the balancing flow AND any reversed (negative-valued)
              category ribbon (tokens.ts). The line's stroke is currentColor
              deliberately — each caller below sets `color` on the wrapping
              element so one pattern renders in either the balancing hue or
              the category's own side color. */}
          <pattern id={HATCH_PATTERN_ID} width="8" height="8" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width="8" height="8" fill="transparent" />
            <line x1="0" y1="0" x2="0" y2="8" stroke="currentColor" strokeWidth={2} strokeOpacity={0.9} />
          </pattern>
        </defs>

        {geometry.links.map((l) => {
          const isBalancing = l.link.kind === "balancing";
          const isReversed = l.link.kind === "category" && l.link.reversed;
          const color = isBalancing ? BALANCING_COLOR : colorForSide(sideForCategoryLink(l.link, graph));
          const isActive = activeId === l.link.id;
          const reversedNote = isReversed
            ? " — flows the other way, back into the federal government, reducing this side's net total"
            : "";
          return (
            <g key={l.link.id}>
              <path
                className="bfs-link"
                d={l.path}
                fill={color}
                fillOpacity={isActive ? 0.85 : 0.5}
                tabIndex={0}
                role="button"
                aria-label={`Flow ${l.link.id}: ${formatSeriesValue(l.link.valueExact, graph.unit, graph.magnitude)}${reversedNote}`}
                onMouseEnter={() => setHoveredId(l.link.id)}
                onMouseLeave={() => setHoveredId((h) => (h === l.link.id ? null : h))}
                onFocus={() => setHoveredId(l.link.id)}
                onBlur={() => setHoveredId((h) => (h === l.link.id ? null : h))}
                onClick={() => select(l.link.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    select(l.link.id);
                  }
                }}
              />
              {isBalancing || isReversed ? (
                <path d={l.path} fill={`url(#${HATCH_PATTERN_ID})`} style={{ pointerEvents: "none", color }} />
              ) : null}
            </g>
          );
        })}

        {geometry.nodes.map((p) => {
          const isBalancing = p.node.kind === "balancing";
          const isReversed = !isBalancing && graph.links.some((l) => l.kind === "category" && l.reversed && (l.sourceId === p.node.id || l.targetId === p.node.id));
          const color = isBalancing ? BALANCING_COLOR : colorForSide(p.node.side === "hub" ? "hub" : p.node.side);
          const isActive = activeId === p.node.id;
          const label = labelsByNodeId.get(p.node.id);
          const anchor = labelAnchor(p, orientation, label?.anchor === "outside" ? OUTSIDE_LABEL_GAP : INLINE_LABEL_GAP);
          const displayLabel = resolveNodeLabel(p.node, seriesCatalog);
          const reversedNote = isReversed ? " — flows the other way, back into the federal government" : "";

          return (
            <g key={p.node.id}>
              <rect
                className="bfs-node"
                x={p.x0}
                y={p.y0}
                width={Math.max(p.x1 - p.x0, 1)}
                height={Math.max(p.y1 - p.y0, 1)}
                fill={color}
                fillOpacity={isActive ? 1 : 0.92}
                stroke={isBalancing || isReversed ? color : "none"}
                strokeDasharray={isBalancing || isReversed ? "4 3" : undefined}
                strokeWidth={isBalancing || isReversed ? 2 : 0}
                tabIndex={0}
                role="button"
                aria-label={`${displayLabel}: ${formatSeriesValue(p.node.valueExact, graph.unit, graph.magnitude)}${reversedNote}`}
                onMouseEnter={() => setHoveredId(p.node.id)}
                onMouseLeave={() => setHoveredId((h) => (h === p.node.id ? null : h))}
                onFocus={() => setHoveredId(p.node.id)}
                onBlur={() => setHoveredId((h) => (h === p.node.id ? null : h))}
                onClick={() => select(p.node.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    select(p.node.id);
                  }
                }}
              />
              {label?.visible ? (
                <>
                  {label.anchor === "outside" ? (
                    <line
                      x1={orientation === "horizontal" ? (p.node.side === "receipt" ? p.x0 : p.x1) : (p.x0 + p.x1) / 2}
                      y1={orientation === "horizontal" ? (p.y0 + p.y1) / 2 : p.node.side === "receipt" ? p.y0 : p.y1}
                      x2={anchor.textAnchor === "end" ? anchor.x + 4 : anchor.textAnchor === "start" ? anchor.x - 4 : anchor.x}
                      y2={anchor.y}
                      stroke="var(--bfs-gridline)"
                      strokeWidth={1}
                    />
                  ) : null}
                  <text x={anchor.x} y={anchor.y} textAnchor={anchor.textAnchor} dominantBaseline="middle" fontSize={12} className={label.anchor === "outside" ? "bfs-muted-text" : undefined}>
                    {displayLabel}
                  </text>
                </>
              ) : null}
            </g>
          );
        })}
      </svg>

      <VisuallyHidden as="p" id={captionId}>
        {summary}
      </VisuallyHidden>

      <DetailPanel detail={detail} catalog={seriesCatalog} onClose={pinnedId ? () => setPinnedId(null) : undefined} />
    </div>
  );
}

function Legend() {
  const swatchStyle = (color: string): CSSProperties => ({
    display: "inline-block",
    width: 12,
    height: 12,
    borderRadius: 2,
    background: color,
    marginRight: 6,
  });
  return (
    <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--bfs-text-secondary)", marginBottom: 8, flexWrap: "wrap" }}>
      <span>
        <i style={swatchStyle("var(--bfs-receipt)")} />
        Receipts
      </span>
      <span>
        <i style={swatchStyle("var(--bfs-outlay)")} />
        Outlays
      </span>
      <span>
        <i style={{ ...swatchStyle("var(--bfs-balancing)"), backgroundImage: "linear-gradient(45deg, var(--bfs-balancing) 25%, transparent 25%, transparent 50%, var(--bfs-balancing) 50%, var(--bfs-balancing) 75%, transparent 75%)", backgroundSize: "6px 6px" }} />
        Borrowing / surplus — fills the gap, not a spending category
      </span>
    </div>
  );
}
