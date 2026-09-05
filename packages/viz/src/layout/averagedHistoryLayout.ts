/**
 * Data math for Frame A of the "spending history, scrubbable" redesign (the
 * approved interactive mockup, penny-history-scrub.html rev 2): a single
 * category's rolling monthly AVERAGE (bold) drawn over its actual monthly
 * figures (faint), on ONE shared linear y-axis. The rev-2 insight that made
 * this replace the old two-panel/second-axis design: "a 12-month average is
 * the 12-month total ÷ 12", so it lives on exactly the same scale as the
 * monthly figures it smooths — no second axis, nothing crushed.
 *
 * This module owns only the AVERAGE-SERIES math (`rollingAverage`) and the
 * time-window clip (`clipToWindow`) — the actual pixel geometry reuses
 * `computeCategoryHistoryGeometry` from categoryHistoryLayout.ts directly
 * (see AveragedHistoryChart.tsx): a bold, monotone-smoothed line over a
 * thin, straight-segment line on one data-fit linear domain is EXACTLY that
 * function's existing shape, just with "the rolling average" standing in
 * for "the 12-month total". Reusing it, rather than re-deriving the same
 * domain/tick/monotone-spline math a second time, is the whole point of
 * putting this file in the same package as that one.
 *
 * Like every other layout module here, this file knows nothing about React
 * or pixels: `Number()` below is used ONLY where a value was already
 * committed to being cosmetic before this module saw it (never for the
 * money math itself, which stays BigInt/decimal-string exact via
 * money/decimal.ts throughout).
 */
import { sumDecimal, divideDecimalByInt } from "../money/decimal";
import { formatUsd } from "../money/format";
import { filterHistoryToWindow, type HistoryLayoutPoint, type HistoryWindow } from "./categoryHistoryLayout";

export type { HistoryWindow };

/**
 * The shared point shape both new Frame A/B components render:
 * `periodEnd`/`valueWhole` (this package's existing HistoryLayoutPoint —
 * see categoryHistoryLayout.ts) plus the three presentation fields
 * CategoryHistoryChart's own point type already carries (`display`,
 * `label`, `scaledDisplay`). Named `HistoryChartPoint` here — rather than
 * importing CategoryHistoryChartPoint from that component's .tsx file —
 * because this module (like every layout module in the package) stays
 * dependency-free of any component; the two types are deliberately
 * structurally identical, not merely similar, so a caller already holding
 * one can pass it directly where the other is expected.
 */
export interface HistoryChartPoint extends HistoryLayoutPoint {
  /** Full-precision, "exact style" display string — see `rollingAverage`'s
   * own doc comment for how an AVERAGE point's `display` is derived (this
   * package's own formatUsd, never a bespoke formatter, matching
   * money/format.ts's "one shared formatter" doctrine); for a raw monthly
   * or 12-month-total point, the caller (apps/web) supplies this the same
   * way it always has. */
  readonly display: string;
  /** Short label for this point ("Jul 2026"). */
  readonly label: string;
  /** Rounded, compact display string ("$146.7B" style). Falls back to
   * `display` when omitted, matching every other chart in this package. */
  readonly scaledDisplay?: string;
}

/** `YYYY-MM-DD` -> `year*12 + month`. Duplicated (deliberately, in
 * miniature) rather than imported from categoryHistoryLayout.ts — that
 * module doesn't export it, and every other layout module in this package
 * (dualCadenceHistoryLayout.ts's own `daysFromEpoch`/month helpers) already
 * makes the same choice for the same reason: each layout module stays
 * self-contained rather than reaching into a sibling's private internals. */
function monthIndexOf(periodEnd: string): number {
  return Number(periodEnd.slice(0, 4)) * 12 + Number(periodEnd.slice(5, 7));
}

/**
 * Computes the trailing `windowMonths`-month rolling average of `points`'
 * own monthly figures — Frame A's bold line. `points` must be the FULL
 * monthly series, ascending by `periodEnd` (this package's standing
 * convention). The output's first entry lands at index `windowMonths - 1`
 * (the first month with `windowMonths` real preceding entries to average),
 * and each entry takes its `periodEnd`/`label` from the WINDOW'S LAST
 * month — the average "as of" that month, never its start or midpoint.
 *
 * This function must always be called on the COMPLETE series, and its
 * result then narrowed with `clipToWindow` for whatever time window (1Y /
 * 5Y / 10Y / All) is currently showing — never called on an
 * already-truncated `points` array. This mirrors
 * `filterHistoryToWindow`'s own documented principle for the OLD
 * 12-month-total line exactly, for the identical reason: a trailing
 * N-month average needs the N-1 real months before wherever a truncated
 * window would start, so computing it on a truncated series would silently
 * produce a DIFFERENT (wrong) smoothing near the window's own left edge —
 * exactly the kind of fabrication CLAUDE.md forbids.
 *
 * A window that would span a GAP in the backfill (a missing calendar month)
 * is skipped entirely, never averaged over as if the gap weren't there —
 * mirrors apps/web's own `buildCategoryHistoryLineSeries` gap guard for the
 * 12-month total (CLAUDE.md: missing data is a gap, never smoothed away).
 * This means the returned array can end EARLIER than `points` itself (if
 * the trailing window ending at `points`' own last month spans a gap) —
 * callers must look an average up by `periodEnd`, never assume it's the
 * same length as, or ends at the same point as, `points`.
 *
 * Money math stays exact throughout: the window's sum is `sumDecimal`
 * (BigInt), the division by `windowMonths` is `divideDecimalByInt`
 * (BigInt long division — see that function's own doc comment for why some
 * rounding there is mathematically unavoidable and why it's NOT the
 * "display boundary"). `display`/`scaledDisplay` are then this package's
 * single shared money formatter, `formatUsd` (money/format.ts) — the ONLY
 * rounding a reader ever actually sees.
 */
