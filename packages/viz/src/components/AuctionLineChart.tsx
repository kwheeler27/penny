import { computeAuctionSeriesGeometry, type AuctionSeriesLayoutPoint } from "../layout/auctionSeriesLayout";
import { VisuallyHidden } from "./VisuallyHidden";

export interface AuctionLineChartPoint extends AuctionSeriesLayoutPoint {
  /** Precomputed display string for this point's hover/focus title (e.g. "4.512%") — never re-derived here. */
  readonly display: string;
  /** Precomputed short label for this point (e.g. "Aug 27, 2026") — used in the aria-label and the hidden table fallback. */
  readonly label: string;
  readonly isLatest: boolean;
}

export interface AuctionLineChartProps {
  readonly points: readonly AuctionLineChartPoint[];
  readonly color: string;
  /** How to format each y-axis guide tick (e.g. `{ decimals: 1, suffix: "%" }` -> "4.5%") — see computeAuctionSeriesGeometry's own doc comment for why this lives here rather than as precomputed label strings. */
  readonly valueTickFormat?: { readonly decimals: number; readonly suffix: string };
  readonly ariaLabel: string;
  readonly width?: number;
  readonly height?: number;
}

const PAD = { padLeft: 40, padRight: 20, padTop: 20, padBottom: 25 };

/**
 * The auction page's "price of borrowing" chart (beat 4, "This security's
 * own history"): the family's high yield at each auction, connected by a
 * line, the latest point emphasized. Every point carries a native `<title>`
 * (mouse hover) AND is independently keyboard-focusable with its own
 * `aria-label` — see AuctionDotChart's doc comment for why (issue #7) —
 * backed by the same visually-hidden `<table>` fallback. Renders nothing
 * (null) when there are no points.
 */
export function AuctionLineChart({ points, color, valueTickFormat, ariaLabel, width = 520, height = 175 }: AuctionLineChartProps) {
  if (points.length === 0) return null;
  const geometry = computeAuctionSeriesGeometry(points, { width, height, ...PAD, valueFormat: valueTickFormat });
  const tableId = `auction-line-chart-table-${Math.round(width)}x${Math.round(height)}`;

  return (
    <>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="auto" role="img" aria-label={ariaLabel} style={{ overflow: "visible" }}>
        <line x1={PAD.padLeft} x2={width - PAD.padRight} y1={height - PAD.padBottom} y2={height - PAD.padBottom} stroke="currentColor" strokeOpacity={0.25} />

        {geometry.valueTicks.map((t, i) => (
          <text key={`${t.y}-${i}`} x={PAD.padLeft - 6} y={t.y + 3} fontSize={10} fill="currentColor" opacity={0.6} textAnchor="end">
            {t.label}
          </text>
        ))}

        <path d={geometry.linePath} fill="none" stroke={color} strokeWidth={2.25} />

        {geometry.points.map((p, i) => {
          const point = points[i]!;
          return (
            <circle
              key={p.date}
              cx={p.x}
              cy={p.y}
              r={point.isLatest ? 4.5 : 2.25}
              fill={color}
              fillOpacity={point.isLatest ? 1 : 0.55}
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
