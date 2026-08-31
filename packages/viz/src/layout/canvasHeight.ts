/**
 * Pure viewBox-height decision for the FiscalSankey canvas.
 *
 * CONSTRAINT: height must be a function of the graph's content and the
 * chosen orientation ONLY — never of the measured container height. The
 * measured container wraps this SVG, so feeding its height back into the
 * SVG's viewBox is a ResizeObserver ratchet: each observation includes the
 * legend/caption chrome above the SVG, which grows the viewBox, which grows
 * the rendered SVG, which grows the next observation, without bound
 * (production bug, 2026-08-31). Container *width* is safe to consume — it is
 * set by the page layout, not by the SVG.
 */
import type { FiscalFlowGraph } from "../types";
import type { FlowOrientation } from "./orientation";

export const MIN_HORIZONTAL_HEIGHT_PX = 420;
export const VERTICAL_HEIGHT_PX = 720;

export function resolveCanvasHeight(
  graph: FiscalFlowGraph,
  orientation: FlowOrientation,
  nodeThickness: number,
  nodePadding: number,
): number {
  // Vertical/stacked orientation runs the flow top-to-bottom: nodes stack
  // across the (fixed) width, so height is just the flow-axis run length.
  if (orientation === "vertical") return VERTICAL_HEIGHT_PX;
  // Horizontal orientation stacks nodes vertically within each column; the
  // densest side column sets how much room the layout needs before node
  // heights collapse into their padding.
  let receipts = 0;
  let outlays = 0;
  for (const n of graph.nodes) {
    if (n.side === "receipt") receipts += 1;
    else if (n.side === "outlay") outlays += 1;
  }
  const densest = Math.max(receipts, outlays, 1);
  const contentFloor = densest * (nodeThickness + nodePadding) + nodePadding;
  return Math.max(MIN_HORIZONTAL_HEIGHT_PX, contentFloor);
}
