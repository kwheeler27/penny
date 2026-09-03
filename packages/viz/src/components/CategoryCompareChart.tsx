import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  computeCompareGeometry,
  decollideEndLabels,
  findNearestCompareMonth,
  initialCompareVisibility,
  isCompareSeriesVisible,
  toggleCompareSeries,
  type CompareVisibility,
} from "../layout/compareLayout";
import { usePrefersReducedMotion } from "../scroll/usePrefersReducedMotion";
import type { HistoryChartPoint } from "../layout/averagedHistoryLayout";
import { VisuallyHidden } from "./VisuallyHidden";

export interface CategoryCompareSeriesSpec {
  readonly id: string;
  readonly label: string;
  /** CSS color (a literal color or a `var(--token)` reference resolved by
   * the host page) for this line, its legend swatch, its end-of-line
   * label, and its hover dot/label. */
  readonly color: string;
  /** True for the one gray, dashed "Everything else" line — never a real
   * category, always the sum of every OTHER published outlay function
   * (approved design), so it's drawn differently (dashed) and gates the
   * `annotation` below. */
  readonly dashed?: boolean;
  /** True only for the series that starts OFF — the approved design's
   * "Everything else... is OFF by default (its legend chip turns it on)".
   * At most one series in a real call is expected to set this. */
  readonly defaultHidden?: boolean;
  /** 12-month totals, ascending by periodEnd. */
  readonly points: readonly HistoryChartPoint[];
}

export interface CategoryCompareAnnotation {
  /** The month (periodEnd of a point in the DASHED series) this annotation
   * anchors to — e.g. the "Everything else" line's own peak month. Looked
   * up directly against that series' positioned points; if no such point
   * exists, nothing is drawn. */
  readonly anchorPeriodEnd: string;
  readonly title: string;
  /** Body copy, one paragraph per line — already composed by the caller
   * from real data (CLAUDE.md: no hardcoded stats; this component only
   * renders what it's given, at the anchored position, gated on the dashed
   * series' own visibility). */
  readonly body: readonly string[];
}

export interface CategoryCompareChartProps {
  /** The FIXED series set — five real categories plus "Everything else"
   * (approved design: never a dynamic top-5, so color always follows the
   * same entity call to call). */
  readonly series: readonly CategoryCompareSeriesSpec[];
  /** Shown only while the DASHED series (identified by `series[].dashed`)
   * is currently visible — see layout/compareLayout.ts's
   * `isCompareSeriesVisible` for the exact visibility rule isolation
   * interacts with. Pass null/undefined when there's nothing to
   * highlight. */
  readonly annotation?: CategoryCompareAnnotation | null;
  readonly width?: number;
  readonly height?: number;
}

// padRight: 185, not 148 — measured empirically (real-browser getBBox(), not
// guessed) against real seeded data: the "Everything else" and "Social
// Security" end labels (bold value + muted name, one tspan run) measured 155
// local units wide against a 138-unit budget at 148, and were visibly clipped
// by the panel edge in a real screenshot. 185 leaves ~20 units of margin.
const PAD = { padLeft: 64, padRight: 185, padTop: 24, padBottom: 26 };
const HIT_RADIUS = 7;
const MARKER_RADIUS = 3.5;
const HOVER_DOT_RADIUS = 4.5;
const HALO_STROKE_WIDTH = 3.5;
const END_LABEL_MIN_GAP = 20;
const HOVER_LABEL_MIN_GAP = 18;

/**
 * Frame B of the "spending history, scrubbable" redesign (the approved
 * interactive mockup, penny-history-scrub.html rev 2, "Compare the big
 * five"): the five largest outlay categories plus "Everything else" (every
 * OTHER published outlay function summed, including negative undistributed
 * offsetting receipts) as 12-month totals on one shared dollar axis.
 * "Everything else" renders gray and dashed and starts OFF; legend chips
 * isolate a line on click (click again to restore), and the y-scale
 * refits to whichever lines are currently visible on every change — see
 * layout/compareLayout.ts for the geometry/visibility math, all pure and
 * independently unit-tested there.
 *
 * Hover is OWID-style, matching AveragedHistoryChart's Frame A: a vertical
 * guide snapped to the nearest month, the month name pinned at top, a dot
 * + de-collided value label on EVERY currently visible line at that month
 * (never a floating tooltip box) — no dashed reference line here (that's
 * Frame A-only, per the approved design).
 *
 * The peak-annotation callout (ring + leader line + title/body) is drawn
 * exactly where `annotation.anchorPeriodEnd` lands on the dashed series'
 * own line, and only while that series is actually visible — every figure
 * in its text is computed by the caller from real data (CLAUDE.md: never
 * hardcode a stat); this component only positions and renders it.
 *
 * Renders null when every series has zero points, matching every other
 * chart in this package.
 */