export function rollingAverage(points: readonly HistoryChartPoint[], windowMonths: number): HistoryChartPoint[] {
  if (!Number.isInteger(windowMonths) || windowMonths <= 0) {
    throw new Error(`rollingAverage: windowMonths must be a positive integer, got ${windowMonths}`);
  }
  const out: HistoryChartPoint[] = [];
  for (let i = windowMonths - 1; i < points.length; i++) {
    const windowStart = points[i - windowMonths + 1]!;
    const windowEnd = points[i]!;
    // Gap guard: a real trailing window spans exactly windowMonths-1
    // calendar-month steps between its first and last entry. A hole in the
    // backfill widens that gap — skip the window rather than average across
    // months that don't exist.
    if (monthIndexOf(windowEnd.periodEnd) - monthIndexOf(windowStart.periodEnd) !== windowMonths - 1) continue;
    const windowSlice = points.slice(i - windowMonths + 1, i + 1);
    const sum = sumDecimal(windowSlice.map((p) => p.valueWhole));
    const avgWhole = divideDecimalByInt(sum, windowMonths);
    out.push({
      periodEnd: windowEnd.periodEnd,
      label: windowEnd.label,
      valueWhole: avgWhole,
      display: formatUsd(avgWhole, { compact: false }),
      scaledDisplay: formatUsd(avgWhole, { compact: true }),
    });
  }
  return out;
}

/**
 * Narrows one already-computed series — either the raw `monthly` points or
 * a FULL-series `rollingAverage` result — to a 1Y/5Y/10Y/All time window
 * (see categoryHistoryLayout.ts's `HISTORY_WINDOWS`), anchored on THIS
 * ARRAY's own last point. A pure clip, never a recompute: delegates to
 * `filterHistoryToWindow` (passing an empty second array and keeping only
 * its `.monthly` result) rather than re-deriving the same anchor/cutoff
 * math a second time, so that function's own test coverage backs this one
 * too.
 *
 * Calling this ONCE PER SERIES (once for `monthly`, once for a full
 * `rollingAverage` result) — rather than the paired
 * `filterHistoryToWindow(monthly, total, window)` shape — is deliberate
 * here: Frame A's average can legitimately be a few entries SHORTER than
 * `monthly` (see `rollingAverage`'s own gap-guard doc comment above), so
 * the two series don't always share the "total is a suffix of monthly"
 * relationship `filterHistoryToWindow`'s paired signature assumes. Both
 * calls still anchor on the SAME calendar month whenever the average has no
 * gap at the series' own end (the common case), which is exactly what
 * keeps the "compute on the full series, clip afterward" guarantee intact
 * for Frame A's bold line the same way it already holds for the old
 * 12-month-total line.
 */
export function clipToWindow<T extends HistoryLayoutPoint>(points: readonly T[], window: HistoryWindow): readonly T[] {
  return filterHistoryToWindow(points, [], window).monthly;
}

/**
 * Nudges the hover-scrub's MONTHLY value label away from the AVERAGE
 * value label when the two lines happen to cross near the scrubbed month
 * (both labels would otherwise sit right on top of each other) — the
 * approved mockup's own inline fix (`if (Math.abs(dm - py) < 22) ...`) as a
 * small, independently-testable pure function rather than logic buried in
 * the component. Unlike `decollideEndLabels` (layout/compareLayout.ts,
 * Frame B's N-way label stack), this only ever has TWO labels and one of
 * them (the average's) never moves — the monthly label is the only one
 * that ever gets pushed, and only in one direction (below its own dot
 * instead of above it), matching the mockup exactly. Returns
 * `naturalMonthlyY` unchanged whenever there's no average value to collide
 * with at all (`avgY` is null — the hovered month falls in a gap the
 * rolling average skipped, see `rollingAverage`'s own gap-guard doc
 * comment) or the two are already far enough apart.
 */
export function nudgeHoverLabelAwayFromAverage(naturalMonthlyY: number, avgY: number | null, minGap: number = 22, nudge: number = 20): number {
  if (avgY === null) return naturalMonthlyY;
  return Math.abs(naturalMonthlyY - avgY) < minGap ? naturalMonthlyY + nudge : naturalMonthlyY;
}
