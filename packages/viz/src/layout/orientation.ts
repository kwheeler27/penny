/**
 * Pure breakpoint decision: which orientation the Sankey should render in
 * at a given container width. Stacked/vertical reads better under ~640px
 * (a receipts-column / hub-row / outlays-column layout doesn't have room
 * to breathe at 375px in a left-to-right arrangement); wider containers
 * get the standard horizontal flow.
 */
export type FlowOrientation = "horizontal" | "vertical";

export const VERTICAL_BREAKPOINT_PX = 640;

export function chooseOrientation(containerWidthPx: number): FlowOrientation {
  return containerWidthPx < VERTICAL_BREAKPOINT_PX ? "vertical" : "horizontal";
}
