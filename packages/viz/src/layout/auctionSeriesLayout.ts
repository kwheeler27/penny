/**
 * Pure pixel-layout math for the auction page's "this security's own
 * history" charts (ORCHESTRATION_PROMPT.md beat 4): one shared geometry
 * builder for both the bid-to-cover dot plot and the high-yield line, since
 * they differ only in whether the caller supplies a reference value (the
 * bid-to-cover chart's trailing-average dashed line) and how they choose to
 * render the resulting points (dots vs. a line). This module knows nothing
 * about auctions, money exactness, or React — it takes plain numeric-string
 * points and produces SVG coordinates only, mirroring
 * categoryHistoryLayout.ts's / tgaMonthLayout.ts's own conventions in this
 * package.
 *
 * Points are spaced proportionally to their REAL calendar-day distance (not
 * evenly by index) — a family that skips a scheduled auction, or one whose
 * cadence shifts around a holiday, shows that as a wider or narrower gap
 * rather than compressing it away, matching categoryHistoryLayout.ts's own
 * "a gap in the backfill widens the gap visually" doctrine at day
 * granularity instead of month granularity (coupon reopenings can land
 * inside the same calendar month as another auction in the family, which a
 * month-indexed layout would collide on).
 */

export interface AuctionSeriesLayoutPoint {
  /** YYYY-MM-DD (the auction date). */
  readonly date: string;
  /** Plain decimal-string number to plot — a ratio ("2.50") or a percent
   * ("4.512"), never a dollar magnitude requiring scaling; the caller has
   * already decided the unit. */
  readonly valueWhole: string;
}

export interface PositionedAuctionPoint {
  readonly date: string;
  readonly x: number;
  readonly y: number;
}

/** A cosmetic y-axis guide value. `label` is fully formatted here (mirroring
 * `AuctionDateTick`'s own pattern below) rather than left to the caller,
 * because the tick VALUES themselves are a side effect of this module's
 * padded-domain math — a caller can't predict what they'll be without
 * duplicating that math, so it can't pre-format labels for them either.
 * `value` (the raw float the label was derived from) is exposed too, only
 * for a test or a caller that wants it — never re-derive the domain from it. */
export interface AuctionValueTick {
  readonly y: number;
  readonly value: number;
  readonly label: string;
}

/** An x-axis date guide — the label is plain date-string formatting (pure,
 * unit-agnostic), computed here rather than duplicated by every caller. */
export interface AuctionDateTick {
  readonly x: number;
  readonly label: string;
}

export interface AuctionSeriesGeometry {
  readonly points: readonly PositionedAuctionPoint[];
  /** M/L path connecting `points` in order — the caller decides whether to
   * stroke it prominently (a line chart) or faintly behind dots (a dot
   * chart), or not at all. */
  readonly linePath: string;
  /** y-position of the optional reference value (e.g. a trailing average),
   * or null when the caller didn't supply one. Always inside [padTop,
   * height-padBottom] — the reference value is folded into the y-domain
   * before it's computed, so the dashed line this draws never clips. */
  readonly referenceY: number | null;
  readonly valueTicks: readonly AuctionValueTick[];
  readonly dateTicks: readonly AuctionDateTick[];
  readonly width: number;
  readonly height: number;
}

