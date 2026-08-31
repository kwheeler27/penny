/**
 * Pure label-collision handling for one column of Sankey node bands. A
 * band tall enough for its own label gets one centered inside it ("Social
 * Security"). A thinner band (a small budget function on a busy month)
 * gets its label pushed outside the diagram on a leader line instead of
 * being hidden outright — but only if there's room before the next
 * outside label; when bands are packed too tightly even for that, the
 * label is dropped (never overlapped) and the value is still reachable
 * through the hover/tap detail affordance.
 */
export interface LabelBand {
  readonly id: string;
  /** Band extent along the cross-axis (screen Y in horizontal orientation, screen X in vertical), in pixels. Order/units match layout/sankeyGeometry.ts's PositionedNode. */
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export type LabelAnchor = "inline" | "outside";

export interface LabelPlacement {
  readonly id: string;
  readonly text: string;
  readonly visible: boolean;
  readonly anchor: LabelAnchor;
  /** Cross-axis center of the band this label describes. */
  readonly position: number;
}

export interface LabelPlacementOptions {
  /** Minimum band size (px) that comfortably fits a label inside it. Default 14 (one text line). */
  readonly minInlinePx?: number;
}

const DEFAULT_MIN_INLINE_PX = 14;

/** Places labels for one column's bands, hiding any that would overlap. Input order doesn't matter — bands are processed in cross-axis order. */
export function placeLabels(bands: readonly LabelBand[], opts: LabelPlacementOptions = {}): LabelPlacement[] {
  const minInline = opts.minInlinePx ?? DEFAULT_MIN_INLINE_PX;
  const sorted = [...bands].sort((a, b) => a.start - b.start);

  const placements: LabelPlacement[] = [];
  let lastVisibleCenter: number | null = null;

  for (const band of sorted) {
    const size = band.end - band.start;
    const center = (band.start + band.end) / 2;

    if (size >= minInline) {
      placements.push({ id: band.id, text: band.text, visible: true, anchor: "inline", position: center });
      lastVisibleCenter = center;
      continue;
    }

    const clearOfPrevious = lastVisibleCenter === null || center - lastVisibleCenter >= minInline;
    placements.push({
      id: band.id,
      text: band.text,
      visible: clearOfPrevious,
      anchor: "outside",
      position: center,
    });
    if (clearOfPrevious) lastVisibleCenter = center;
  }

  return placements;
}
