/**
 * Pure pixel-layout math for the "When does the money move?" mirrored daily
 * cadence chart (beat 3, Penny Atlas rev 6): deposits up, withdrawals down,
 * one column per calendar day of a month. A day with no reading (a weekend,
 * a federal holiday — the Daily Treasury Statement doesn't publish on
 * either) renders as a TRUE gap: no bar at all, never a zero-height bar
 * standing in for "no data" (CLAUDE.md: missing data is a gap, never a
 * zero). This module takes already-decided whole-dollar decimal strings (or
 * `null` for a gap day) and produces SVG coordinates only — no money
 * exactness, no registry, no React. `Number()` below is a cosmetic pixel
 * proportion only, per packages/viz/src/money/decimal.ts's documented
 * exception.
 */

export interface CadenceLayoutDay {
  /** YYYY-MM-DD. */
  readonly date: string;
  /** Whole-dollar decimal string, or null when no deposit reading exists for this day (a true gap). */
  readonly depositWhole: string | null;
  /** Whole-dollar decimal string, or null when no withdrawal reading exists for this day (a true gap). */
  readonly withdrawalWhole: string | null;
}

export interface CadenceBarLayout {
  readonly date: string;
  readonly x: number;
  readonly barWidth: number;
  readonly hasDeposit: boolean;
  readonly depositTop: number;
  readonly depositHeight: number;
  readonly hasWithdrawal: boolean;
  readonly withdrawalTop: number;
  readonly withdrawalHeight: number;
}

export interface DailyCadenceGeometry {
  readonly bars: readonly CadenceBarLayout[];
  readonly zeroY: number;
  readonly width: number;
  readonly height: number;
}

export interface DailyCadenceLayoutOptions {
  readonly width: number;
  readonly height: number;
  readonly padTop: number;
  readonly padBottom: number;
  /** Minimum gap between adjacent bar columns, in px. */
  readonly gap?: number;
}

/**
 * Lays out one bar-column per day, evenly spaced across `width` (every
 * calendar day of the month gets a column position, whether or not it has
 * data — that's what keeps a weekend gap visually where the weekend
 * actually falls, rather than collapsing days together). Deposits extend up
 * from a shared zero line; withdrawals extend down from the same line.
 *
 * Guarantees: every bar's `x` falls within [0, width]; `x` is strictly
 * increasing across `bars` (one column per day, left to right, in input
 * order — the caller passes days in calendar order); every height is >= 0
 * and the deposit/withdrawal plot never exceeds its half of the available
 * height.
 */
export function computeDailyCadenceGeometry(days: readonly CadenceLayoutDay[], opts: DailyCadenceLayoutOptions): DailyCadenceGeometry {
  const { width, height, padTop, padBottom, gap = 1.5 } = opts;
  const n = Math.max(days.length, 1);
  const zeroY = padTop + (height - padTop - padBottom) / 2;
  const plotHalf = Math.max(1, (height - padTop - padBottom) / 2);
  const columnWidth = width / n;
  const barWidth = Math.max(0.5, columnWidth - gap);

  // Cosmetic Number() conversions only — the scale used to size bars, never
  // a displayed figure (the caller keeps the exact decimal strings for that).
  const maxAbs = Math.max(
    1,
    ...days.map((d) => Math.abs(Number(d.depositWhole ?? "0"))),
    ...days.map((d) => Math.abs(Number(d.withdrawalWhole ?? "0"))),
  );

  const bars: CadenceBarLayout[] = days.map((d, i) => {
    const x = i * columnWidth + gap / 2;
    const depositH = d.depositWhole !== null ? (Math.abs(Number(d.depositWhole)) / maxAbs) * plotHalf : 0;
    const withdrawalH = d.withdrawalWhole !== null ? (Math.abs(Number(d.withdrawalWhole)) / maxAbs) * plotHalf : 0;
    return {
      date: d.date,
      x,
      barWidth,
      hasDeposit: d.depositWhole !== null,
      depositTop: zeroY - depositH,
      depositHeight: depositH,
      hasWithdrawal: d.withdrawalWhole !== null,
      withdrawalTop: zeroY,
      withdrawalHeight: withdrawalH,
    };
  });

  return { bars, zeroY, width, height };
}
