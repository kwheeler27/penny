/**
 * Data + pixel math for Frame B of the "spending history, scrubbable"
 * redesign (the approved interactive mockup, penny-history-scrub.html
 * rev 2, section "Compare the big five"): a FIXED set of series — the five
 * largest outlay categories plus "Everything else" (every other published
 * outlay function summed, including negative undistributed offsetting
 * receipts) — as 12-month totals on one shared dollar axis, with legend
 * chips that isolate a line and a y-scale that refits to whichever lines
 * are currently visible.
 *
 * This module knows nothing about React or which series is which category
 * — `series[].id` is an opaque caller-assigned string throughout. Like
 * every other layout module in this package, `Number()` is used only for
 * already-cosmetic pixel/domain math, never for the money values
 * themselves (those arrive as caller-supplied HistoryChartPoint strings —
 * see averagedHistoryLayout.ts — computed the same way apps/web already
 * computes CategoryHistoryChart's own 12-month-total points).
 */
import { formatAxisUsd, monotonePath, MIN_YEAR_TICK_GAP_PX } from "./categoryHistoryLayout";
import type { HistoryChartPoint } from "./averagedHistoryLayout";

// ---------- visibility state: hiddenIds + isolatedId ----------

export interface CompareSeriesInput {
  readonly id: string;
  readonly points: readonly HistoryChartPoint[];
  /** True only for the one series that starts OFF (the approved rev-2
   * decision: "Everything else... is OFF by default"). At most one series
   * is expected to set this; nothing here enforces that — it's the
   * caller's fixed-series-list contract to keep. */
  readonly defaultHidden?: boolean;
}

export interface CompareVisibility {
  /** Series toggled off by their OWN legend chip (seeded once, at mount,
   * from every input series' `defaultHidden` flag — see
   * `initialCompareVisibility`). Ignored while `isolatedId` is set. */
  readonly hiddenIds: ReadonlySet<string>;
  /** The one series currently shown ALONE (every other series hidden
   * regardless of `hiddenIds`), or null when nothing is isolated. */
  readonly isolatedId: string | null;
}

/** The starting visibility for a fixed series list — every `defaultHidden`
 * series off, nothing isolated. Call this ONCE (e.g. as a `useState`
 * initializer) — it is not meant to be re-derived on every render, since a
 * reader's own clicks (via `toggleCompareSeries` below) diverge from this
 * starting point immediately. */
export function initialCompareVisibility(series: readonly Pick<CompareSeriesInput, "id" | "defaultHidden">[]): CompareVisibility {
  return { hiddenIds: new Set(series.filter((s) => s.defaultHidden).map((s) => s.id)), isolatedId: null };
}

/** Whether series `id` is currently visible under `visibility` — isolation
 * (when set) overrides everything else; otherwise a series is visible iff
 * it isn't in `hiddenIds`. Shared by the chart's own render pass AND the
 * annotation-visibility gate below, so the two can never disagree about
 * what's actually on screen. */
export function isCompareSeriesVisible(id: string, visibility: CompareVisibility): boolean {
  if (visibility.isolatedId !== null) return visibility.isolatedId === id;
  return !visibility.hiddenIds.has(id);
}

/**
 * Applies one legend-chip click for series `id`. Reconciles the two
 * approved rev-2 decisions for Frame B, which only ever interact for the
 * ONE series that starts hidden ("Everything else"):
 *
 *   - "Everything else... is OFF by default (its legend chip turns it
 *     on)."
 *   - "Legend chips isolate a line on click (click again to restore)."
 *
 * Four cases, checked in this order:
 *
 *  1. Clicking the currently ISOLATED series again restores — `isolatedId`
 *     goes back to null, so visibility reverts to whatever `hiddenIds`
 *     (unchanged by isolating/restoring) already said. This is "click
 *     again to restore".
 *  2. Clicking a DIFFERENT series while something is isolated switches the
 *     isolation target directly — matches the approved mockup's own
 *     one-line toggle (`isolated = isolated === ci ? null : ci`) exactly:
 *     no need to de-isolate first.
 *  3. Clicking a HIDDEN series, with nothing isolated, just turns it ON —
 *     joining whatever else is already visible, NOT isolating it alone.
 *     This is the one case that makes "the chip turns it on" true the
 *     FIRST time "Everything else" is clicked, rather than the general
 *     isolate rule (case 4) firing instead. `hiddenIds` is a fresh Set
 *     (never mutated in place), matching this package's usual immutable
 *     state-update convention.
 *  4. Clicking a VISIBLE, non-isolated series isolates it — case 2's
 *     counterpart for when nothing was isolated yet. A SECOND click on
 *     "Everything else" (now visible after case 3 already turned it on)
 *     falls into this same case, same as any of the fixed five — nothing
 *     Everything-else-specific happens beyond its own first click.
 */
