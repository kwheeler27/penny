/**
 * Pure pixel-layout math for the front door's "history line" chart (beat 1,
 * ORCHESTRATION_PROMPT.md / the approved Penny Atlas rev 6): a category's
 * full monthly history (thin, muted) plus its 12-month rolling total
 * (emphasized), once enough months exist to draw either. This module knows
 * nothing about the registry, money exactness, or React — it takes
 * already-decided whole-unit decimal strings (scaled/rounded by the caller,
 * per lib/front-door-transform.ts's convention in apps/web) and produces SVG
 * coordinates only. `Number()` below is used ONLY for cosmetic pixel
 * placement, matching packages/viz/src/money/decimal.ts's documented
 * exception — never for a value asserted to be exact.
 */

export interface HistoryLayoutPoint {
  /** YYYY-MM-DD, the month's last day — lexical order is chronological order for this format. */
  readonly periodEnd: string;
  /** Whole-unit decimal string (already scaled by the caller). */
  readonly valueWhole: string;
}

export interface PositionedHistoryPoint {
  readonly periodEnd: string;
  readonly x: number;
  readonly y: number;
}

export interface YearTick {
  readonly x: number;
  readonly label: string;
}

/** A y-axis guide value ("$500B" style) — one of exactly three per chart
 * (the data-fit domain's high/mid/low), never a "nice round number" scale:
 * the domain stays data-fit (no padding, no area fill implying a zero
 * baseline), matching computeCategoryHistoryGeometry's own y-domain math
 * exactly. `value` (the raw float the label was derived from) is exposed
 * for a test that wants it — never re-derive the domain from it. */
export interface HistoryValueTick {
  readonly y: number;
  readonly value: number;
  readonly label: string;
}

export interface CategoryHistoryGeometry {
  readonly monthlyPath: string;
  /** The 12-month total's path — a monotone-x cubic spline (see
   * `monotonePath` below), never a fitted/smoothed curve: it passes through
   * every point exactly, matching `totalPoints` digit for digit. */
  readonly totalPath: string;
  readonly monthlyPoints: readonly PositionedHistoryPoint[];
  readonly totalPoints: readonly PositionedHistoryPoint[];
  readonly yearTicks: readonly YearTick[];
  readonly valueTicks: readonly HistoryValueTick[];
  readonly width: number;
  readonly height: number;
}

export interface CategoryHistoryLayoutOptions {
  readonly width: number;
  readonly height: number;
  readonly padLeft: number;
  readonly padRight: number;
  readonly padTop: number;
  readonly padBottom: number;
}

/** `YYYY-MM-DD` -> `year*12 + month`, a whole-calendar-month index — pure
 * string-digit parsing, never a `Date` round-trip. Used only to space points
 * proportionally to real elapsed time (so a gap in the backfill widens the
 * gap visually rather than compressing it away). */
function monthIndexOf(periodEnd: string): number {
  return Number(periodEnd.slice(0, 4)) * 12 + Number(periodEnd.slice(5, 7));
}

function calendarYearOf(periodEnd: string): string {
  return periodEnd.slice(0, 4);
}

/** Minimum horizontal spacing (in the same SVG viewBox units as the year
 * ticks' own `fontSize={10}`) between two adjacent year-tick labels before
 * one is dropped as illegible — see the year-ticks block below. Exported so
 * layout/compareLayout.ts's own year-tick collision guard (Frame B's
 * multi-series chart, "Compare the big five") shares the identical
 * legibility threshold rather than risking an independently-chosen number
 * drifting from this one. */
export const MIN_YEAR_TICK_GAP_PX = 26;

/**
 * Computes the SVG geometry for one category's history chart. `monthly` and
 * `total` must each be sorted ascending by `periodEnd` (the caller's job —
 * this module trusts the order it's given, matching sankeyGeometry.ts's own
 * convention of trusting its input's shape). `total` may be empty (fewer
 * than 12 months exist yet) — the chart then renders the monthly line alone,
 * never a fabricated total line.
 *
 * Guarantees: every returned x/y falls within [0, width] x [0, height]; x is
 * strictly increasing across `monthlyPoints` (and, independently, across
 * `totalPoints`) whenever there is more than one point.
 */
