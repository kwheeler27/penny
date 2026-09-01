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
  const yearTicks: YearTick[] = [];
  let lastYear: string | null = null;
  for (const p of monthlyPoints) {
    const year = calendarYearOf(p.periodEnd);
    if (year !== lastYear) {
      yearTicks.push({ x: p.x, label: year });
      lastYear = year;
    }
  }

  const zeroY = lo <= 0 && hi >= 0 ? yFor("0") : null;

  return { monthlyPath: toPath(monthlyPoints), totalPath: toPath(totalPoints), monthlyPoints, totalPoints, yearTicks, zeroY, width, height };
}
