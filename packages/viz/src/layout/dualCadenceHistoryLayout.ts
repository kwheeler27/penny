/**
 * Pure pixel-layout math for a two-line, ONE shared dollar axis chart where
 * the two lines publish on genuinely different cadences (beat 5's TGA<->bank
 * reserves chart: the Treasury General Account publishes a reading most
 * business days; bank reserves publish once a week). Unlike
 * categoryHistoryLayout.ts's monthly/12-month-total pair, this module's two
 * series do NOT share one calendar — a is never a subset or superset of b's
 * dates — so points are positioned by their own REAL calendar-day distance
 * from a single combined start date (mirroring auctionSeriesLayout.ts's
 * day-based x-spacing), never by array index and never assuming one series'
 * dates cover the other's.
 *
 * Each line is drawn as plain straight (M/L) segments, connecting only the
 * dates it actually has a reading for — a gap in one series (a weekend for
 * the daily line, six days between weekly readings for the other) simply
 * widens the segment between two real points rather than being interpolated
 * or zero-filled (CLAUDE.md: missing data is a gap, never a zero). Straight
 * segments also trivially satisfy "no overshoot" — there is no fitted curve
 * to overshoot a local max/min with.
 *
 * This module knows nothing about money exactness, the registry, or React —
 * it takes already-decided whole-unit decimal strings and produces SVG
 * coordinates only. `Number()` below is used ONLY for cosmetic pixel
 * placement, matching every other layout module in this package's
 * documented exception.
 */

export interface DualHistoryLayoutPoint {
  /** YYYY-MM-DD. */
  readonly date: string;
  /** Whole-unit decimal string (already scaled by the caller). */
  readonly valueWhole: string;
}

export interface PositionedDualPoint {
  readonly date: string;
  readonly x: number;
  readonly y: number;
}

/** A y-axis guide value — the combined (both series) data's own high/mid/low,
 * never a "nice round number" scale, matching categoryHistoryLayout.ts's own
 * convention. `label` is a fixed-trillions cosmetic string ("$2.92T") — this
 * chart's two series are both large-money stocks that span into the
 * trillions, so a fixed "$X.XXT" axis (rather than apps/web's usual fixed-
 * billions convention, built for monthly outlay categories two-to-three
 * orders of magnitude smaller) is what stays legible at this chart's actual
 * scale; still a FIXED scale, never auto-switching between T/B per point. */
export interface DualHistoryValueTick {
  readonly y: number;
  readonly value: number;
  readonly label: string;
}

/** An x-axis date guide, evenly spaced across the COMBINED date range (never
 * derived from either series' own point indices, which would land ticks at
 * different calendar positions depending on which series happened to have
 * more points near an edge). */
export interface DualHistoryDateTick {
  readonly x: number;
  readonly label: string;
}

export interface DualHistoryGeometry {
  readonly aPath: string;
  readonly bPath: string;
  readonly aPoints: readonly PositionedDualPoint[];
  readonly bPoints: readonly PositionedDualPoint[];
  readonly valueTicks: readonly DualHistoryValueTick[];
  readonly dateTicks: readonly DualHistoryDateTick[];
  readonly width: number;
  readonly height: number;
}

export interface DualHistoryLayoutOptions {
  readonly width: number;
  readonly height: number;
  readonly padLeft: number;
  readonly padRight: number;
  readonly padTop: number;
  readonly padBottom: number;
}

/**
 * Days since the Unix epoch for a plain YYYY-MM-DD string, via Howard
 * Hinnant's civil-calendar algorithm — exact integer arithmetic on the
 * string's own year/month/day digits, never a `Date` object. Duplicated
 * (deliberately, in miniature) rather than imported from
 * auctionSeriesLayout.ts, matching this package's existing convention of
 * each layout module staying self-contained (see auctionSeriesLayout.ts's
 * own copy of this same function, which makes the identical choice for the
 * identical reason).
 */