export function toggleCompareSeries(current: CompareVisibility, id: string): CompareVisibility {
  if (current.isolatedId === id) return { ...current, isolatedId: null };
  if (current.isolatedId !== null) return { ...current, isolatedId: id };
  if (current.hiddenIds.has(id)) {
    const nextHidden = new Set(current.hiddenIds);
    nextHidden.delete(id);
    return { hiddenIds: nextHidden, isolatedId: null };
  }
  return { ...current, isolatedId: id };
}

// ---------- y-scale refit ----------

export interface ValueDomain {
  readonly lo: number;
  readonly hi: number;
}

/**
 * The y-axis domain across only the currently VISIBLE series' values — the
 * approved decision's "the y-scale refits to visible lines on every
 * visibility change." Matches computeCategoryHistoryGeometry's own
 * data-fit convention exactly (`lo` always includes 0, never a "nice round
 * number" scale, never padded) — a deliberate departure from the
 * interactive mockup's own ad hoc `* 1.06` headroom / `* 0.92` floor, which
 * was written fresh for that one-off demo rather than against this
 * package's established chart idiom; every OTHER chart here stays
 * data-fit-with-zero-included, and Frame B follows suit rather than
 * introducing a second convention. Falls back to `{ lo: 0, hi: 1 }` — never
 * a zero-span, division-by-zero-prone domain — when nothing is visible at
 * all (every series hidden, none isolated with points).
 */
export function computeVisibleValueDomain(series: readonly Pick<CompareSeriesInput, "id" | "points">[], visibility: CompareVisibility): ValueDomain {
  const values = series.filter((s) => isCompareSeriesVisible(s.id, visibility)).flatMap((s) => s.points.map((p) => Number(p.valueWhole)));
  if (values.length === 0) return { lo: 0, hi: 1 };
  return { lo: Math.min(0, ...values), hi: Math.max(0, ...values) };
}

// ---------- end-of-line / hover label de-collision ----------

export interface EndLabelCandidate {
  readonly id: string;
  readonly y: number;
}

/**
 * Nudges a set of right-edge (or hover) labels apart, vertically, so no two
 * land within `minGap` of each other, then clamps the whole stack inside
 * `[lo, hi]` — Frame B's end-of-line labels (six lines' worth, approved
 * decision: "vertically de-collided, min 20px gaps") and its hover-scrub
 * value labels both use this. Extends the approved mockup's own two-pass
 * `decollide()` (push down for min gaps, then clamp a bottom overflow and
 * re-resolve) with a symmetric top clamp: the mockup never needed one (its
 * six labels never collectively exceeded that one chart's height), but a
 * shared, exported primitive should stay correct for a caller with more
 * series or a shorter chart, not just the one case the mockup happened to
 * hit. `candidates` need not be pre-sorted; the returned array is sorted by
 * final `y`, so match a result back to its series by `id`, never by index.
 */
export function decollideEndLabels(candidates: readonly EndLabelCandidate[], minGap: number, lo: number, hi: number): EndLabelCandidate[] {
  const items = candidates.map((c) => ({ ...c })).sort((a, b) => a.y - b.y);

  const pushDown = () => {
    for (let i = 1; i < items.length; i++) {
      if (items[i]!.y - items[i - 1]!.y < minGap) items[i]!.y = items[i - 1]!.y + minGap;
    }
  };
  pushDown();

  // Bottom clamp: if the cumulative downward pushes ran the last label past
  // `hi`, pin it there and walk upward, pulling each earlier label up just
  // enough to keep minGap from the one below it, until one is already
  // inside bounds.
  let ceiling = hi;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i]!.y > ceiling) {
      items[i]!.y = ceiling;
      ceiling -= minGap;
    } else {
      break;
    }
  }
  // The bottom clamp can reintroduce a min-gap violation further up the
  // stack (pulling one label up may now sit it too close to the one above
  // it) — one more forward pass resolves that, mirroring the mockup's own
  // third pass.
  pushDown();

  // Top clamp: the mirror image, for a caller whose labels collectively
  // don't fit even after the bottom clamp above.
  let floor = lo;
  for (let i = 0; i < items.length; i++) {
    if (items[i]!.y < floor) {
      items[i]!.y = floor;
      floor += minGap;
    } else {
      break;
    }
  }

  return items;
}

