import { computeAuctionSeriesGeometry, type AuctionSeriesLayoutPoint } from "../layout/auctionSeriesLayout";
import { VisuallyHidden } from "./VisuallyHidden";

export interface AuctionDotChartPoint extends AuctionSeriesLayoutPoint {
  /** Precomputed display string for this point's hover/focus title (e.g. "2.79×") — never re-derived here. */
  readonly display: string;
  /** Precomputed short label for this point (e.g. "Jul 29, 2025") — used in the aria-label and the hidden table fallback. */
  readonly label: string;
  readonly isLatest: boolean;
}

export interface AuctionDotChartProps {
  readonly points: readonly AuctionDotChartPoint[];
  readonly color: string;
  /** The trailing-average reference value to plot, or null to draw no dashed line. */
  readonly referenceValue?: number | null;
  /** Precomputed display string for the reference line's own label (e.g. "14-auction average 2.50×"), or null to draw the line without a label. */
  readonly referenceLabel?: string | null;
  /** How to format each y-axis guide tick (e.g. `{ decimals: 1, suffix: "×" }` -> "2.5×") — see computeAuctionSeriesGeometry's own doc comment for why this lives here rather than as precomputed label strings. */
  readonly valueTickFormat?: { readonly decimals: number; readonly suffix: string };
  readonly ariaLabel: string;
  readonly width?: number;
  readonly height?: number;
}

const PAD = { padLeft: 40, padRight: 20, padTop: 20, padBottom: 25 };

/**
 * The auction page's "demand" chart (beat 4, "This security's own history"):
 * one dot per auction in a security family, a faint connecting guide line, a
 * dashed trailing-average reference line, and the latest auction's dot
 * emphasized. Every dot carries a native `<title>` (mouse hover) AND is
 * independently keyboard-focusable with its own `aria-label` (issue #7: a
 * hover-only `<title>` alone isn't reliably reachable by keyboard) — backed
 * by a visually-hidden `<table>` listing every point as a redundant,
 * screen-reader-native fallback that doesn't depend on any assistive
 * technology's handling of focusable SVG shapes. Renders nothing (null) when
 * there are no points — the caller decides how to render that gap.
 */
export function AuctionDotChart({ points, color, referenceValue, referenceLabel, valueTickFormat, ariaLabel, width = 520, height = 175 }: AuctionDotChartProps) {
  if (points.length === 0) return null;
  const geometry = computeAuctionSeriesGeometry(points, { width, height, ...PAD, referenceValue, valueFormat: valueTickFormat });
  const tableId = `auction-dot-chart-table-${Math.round(width)}x${Math.round(height)}`;

  return (
    <>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={ariaLabel} style={{ height: "auto", overflow: "visible" }}>
        <line x1={PAD.padLeft} x2={width - PAD.padRight} y1={height - PAD.padBottom} y2={height - PAD.padBottom} stroke="currentColor" strokeOpacity={0.25} />

        {geometry.referenceY !== null && (
          <>
            <line x1={PAD.padLeft} x2={width - PAD.padRight} y1={geometry.referenceY} y2={geometry.referenceY} stroke="currentColor" strokeOpacity={0.5} strokeDasharray="3 4" />
            {referenceLabel && (
              <text x={PAD.padLeft + 2} y={geometry.referenceY - 5} fontSize={10.5} fill="currentColor" opacity={0.75}>
                {referenceLabel}
              </text>
            )}
          </>
        )}

        {geometry.valueTicks.map((t, i) => (
          <text key={`${t.y}-${i}`} x={PAD.padLeft - 6} y={t.y + 3} fontSize={10} fill="currentColor" opacity={0.6} textAnchor="end">
            {t.label}
          </text>
        ))}

        <polyline points={geometry.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} fill="none" stroke={color} strokeWidth={1.5} strokeOpacity={0.45} />

        {geometry.points.map((p, i) => {
          const point = points[i]!;
          return (
            <circle
              key={p.date}
              cx={p.x}
              cy={p.y}
              r={point.isLatest ? 5.5 : 4}
              fill={color}
              tabIndex={0}
              role="img"
              aria-label={`${point.label}: ${point.display}${point.isLatest ? " (latest)" : ""}`}
              style={{ cursor: "pointer" }}
            >
              <title>{`${point.label}: ${point.display}${point.isLatest ? " (latest)" : ""}`}</title>
            </circle>
          );
        })}

        {geometry.dateTicks.map((tick) => (
          <text key={tick.x} x={tick.x} y={height - 6} fontSize={10} fill="currentColor" opacity={0.6} textAnchor={tick.x < PAD.padLeft + 20 ? "start" : tick.x > width - PAD.padRight - 20 ? "end" : "middle"}>
            {tick.label}
          </text>
        ))}
      </svg>

      <VisuallyHidden as="div">
        <table id={tableId}>
          <caption>{ariaLabel}</caption>
          <thead>
            <tr>
              <th scope="col">Auction date</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.date}>
                <td>{p.label}</td>
                <td>
                  {p.display}
                  {p.isLatest ? " (latest)" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </VisuallyHidden>
    </>
  );
}
