/**
 * Pixel geometry for a FiscalFlowGraph, built on d3-sankey (the real D3
 * layout algorithm for this exact diagram shape — not a hand-rolled
 * substitute) + a small custom ribbon-path generator so the same geometry
 * works in both horizontal (desktop) and vertical/stacked (narrow-viewport)
 * orientation, which d3-sankey does not support natively.
 *
 * Node column order comes entirely from graph topology (receipts/borrowing
 * have no incoming link, outlays/surplus have no outgoing link, so
 * sankeyJustify places them at the far ends and the hub in between) with
 * `nodeSort(null)` so within-column order is exactly buildFiscalFlowGraph's
 * own deterministic order (descending by value, balancing node last) —
 * this package never lets d3-sankey's default crossing-minimization reorder
 * nodes, since the balancing flow's fixed position is part of the contract.
 *
 * `value` fed into d3-sankey is the cosmetic `valueApprox` float (pixel
 * proportion only) — every exactness claim (the reconciliation identity,
 * displayed totals) is computed upstream in buildFiscalFlowGraph from
 * `valueExact` and never touches this module.
 */
import { sankey as d3Sankey, sankeyJustify } from "d3-sankey";
import type { FiscalFlowGraph, FiscalFlowNode, FiscalFlowLink } from "../types";
import type { FlowOrientation } from "./orientation";

export interface GeometryOptions {
  readonly width: number;
  readonly height: number;
  readonly orientation: FlowOrientation;
  readonly nodeThickness?: number;
  readonly nodePadding?: number;
}

export interface PositionedNode {
  readonly node: FiscalFlowNode;
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

export interface PositionedLink {
  readonly link: FiscalFlowLink;
  readonly path: string;
  /** Ribbon thickness in pixels at its widest — for a legend swatch or a hover hit-test fallback, not needed to draw the path (the path already encodes width). */
  readonly thickness: number;
}

export interface FlowGeometry {
  readonly nodes: readonly PositionedNode[];
  readonly links: readonly PositionedLink[];
  readonly width: number;
  readonly height: number;
}

interface SankeyNodeDatum {
  id: string;
}

function bezierControlPoints(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  orientation: FlowOrientation,
): [number, number, number, number] {
  if (orientation === "horizontal") {
    const mx = (sx + tx) / 2;
    return [mx, sy, mx, ty];
  }
  const my = (sy + ty) / 2;
  return [sx, my, tx, my];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function ribbonPath(
  s0: readonly [number, number],
  s1: readonly [number, number],
  t0: readonly [number, number],
  t1: readonly [number, number],
  orientation: FlowOrientation,
): string {
  const top = bezierControlPoints(s0[0], s0[1], t0[0], t0[1], orientation);
  const bottom = bezierControlPoints(s1[0], s1[1], t1[0], t1[1], orientation);
  return (
    `M${s0[0]},${s0[1]} ` +
    `C${top[0]},${top[1]} ${top[2]},${top[3]} ${t0[0]},${t0[1]} ` +
    `L${t1[0]},${t1[1]} ` +
    `C${bottom[2]},${bottom[3]} ${bottom[0]},${bottom[1]} ${s1[0]},${s1[1]} Z`
  );
}

/** Computes node/link pixel positions and SVG ribbon paths for one graph, in either orientation. Pure — no DOM. */
export function computeFlowGeometry(graph: FiscalFlowGraph, opts: GeometryOptions): FlowGeometry {
  const { width, height, orientation, nodeThickness = 20, nodePadding = 12 } = opts;
  // Vertical orientation is computed by running the layout in a
  // width/height-swapped space, then swapping x<->y back on the result —
  // d3-sankey always lays out left-to-right internally.
  const layoutWidth = orientation === "horizontal" ? width : height;
  const layoutHeight = orientation === "horizontal" ? height : width;

  const nodeIndexOrder = new Map(graph.nodes.map((n, i) => [n.id, i]));
  const sankeyNodes: SankeyNodeDatum[] = graph.nodes.map((n) => ({ id: n.id }));
  const sankeyLinks = graph.links.map((l) => ({
    source: l.sourceId,
    target: l.targetId,
    value: Math.max(l.valueApprox, 0),
  }));

  const generator = d3Sankey<{ nodes: SankeyNodeDatum[]; links: typeof sankeyLinks }, SankeyNodeDatum, {}>()
    .nodeId((d) => d.id)
    .nodeWidth(nodeThickness)
    .nodePadding(nodePadding)
    .nodeAlign(sankeyJustify)
    .nodeSort(null)
    .linkSort(null)
    .extent([
      [0, 0],
      [layoutWidth, layoutHeight],
    ]);

  const laidOut = generator({ nodes: sankeyNodes, links: sankeyLinks });

  const positionedById = new Map<string, PositionedNode>();
  for (const n of laidOut.nodes) {
    const graphNode = graph.nodes[nodeIndexOrder.get(n.id) ?? -1];
    if (!graphNode || n.x0 === undefined || n.x1 === undefined || n.y0 === undefined || n.y1 === undefined) continue;
    // d3-sankey's internal relaxation accumulates float error (a node can
    // land at e.g. 400.00000000000006 against a 400px extent) — clamp to
    // the declared canvas so the contract "geometry stays within
    // [0,width]x[0,height]" holds exactly, not just to within an epsilon.
    const raw =
      orientation === "horizontal"
        ? { x0: n.x0, x1: n.x1, y0: n.y0, y1: n.y1 }
        : { x0: n.y0, x1: n.y1, y0: n.x0, y1: n.x1 };
    const positioned: PositionedNode = {
      node: graphNode,
      x0: clamp(raw.x0, 0, width),
      x1: clamp(raw.x1, 0, width),
      y0: clamp(raw.y0, 0, height),
      y1: clamp(raw.y1, 0, height),
    };
    positionedById.set(n.id, positioned);
  }

  const positionedNodes = graph.nodes.map((n) => positionedById.get(n.id)).filter((n): n is PositionedNode => n !== undefined);

  const positionedLinks: PositionedLink[] = [];
  for (const l of laidOut.links) {
    const sourceId = typeof l.source === "object" ? (l.source as SankeyNodeDatum).id : String(l.source);
    const targetId = typeof l.target === "object" ? (l.target as SankeyNodeDatum).id : String(l.target);
    const graphLink = graph.links.find((gl) => gl.sourceId === sourceId && gl.targetId === targetId);
    if (!graphLink || l.y0 === undefined || l.y1 === undefined || l.width === undefined) continue;
    const source = positionedById.get(sourceId);
    const target = positionedById.get(targetId);
    if (!source || !target) continue;

    const halfWidth = l.width / 2;
    const path =
      orientation === "horizontal"
        ? ribbonPath(
            [source.x1, l.y0 - halfWidth],
            [source.x1, l.y0 + halfWidth],
            [target.x0, l.y1 - halfWidth],
            [target.x0, l.y1 + halfWidth],
            orientation,
          )
        : ribbonPath(
            [l.y0 - halfWidth, source.y1],
            [l.y0 + halfWidth, source.y1],
            [l.y1 - halfWidth, target.y0],
            [l.y1 + halfWidth, target.y0],
            orientation,
          );

    positionedLinks.push({ link: graphLink, path, thickness: l.width });
  }

  return { nodes: positionedNodes, links: positionedLinks, width, height };
}
