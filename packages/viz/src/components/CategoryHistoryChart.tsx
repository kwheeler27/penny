import { computeCategoryHistoryGeometry, type HistoryLayoutPoint } from "../layout/categoryHistoryLayout";
import { VisuallyHidden } from "./VisuallyHidden";

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

/** Invisible-but-interactive hit-target radius — wider than the old visible
 * dot (r=2/2.75) so hover/click/focus stays easy to land even though
 * nothing is painted there. `pointerEvents: "all"` is required because a
 * `fillOpacity={0}` circle is otherwise NOT hit-testable by default SVG
 * pointer-event rules (`visiblePainted` only counts painted area). */
const HIT_RADIUS = 7;
/** The single visible, emphasized marker's radius — the latest point only. */
const MARKER_RADIUS = 3.5;

/**
 * The full-history form of a category's monthly figures (beat 1, "HISTORY
 * PANELS v2"): the monthly series a thin, muted polyline and the 12-month
 * rolling total an emphasized polyline on top of it, year ticks on the
 * x-axis. Neither line paints a dot at every month — that reads as a
 * "beaded chain" once a series runs to 100+ points — except the single
 * latest point (on whichever line is on top: the 12-month total once it
 * exists, otherwise the monthly line), which stays a solid, emphasized
 * marker.
 *
 * Every month remains reachable for its exact figure despite the missing
 * dots: each point is an invisible, wider hit-target circle that is both
 * mouse-hoverable (a native `<title>`) AND independently keyboard-focusable
 * with its own `aria-label` — the same fix issue #7 already established for
 * AuctionDotChart/AuctionLineChart, extended here — backed by a
 * visually-hidden `<table>` per line as a screen-reader-native fallback that
 * doesn't depend on any assistive technology's handling of focusable SVG
 * shapes. Renders nothing (null) when there is no monthly series to show —
 * the caller decides whether that means "show the four-period dot plot
 * instead" or "show a gap note," per CLAUDE.md's gap-never-zero rule.
 */
export function CategoryHistoryChart({ monthly, total, color, width = 560, height = 130 }: CategoryHistoryChartProps) {
  if (monthly.length === 0) return null;
  const geometry = computeCategoryHistoryGeometry(monthly, total, { width, height, ...PAD });
  const ariaSummary = monthly.map((p) => `${p.label} ${p.display}`).join(", ");
  const hasTotal = total.length > 0;
  const monthlyTableId = `category-history-monthly-${Math.round(width)}x${Math.round(height)}`;
  const totalTableId = `category-history-total-${Math.round(width)}x${Math.round(height)}`;

  return (
    <>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="auto" role="img" aria-label={`Monthly history: ${ariaSummary}`} style={{ overflow: "visible" }}>
        {geometry.zeroY !== null && <line x1={0} x2={width} y1={geometry.zeroY} y2={geometry.zeroY} stroke="currentColor" strokeOpacity={0.15} />}

        <path d={geometry.monthlyPath} fill="none" stroke={color} strokeOpacity={0.4} strokeWidth={1.5} />
        {geometry.monthlyPoints.map((p, i) => {
          const point = monthly[i]!;
          // The monthly line's own last point is the chart's one visible
          // marker only when there is no 12-month total on top of it —
          // otherwise that honor belongs to the total line's last point
          // below, and this stays an invisible hit target like every other
          // monthly point.
          const isLatestMarker = !hasTotal && i === monthly.length - 1;
          return (
            <circle
              key={`m-${p.periodEnd}`}
              cx={p.x}
              cy={p.y}
              r={isLatestMarker ? MARKER_RADIUS : HIT_RADIUS}
              fill={isLatestMarker ? color : "transparent"}
              tabIndex={0}
              role="img"
              aria-label={`${point.label}: ${point.display}${isLatestMarker ? " (latest)" : ""}`}
              style={{ pointerEvents: "all", cursor: "pointer" }}
            >
              <title>{`${point.label}: ${point.display}${isLatestMarker ? " (latest)" : ""}`}</title>
            </circle>
          );
        })}

        {hasTotal && (
          <>
            <path d={geometry.totalPath} fill="none" stroke={color} strokeWidth={2.5} />
            {geometry.totalPoints.map((p, i) => {
              const point = total[i]!;
              const isLatestMarker = i === total.length - 1;
              return (
                <circle
                  key={`t-${p.periodEnd}`}
                  cx={p.x}
                  cy={p.y}
                  r={isLatestMarker ? MARKER_RADIUS : HIT_RADIUS}
                  fill={isLatestMarker ? color : "transparent"}
                  tabIndex={0}
                  role="img"
                  aria-label={`${point.label}, 12-month total: ${point.display}${isLatestMarker ? " (latest)" : ""}`}
                  style={{ pointerEvents: "all", cursor: "pointer" }}
                >
                  <title>{`${point.label}, 12-month total: ${point.display}${isLatestMarker ? " (latest)" : ""}`}</title>
                </circle>
              );
            })}
          </>
        )}

        {geometry.yearTicks.map((tick) => (
          <text key={tick.x} x={tick.x} y={height - 4} fontSize={10} fill="currentColor" opacity={0.6} textAnchor={tick.x < 12 ? "start" : tick.x > width - 12 ? "end" : "middle"}>
            {tick.label}
          </text>
        ))}
      </svg>

      <VisuallyHidden as="div">
        <table id={monthlyTableId}>
          <caption>Monthly figures, as published</caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            {monthly.map((p) => (
              <tr key={p.periodEnd}>
                <td>{p.label}</td>
                <td>{p.display}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </VisuallyHidden>
      {hasTotal && (
        <VisuallyHidden as="div">
          <table id={totalTableId}>
            <caption>12-month rolling total</caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">12-month total</th>
              </tr>
            </thead>
            <tbody>
              {total.map((p) => (
                <tr key={p.periodEnd}>
                  <td>{p.label}</td>
                  <td>{p.display}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </VisuallyHidden>
      )}
    </>
  );
}