export function computeCategoryHistoryGeometry(
  monthly: readonly HistoryLayoutPoint[],
  total: readonly HistoryLayoutPoint[],
  opts: CategoryHistoryLayoutOptions,
): CategoryHistoryGeometry {
  const { width, height, padLeft, padRight, padTop, padBottom } = opts;
  if (monthly.length === 0) {
    return { monthlyPath: "", totalPath: "", monthlyPoints: [], totalPoints: [], yearTicks: [], valueTicks: [], width, height };
  }

  const firstIdx = monthIndexOf(monthly[0]!.periodEnd);
  const lastIdx = monthIndexOf(monthly[monthly.length - 1]!.periodEnd);
  const span = Math.max(1, lastIdx - firstIdx);
  const plotWidth = Math.max(1, width - padLeft - padRight);
  const xFor = (periodEnd: string) => padLeft + ((monthIndexOf(periodEnd) - firstIdx) / span) * plotWidth;

  const values = [...monthly, ...total].map((p) => Number(p.valueWhole));
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const range = hi - lo || 1;
  const plotHeight = Math.max(1, height - padTop - padBottom);
  const yFor = (valueWhole: string) => padTop + (1 - (Number(valueWhole) - lo) / range) * plotHeight;

  const monthlyPoints: PositionedHistoryPoint[] = monthly.map((p) => ({ periodEnd: p.periodEnd, x: xFor(p.periodEnd), y: yFor(p.valueWhole) }));
  const totalPoints: PositionedHistoryPoint[] = total.map((p) => ({ periodEnd: p.periodEnd, x: xFor(p.periodEnd), y: yFor(p.valueWhole) }));

  const toPath = (points: readonly PositionedHistoryPoint[]) => points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  // Year ticks: one per calendar year crossed, at the first point of that
  // year — never a hardcoded set of years (self-adjusts as the backfill
  // grows). The very first point always ticks (lastYear starts as a value
  // no real year equals), so the series' start year is never unlabeled. This
  // deliberately does NOT also force a tick at the very last point: for a
  // continuous monthly series, the last point's year was already ticked
  // earlier in the same run whenever it isn't a brand-new year — forcing a
  // second tick there produced two adjacent, overlapping "2026" labels when
  // the series happened to end partway through its final year (found via a
  // real-data screenshot, 137-month Medicare history, Mar 2015-Jul 2026).
  const rawYearTicks: YearTick[] = [];
  let lastYear: string | null = null;
  for (const p of monthlyPoints) {
    const year = calendarYearOf(p.periodEnd);
    if (year !== lastYear) {
      rawYearTicks.push({ x: p.x, label: year });
      lastYear = year;
    }
  }
  // Drop any tick (other than the first, which always survives) that lands
  // too close to the previous KEPT tick to be legible as two separate
  // 4-digit labels — the same collision the comment above already found at
  // the series' own right edge, but reachable at the LEFT edge too once the
  // time-window selector (1Y/5Y/10Y) can start the visible series mid-year:
  // e.g. a 10-year window beginning August 2016 puts "2016" and the
  // following "2017" (only 5 months later) close enough to visually merge
  // (found via a real-data screenshot of the front door's 10Y window on a
  // 137-month Medicare history). `MIN_YEAR_TICK_GAP_PX` is expressed in the
  // same SVG viewBox units as the tick labels' own `fontSize={10}`, so it
  // scales however the caller's `width` does.
  const yearTicks: YearTick[] = [];
  for (const tick of rawYearTicks) {
    const previous = yearTicks[yearTicks.length - 1];
    if (previous && tick.x - previous.x < MIN_YEAR_TICK_GAP_PX) continue;
    yearTicks.push(tick);
  }

  // Three y-axis guides — the data-fit domain's high/mid/low, never a
  // "nice round number" scale (the domain stays exactly what the data
  // spans; no padding, matching the "no area fill" rule this chart follows
  // since a data-fit domain has no meaningful zero baseline to anchor a
  // fill to). Deduplicated by y-position (a flat, single-valued series would
  // otherwise emit three identical, overlapping labels).
  const rawTicks = [hi, (hi + lo) / 2, lo].map((v) => ({ y: yFor(String(v)), value: v, label: formatAxisUsd(v) }));
  const valueTicks: HistoryValueTick[] = rawTicks.filter((t, i) => i === 0 || Math.abs(t.y - rawTicks[i - 1]!.y) > 0.5);

  // The 12-month total is drawn as a smooth monotone-x spline (never a
  // fitted curve — it passes through every point exactly); the monthly line
  // stays straight segments, per this chart's own visual hierarchy (thin,
  // muted, "as published" vs. bold, smoothed "12-month total").
  return { monthlyPath: toPath(monthlyPoints), totalPath: monotonePath(totalPoints), monthlyPoints, totalPoints, yearTicks, valueTicks, width, height };
}

