import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { computeCategoryHistoryGeometry, findNearestHistoryPoint, placeEndLabels } from "../layout/categoryHistoryLayout";
import { nudgeHoverLabelAwayFromAverage, type HistoryChartPoint } from "../layout/averagedHistoryLayout";
import { VisuallyHidden } from "./VisuallyHidden";

export interface AveragedHistoryChartProps {
  /** Full monthly series, ascending by periodEnd — the thin, faint line. */
  readonly monthly: readonly HistoryChartPoint[];
  /** The rolling average, ascending — the bold line (see
   * layout/averagedHistoryLayout.ts's `rollingAverage` for how this is
   * computed; this component renders whatever it's given, already clipped
   * to whatever time window is showing via `clipToWindow`). Can be shorter
   * than `monthly`, or end earlier, when the trailing window skipped a
   * gap — this component never assumes the two arrays line up 1:1. */
  readonly average: readonly HistoryChartPoint[];
  /** CSS color (a literal color or a `var(--token)` reference resolved by
   * the host page) for both lines, the average's end-of-line value, and its
   * hover marker. */
  readonly color: string;
  /** Appended directly after the bold end-of-line average VALUE, forming
   * one text run in `color` ("$94.0B" + avgLabel="/mo avg" ->
   * "$94.0B/mo avg") — supplied by the caller, never hardcoded here, since
   * unlike CategoryHistoryChart's single fixed "12-month total" this
   * chart's bold line can be either a 12-month or a 6-month rolling
   * average and the caller's own copy decides whether/how to say which. */
  readonly avgLabel: string;
  /** Ready-to-render text for the muted line beneath the bold end label
   * (approved design: "$1.13T past 12 mo" style) — rendered exactly as
   * given, or omitted entirely when null/undefined (never a fabricated
   * fallback; e.g. fewer than 12 months exist yet). */
  readonly secondaryEndLabel?: string | null;
  /** Ready-to-render text at the faint monthly line's own end (approved
   * design: the latest monthly value, muted) — omitted entirely when
   * null/undefined. */
  readonly monthlyEndLabel?: string | null;
  readonly width?: number;
  readonly height?: number;
}

// padRight: 150, not CategoryHistoryChart's inherited 118 — measured empirically
// (real-browser SVGTextElement.getBBox(), not guessed) against this chart's actual
// content: the secondary end label ("$1,127.9B past 12 mo" style) runs noticeably
// longer than CategoryHistoryChart's old fixed "12-month total"/"monthly" labels,
// and at 118 it measurably overflowed the chart's own right edge (121.5 local
// units of text against a 110-unit budget) — clipped by the panel in a real
// screenshot, exactly the class of bug CLAUDE.md's screenshot-verification rule
// exists to catch. 150 leaves ~20 units of margin above the widest figure this
// repo's data currently produces.
const PAD = { padLeft: 60, padRight: 150, padTop: 28, padBottom: 24 };

const HIT_RADIUS = 7;
const MARKER_RADIUS = 3.5;
const HOVER_MONTHLY_DOT_RADIUS = 3.5;
const HOVER_AVG_DOT_RADIUS = 4.5;
const ACTIVE_HALO_STROKE_WIDTH = 3.5;
/** Vertical gap (px) between the two stacked end labels for the AVERAGE
 * line (the bold value+avgLabel run, and the muted secondaryEndLabel
 * beneath it) — independent of `placeEndLabels`' own collision gap between
 * the average block and the monthly line's own end label. */
const SECONDARY_LABEL_OFFSET = 15;
/** Minimum vertical gap `placeEndLabels` keeps between the average block's
 * TOP line and the monthly line's end label — larger than
 * categoryHistoryLayout.ts's own default (12) because the average block is
 * two lines tall, not one, and needs room for `SECONDARY_LABEL_OFFSET`
 * beneath it without visually colliding with the monthly label. */
const END_LABEL_MIN_GAP = 30;

/**
 * Frame A of the "spending history, scrubbable" redesign (the approved
 * interactive mockup, penny-history-scrub.html rev 2): a single category's
 * rolling monthly AVERAGE (bold) drawn over its actual monthly figures
 * (faint, ~0.42 opacity), on ONE shared linear y-axis — replacing an
 * earlier two-panel/second-axis design once the team noticed a 12-month
 * average is just the 12-month total ÷ 12, so it lives on exactly the same
 * scale as the monthly line it smooths.
 *
 * Reuses `computeCategoryHistoryGeometry` (categoryHistoryLayout.ts)
 * directly for the pixel math — `average` stands in for that function's
 * "total" parameter (bold, monotone-smoothed) and `monthly` for its
 * "monthly" parameter (thin, straight segments), which is EXACTLY this
 * frame's visual shape; only the presentation layer here (colors, hover
 * behavior, end labels) is new. Renders null when `monthly` is empty,
 * matching every other chart in this package.
 *
 * Hover/focus is OWID-style rather than CategoryHistoryChart's
 * floating-tooltip-box: a vertical guide line snapped to the nearest
 * month, the month name pinned at the chart's top, a dot on each line that
 * has a reading at that month, value labels at the dots (panel-colored
 * halo via `paint-order: stroke` so they stay legible crossing a gridline
 * or the other line), and a dashed horizontal reference line from the
 * scrubbed AVERAGE point out to the right edge — never a floating box.
 * Every month stays reachable by keyboard too: each MONTHLY point is one
 * focusable hit target (its `aria-label` states both the monthly and,
 * when available, the average reading at that month) — unlike
 * CategoryHistoryChart, the average line's own points are NOT separately
 * focusable here, since one guide already scrubs both lines together and a
 * second, near-duplicate set of tab stops would only add noise. A
 * screen-reader-native `<table>` fallback still exists per line,
 * independent of the interactive hit targets, matching this package's
 * standing accessibility contract.
 */
