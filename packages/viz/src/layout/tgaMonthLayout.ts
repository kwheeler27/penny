/**
 * Pure pixel-layout math for the TGA-through-the-month line (beat 3, Penny
 * Atlas rev 6): the Treasury General Account's closing balance across the
 * days of one calendar month. No value publishes on weekends or federal
 * holidays (fiscal.tga.closing_balance's own registry notes) — those days
 * are simply absent from the line, never interpolated or carried forward
 * (CLAUDE.md: missing data is a gap, never a zero or a stand-in value). This
 * module takes already-decided whole-dollar decimal strings (or `null` for
 * a gap day) and produces SVG coordinates only.
 */

export interface TgaLayoutDay {
  /** YYYY-MM-DD. */
  readonly date: string;
  /** Whole-dollar decimal string, or null when no reading exists for this day (a true gap). */
  readonly valueWhole: string | null;
}

export interface PositionedTgaPoint {
  readonly date: string;
  readonly x: number;
  readonly y: number;
}

export interface TgaMonthGeometry {
  readonly path: string;
  readonly points: readonly PositionedTgaPoint[];
  readonly width: number;
  readonly height: number;
}

export interface TgaMonthLayoutOptions {
  readonly width: number;
  readonly height: number;
  readonly padLeft: number;
  readonly padRight: number;
  readonly padTop: number;
  readonly padBottom: number;
}

/**
 * Lays out the TGA line across every calendar day of the month (one x
 * position per day, evenly spaced, whether or not that day has a reading) —
 * days with no reading are simply skipped when building `points`/`path`, so
 * the line connects the nearest two days that actually published a value
 * (e.g. Friday directly to the following Monday) rather than fabricating a
 * weekend/holiday value.
 *
 * Guarantees: every point's x/y falls within [0, width] x [0, height]; x is
 * strictly increasing across `points` whenever there is more than one.
 */
export function computeTgaMonthGeometry(days: readonly TgaLayoutDay[], opts: TgaMonthLayoutOptions): TgaMonthGeometry {
  const { width, height, padLeft, padRight, padTop, padBottom } = opts;
  const n = Math.max(days.length - 1, 1);
  const plotWidth = Math.max(1, width - padLeft - padRight);
  const xFor = (i: number) => padLeft + (i / n) * plotWidth;

  const known = days.filter((d) => d.valueWhole !== null);
  if (known.length === 0) return { path: "", points: [], width, height };

  // Cosmetic Number() conversion only, for the y-scale — never a displayed figure.
  const values = known.map((d) => Number(d.valueWhole));
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const range = hi - lo || 1;
  const plotHeight = Math.max(1, height - padTop - padBottom);
  const yFor = (v: number) => padTop + (1 - (v - lo) / range) * plotHeight;

  const points: PositionedTgaPoint[] = [];
  days.forEach((d, i) => {
    if (d.valueWhole === null) return;
    points.push({ date: d.date, x: xFor(i), y: yFor(Number(d.valueWhole)) });
  });

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return { path, points, width, height };
}
