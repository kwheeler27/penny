import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { placeEndLabels } from "../layout/categoryHistoryLayout";
import { computeDualHistoryGeometry, findNearestDualPoint, type DualHistoryLayoutPoint, type NearestDualPoint } from "../layout/dualCadenceHistoryLayout";
import { VisuallyHidden } from "./VisuallyHidden";

export interface DualCadenceSeriesPoint extends DualHistoryLayoutPoint {
  /** Full-precision, "as published" display string (never rounded to make it friendlier) — the native `<title>`, `aria-label`, screen-reader table, and the tooltip's secondary line all use this unchanged. */
  readonly display: string;
  /** Rounded display string for the tooltip's large primary line ("$2.92T" style). Falls back to `display` when omitted. */
  readonly scaledDisplay?: string;
  /** Short label for this point ("Jun 1, 2026") — used in the aria-label and the tooltip's date line. */
  readonly label: string;
}

export interface DualCadenceLineSpec {
  readonly points: readonly DualCadenceSeriesPoint[];
  /** CSS color (a literal color or a `var(--token)` reference resolved by the host page) for this line, its markers, and its end-of-line label. */
  readonly color: string;
  /** This line's name ("Bank reserves", "Treasury General Account") — shown as the in-chart end label and in the tooltip. */
  readonly label: string;
  /** This line's own publication cadence ("weekly, Wednesdays" / "most business days") — shown in the tooltip beneath the series name, since the two lines on this chart deliberately do NOT share a cadence and that difference is part of what the chart is honestly showing. */
  readonly cadenceLabel: string;
}

export interface DualCadenceHistoryChartProps {
  readonly a: DualCadenceLineSpec;
  readonly b: DualCadenceLineSpec;
  readonly width?: number;
  readonly height?: number;
}

const PAD = { padLeft: 64, padRight: 96, padTop: 20, padBottom: 24 };

const HIT_RADIUS = 7;
const MARKER_RADIUS = 3.5;
const ACTIVE_DOT_RADIUS = 3.5;
const ACTIVE_RING_RADIUS = 5.5;

/**
 * The TGA<->bank-reserves chart (beat 5, "The plumbing, breathing — in real
 * data"): two lines on ONE shared dollar axis, published on genuinely
 * different cadences (the Treasury General Account most business days; bank
 * reserves once a week) — rendered honestly rather than resampled onto a
 * common calendar. Built to the same bar CategoryHistoryChart set: labeled
 * y-axis gridlines, in-chart end labels, a real hover/focus tooltip with
 * both a rounded and an exact value plus each point's own series name, no
 * focus "blobs" (every hit-target circle sets `outline: none`; a separate
 * dot+ring overlay is the only thing that ever paints as focus/hover), and
 * straight (never overshooting) line segments.
 *
 * Every point stays reachable for its exact figure via a native `<title>`
 * (mouse) AND independent keyboard focus (`tabIndex` + `role="img"` +
 * `aria-label`), backed by a visually-hidden `<table>` per line as a
 * screen-reader-native fallback — matching CategoryHistoryChart's own
 * accessibility contract exactly.
 *
 * Renders nothing (null) when BOTH lines have zero points — the caller's
 * job to show a "no data yet" note instead (this package's existing
 * convention: see CategoryHistoryChart). When exactly one line is empty
 * (e.g. `b` — reserves — before that series is registered/ingested), this
 * draws the other line alone; noting the absent line is also the caller's
 * job (e.g. a caption below the chart), matching how this package leaves
 * "no data" messaging to whoever has the surrounding copy.
 */