export function AveragedHistoryChart({ monthly, average, color, avgLabel, secondaryEndLabel, monthlyEndLabel, width = 560, height = 180 }: AveragedHistoryChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);

  if (monthly.length === 0) return null;

  const geometry = computeCategoryHistoryGeometry(monthly, average, { width, height, ...PAD });
  const hasAverage = average.length > 0;
  const monthlyTableId = `averaged-history-monthly-${Math.round(width)}x${Math.round(height)}`;
  const averageTableId = `averaged-history-average-${Math.round(width)}x${Math.round(height)}`;

  const activeIdx = hoveredIdx ?? focusedIdx;

  function handlePointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const localX = ((e.clientX - rect.left) / rect.width) * width;
    const localY = ((e.clientY - rect.top) / rect.height) * height;
    const nearest = findNearestHistoryPoint(geometry.monthlyPoints, [], localX, localY);
    setHoveredIdx((prev) => (prev === nearest?.index ? prev : (nearest?.index ?? null)));
  }

  function handlePointerLeave() {
    setHoveredIdx((prev) => (prev === null ? prev : null));
  }

  const avgLastY = hasAverage ? (geometry.totalPoints[geometry.totalPoints.length - 1]?.y ?? null) : null;
  const monthlyLastY = geometry.monthlyPoints[geometry.monthlyPoints.length - 1]?.y ?? height / 2;
  const endLabels = placeEndLabels(avgLastY, monthlyLastY, END_LABEL_MIN_GAP);
  const endLabelX = width - PAD.padRight + 8;
  const dashedRightEdge = endLabelX - 4;

  // The hovered/focused month's own data — looked up once, shared by the
  // guide line, both dots, and both value labels below.
  const activeMonthPoint = activeIdx !== null ? geometry.monthlyPoints[activeIdx] : undefined;
  const activeMonthly = activeIdx !== null ? monthly[activeIdx] : undefined;
  const activeAvgIdx = activeMonthly ? average.findIndex((p) => p.periodEnd === activeMonthly.periodEnd) : -1;
  const activeAvgPoint = activeAvgIdx >= 0 ? geometry.totalPoints[activeAvgIdx] : undefined;
  const activeAvg = activeAvgIdx >= 0 ? average[activeAvgIdx] : undefined;

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="img"
        aria-label={`Monthly history and rolling average: ${monthly.map((p) => `${p.label} ${p.display}`).join(", ")}`}
        style={{ height: "auto", overflow: "visible", display: "block", pointerEvents: "all" }}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      >
        {geometry.valueTicks.map((t) => (
          <g key={`vt-${t.y.toFixed(1)}`}>
            <line x1={PAD.padLeft} x2={width - PAD.padRight} y1={t.y} y2={t.y} stroke="currentColor" strokeOpacity={0.15} />
            <text x={PAD.padLeft - 6} y={t.y + 3} fontSize={10} fill="currentColor" opacity={0.65} textAnchor="end" style={{ fontVariantNumeric: "tabular-nums" }}>
              {t.label}
            </text>
          </g>
        ))}

        {/* Faint monthly line — the actual, unsmoothed figures. */}
        <path d={geometry.monthlyPath} fill="none" stroke={color} strokeOpacity={0.42} strokeWidth={1.4} strokeLinecap="round" />
        {geometry.monthlyPoints.map((p, i) => {
          const point = monthly[i]!;
          const avgAtSameMonth = average.find((a) => a.periodEnd === point.periodEnd);
          const label = avgAtSameMonth ? `${point.label}: monthly ${point.display}, rolling average ${avgAtSameMonth.display}` : `${point.label}: monthly ${point.display}`;
          return (
            <circle
              key={`m-${p.periodEnd}`}
              cx={p.x}
              cy={p.y}
              r={HIT_RADIUS}
              fill="transparent"
              tabIndex={0}
              role="img"
              aria-label={label}
              onFocus={() => setFocusedIdx(i)}
              onBlur={() => setFocusedIdx((prev) => (prev === i ? null : prev))}
              style={{ pointerEvents: "all", cursor: "pointer", outline: "none" }}
            >
              <title>{label}</title>
            </circle>
          );
        })}

        {/* Bold average line, on top. */}
        {hasAverage && <path d={geometry.totalPath} fill="none" stroke={color} strokeWidth={2.8} strokeLinecap="round" />}
        {hasAverage && geometry.totalPoints.length > 0 && (
          <circle cx={geometry.totalPoints[geometry.totalPoints.length - 1]!.x} cy={geometry.totalPoints[geometry.totalPoints.length - 1]!.y} r={MARKER_RADIUS} fill={color} />
        )}

        {geometry.yearTicks.map((tick) => (
          <text key={tick.x} x={tick.x} y={height - 6} fontSize={10} fill="currentColor" opacity={0.6} textAnchor={tick.x < 12 ? "start" : tick.x > width - 12 ? "end" : "middle"}>
            {tick.label}
          </text>
        ))}

        {/* End-of-line labels. */}
        {hasAverage && endLabels.totalY !== null && (
          <>
            <text x={endLabelX} y={endLabels.totalY} fontSize={13} fontWeight={700} fill={color} dominantBaseline="middle" style={{ fontVariantNumeric: "tabular-nums" }}>
              {(average[average.length - 1]?.scaledDisplay ?? average[average.length - 1]?.display) + avgLabel}
            </text>
            {secondaryEndLabel != null && (
              <text x={endLabelX} y={endLabels.totalY + SECONDARY_LABEL_OFFSET} fontSize={11} fill="currentColor" opacity={0.6} dominantBaseline="middle" style={{ fontVariantNumeric: "tabular-nums" }}>
                {secondaryEndLabel}
              </text>
            )}
          </>
        )}
        {monthlyEndLabel != null && (
          <text x={endLabelX} y={endLabels.monthlyY} fontSize={10.5} fill="currentColor" opacity={0.6} dominantBaseline="middle" style={{ fontVariantNumeric: "tabular-nums" }}>
            {monthlyEndLabel}
          </text>
        )}

        {/* OWID-style hover/focus scrub: a vertical guide, the month name
            pinned at top, a dot + value label per line that has a reading
            at this month, and a dashed reference from the average point to
            the right edge. No floating tooltip box anywhere. */}
        {activeMonthPoint && activeMonthly && (
          <g style={{ pointerEvents: "none" }}>
            <line x1={activeMonthPoint.x} x2={activeMonthPoint.x} y1={4} y2={height - PAD.padBottom} stroke="var(--guide, currentColor)" strokeOpacity={0.5} strokeWidth={1} />
            <text
              x={Math.min(Math.max(activeMonthPoint.x, PAD.padLeft), width - 90)}
              y={12}
              fontWeight={700}
              fontSize={11}
              fill="currentColor"
              textAnchor="middle"
              style={{ paintOrder: "stroke", stroke: "var(--panel, #f1f0ea)", strokeWidth: ACTIVE_HALO_STROKE_WIDTH }}
            >
              {activeMonthly.label}
            </text>

            {activeAvgPoint && activeAvg && (
              <>
                <line
                  x1={activeMonthPoint.x}
                  x2={dashedRightEdge}
                  y1={activeAvgPoint.y}
                  y2={activeAvgPoint.y}
                  stroke={color}
                  strokeWidth={1}
                  strokeDasharray="5 4"
                  strokeOpacity={0.75}
                />
                <circle cx={activeMonthPoint.x} cy={activeAvgPoint.y} r={HOVER_AVG_DOT_RADIUS} fill={color} stroke="var(--panel, #f1f0ea)" strokeWidth={2} />
                <text
                  x={activeMonthPoint.x}
                  y={activeAvgPoint.y - 12}
                  fontWeight={700}
                  fontSize={13}
                  fill={color}
                  textAnchor="middle"
                  style={{ paintOrder: "stroke", stroke: "var(--panel, #f1f0ea)", strokeWidth: ACTIVE_HALO_STROKE_WIDTH, fontVariantNumeric: "tabular-nums" }}
                >
                  {activeAvg.scaledDisplay ?? activeAvg.display}
                </text>
              </>
            )}

            <circle cx={activeMonthPoint.x} cy={activeMonthPoint.y} r={HOVER_MONTHLY_DOT_RADIUS} fill={color} fillOpacity={0.55} stroke="var(--panel, #f1f0ea)" strokeWidth={2} />
            <text
              x={activeMonthPoint.x}
              y={nudgeHoverLabelAwayFromAverage(activeMonthPoint.y - 10, activeAvgPoint?.y ?? null)}
              fontSize={11.5}
              fill="currentColor"
              opacity={0.75}
              textAnchor="middle"
              style={{ paintOrder: "stroke", stroke: "var(--panel, #f1f0ea)", strokeWidth: ACTIVE_HALO_STROKE_WIDTH, fontVariantNumeric: "tabular-nums" }}
            >
              {activeMonthly.scaledDisplay ?? activeMonthly.display}
            </text>
          </g>
        )}
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
      {hasAverage && (
        <VisuallyHidden as="div">
          <table id={averageTableId}>
            <caption>Rolling average</caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Average</th>
              </tr>
            </thead>
            <tbody>
              {average.map((p) => (
                <tr key={p.periodEnd}>
                  <td>{p.label}</td>
                  <td>{p.display}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </VisuallyHidden>
      )}
    </div>
  );
}