export interface AuctionSeriesLayoutOptions {
  readonly width: number;
  readonly height: number;
  readonly padLeft: number;
  readonly padRight: number;
  readonly padTop: number;
  readonly padBottom: number;
  /** An optional reference value (e.g. the family's trailing-average
   * bid-to-cover) folded into the y-domain, or null/omitted for a chart with
   * no reference line. */
  readonly referenceValue?: number | null;
  /** How to render each value-axis tick's cosmetic label — e.g. `{ decimals:
   * 1, suffix: "×" }` -> "2.5×". Omit for bare-number labels ("2.5"). This
   * is purely a display suffix/rounding for the axis GUIDE text; it never
   * touches how any real point's own value is stored or displayed
   * elsewhere. */
  readonly valueFormat?: { readonly decimals: number; readonly suffix: string };
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "2026-08-27" -> "Aug '26" — the compact axis-tick date format these mini
 * charts use (distinct from apps/web's own formatMonthYearShort, which this
 * package deliberately does not import — see lib/format.ts's own doc
 * comment on why apps/web avoids importing FROM @penny/viz's barrel in a
 * Server Component; the reverse dependency would be worse, and every other
 * chart in this package already duplicates this kind of small date-string
 * parse rather than reaching across the package boundary). */
function shortMonthApostropheYear(dateStr: string): string {
  const month = SHORT_MONTHS[Number(dateStr.slice(5, 7)) - 1] ?? dateStr.slice(5, 7);
  const year2 = dateStr.slice(2, 4);
  return `${month} '${year2}`;
}

/**
 * Days since the Unix epoch for a plain YYYY-MM-DD string, via Howard
 * Hinnant's civil-calendar algorithm — exact integer arithmetic on the
 * string's own year/month/day digits, never a `Date` object (matching this
 * repo's calendar-math convention: calendar dates are never round-tripped
 * through `Date`, where a timezone offset can shift the computed day). Used
 * only to space points proportionally to real elapsed time; the return
 * value has no meaning on its own, only as a difference between two dates.
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

const EMPTY_GEOMETRY_BASE = { points: [] as PositionedAuctionPoint[], linePath: "", referenceY: null, valueTicks: [] as AuctionValueTick[], dateTicks: [] as AuctionDateTick[] };

/**
 * Computes shared geometry for an auction time-series chart. `points` must
 * be sorted ascending by `date` (the caller's job, matching this package's
 * existing layout modules, which all trust their input's order). Guarantees:
 * every returned x/y falls within [0, width] x [0, height]; x is strictly
 * increasing across `points` whenever there is more than one, even when two
 * auctions share the same calendar day (a day-index tie is nudged apart by a
 * hairline so two points are never drawn on top of each other).
 */
export function computeAuctionSeriesGeometry(points: readonly AuctionSeriesLayoutPoint[], opts: AuctionSeriesLayoutOptions): AuctionSeriesGeometry {
  const { width, height, padLeft, padRight, padTop, padBottom, referenceValue, valueFormat } = opts;
  if (points.length === 0) return { ...EMPTY_GEOMETRY_BASE, width, height };

  const dayIndices = points.map((p) => daysFromEpoch(p.date));
  const firstDay = dayIndices[0]!;
  const lastDay = dayIndices[dayIndices.length - 1]!;
  const daySpan = Math.max(1, lastDay - firstDay);
  const plotWidth = Math.max(1, width - padLeft - padRight);
  // A same-day tie (two auctions dated identically — not expected in
  // practice, but never divide-by-zero or silently overlap) nudges by a
  // fraction of a pixel per repeat so ordering stays strictly increasing.
  const xFor = (i: number): number => {
    const base = padLeft + ((dayIndices[i]! - firstDay) / daySpan) * plotWidth;
    let nudge = 0;
    for (let j = i - 1; j >= 0 && dayIndices[j] === dayIndices[i]; j--) nudge += 1;
    return base + nudge * 0.5;
  };

  // Cosmetic Number() conversion only, for the y-scale — never a displayed
  // figure (every point's real value is rendered from its own precomputed
  // display string by the caller, per this package's documented convention).
  const values = points.map((p) => Number(p.valueWhole));
  const withReference = referenceValue != null && Number.isFinite(referenceValue) ? [...values, referenceValue] : values;
  const dataLo = Math.min(...withReference);
  const dataHi = Math.max(...withReference);
  const dataRange = dataHi - dataLo;
  // Pad the domain so the plotted line/dots and any reference line sit away
  // from the top/bottom edges — a flat series (dataRange === 0) still gets a
  // sane, non-zero domain to avoid a divide-by-zero.
  const pad = dataRange > 0 ? dataRange * 0.18 : Math.max(Math.abs(dataHi), 1) * 0.1;
  const lo = dataLo - pad;
  const hi = dataHi + pad;
  const range = hi - lo || 1;
  const plotHeight = Math.max(1, height - padTop - padBottom);
  const yFor = (v: number) => padTop + (1 - (v - lo) / range) * plotHeight;

  const positioned: PositionedAuctionPoint[] = points.map((p, i) => ({ date: p.date, x: xFor(i), y: yFor(Number(p.valueWhole)) }));
  const linePath = positioned.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  const formatTick = (v: number): string => (valueFormat ? `${v.toFixed(valueFormat.decimals)}${valueFormat.suffix}` : String(v));
  const valueTicks: AuctionValueTick[] = [hi, (hi + lo) / 2, lo].map((v) => ({ y: yFor(v), value: v, label: formatTick(v) }));

  const midIdx = Math.floor((positioned.length - 1) / 2);
  const dateTickIdx = positioned.length <= 2 ? [0, positioned.length - 1] : [0, midIdx, positioned.length - 1];
  const seenX = new Set<number>();
  const dateTicks: AuctionDateTick[] = [];
  for (const i of dateTickIdx) {
    const p = points[i]!;
    if (seenX.has(i)) continue;
    seenX.add(i);
    dateTicks.push({ x: positioned[i]!.x, label: shortMonthApostropheYear(p.date) });
  }

  const referenceY = referenceValue != null && Number.isFinite(referenceValue) ? yFor(referenceValue) : null;

  return { points: positioned, linePath, referenceY, valueTicks, dateTicks, width, height };
}
