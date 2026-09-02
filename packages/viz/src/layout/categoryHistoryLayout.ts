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

export interface CategoryHistoryGeometry {
  readonly monthlyPath: string;
  readonly totalPath: string;
  readonly monthlyPoints: readonly PositionedHistoryPoint[];
  readonly totalPoints: readonly PositionedHistoryPoint[];
  readonly yearTicks: readonly YearTick[];
  readonly zeroY: number | null;
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
 * one is dropped as illegible — see the year-ticks block below. */
const MIN_YEAR_TICK_GAP_PX = 26;

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
    return { monthlyPath: "", totalPath: "", monthlyPoints: [], totalPoints: [], yearTicks: [], zeroY: null, width, height };
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

  const zeroY = lo <= 0 && hi >= 0 ? yFor("0") : null;

  return { monthlyPath: toPath(monthlyPoints), totalPath: toPath(totalPoints), monthlyPoints, totalPoints, yearTicks, zeroY, width, height };
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