export function CategoryCompareChart({ series, annotation, width = 1016, height = 380 }: CategoryCompareChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  // Seeded ONCE from the initial `series` prop, per the approved design's
  // own "FIXED series set, never dynamic" contract — a reader's clicks are
  // expected to diverge from the starting defaultHidden/isolated state
  // immediately, so re-seeding on every prop change would surprise them by
  // silently reverting their own toggles.
  const [visibility, setVisibility] = useState<CompareVisibility>(() => initialCompareVisibility(series));
  const [hoveredPeriodEnd, setHoveredPeriodEnd] = useState<string | null>(null);
  const [focusedPeriodEnd, setFocusedPeriodEnd] = useState<string | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  const totalPoints = series.reduce((n, s) => n + s.points.length, 0);
  if (totalPoints === 0) return null;

  const geometry = computeCompareGeometry(series, visibility, { width, height, ...PAD });
  const activePeriodEnd = hoveredPeriodEnd ?? focusedPeriodEnd;

  function handlePointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const localX = ((e.clientX - rect.left) / rect.width) * width;
    const nearest = findNearestCompareMonth(geometry.months, localX);
    setHoveredPeriodEnd((prev) => (prev === nearest ? prev : nearest));
  }

  function handlePointerLeave() {
    setHoveredPeriodEnd((prev) => (prev === null ? prev : null));
  }

  // End-of-line labels: bold value + muted name, one per VISIBLE series,
  // de-collided (approved design: min 20px gaps).
  const endLabelCandidates = geometry.series
    .map((g) => {
      const spec = series.find((s) => s.id === g.id)!;
      const lastPoint = g.points[g.points.length - 1];
      const lastData = spec.points[spec.points.length - 1];
      return lastPoint && lastData ? { id: g.id, y: lastPoint.y, x: lastPoint.x, spec, data: lastData } : null;
    })
    .filter((c): c is { id: string; y: number; x: number; spec: CategoryCompareSeriesSpec; data: HistoryChartPoint } => c !== null);
  const decollidedEnds = decollideEndLabels(endLabelCandidates, END_LABEL_MIN_GAP, PAD.padTop + 4, height - PAD.padBottom - 4);
  const endLabelX = width - PAD.padRight + 10;

  // Hover value labels across every visible series at the active month.
  const hoverCandidates =
    activePeriodEnd === null
      ? []
      : geometry.series
          .map((g) => {
            const point = g.points.find((p) => p.periodEnd === activePeriodEnd);
            const spec = series.find((s) => s.id === g.id)!;
            const data = spec.points.find((p) => p.periodEnd === activePeriodEnd);
            return point && data ? { id: g.id, y: point.y, x: point.x, spec, data } : null;
          })
          .filter((c): c is { id: string; y: number; x: number; spec: CategoryCompareSeriesSpec; data: HistoryChartPoint } => c !== null);
  const decollidedHover = decollideEndLabels(hoverCandidates, HOVER_LABEL_MIN_GAP, PAD.padTop + 4, height - PAD.padBottom - 4);
  const activeMonthX = activePeriodEnd !== null ? geometry.months.find((m) => m.periodEnd === activePeriodEnd)?.x : undefined;

  const restSpec = series.find((s) => s.dashed);
  const restVisible = restSpec !== undefined && isCompareSeriesVisible(restSpec.id, visibility);
  const restGeom = restSpec && restVisible ? geometry.series.find((g) => g.id === restSpec.id) : undefined;
  const annotationPoint = restGeom && annotation ? restGeom.points.find((p) => p.periodEnd === annotation.anchorPeriodEnd) : undefined;
  // Bundled together once restSpec/annotationPoint are both confirmed
  // present, so the render below never needs a non-null assertion on
  // restSpec — a color pulled from `restSpec` after this point could
  // otherwise be undefined as far as TypeScript's control-flow analysis is
  // concerned, even though `annotationPoint` being set already proves it.
  const annotationRender = restSpec && annotationPoint && annotation ? { x: annotationPoint.x, y: annotationPoint.y, color: restSpec.color, title: annotation.title, body: annotation.body } : null;

  const legendTransition = prefersReducedMotion ? "none" : "opacity 150ms ease";

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <div role="group" aria-label="Series shown" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8, fontSize: 13 }}>
        {series.map((s) => {
          const visible = isCompareSeriesVisible(s.id, visibility);
          const isolated = visibility.isolatedId === s.id;
          return (
            <button
              key={s.id}
              type="button"
              // `aria-pressed` reports the chip's actual on/off meaning —
              // whether the series is currently PLOTTED — not isolation
              // (found in review: binding it to `isolated` left a screen-
              // reader user with no way to tell whether "Everything else"
              // was on, since turning it on via case 3 of
              // toggleCompareSeries doesn't isolate anything). Isolation is
              // a second, separate state, surfaced in the accessible name
              // instead of overloading this attribute.
              aria-pressed={visible}
              aria-label={`${s.label}${isolated ? " (isolated — only this line shown)" : ""}`}
              onClick={() => setVisibility((prev) => toggleCompareSeries(prev, s.id))}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                font: "inherit",
                color: "currentColor",
                background: isolated ? "var(--panel, transparent)" : "transparent",
                border: isolated ? "1px solid currentColor" : "1px solid transparent",
                borderRadius: 6,
                padding: "4px 8px",
                cursor: "pointer",
                opacity: visible ? 1 : 0.35,
                transition: legendTransition,
                // No `outline: "none"` here (found in review): unlike the
                // hit-radius circles below — which suppress the native
                // outline only because focusing one paints its own guide
                // line/dot as a substitute focus indicator — these chips
                // have no such stand-in, so keyboard focus needs the
                // browser's own default ring to stay visible at all
                // (WCAG 2.2 SC 2.4.7).
              }}
            >
              <i
                aria-hidden="true"
                style={{
                  width: 14,
                  height: 3,
                  borderRadius: 2,
                  display: "inline-block",
                  background: s.dashed
                    ? `repeating-linear-gradient(90deg, ${s.color} 0 4px, transparent 4px 7px)`
                    : s.color,
                }}
              />
              {s.label}
            </button>
          );
        })}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="auto"
        role="img"
        aria-label={`Compare spending categories, 12-month totals: ${series.map((s) => s.label).join(", ")}`}
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

        {geometry.series.map((g) => {
          const spec = series.find((s) => s.id === g.id)!;
          const isNearestOnHover = activePeriodEnd !== null && decollidedHover.some((h) => h.id === g.id);
          return (
            <g key={g.id}>
              <path
                d={g.path}
                fill="none"
                stroke={spec.color}
                strokeWidth={spec.dashed ? 1.8 : isNearestOnHover ? 2.6 : 2}
                strokeDasharray={spec.dashed ? "6 4" : undefined}
                strokeLinecap="round"
              />
              {g.points.map((p, i) => {
                const data = spec.points.find((d) => d.periodEnd === p.periodEnd);
                const isLatest = i === g.points.length - 1;
                const label = data ? `${spec.label}, ${data.label}: ${data.display}${isLatest ? " (latest)" : ""}` : spec.label;
                return (
                  <circle
                    key={`${g.id}-${p.periodEnd}`}
                    cx={p.x}
                    cy={p.y}
                    r={isLatest ? MARKER_RADIUS : HIT_RADIUS}
                    fill={isLatest ? spec.color : "transparent"}
                    tabIndex={0}
                    role="img"
                    aria-label={label}
                    onFocus={() => setFocusedPeriodEnd(p.periodEnd)}
                    onBlur={() => setFocusedPeriodEnd((prev) => (prev === p.periodEnd ? null : prev))}
                    style={{ pointerEvents: "all", cursor: "pointer", outline: "none" }}
                  >
                    <title>{label}</title>
                  </circle>
                );
              })}
            </g>
          );
        })}

        {geometry.yearTicks.map((tick) => (
          <text key={tick.x} x={tick.x} y={height - PAD.padBottom + 20} fontSize={10} fill="currentColor" opacity={0.6} textAnchor={tick.x < 12 ? "start" : tick.x > width - 12 ? "end" : "middle"}>
            {tick.label}
          </text>
        ))}

        {/* End-of-line labels: bold value + muted category name, de-collided. */}
        {decollidedEnds.map((e) => {
          const found = endLabelCandidates.find((c) => c.id === e.id)!;
          return (
            <text key={e.id} x={endLabelX} y={e.y} dominantBaseline="middle" style={{ fontVariantNumeric: "tabular-nums" }}>
              <tspan fontWeight={700} fontSize={13} fill={found.spec.color}>
                {found.data.scaledDisplay ?? found.data.display}
              </tspan>
              <tspan dx={5} fontSize={11} fill="currentColor" opacity={0.6}>
                {found.spec.label}
              </tspan>
            </text>
          );
        })}

        {/* Peak-annotation callout — ring + leader line + title/body, only
            while the dashed series is visible and has a point at the
            anchored month. */}
        {annotationRender && (
          <g style={{ pointerEvents: "none" }}>
            <circle cx={annotationRender.x} cy={annotationRender.y} r={5} fill="none" stroke={annotationRender.color} strokeWidth={1.5} />
            <line x1={annotationRender.x - 8} y1={annotationRender.y} x2={annotationRender.x - 46} y2={annotationRender.y} stroke={annotationRender.color} strokeWidth={1} strokeOpacity={0.7} />
            <text x={annotationRender.x - 54} y={annotationRender.y + 3} textAnchor="end" fontWeight={650} fontSize={11.5} fill="currentColor">
              {annotationRender.title}
            </text>
            {annotationRender.body.map((line, li) => (
              <text key={li} x={annotationRender.x - 54} y={annotationRender.y + 18 + li * 14} textAnchor="end" fontSize={11} fill="currentColor" opacity={0.65}>
                {line}
              </text>
            ))}
          </g>
        )}

        {/* OWID-style hover/focus scrub: a guide line, the month name
            pinned at top, a dot + de-collided value label on every
            currently visible line. No dashed reference line (Frame A
            only) and no floating tooltip box. */}
        {activeMonthX !== undefined && activePeriodEnd !== null && (
          <g style={{ pointerEvents: "none" }}>
            <line x1={activeMonthX} x2={activeMonthX} y1={2} y2={height - PAD.padBottom} stroke="var(--guide, currentColor)" strokeOpacity={0.5} strokeWidth={1} />
            <text
              x={Math.min(Math.max(activeMonthX, PAD.padLeft), width - 160)}
              y={10}
              fontWeight={700}
              fontSize={11}
              fill="currentColor"
              textAnchor="middle"
              style={{ paintOrder: "stroke", stroke: "var(--panel, #f1f0ea)", strokeWidth: HALO_STROKE_WIDTH }}
            >
              {hoverCandidates[0]?.data.label ?? ""}
            </text>
            {hoverCandidates.map((c) => (
              <circle key={c.id} cx={activeMonthX} cy={c.y} r={HOVER_DOT_RADIUS} fill={c.spec.color} stroke="var(--panel, #f1f0ea)" strokeWidth={2} />
            ))}
            {decollidedHover.map((h) => {
              const c = hoverCandidates.find((x) => x.id === h.id)!;
              return (
                <text
                  key={h.id}
                  x={activeMonthX - 9}
                  y={h.y + 4}
                  textAnchor="end"
                  fontWeight={700}
                  fontSize={12.5}
                  fill={c.spec.color}
                  style={{ paintOrder: "stroke", stroke: "var(--panel, #f1f0ea)", strokeWidth: HALO_STROKE_WIDTH, fontVariantNumeric: "tabular-nums" }}
                >
                  {c.data.scaledDisplay ?? c.data.display}
                </text>
              );
            })}
          </g>
        )}
      </svg>

      {series.map((s) => (
        <VisuallyHidden as="div" key={s.id}>
          <table>
            <caption>{s.label} (12-month total)</caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              {s.points.map((p) => (
                <tr key={p.periodEnd}>
                  <td>{p.label}</td>
                  <td>{p.display}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </VisuallyHidden>
      ))}
    </div>
  );
}