function daysFromEpoch(dateStr: string): number {
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7));
  const day = Number(dateStr.slice(8, 10));
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400; // [0, 399]
  const mp = (month + 9) % 12; // [0, 11], Mar=0 .. Feb=11
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1; // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy; // [0, 146096]
  return era * 146097 + doe - 719468;
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "2026-08-27" -> "Aug '26" — mirrors auctionSeriesLayout.ts's own compact
 * axis-tick date format (see that module's doc comment for why this package
 * duplicates rather than shares this kind of small date-string formatter). */
function shortMonthApostropheYear(dateStr: string): string {
  const month = SHORT_MONTHS[Number(dateStr.slice(5, 7)) - 1] ?? dateStr.slice(5, 7);
  const year2 = dateStr.slice(2, 4);
  return `${month} '${year2}`;
}

/** Cosmetic-only y-axis guide label at a fixed trillions scale, two decimals
 * ("$2.92T", "$0.86T") — see this module's DualHistoryValueTick doc comment
 * for why this chart uses trillions rather than apps/web's usual fixed-
 * billions axis convention. `Number`-based, like every other cosmetic
 * pixel/guide computation in this module — never used for a displayed,
 * asserted-exact figure (those arrive as precomputed strings from the
 * caller, via each point's own `display`/`scaledDisplay` in the component). */
