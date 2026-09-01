import { computeCategoryHistoryGeometry, type HistoryLayoutPoint } from "../layout/categoryHistoryLayout";

export interface CategoryHistoryChartPoint extends HistoryLayoutPoint {
  /** Precomputed display string for this point's hover title (e.g. "$146.7B") — never re-derived here. */
  readonly display: string;
  /** Precomputed short label for this point (e.g. "Jul 2026") — used only in the aria-label summary. */
  readonly label: string;
}

export interface CategoryHistoryChartProps {
  /** Full monthly series, ascending by periodEnd. */
  readonly monthly: readonly CategoryHistoryChartPoint[];
  /** 12-month rolling total, ascending — empty when fewer than 12 consecutive months exist yet (never fabricated; see lib/front-door-transform.ts's buildCategoryHistoryLineSeries in apps/web). */
  readonly total: readonly CategoryHistoryChartPoint[];
  /** CSS color (a literal color or a `var(--token)` reference resolved by the host page) for both lines — the monthly line is drawn at reduced opacity, the total line at full opacity, so one color reads as "the same series, two resolutions." */
  readonly color: string;
  readonly width?: number;
  readonly height?: number;
}

const PAD = { padLeft: 8, padRight: 8, padTop: 18, padBottom: 20 };

/**
 * The full-history form of a category's monthly figures (beat 1, "HISTORY
 * PANELS v2"): the monthly series thin and muted, the 12-month rolling
 * total emphasized on top of it, year ticks on the x-axis, and an
 * exact-value hover (a native SVG `<title>` on each point — no client JS
 * state, works with a screen reader's own affordances). Renders nothing
 * (null) when there is no monthly series to show — the caller decides
 * whether that means "show the four-period dot plot instead" or "show a gap
 * note," per CLAUDE.md's gap-never-zero rule.
 */
export function CategoryHistoryChart({ monthly, total, color, width = 560, height = 130 }: CategoryHistoryChartProps) {
  if (monthly.length === 0) return null;
  const geometry = computeCategoryHistoryGeometry(monthly, total, { width, height, ...PAD });
  const ariaSummary = monthly.map((p) => `${p.label} ${p.display}`).join(", ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="auto" role="img" aria-label={`Monthly history: ${ariaSummary}`}>
      {geometry.zeroY !== null && <line x1={0} x2={width} y1={geometry.zeroY} y2={geometry.zeroY} stroke="currentColor" strokeOpacity={0.15} />}

      <path d={geometry.monthlyPath} fill="none" stroke={color} strokeOpacity={0.4} strokeWidth={1.25} />
      {geometry.monthlyPoints.map((p, i) => (
        <circle key={p.periodEnd} cx={p.x} cy={p.y} r={2} fill={color} fillOpacity={0.5}>
          <title>{`${monthly[i]!.label}: ${monthly[i]!.display}`}</title>
        </circle>
      ))}

      {total.length > 0 && (
        <>
          <path d={geometry.totalPath} fill="none" stroke={color} strokeWidth={2.25} />
          {geometry.totalPoints.map((p, i) => (
            <circle key={p.periodEnd} cx={p.x} cy={p.y} r={2.75} fill={color}>
              <title>{`${total[i]!.label}, 12-month total: ${total[i]!.display}`}</title>
            </circle>
          ))}
        </>
      )}

      {geometry.yearTicks.map((tick) => (
        <text key={tick.x} x={tick.x} y={height - 4} fontSize={10} fill="currentColor" opacity={0.6} textAnchor={tick.x < 12 ? "start" : tick.x > width - 12 ? "end" : "middle"}>
          {tick.label}
        </text>
      ))}
    </svg>
  );
}
