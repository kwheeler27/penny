"use client";

/**
 * Act I / Act II shared chart: a period toggle (fiscal-year-to-date / latest
 * month), ranked bars with an exact-value tooltip and a share-of-total
 * label, and a click-to-expand history panel per category. Most of the data
 * this component renders was already computed server-side, from the
 * database, by lib/front-door-data.ts — the one exception is a category's
 * FULL monthly history (the v2 line chart, HistoryPanelV2 below), which this
 * component fetches itself, lazily, from GET /api/category-history only for
 * the one row a reader actually expands — never inlined for all ~27
 * categories on every page load (that was ~1MB of unconditional RSC payload
 * on every visit; see the API route's own doc comment). This file otherwise
 * only assembles markup and owns its interactive UI state (which period is
 * showing, which row is expanded, and the small per-category fetch cache
 * below). Bar/dot pixel geometry below uses Number() on an already-exact
 * whole-dollar string, which is fine for a COSMETIC proportion (never for a
 * displayed figure) — see packages/viz/src/money/decimal.ts's documented
 * convention, which this component follows.
 */
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { CategoryHistoryChart, filterHistoryToWindow, HISTORY_WINDOWS, type HistoryWindow } from "@penny/viz";
import type { CategoryHistoryLineSeries, CategoryHistoryPanel, HistoryPoint, RankedPeriod } from "@/lib/front-door-transform";
import { formatUsdScale } from "@/lib/format";
import MonthStepper from "./month-stepper";

/** Act I's server-driven month stepper (beat 1) — omitted entirely by Act
 * II's usage of this same chart, which keeps its plain fytd/latest-month
 * toggle unchanged. */
export interface RankedBarChartStepper {
  currentPeriodEnd: string;
  prevHref: string | null;
  nextHref: string | null;
}

export interface RankedBarChartProps {
  idPrefix: string;
  colorVar: "--series-outlays" | "--series-receipts";
  toggleLabels: { fytd: string; month: string };
  periods: { fytd: RankedPeriod | null; month: RankedPeriod | null };
  histories: Record<string, CategoryHistoryPanel | null>;
  /** Persistent explanatory footer, shown in both periods (Act I's
   * percentages/negative-rows note). Omit when the act has nothing
   * persistent to say — Act II relies on monthOnlyNote alone, matching the
   * approved mockup, which gives Act II's chart no standing footer at all. */
  footNote?: string;
  monthOnlyNote?: string | null;
  /** Which tab is active on first render. Act II keeps the original "fytd"
   * default; Act I defaults to "month" — the atlas's rev 4/6 "month-first
   * opening" note: the story opens at the government's actual pace, one
   * month at a time. */
  defaultPeriod?: PeriodKey;
  /** The month stepper (beat 1) — present only for Act I. When given, the
   * month tab shows the ‹ Month YYYY › pill plus a "$X spent/collected"
   * stage-setter line instead of just the ranked bars. */
  stepper?: RankedBarChartStepper | null;
  /** The verb for the stage-setter line ("spent", "collected") — only used
   * alongside `stepper`. */
  stageVerb?: string;
}

type PeriodKey = "fytd" | "month";

/** Whole calendar-month index (year*12 + month) from a YYYY-MM-DD string —
 * exact integer arithmetic on the string's digits, never a `Date`. Used only
 * to space history-panel dots proportionally to real elapsed time. */
function monthIndex(periodEnd: string): number {
  return Number(periodEnd.slice(0, 4)) * 12 + Number(periodEnd.slice(5, 7));
}