export function DualCadenceHistoryChart({ a, b, width = 640, height = 220 }: DualCadenceHistoryChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredPoint, setHoveredPoint] = useState<NearestDualPoint | null>(null);
  const [focusedPoint, setFocusedPoint] = useState<NearestDualPoint | null>(null);

  if (a.points.length === 0 && b.points.length === 0) return null;

  const geometry = computeDualHistoryGeometry(a.points, b.points, { width, height, ...PAD });
  const hasA = a.points.length > 0;
  const hasB = b.points.length > 0;
  const aTableId = `dual-cadence-a-${Math.round(width)}x${Math.round(height)}`;
  const bTableId = `dual-cadence-b-${Math.round(width)}x${Math.round(height)}`;

  const ariaSummaryA = hasA ? `${a.label}: ${a.points.map((p) => `${p.label} ${p.display}`).join(", ")}` : "";
  const ariaSummaryB = hasB ? `${b.label}: ${b.points.map((p) => `${p.label} ${p.display}`).join(", ")}` : "";
  const ariaLabel = [ariaSummaryA, ariaSummaryB].filter(Boolean).join(". ");

  // Mouse hover wins over keyboard focus when both are set — the reader's
  // most recent action decides which point the tooltip describes (matches
  // CategoryHistoryChart's own convention).
  const active = hoveredPoint ?? focusedPoint;
  const activeSpec = active ? (active.series === "a" ? a : b) : undefined;
  const activePoint = active && activeSpec ? activeSpec.points[active.index] : undefined;
  const activeGeomPoint = active ? (active.series === "a" ? geometry.aPoints[active.index] : geometry.bPoints[active.index]) : undefined;

  function samePoint(x: NearestDualPoint | null, y: NearestDualPoint | null): boolean {
    if (x === y) return true;
    if (!x || !y) return false;
    return x.series === y.series && x.index === y.index;
  }

  function handlePointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const localX = ((e.clientX - rect.left) / rect.width) * width;
    const localY = ((e.clientY - rect.top) / rect.height) * height;
    const nearest = findNearestDualPoint(geometry.aPoints, geometry.bPoints, localX, localY);
    setHoveredPoint((prev) => (samePoint(prev, nearest) ? prev : nearest));
  }

  function handlePointerLeave() {
    setHoveredPoint((prev) => (prev === null ? prev : null));
  }

  const aLastY = hasA ? (geometry.aPoints[geometry.aPoints.length - 1]?.y ?? null) : null;
  const bLastY = hasB ? (geometry.bPoints[geometry.bPoints.length - 1]?.y ?? null) : null;
  const endLabels =
    aLastY !== null && bLastY !== null
      ? (() => {
          const placed = placeEndLabels(bLastY, aLastY);
          return { aY: placed.monthlyY, bY: placed.totalY };
        })()
      : { aY: aLastY, bY: bLastY };
  const endLabelX = width - PAD.padRight + 8;

  function renderLine(spec: DualCadenceLineSpec, series: "a" | "b", points: readonly { x: number; y: number; date: string }[]) {
    if (points.length === 0) return null;
    const specPoints = spec.points;
    return (
      <g>
        <path d={series === "a" ? geometry.aPath : geometry.bPath} fill="none" stroke={spec.color} strokeWidth={2.25} />
        {points.map((p, i) => {
          const point = specPoints[i]!;
          const isLatest = i === points.length - 1;
          return (
            <circle
              key={`${series}-${p.date}`}
              cx={p.x}
              cy={p.y}
              r={isLatest ? MARKER_RADIUS : HIT_RADIUS}
              fill={isLatest ? spec.color : "transparent"}
              tabIndex={0}
              role="img"
              aria-label={`${spec.label}, ${point.label}: ${point.display}${isLatest ? " (latest)" : ""}`}
              onFocus={() => setFocusedPoint({ series, index: i })}
              onBlur={() => setFocusedPoint((prev) => (samePoint(prev, { series, index: i }) ? null : prev))}
              style={{ pointerEvents: "all", cursor: "pointer", outline: "none" }}
            >
              <title>{`${spec.label}, ${point.label}: ${point.display}${isLatest ? " (latest)" : ""}`}</title>
            </circle>
          );
        })}
      </g>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="auto"
        role="img"
        aria-label={ariaLabel}
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

        {renderLine(a, "a", geometry.aPoints)}
        {renderLine(b, "b", geometry.bPoints)}

        {geometry.dateTicks.map((tick, i) => (
          <text key={`${tick.x}-${i}`} x={tick.x} y={height - 6} fontSize={10} fill="currentColor" opacity={0.6} textAnchor={i === 0 ? "start" : i === geometry.dateTicks.length - 1 ? "end" : "middle"}>
            {tick.label}
          </text>
        ))}

        {hasA && endLabels.aY !== null && (
          <text x={endLabelX} y={endLabels.aY} fontSize={11} fontWeight={600} fill={a.color} dominantBaseline="middle">
            {a.label}
          </text>
        )}
        {hasB && endLabels.bY !== null && (
          <text x={endLabelX} y={endLabels.bY} fontSize={11} fontWeight={600} fill={b.color} dominantBaseline="middle">
            {b.label}
          </text>
        )}

        {/* Hover/focus indicator: a small dot + ring, never the browser's
            default focus outline (every hit-target circle above sets
            `outline: none`) — the only focus/hover marker that ever paints. */}
        {activeGeomPoint && activeSpec && (
          <g style={{ pointerEvents: "none" }}>
            <circle cx={activeGeomPoint.x} cy={activeGeomPoint.y} r={ACTIVE_RING_RADIUS} fill="none" stroke={activeSpec.color} strokeWidth={2} />
            <circle cx={activeGeomPoint.x} cy={activeGeomPoint.y} r={ACTIVE_DOT_RADIUS} fill={activeSpec.color} />
          </g>
        )}
      </svg>

      {active && activePoint && activeGeomPoint && activeSpec && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: `${(activeGeomPoint.x / width) * 100}%`,
            top: `${(activeGeomPoint.y / height) * 100}%`,
            transform: xyTransform(activeGeomPoint.x / width, activeGeomPoint.y / height),
            pointerEvents: "none",
            zIndex: 1,
            minWidth: 140,
            maxWidth: 220,
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
          <div style={{ color: activeSpec.color, fontSize: 10.5, marginBottom: 2 }}>
            {activeSpec.label} <span style={{ color: "var(--text-muted, #898781)" }}>· {activeSpec.cadenceLabel}</span>
          </div>
          <div style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{activePoint.scaledDisplay ?? activePoint.display}</div>
          <div style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-muted, #898781)", fontSize: 10.5 }}>{activePoint.display}</div>
        </div>
      )}

      {hasA && (
        <VisuallyHidden as="div">
          <table id={aTableId}>
            <caption>
              {a.label} ({a.cadenceLabel})
            </caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              {a.points.map((p) => (
                <tr key={p.date}>
                  <td>{p.label}</td>
                  <td>{p.display}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </VisuallyHidden>
      )}
      {hasB && (
        <VisuallyHidden as="div">
          <table id={bTableId}>
            <caption>
              {b.label} ({b.cadenceLabel})
            </caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              {b.points.map((p) => (
                <tr key={p.date}>
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
 * position in the chart — mirrors CategoryHistoryChart's own xyTransform
 * exactly (see that component for the reasoning: a pure CSS transform, no
 * layout-measuring pass needed, so it works identically on first paint). */
function xyTransform(xFrac: number, yFrac: number): string {
  const horiz = xFrac < 0.18 ? "0%" : xFrac > 0.82 ? "-100%" : "-50%";
  const vert = yFrac < 0.3 ? "12px" : "calc(-100% - 12px)";
  return `translate(${horiz}, ${vert})`;
}