function formatAxisUsdTrillions(value: number): string {
  const trillions = value / 1_000_000_000_000;
  const rounded = Math.round(Math.abs(trillions) * 100) / 100;
  const grouped = rounded.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${value < 0 ? "−" : ""}$${grouped}T`;
}

const EMPTY_GEOMETRY_BASE = {
  aPath: "",
  bPath: "",
  aPoints: [] as PositionedDualPoint[],
  bPoints: [] as PositionedDualPoint[],
  valueTicks: [] as DualHistoryValueTick[],
  dateTicks: [] as DualHistoryDateTick[],
};

/**
 * Computes shared geometry for the two-line chart. `a` and `b` must each be
 * sorted ascending by `date` (this package's existing convention — every
 * layout module here trusts its input's order). Either may be empty (e.g.
 * `b` — bank reserves — before that series exists in the registry at all);
 * the other line still lays out normally against its own real date range.
 * Both empty returns the empty geometry below (the caller's job to render a
 * "no data yet" state instead, matching every other chart in this package).
 *
 * Guarantees: every returned x/y falls within [0, width] x [0, height]; x is
 * non-decreasing across `aPoints` (and, independently, across `bPoints`)
 * whenever there is more than one point in that line.
 */
export function computeDualHistoryGeometry(a: readonly DualHistoryLayoutPoint[], b: readonly DualHistoryLayoutPoint[], opts: DualHistoryLayoutOptions): DualHistoryGeometry {
  const { width, height, padLeft, padRight, padTop, padBottom } = opts;
  if (a.length === 0 && b.length === 0) return { ...EMPTY_GEOMETRY_BASE, width, height };

  const allDayIndices = [...a, ...b].map((p) => daysFromEpoch(p.date));
  const firstDay = Math.min(...allDayIndices);
  const lastDay = Math.max(...allDayIndices);
  const daySpan = Math.max(1, lastDay - firstDay);
  const plotWidth = Math.max(1, width - padLeft - padRight);
  const xForDayIndex = (dayIdx: number) => padLeft + ((dayIdx - firstDay) / daySpan) * plotWidth;
  const xFor = (dateStr: string) => xForDayIndex(daysFromEpoch(dateStr));

  // Cosmetic Number() conversions only, for the shared y-scale — never a
  // displayed figure (every point's real value is rendered from its own
  // precomputed display string by the caller).
  const allValues = [...a, ...b].map((p) => Number(p.valueWhole));
  const dataLo = Math.min(...allValues);
  const dataHi = Math.max(...allValues);
  const dataRange = dataHi - dataLo;
  // A little breathing room above/below so neither line hugs the very top or
  // bottom edge — never enough to imply a zero baseline the way an area fill
  // would (this chart draws lines only, matching CategoryHistoryChart's own
  // "no area fill" doctrine).
  const pad = dataRange > 0 ? dataRange * 0.08 : Math.max(Math.abs(dataHi), 1) * 0.1;
  const lo = dataLo - pad;
  const hi = dataHi + pad;
  const range = hi - lo || 1;
  const plotHeight = Math.max(1, height - padTop - padBottom);
  const yFor = (v: number) => padTop + (1 - (v - lo) / range) * plotHeight;

  const toPositioned = (points: readonly DualHistoryLayoutPoint[]): PositionedDualPoint[] => points.map((p) => ({ date: p.date, x: xFor(p.date), y: yFor(Number(p.valueWhole)) }));
  const toPath = (points: readonly PositionedDualPoint[]) => points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  const aPoints = toPositioned(a);
  const bPoints = toPositioned(b);

  const valueTicks: DualHistoryValueTick[] = [dataHi, (dataHi + dataLo) / 2, dataLo].map((v) => ({ y: yFor(v), value: v, label: formatAxisUsdTrillions(v) }));

  // Three date ticks — the combined range's own start, midpoint, and end —
  // never derived from either series' point indices (see this module's
  // DualHistoryDateTick doc comment).
  const dateTicks: DualHistoryDateTick[] = [firstDay, Math.round((firstDay + lastDay) / 2), lastDay].map((dayIdx) => ({
    x: xForDayIndex(dayIdx),
    label: shortMonthApostropheYear(dayIndexToDateStr(dayIdx)),
  }));

  return { aPath: toPath(aPoints), bPath: toPath(bPoints), aPoints, bPoints, valueTicks, dateTicks, width, height };
}

/**
 * The inverse of `daysFromEpoch` — the plain YYYY-MM-DD string `dayIdx` days
 * after the Unix epoch. Used only to turn a date TICK's day-index (the
 * combined range's start/mid/end, which may not be a real data point at all)
 * back into a label string; never used for a real point's own date, which
 * the caller always supplies directly.
 */
function dayIndexToDateStr(dayIdx: number): string {
  const z = dayIdx + 719468;
  const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
  const doe = z - era * 146097; // [0, 146096]
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365); // [0, 399]
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365]
  const mp = Math.floor((5 * doy + 2) / 153); // [0, 11]
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1; // [1, 31]
  const month = mp < 10 ? mp + 3 : mp - 9; // [1, 12]
  const year = month <= 2 ? y + 1 : y;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ---------- hover/focus: nearest-point hit-testing across BOTH lines ----------

export interface NearestDualPoint {
  readonly series: "a" | "b";
  /** Index into whichever of `aPoints`/`bPoints` `series` names. */
  readonly index: number;
}

/**
 * Finds the point (from EITHER line) a pointer at (`pointerX`, `pointerY`) —
 * in the same SVG viewBox pixel space as `aPoints`/`bPoints` — is closest to.
 * Unlike findNearestHistoryPoint (categoryHistoryLayout.ts), which can find
 * "the nearest month" first because its monthly series is always the
 * superset of every date the total line has, this chart's two series share
 * no such relationship (bank reserves are never a subset of TGA's own
 * dates) — so this scans both point sets directly, by x-distance first (the
 * primary axis a reader is scrubbing along), y-distance as the tiebreak. A
 * linear scan over both arrays combined is deliberate, matching this
 * package's documented convention that its charts top out at a few hundred
 * points combined — nowhere near where a binary search would matter.
 * Returns null only when both lines are empty.
 */
export function findNearestDualPoint(aPoints: readonly PositionedDualPoint[], bPoints: readonly PositionedDualPoint[], pointerX: number, pointerY: number): NearestDualPoint | null {
  let best: NearestDualPoint | null = null;
  let bestDx = Infinity;
  let bestDy = Infinity;

  const consider = (series: "a" | "b", points: readonly PositionedDualPoint[]) => {
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!;
      const dx = Math.abs(p.x - pointerX);
      const dy = Math.abs(p.y - pointerY);
      if (dx < bestDx || (dx === bestDx && dy < bestDy)) {
        bestDx = dx;
        bestDy = dy;
        best = { series, index: i };
      }
    }
  };
  consider("a", aPoints);
  consider("b", bPoints);
  return best;
}