function HistoryPanel({ label, panel }: { label: string; panel: CategoryHistoryPanel }) {
  const { points, chips } = panel;
  const W = 560;
  const H = 120;
  const padL = 8;
  const padR = 56;
  const padY = 26;
  const firstIdx = monthIndex(points[0]!.periodEnd);
  const lastIdx = monthIndex(points[points.length - 1]!.periodEnd);
  const span = Math.max(1, lastIdx - firstIdx);
  const xOf = (p: HistoryPoint) => padL + ((monthIndex(p.periodEnd) - firstIdx) / span) * (W - padL - padR);
  const values = points.map((p) => Number(p.valueWhole));
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const range = hi - lo || 1;
  const yOf = (v: number) => padY + (1 - (v - lo) / range) * (H - 2 * padY);
  const linePath = points.map((p, i) => `${i ? "L" : "M"}${xOf(p).toFixed(1)},${yOf(Number(p.valueWhole)).toFixed(1)}`).join(" ");
  const ariaSummary = points.map((p) => `${p.monthLabel} ${p.scaledDisplay}`).join(", ");

  return (
    <div className="rank-hist">
      <div className="rank-hist-title">
        {label} — the {points.length} period{points.length === 1 ? "" : "s"} the latest statement publishes
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${label}: ${ariaSummary}`}>
        {lo < 0 && <line x1={padL} x2={W - padR + 30} y1={yOf(0)} y2={yOf(0)} className="rank-hist-zeroline" />}
        <path d={linePath} className="rank-hist-line" fill="none" />
        {points.map((p) => (
          <g key={p.periodEnd}>
            <circle cx={xOf(p)} cy={yOf(Number(p.valueWhole))} r={4} className="rank-hist-dot" />
            <text x={xOf(p)} y={yOf(Number(p.valueWhole)) - 9} textAnchor="middle" className="rank-hist-dot-label">
              {p.scaledDisplay}
            </text>
            <text x={xOf(p)} y={H - 4} textAnchor="middle" className="rank-hist-month-label">
              {p.monthLabel}
            </text>
          </g>
        ))}
      </svg>
      {chips.length > 0 && (
        <div className="rank-hist-chips">
          {chips.map((chip) => (
            <span key={chip.label} className="rank-hist-chip">
              {chip.label}: <b>{chip.display}</b>
            </span>
          ))}
        </div>
      )}
      <div className="rank-hist-note">
        Monthly figures are lumpy — payment dates shift across month boundaries, so a single month can swing sharply
        without a policy change. Showing the periods the latest statement publishes; the full monthly line chart
        appears when this category&rsquo;s history is available.
      </div>
    </div>
  );
}

/**
 * The v2 line-chart form of a category's history (beat 1, "HISTORY PANELS
 * v2"): the real @penny/viz CategoryHistoryChart, shown instead of the
 * four-period dot plot above once a category's ingested history exceeds
 * four months (see lib/front-door-transform.ts's buildCategoryHistoryLineSeries,
 * which returns null — never rendering this — until then). Owns the
 * [1Y · 5Y · 10Y · All] time-window toggle itself (client-only UI state,
 * defaulting to "All" — the original, unfiltered behavior): the window only
 * narrows which already-computed points are shown, via @penny/viz's
 * filterHistoryToWindow — it never recomputes the 12-month total from a
 * truncated window (that would silently fabricate a different smoothing
 * near the window's left edge; see that function's own doc comment).
 */
export function HistoryPanelV2({ label, series, colorVar }: { label: string; series: CategoryHistoryLineSeries; colorVar: RankedBarChartProps["colorVar"] }) {
  const [windowKey, setWindowKey] = useState<HistoryWindow>("all");
  const windowed = filterHistoryToWindow(series.monthly, series.twelveMonthTotal, windowKey);
  // `display` becomes the chart's ACCESSIBLE name (native SVG hover title,
  // aria-label, and screen-reader table fallback) — always the
  // full-precision exactDisplay, never rounded. `scaledDisplay` is the new
  // hover/focus tooltip's large primary line ("$XX.XB" style); the tooltip
  // still shows `display` (the exact figure) below it, muted — the exact
  // figure is never dropped, only demoted to a secondary line.
  const monthly = windowed.monthly.map((p) => ({ periodEnd: p.periodEnd, valueWhole: p.valueWhole, display: p.exactDisplay, scaledDisplay: p.scaledDisplay, label: p.monthLabel }));
  const total = windowed.total.map((p) => ({ periodEnd: p.periodEnd, valueWhole: p.valueWhole, display: p.exactDisplay, scaledDisplay: p.scaledDisplay, label: p.monthLabel }));
  const first = windowed.monthly[0]!;
  const last = windowed.monthly[windowed.monthly.length - 1]!;

  return (
    <div className="rank-hist">
      <div className="rank-hist-title">
        {label} — {windowed.monthly.length} months, {first.monthLabel} through {last.monthLabel}
      </div>
      <div className="rank-hist-window" role="group" aria-label={`Time window — ${label}`}>
        {HISTORY_WINDOWS.map((opt) => (
          <button key={opt.key} type="button" aria-pressed={windowKey === opt.key} onClick={() => setWindowKey(opt.key)}>
            {opt.label}
          </button>
        ))}
      </div>
      <CategoryHistoryChart monthly={monthly} total={total} color={`var(${colorVar})`} />
      <div className="rank-hist-note">
        {series.twelveMonthTotal.length > 0
          ? "Monthly figures are lumpy — payment dates shift across month boundaries — which the bold 12-month total line smooths out."
          : "Monthly figures are lumpy — payment dates shift across month boundaries — a 12-month total appears once 12 consecutive months are ingested."}
      </div>
    </div>
  );
}

export default function RankedBarChart({
  idPrefix,
  colorVar,
  toggleLabels,
  periods,
  histories,
  footNote,
  monthOnlyNote,
  defaultPeriod = "fytd",
  stepper,
  stageVerb = "spent",
}: RankedBarChartProps) {
  const [period, setPeriod] = useState<PeriodKey>(defaultPeriod);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // The v2 full-history line chart, fetched lazily per category (never all
  // ~27 up front — see this file's module doc and GET /api/category-history).
  // `undefined` = not yet requested; `null` = fetched, and either the
  // category has 4-or-fewer months (fall back to the dot plot) or the
  // request failed (same honest fallback, never a fabricated chart).
  const [fetchedFull, setFetchedFull] = useState<Record<string, CategoryHistoryLineSeries | null>>({});
  const requestedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!expandedId || requestedIds.current.has(expandedId)) return;
    requestedIds.current.add(expandedId);
    let cancelled = false;
    fetch(`/api/category-history?id=${encodeURIComponent(expandedId)}`)
      .then((res) => (res.ok ? (res.json() as Promise<{ series: CategoryHistoryLineSeries | null }>) : { series: null }))
      .then(({ series }) => {
        if (!cancelled) setFetchedFull((prev) => ({ ...prev, [expandedId]: series }));
      })
      .catch(() => {
        if (!cancelled) setFetchedFull((prev) => ({ ...prev, [expandedId]: null }));
      });
    return () => {
      cancelled = true;
    };
  }, [expandedId]);

  const current = periods[period];
  const inStepperMode = period === "month" && Boolean(stepper);

  if (!current) {
    return <div className="rank-chart-empty">No report has been ingested yet for this view.</div>;
  }

  const values = current.rows.map((r) => Number(r.valueWhole));
  const maxPos = Math.max(0, ...values);
  const minNeg = Math.min(0, ...values);
  const negFrac = minNeg < 0 ? Math.max(0.06, Math.abs(minNeg) / (maxPos + Math.abs(minNeg) || 1)) : 0;
  const zero = negFrac * 100;
  const scale = maxPos > 0 ? (100 - zero) / maxPos : 0;

  return (
    <div className="rank-block">
      <div className="rank-toggle" role="group" aria-label={`Period — ${idPrefix}`}>
        <button type="button" aria-pressed={period === "fytd"} onClick={() => setPeriod("fytd")}>
          {toggleLabels.fytd}
        </button>
        <button type="button" aria-pressed={period === "month"} onClick={() => setPeriod("month")}>
          {toggleLabels.month}
        </button>
      </div>
      {inStepperMode && stepper && (
        <div className="month-stepper-row">
          <div className="month-stepper-total">
            {formatUsdScale(current.totalWhole, "B", 1)} {stageVerb}
          </div>
          <MonthStepper currentLabel={current.periodLabel} prevHref={stepper.prevHref} nextHref={stepper.nextHref} />
        </div>
      )}
      <div className="rank-chart">
        {current.rows.length === 0 && period === "month" && (
          <div className="rank-chart-nocat">No category breakdown has been ingested for this month yet — only the published total, above.</div>
        )}
        <div className="rank-rows">
          {current.rows.map((row) => {
            const w = Math.max(Math.abs(Number(row.valueWhole)) * scale, 0.35);
            // backgroundColor (the longhand), never the `background`
            // shorthand: React's inline `style` wins over any external
            // stylesheet rule for the same longhand property, so a
            // shorthand `background: ...` here would silently zero out
            // `.rank-row-bar--neg`'s `background-image` hatch pattern from
            // globals.css and it would never paint on a negative row.
            const barStyle: CSSProperties = row.negative
              ? { left: `${Math.max(zero - w, 0)}%`, width: `${Math.min(w, zero)}%`, backgroundColor: `var(${colorVar})`, opacity: 0.75 }
              : { left: `${zero}%`, width: `${w}%`, backgroundColor: `var(${colorVar})` };
            const expanded = expandedId === row.id;
            const panel = histories[row.id];
            const lineSeries = fetchedFull[row.id];
            // `undefined` = the lazy /api/category-history fetch hasn't
            // resolved yet; `null` = it resolved with no full series. Only
            // the resolved-null case falls back to the sparse dot plot —
            // rendering it while the fetch is in flight flashed a whole
            // different chart for ~a second before the real one replaced it
            // (Kevin's 2026-09-02 screen recording).
            const historyResolved = row.id in fetchedFull;
            return (
              <div key={row.id}>
                <button type="button" className="rank-row" aria-expanded={expanded} onClick={() => setExpandedId(expanded ? null : row.id)}>
                  <span className="rank-row-lab">{row.label}</span>
                  <span className="rank-row-track">
                    <span className="rank-row-zero" style={{ left: `${zero}%` }} />
                    <span
                      className={`rank-row-bar${row.negative ? " rank-row-bar--neg" : ""}`}
                      style={barStyle}
                      title={`${row.label}: ${row.exactDisplay} (exact, as published)`}
                    />
                  </span>
                  <span className="rank-row-val">
                    {row.scaledDisplay} <span className="rank-row-pct">· {row.shareDisplay}</span>
                  </span>
                </button>
                {expanded &&
                  (lineSeries ? (
                    <HistoryPanelV2 label={row.label} series={lineSeries} colorVar={colorVar} />
                  ) : !historyResolved ? (
                    // Sized to roughly the v2 panel's rendered height so the
                    // swap-in doesn't jump the page either.
                    <div className="rank-hist rank-hist--pending" aria-busy="true">
                      Loading {row.label}&rsquo;s monthly history…
                    </div>
                  ) : panel ? (
                    <HistoryPanel label={row.label} panel={panel} />
                  ) : (
                    <div className="rank-hist rank-hist--empty">No history ingested yet for this category.</div>
                  ))}
              </div>
            );
          })}
        </div>
        {!inStepperMode && <div className="rank-total">{current.totalDisplay}</div>}
        {footNote && <div className="rank-foot">{footNote}</div>}
        {period === "month" && monthOnlyNote && <div className={footNote ? "rank-foot rank-foot--note" : "rank-foot"}>{monthOnlyNote}</div>}
      </div>
    </div>
  );
}
