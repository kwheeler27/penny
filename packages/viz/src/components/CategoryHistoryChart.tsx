import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { computeCategoryHistoryGeometry, findNearestHistoryPoint, placeEndLabels, type HistoryLayoutPoint, type NearestHistoryPoint } from "../layout/categoryHistoryLayout";
import { VisuallyHidden } from "./VisuallyHidden";

export interface CategoryHistoryChartPoint extends HistoryLayoutPoint {
  /** Precomputed display string for this point's ACCESSIBLE name — the
   * native `<title>`, `aria-label`, and screen-reader table fallback all use
   * this, unchanged: the full-precision, "as published" figure (CLAUDE.md:
   * never round a displayed figure to make it friendlier). */
  readonly display: string;
  /** Precomputed short label for this point (e.g. "Jul 2026") — used in the
   * aria-label summary and the hover/focus tooltip's month line. */
  readonly label: string;
  /** Precomputed ROUNDED display string ("$146.7B" style) — the hover/focus
   * tooltip's large primary line. `display` (the exact figure) still shows
   * below it, muted, in the same tooltip — the exact figure is never
   * dropped, only demoted to a secondary line. Falls back to `display` when
   * omitted, so a caller that hasn't supplied it yet still renders a
   * sensible (if less scannable) tooltip. */
  readonly scaledDisplay?: string;
}

export interface CategoryHistoryChartProps {
  /** Full monthly series, ascending by periodEnd. */
  readonly monthly: readonly CategoryHistoryChartPoint[];
  /** 12-month rolling total, ascending — empty when fewer than 12 consecutive months exist yet (never fabricated; see lib/front-door-transform.ts's buildCategoryHistoryLineSeries in apps/web). */
  readonly total: readonly CategoryHistoryChartPoint[];
  /** CSS color (a literal color or a `var(--token)` reference resolved by the host page) for both lines — the monthly line is drawn at reduced opacity, the total line at full opacity, so one color reads as "the same series, two resolutions." Also the hover/focus marker ring's color. */
  readonly color: string;
  readonly width?: number;
  readonly height?: number;
}

const PAD = { padLeft: 60, padRight: 92, padTop: 20, padBottom: 22 };

/** Invisible-but-interactive hit-target radius — wider than the old visible
 * dot (r=2/2.75) so hover/click/focus stays easy to land even though
 * nothing is painted there. `pointerEvents: "all"` is required because a
 * `fillOpacity={0}` circle is otherwise NOT hit-testable by default SVG
 * pointer-event rules (`visiblePainted` only counts painted area). */
const HIT_RADIUS = 7;
/** The single visible, emphasized marker's radius — the latest point only. */
const MARKER_RADIUS = 3.5;
/** The hover/focus indicator's own dot + ring — deliberately drawn as a
 * SEPARATE overlay (never an outline on the wide, invisible HIT_RADIUS hit
 * target) so keyboard focus never produces the browser's default focus
 * ring on a 7px circle blown up into a "blob": every hit-target circle sets
 * `outline: none` below, and this dot+ring is the only focus/hover
 * indicator that ever paints. */
const ACTIVE_DOT_RADIUS = 3.5;
const ACTIVE_RING_RADIUS = 5.5;

function seriesLabelFor(series: "monthly" | "total"): string {
  return series === "total" ? "Trailing 12-month total" : "Monthly, as published";
}

/**
 * The full-history form of a category's monthly figures (beat 1, "HISTORY
 * PANELS v2"): the monthly series a thin, muted polyline and the 12-month
 * rolling total a bold, monotone-smoothed polyline on top of it, y-axis
 * gridlines + value labels, year ticks on the x-axis, and direct in-chart
 * end-of-line labels ("12-month total" / "monthly") — so the two lines'
 * meaning never depends solely on a caption a reader might not read.
 * Neither line paints a dot at every month — that reads as a "beaded chain"
 * once a series runs to 100+ points — except the single latest point (on
 * whichever line is on top), which stays a solid, emphasized marker.
 *
 * Every month remains reachable for its exact figure despite the missing
 * dots: each point is an invisible, wider hit-target circle that is both
 * mouse-hoverable (a native `<title>`, plus a real HTML tooltip — see
 * below) AND independently keyboard-focusable with its own `aria-label`,
 * backed by a visually-hidden `<table>` per line as a screen-reader-native
 * fallback that doesn't depend on any assistive technology's handling of
 * focusable SVG shapes.
 *
 * The hover/focus tooltip and its marker+ring are driven by one `active`
 * point (mouse hover takes priority over keyboard focus when both are
 * live, matching the point the reader is currently attending to): a
 * pointer move over the chart finds the nearest point via
 * `findNearestHistoryPoint` (pure pixel math, unit-tested independently in
 * categoryHistoryLayout.test.ts) and a hit-target circle's own `onFocus`
 * sets the same shape of state via keyboard. Renders nothing (null) when
 * there is no monthly series to show — the caller decides whether that
 * means "show the four-period dot plot instead" or "show a gap note," per
 * CLAUDE.md's gap-never-zero rule.
 */