// ---------- geometry ----------

export interface CompareLayoutOptions {
  readonly width: number;
  readonly height: number;
  readonly padLeft: number;
  readonly padRight: number;
  readonly padTop: number;
  readonly padBottom: number;
}

export interface ComparePositionedPoint {
  readonly periodEnd: string;
  readonly x: number;
  readonly y: number;
}

export interface CompareSeriesGeometry {
  readonly id: string;
  readonly path: string;
  readonly points: readonly ComparePositionedPoint[];
}

export interface CompareMonthTick {
  readonly periodEnd: string;
  readonly x: number;
}

export interface CompareYearTick {
  readonly x: number;
  readonly label: string;
}

export interface CompareValueTick {
  readonly y: number;
  readonly value: number;
  readonly label: string;
}

export interface CompareGeometry {
  /** Positioned path + points for each VISIBLE series only, in the same
   * order as the input `series` array (never all six — a hidden series
   * costs nothing to lay out or paint). */
  readonly series: readonly CompareSeriesGeometry[];
  /** Every calendar month across ALL input series (visible or not),
   * positioned — the x-domain stays fixed across visibility toggles (only
   * the y-domain refits); this is also what the chart's hover scrub snaps
   * to. */
  readonly months: readonly CompareMonthTick[];
  readonly yearTicks: readonly CompareYearTick[];
  readonly valueTicks: readonly CompareValueTick[];
  readonly width: number;
  readonly height: number;
}

const EMPTY_GEOMETRY_BASE = {
  series: [] as CompareSeriesGeometry[],
  months: [] as CompareMonthTick[],
  yearTicks: [] as CompareYearTick[],
  valueTicks: [] as CompareValueTick[],
};

/** `YYYY-MM-DD` -> `year*12 + month`. Duplicated from
 * averagedHistoryLayout.ts's own copy (itself duplicated from
 * categoryHistoryLayout.ts's private helper) — see that module's doc
 * comment for why each layout module here stays self-contained rather than
 * reaching into a sibling's internals. */
function monthIndexOf(periodEnd: string): number {
  return Number(periodEnd.slice(0, 4)) * 12 + Number(periodEnd.slice(5, 7));
}

/**
 * Computes Frame B's shared geometry: every input series' x-position comes
 * from the FULL combined calendar span (every series, visible or not, so
 * toggling a line never shifts the x-axis); the y-domain and the paths/
 * points returned come from VISIBLE series only (the approved "scale
 * refits to visible" decision) via `computeVisibleValueDomain` above.
 *
 * Returns the empty geometry (no series, no ticks) when every input series
 * has zero points — the caller's job to render a "no data yet" state
 * instead, matching every other chart in this package.
 */