/** Cosmetic-only y-axis guide label ("$500B" / "$1,384.4B" style) — mirrors
 * apps/web's lib/format.ts `formatUsdScale`'s OUTPUT SHAPE (a fixed "B"
 * scale, comma-grouped, one decimal — CLAUDE.md: values keep their unit,
 * never silently switch magnitude, so this never flips to "$1.4T" for a
 * large 12-month total) without importing it: this package stays
 * dependency-free of apps/web (matching auctionSeriesLayout.ts's own small
 * local axis-tick formatter). `Number`-based, like every other cosmetic
 * pixel/guide computation in this module — never used for a displayed,
 * asserted-exact figure (those always arrive as a precomputed string from
 * the caller, per this module's own top-of-file doc comment).
 *
 * Exported so layout/compareLayout.ts's own axis ("Compare the big five",
 * Frame B) reuses this SAME fixed-billions formatter rather than an
 * independent auto-scaling one: that chart's end-of-line labels, hover
 * labels, and annotation title all already arrive from the server as
 * fixed-billions `scaledDisplay` strings (apps/web's formatUsdScale), so an
 * axis that itself switched to trillions past $1,000B would put two
 * different magnitudes on one chart — CLAUDE.md's "never silently mix
 * magnitudes in a sum or a chart," found in review. */
