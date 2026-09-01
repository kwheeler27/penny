import { computeDailyCadenceGeometry, type CadenceLayoutDay } from "../layout/dailyCadenceLayout";

export interface DailyCadenceChartDay extends CadenceLayoutDay {
  /** Precomputed display string for the deposit hover title, or null when `depositWhole` is null (a gap day). */
  readonly depositDisplay: string | null;
  /** Precomputed display string for the withdrawal hover title, or null when `withdrawalWhole` is null (a gap day). */
  readonly withdrawalDisplay: string | null;
}

export interface DailyCadenceChartProps {
  /** Every calendar day of the month, ascending — including gap days (weekends/holidays), so the caller's day-of-month positions are preserved. */
  readonly days: readonly DailyCadenceChartDay[];
  readonly depositColor: string;
  readonly withdrawalColor: string;
  readonly width?: number;
  readonly height?: number;
}

/**
 * The mirrored daily cadence chart (beat 3, "When does the money move?"):
 * deposits as columns rising above a zero line, withdrawals as columns
 * falling below it, one column position per calendar day of the month. A
 * day with no reading (weekend, federal holiday — the Daily Treasury
 * Statement doesn't publish on either) draws no bar at all — a true gap,
 * never a zero-height stand-in. Exact figures are on each bar's native
 * `<title>` (hover, and available to assistive tech) — no client JS state.
 */
export function DailyCadenceChart({ days, depositColor, withdrawalColor, width = 640, height = 220 }: DailyCadenceChartProps) {
  if (days.length === 0) return null;
  const geometry = computeDailyCadenceGeometry(days, { width, height, padTop: 10, padBottom: 10 });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="auto" role="img" aria-label={`Daily deposits and withdrawals across ${days.length} days`}>
      <line x1={0} x2={width} y1={geometry.zeroY} y2={geometry.zeroY} stroke="currentColor" strokeOpacity={0.25} />
      {geometry.bars.map((b, i) => {
        const day = days[i]!;
        return (
          <g key={b.date}>
            {b.hasDeposit && (
              <rect x={b.x} y={b.depositTop} width={b.barWidth} height={b.depositHeight} fill={depositColor}>
                <title>{`${b.date}: ${day.depositDisplay} deposited`}</title>
              </rect>
            )}
            {b.hasWithdrawal && (
              <rect x={b.x} y={b.withdrawalTop} width={b.barWidth} height={b.withdrawalHeight} fill={withdrawalColor}>
                <title>{`${b.date}: ${day.withdrawalDisplay} withdrawn`}</title>
              </rect>
            )}
          </g>
        );
      })}
    </svg>
  );
}