export function computeCompareGeometry(series: readonly CompareSeriesInput[], visibility: CompareVisibility, opts: CompareLayoutOptions): CompareGeometry {
  const { width, height, padLeft, padRight, padTop, padBottom } = opts;
  const allPoints = series.flatMap((s) => s.points);
  if (allPoints.length === 0) return { ...EMPTY_GEOMETRY_BASE, width, height };

  const firstIdx = Math.min(...allPoints.map((p) => monthIndexOf(p.periodEnd)));
  const lastIdx = Math.max(...allPoints.map((p) => monthIndexOf(p.periodEnd)));
  const span = Math.max(1, lastIdx - firstIdx);
  const plotWidth = Math.max(1, width - padLeft - padRight);
  const xFor = (periodEnd: string) => padLeft + ((monthIndexOf(periodEnd) - firstIdx) / span) * plotWidth;

  const { lo, hi } = computeVisibleValueDomain(series, visibility);
  const range = hi - lo || 1;
  const plotHeight = Math.max(1, height - padTop - padBottom);
  const yFor = (v: number) => padTop + (1 - (v - lo) / range) * plotHeight;

  const seriesGeometry: CompareSeriesGeometry[] = series
    .filter((s) => isCompareSeriesVisible(s.id, visibility))
    .map((s) => {
      const points: ComparePositionedPoint[] = s.points.map((p) => ({ periodEnd: p.periodEnd, x: xFor(p.periodEnd), y: yFor(Number(p.valueWhole)) }));
      return { id: s.id, path: monotonePath(points), points };
    });

  // Every distinct calendar month across ALL series (union, deduped,
  // ascending) — the hover-scrub's snap targets, and the walk below for
  // year ticks. Positioned via the same fixed x-domain as every series'
  // own points, so a scrub always lands exactly on a real point whenever
  // one exists there.
  const monthSet = new Set(allPoints.map((p) => p.periodEnd));
  const monthList = [...monthSet].sort();
  const months: CompareMonthTick[] = monthList.map((periodEnd) => ({ periodEnd, x: xFor(periodEnd) }));

  // Year ticks: one per calendar year crossed, with the same collision-drop
  // guard categoryHistoryLayout.ts's own year ticks use (shared constant,
  // see MIN_YEAR_TICK_GAP_PX's own doc comment for why it's imported rather
  // than re-chosen here).
  const rawYearTicks: CompareYearTick[] = [];
  let lastYear: string | null = null;
  for (const m of months) {
    const year = m.periodEnd.slice(0, 4);
    if (year !== lastYear) {
      rawYearTicks.push({ x: m.x, label: year });
      lastYear = year;
    }
  }
  const yearTicks: CompareYearTick[] = [];
  for (const tick of rawYearTicks) {
    const previous = yearTicks[yearTicks.length - 1];
    if (previous && tick.x - previous.x < MIN_YEAR_TICK_GAP_PX) continue;
    yearTicks.push(tick);
  }

  // Three y-axis guides — visible-domain high/mid/low, deduplicated by
  // y-position (a flat or all-hidden domain would otherwise emit
  // overlapping identical labels), matching computeCategoryHistoryGeometry's
  // own valueTicks convention exactly.
  // formatAxisUsd — the SAME fixed-billions formatter categoryHistoryLayout.ts
  // uses for every other chart in this package — not an auto-scaling
  // billions/trillions formatter: this chart's own end-of-line labels, hover
  // labels, and annotation title all arrive from the server already fixed
  // to billions (apps/web's formatUsdScale), so the axis switching units on
  // its own past $1,000B would put two different magnitudes on one chart
  // (CLAUDE.md: never silently mix magnitudes in a sum or a chart — found in
  // review). A y-axis figure that big ("$3,817.2B") is exactly what this
  // same chart's own end-of-line label already shows for that point.
  const rawValueTicks = [hi, (hi + lo) / 2, lo].map((v) => ({ y: yFor(v), value: v, label: formatAxisUsd(v) }));
  const valueTicks: CompareValueTick[] = rawValueTicks.filter((t, i) => i === 0 || Math.abs(t.y - rawValueTicks[i - 1]!.y) > 0.5);

  return { series: seriesGeometry, months, yearTicks, valueTicks, width, height };
}

/**
 * Finds the calendar month (from `geometry.months`) nearest `pointerX` —
 * Frame B's hover-scrub snap target, shared across every visible line
 * (unlike categoryHistoryLayout.ts's `findNearestHistoryPoint`, which picks
 * ONE line to highlight, Frame B's OWID-style hover shows a dot + label on
 * EVERY visible line at the same snapped month). A linear scan, matching
 * this package's documented convention that its charts top out at a
 * couple hundred points. Returns null only when there are no months at
 * all (empty geometry).
 */
export function findNearestCompareMonth(months: readonly CompareMonthTick[], pointerX: number): string | null {
  if (months.length === 0) return null;
  let bestIdx = 0;
  let bestDx = Math.abs(months[0]!.x - pointerX);
  for (let i = 1; i < months.length; i++) {
    const dx = Math.abs(months[i]!.x - pointerX);
    if (dx < bestDx) {
      bestDx = dx;
      bestIdx = i;
    }
  }
  return months[bestIdx]!.periodEnd;
}