export function formatAxisUsd(value: number): string {
  const billions = value / 1_000_000_000;
  const rounded = Math.round(Math.abs(billions) * 10) / 10;
  if (rounded === 0) return "$0";
  const grouped = rounded.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${billions < 0 ? "−" : ""}$${grouped}B`;
}

// ---------- monotone-x cubic interpolation (the 12-month total's curve) ----------

export interface BezierSegment {
  readonly cp1: { readonly x: number; readonly y: number };
  readonly cp2: { readonly x: number; readonly y: number };
  readonly end: { readonly x: number; readonly y: number };
}

/**
 * Fritsch–Carlson monotone cubic Hermite interpolation, converted to cubic
 * Bezier segments. This is an INTERPOLATING spline — the resulting curve
 * passes through every input point exactly (never a least-squares fit, so a
 * value is never visually distorted) — with tangents chosen so the curve
 * never overshoots a local max/min the way a plain Catmull-Rom spline can:
 * per point, the tangent is clamped so each segment's Bezier control points
 * stay within [min(y0,y1), max(y0,y1)] of that segment's own two endpoints
 * (proof sketch: the clamp keeps a=m0/slope and b=m1/slope in [0,3], and a
 * cubic Hermite's control points are p0 + (a/3)(p1-p0) and p1 - (b/3)(p1-p0)
 * — both convex combinations of p0/p1 whenever a,b in [0,3]).
 *
 * Requires `points` sorted by strictly increasing x (this package's own
 * convention — see this module's top-of-file doc comment). Fewer than 2
 * points returns no segments (nothing to interpolate between).
 */
export function computeMonotoneSegments(points: readonly { readonly x: number; readonly y: number }[]): BezierSegment[] {
  const n = points.length;
  if (n < 2) return [];

  // Secant slope of each interval [i, i+1].
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const d = points[i + 1]!.x - points[i]!.x;
    dx.push(d);
    slope.push(d === 0 ? 0 : (points[i + 1]!.y - points[i]!.y) / d);
  }

  // Initial tangent at each point: the adjacent secant at an endpoint, the
  // average of both adjacent secants at an interior point.
  const m: number[] = new Array(n);
  m[0] = slope[0]!;
  m[n - 1] = slope[n - 2]!;
  for (let i = 1; i < n - 1; i++) m[i] = (slope[i - 1]! + slope[i]!) / 2;

  // A flat interval (slope 0) forces both its tangents to 0 — otherwise an
  // averaged tangent from a neighboring non-flat interval would put a
  // visible bump on what should be a dead-flat run.
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
    }
  }

  // The Fritsch–Carlson clamp: for each interval, α = m[i]/slope, β =
  // m[i+1]/slope must both be non-negative (a negative value means the
  // tangent points the "wrong way" relative to this interval's own secant —
  // exactly the sign-change case at a local max/min — so it's zeroed), and
  // α²+β² must not exceed 9 (otherwise both are rescaled onto that circle).
  // This is what guarantees the control-point bound in this function's own
  // doc comment above.
  for (let i = 0; i < n - 1; i++) {
    const s = slope[i]!;
    if (s === 0) continue;
    let a = m[i]! / s;
    let b = m[i + 1]! / s;
    if (a < 0) {
      m[i] = 0;
      a = 0;
    }
    if (b < 0) {
      m[i + 1] = 0;
      b = 0;
    }
    const sumSq = a * a + b * b;
    if (sumSq > 9) {
      const tau = 3 / Math.sqrt(sumSq);
      m[i] = tau * a * s;
      m[i + 1] = tau * b * s;
    }
  }

  const segments: BezierSegment[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i]!;
    const p1 = points[i + 1]!;
    const d = dx[i]!;
    segments.push({
      cp1: { x: p0.x + d / 3, y: p0.y + (m[i]! * d) / 3 },
      cp2: { x: p1.x - d / 3, y: p1.y - (m[i + 1]! * d) / 3 },
      end: { x: p1.x, y: p1.y },
    });
  }
  return segments;
}

/** An SVG path string for `points`, using `computeMonotoneSegments` above —
 * the 12-month total line's own path (see computeCategoryHistoryGeometry).
 * Degenerates to a single "M" (no line) for 0-1 points, matching `toPath`'s
 * own convention for the monthly line. */
export function monotonePath(points: readonly { readonly x: number; readonly y: number }[]): string {
  if (points.length === 0) return "";
  const first = points[0]!;
  let d = `M${first.x.toFixed(1)},${first.y.toFixed(1)}`;
  for (const seg of computeMonotoneSegments(points)) {
    d += ` C${seg.cp1.x.toFixed(1)},${seg.cp1.y.toFixed(1)} ${seg.cp2.x.toFixed(1)},${seg.cp2.y.toFixed(1)} ${seg.end.x.toFixed(1)},${seg.end.y.toFixed(1)}`;
  }
  return d;
}

// ---------- hover/focus: nearest-point hit-testing (pure pixel math) ----------

export interface NearestHistoryPoint {
  readonly series: "monthly" | "total";
  /** Index into whichever of `monthlyPoints`/`totalPoints` `series` names —
   * same array the caller already has, so it can look up that point's own
   * precomputed display strings without this module knowing about them. */
  readonly index: number;
}

/**
 * Finds the point a pointer at (`pointerX`, `pointerY`) — in the same SVG
 * viewBox pixel space as `monthlyPoints`/`totalPoints` — is closest to, for
 * the chart's hover tooltip and its focus-driven equivalent. Two-step, per
 * the chart's own visual model (one line thin-and-muted, the other
 * bold-and-smoothed, both sharing one x-axis): first the nearest MONTH by x
 * (monthlyPoints is always the superset of periodEnds — every total point's
 * period is also a monthly point), then, if a 12-month total exists at that
 * same month, whichever of the two lines' y at that month is closer to
 * `pointerY`. A linear scan is deliberate — this package's charts top out at
 * a couple hundred points, nowhere near where a binary search would matter.
 * Returns null only when there are no monthly points to hit-test at all.
 */
export function findNearestHistoryPoint(
  monthlyPoints: readonly PositionedHistoryPoint[],
  totalPoints: readonly PositionedHistoryPoint[],
  pointerX: number,
  pointerY: number,
): NearestHistoryPoint | null {
  if (monthlyPoints.length === 0) return null;

  let nearestIdx = 0;
  let bestDx = Math.abs(monthlyPoints[0]!.x - pointerX);
  for (let i = 1; i < monthlyPoints.length; i++) {
    const dx = Math.abs(monthlyPoints[i]!.x - pointerX);
    if (dx < bestDx) {
      bestDx = dx;
      nearestIdx = i;
    }
  }
  const monthlyPoint = monthlyPoints[nearestIdx]!;

  const totalIdx = totalPoints.findIndex((p) => p.periodEnd === monthlyPoint.periodEnd);
  if (totalIdx === -1) return { series: "monthly", index: nearestIdx };

  const totalPoint = totalPoints[totalIdx]!;
  const dMonthly = Math.abs(monthlyPoint.y - pointerY);
  const dTotal = Math.abs(totalPoint.y - pointerY);
  return dTotal <= dMonthly ? { series: "total", index: totalIdx } : { series: "monthly", index: nearestIdx };
}

// ---------- in-chart end labels: a collision guard ----------

export interface EndLabelPositions {
  readonly totalY: number | null;
  readonly monthlyY: number;
}

/** Minimum vertical gap (px) between the "12-month total" and "monthly"
 * end-of-line labels before they'd visually collide. */
const MIN_END_LABEL_GAP = 12;

/**
 * Nudges the two right-edge line labels ("12-month total", "monthly") apart
 * when their natural y-positions (each line's own last point) would put
 * them within `minGap` of each other — never swapping which is on top,
 * since each label still needs to read as belonging to its own line. A tie
 * (both lines ending at the exact same y) is broken by putting the total
 * label above, matching the common case (a 12-month total is a larger
 * magnitude than any single month, so it plots higher — smaller y — on this
 * inverted-y SVG axis). Returns `monthlyY` unchanged, `totalY: null`, when
 * there is no 12-month total line to place at all.
 */
export function placeEndLabels(totalY: number | null, monthlyY: number, minGap: number = MIN_END_LABEL_GAP): EndLabelPositions {
  if (totalY === null) return { totalY: null, monthlyY };
  const gap = Math.abs(totalY - monthlyY);
  if (gap >= minGap) return { totalY, monthlyY };
  const mid = (totalY + monthlyY) / 2;
  const half = minGap / 2;
  return totalY <= monthlyY ? { totalY: mid - half, monthlyY: mid + half } : { totalY: mid + half, monthlyY: mid - half };
}

// ---------- time-window selector (1Y / 5Y / 10Y / All) ----------

export type HistoryWindow = "1y" | "5y" | "10y" | "all";

/** Canonical [1Y · 5Y · 10Y · All] option list, in display order — shared by
 * whatever host renders the selector buttons, so the button labels and the
 * filtering logic below can never drift apart. */
export const HISTORY_WINDOWS: ReadonlyArray<{ readonly key: HistoryWindow; readonly label: string }> = [
  { key: "1y", label: "1Y" },
  { key: "5y", label: "5Y" },
  { key: "10y", label: "10Y" },
  { key: "all", label: "All" },
];

export interface HistoryWindowResult<T> {
  readonly monthly: readonly T[];
  readonly total: readonly T[];
}

/**
 * Narrows a full, already-computed history to the trailing N years, anchored
 * on the MONTHLY series' own last point (never today's wall-clock date, so
 * the window follows whatever data is actually loaded — same convention
 * `computeCategoryHistoryGeometry` uses of trusting the caller's data over
 * any external clock).
 *
 * This is a pure CLIP, never a recompute: `total` must already be the
 * trailing-12-month total computed from the FULL series (e.g.
 * lib/front-door-transform.ts's buildCategoryHistoryLineSeries in apps/web),
 * and this function only narrows which of its already-correct entries fall
 * inside the window. Recomputing the rolling total from a truncated monthly
 * window instead would silently produce a DIFFERENT (wrong) smoothing near
 * the window's left edge — exactly the kind of fabrication CLAUDE.md
 * forbids — because a trailing-12-month sum needs the 11 real months before
 * the window even starts, which a truncated recompute wouldn't have.
 *
 * `"all"` (the default) returns both inputs completely unfiltered.
 */
export function filterHistoryToWindow<T extends HistoryLayoutPoint>(monthly: readonly T[], total: readonly T[], window: HistoryWindow): HistoryWindowResult<T> {
  if (window === "all" || monthly.length === 0) return { monthly, total };
  const years = window === "1y" ? 1 : window === "5y" ? 5 : 10;
  const spanMonths = years * 12;
  const anchorIdx = monthIndexOf(monthly[monthly.length - 1]!.periodEnd);
  const cutoffIdx = anchorIdx - spanMonths + 1;
  const clip = (points: readonly T[]) => points.filter((p) => monthIndexOf(p.periodEnd) >= cutoffIdx);
  return { monthly: clip(monthly), total: clip(total) };
}