export function CategoryHistoryChart({ monthly, total, color, width = 560, height = 130 }: CategoryHistoryChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredPoint, setHoveredPoint] = useState<NearestHistoryPoint | null>(null);
  const [focusedPoint, setFocusedPoint] = useState<NearestHistoryPoint | null>(null);

  if (monthly.length === 0) return null;
  const geometry = computeCategoryHistoryGeometry(monthly, total, { width, height, ...PAD });
  const ariaSummary = monthly.map((p) => `${p.label} ${p.display}`).join(", ");
  const hasTotal = total.length > 0;
  const monthlyTableId = `category-history-monthly-${Math.round(width)}x${Math.round(height)}`;
  const totalTableId = `category-history-total-${Math.round(width)}x${Math.round(height)}`;

  // Mouse hover wins over keyboard focus when both are set — the reader's
  // most recent action decides which point the tooltip describes.
  const active = hoveredPoint ?? focusedPoint;
  const activePoint = active ? (active.series === "monthly" ? monthly[active.index] : total[active.index]) : undefined;
  const activeGeomPoint = active ? (active.series === "monthly" ? geometry.monthlyPoints[active.index] : geometry.totalPoints[active.index]) : undefined;

  function samePoint(a: NearestHistoryPoint | null, b: NearestHistoryPoint | null): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.series === b.series && a.index === b.index;
  }

  function handlePointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const localX = ((e.clientX - rect.left) / rect.width) * width;
    const localY = ((e.clientY - rect.top) / rect.height) * height;
    const nearest = findNearestHistoryPoint(geometry.monthlyPoints, geometry.totalPoints, localX, localY);
    setHoveredPoint((prev) => (samePoint(prev, nearest) ? prev : nearest));
  }

  function handlePointerLeave() {
    setHoveredPoint((prev) => (prev === null ? prev : null));
  }

  // End-of-line labels' natural y-positions (each line's own last point),
  // nudged apart by placeEndLabels when they'd otherwise collide.
  const totalLastY = hasTotal ? geometry.totalPoints[geometry.totalPoints.length - 1]?.y ?? null : null;
  const monthlyLastY = geometry.monthlyPoints[geometry.monthlyPoints.length - 1]?.y ?? height / 2;
  const endLabels = placeEndLabels(totalLastY, monthlyLastY);
  const endLabelX = width - PAD.padRight + 8;

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="auto"
        role="img"
        aria-label={`Monthly history: ${ariaSummary}`}
        style={{ overflow: "visible", display: "block", pointerEvents: "all" }}
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

        <path d={geometry.monthlyPath} fill="none" stroke={color} strokeOpacity={0.35} strokeWidth={1.25} />
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
              onFocus={() => setFocusedPoint({ series: "monthly", index: i })}
              onBlur={() => setFocusedPoint((prev) => (samePoint(prev, { series: "monthly", index: i }) ? null : prev))}
              style={{ pointerEvents: "all", cursor: "pointer", outline: "none" }}
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
                  onFocus={() => setFocusedPoint({ series: "total", index: i })}
                  onBlur={() => setFocusedPoint((prev) => (samePoint(prev, { series: "total", index: i }) ? null : prev))}
                  style={{ pointerEvents: "all", cursor: "pointer", outline: "none" }}
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

        {hasTotal && endLabels.totalY !== null && (
          <text x={endLabelX} y={endLabels.totalY} fontSize={11} fontWeight={600} fill={color} dominantBaseline="middle">
            12-month total
          </text>
        )}
        <text x={endLabelX} y={endLabels.monthlyY} fontSize={10.5} fill="currentColor" opacity={0.6} dominantBaseline="middle">
          monthly
        </text>

        {/* Hover/focus indicator: a small dot + ring, never the browser's
            default focus outline (every hit-target circle above sets
            `outline: none`) — this is the ONLY focus/hover marker that ever
            paints, so it can never render as an oversized "blob" around an
            invisible hit target. */}
        {activeGeomPoint && (
          <g style={{ pointerEvents: "none" }}>
            <circle cx={activeGeomPoint.x} cy={activeGeomPoint.y} r={ACTIVE_RING_RADIUS} fill="none" stroke={color} strokeWidth={2} />
            <circle cx={activeGeomPoint.x} cy={activeGeomPoint.y} r={ACTIVE_DOT_RADIUS} fill={color} />
          </g>
        )}
      </svg>

      {active && activePoint && activeGeomPoint && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: `${(activeGeomPoint.x / width) * 100}%`,
            top: `${(activeGeomPoint.y / height) * 100}%`,
            transform: xyTransform(activeGeomPoint.x / width, activeGeomPoint.y / height),
            pointerEvents: "none",
            zIndex: 1,
            minWidth: 120,
            maxWidth: 200,
            padding: "6px 10px",
            borderRadius: 6,
            background: "var(--surface, #fcfcfb)",
            border: "1px solid var(--border, rgba(11, 11, 11, 0.14))",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.12)",
            fontSize: 12,
            lineHeight: 1.35,
            color: "var(--text-primary, #0b0b0b)",
          }}
        >
          <div style={{ fontWeight: 600 }}>{activePoint.label}</div>
          <div style={{ color: active.series === "total" ? color : "var(--text-muted, #898781)", fontSize: 10.5, marginBottom: 2 }}>{seriesLabelFor(active.series)}</div>
          <div style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{activePoint.scaledDisplay ?? activePoint.display}</div>
          <div style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-muted, #898781)", fontSize: 10.5 }}>{activePoint.display}</div>
        </div>
      )}

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
    </div>
  );
}

/** Chooses the tooltip's anchor corner from the hovered point's FRACTIONAL
 * position in the chart (0..1 each axis) — a pure CSS transform, not a
 * `getBoundingClientRect`-measured clamp, so it needs no layout pass and
 * works identically on first paint: near the left/right edge the tooltip
 * anchors its own left/right edge to the point instead of centering (so it
 * never extends past the chart's own bounds), and near the top it drops
 * below the point instead of floating above it (so it never extends above
 * the chart). */
function xyTransform(xFrac: number, yFrac: number): string {
  const horiz = xFrac < 0.18 ? "0%" : xFrac > 0.82 ? "-100%" : "-50%";
  const vert = yFrac < 0.3 ? "12px" : "calc(-100% - 12px)";
  return `translate(${horiz}, ${vert})`;
}
