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
import { useEffect, useState } from "react";
import { AveragedHistoryChart, CategoryCompareChart, filterHistoryToWindow, rollingAverage, HISTORY_WINDOWS, type HistoryChartPoint, type HistoryWindow } from "@penny/viz";
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
  /**
   * Renders the "Compare the big five" disclosure (Frame B,
   * spending-history-scrub) beneath this chart — Act I's outlays usage ONLY.
   * An explicit prop, not an `idPrefix === "spend"` string check: this
   * component stays agnostic about which act is calling it, and the page
   * decides which chart instance gets the affordance.
   */
  compareBigFive?: boolean;
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

/** [12-mo avg · 6-mo avg] — the rolling-average window toggle, alongside
 * the existing [1Y · 5Y · 10Y · All] time window (Kevin's rev-2 spending-
 * history-scrub decision: one panel, one linear axis, the average IS the
 * 12-month total divided by 12, so it lives on the same scale as the
 * monthly line — no second axis, no stacked panels). */
type AverageWindow = 12 | 6;
const AVERAGE_WINDOWS: ReadonlyArray<{ key: AverageWindow; label: string }> = [
  { key: 12, label: "12-mo avg" },
  { key: 6, label: "6-mo avg" },
];

/**
 * The v2 line-chart form of a category's history (beat 1, "HISTORY PANELS
 * v2"; reworked for spending-history-scrub rev 2): the real @penny/viz
 * AveragedHistoryChart — a bold rolling AVERAGE of the monthly figures over
 * a faint actual-monthly line, one panel, one linear y-axis (the earlier
 * "monthly + 12-month TOTAL on one axis" form read as visually nonlinear —
 * a total is 12x a typical month's own scale — and this fixes that: a
 * 12-month average is the 12-month total divided by 12, so it plots on
 * exactly the same axis as the monthly figures it smooths) — shown instead
 * of the four-period dot plot above once a category's ingested history
 * exceeds four months (see lib/front-door-transform.ts's
 * buildCategoryHistoryLineSeries, which returns null — never rendering
 * this — until then).
 *
 * Owns BOTH toggles itself (client-only UI state): the [1Y · 5Y · 10Y ·
 * All] time window (defaulting to "All", the original unfiltered
 * behavior) and the new [12-mo avg · 6-mo avg] average window (defaulting
 * to 12-mo). The average is computed via @penny/viz's rollingAverage on
 * the FULL, unwindowed monthly series, and only THEN clipped to the time
 * window via filterHistoryToWindow's PAIRED signature — never recomputed
 * on a truncated window (the same principle @penny/viz's
 * filterHistoryToWindow already documents for the retired 12-month-total
 * line: a rolling window near the window's own left edge needs real
 * months from before the window starts, which a truncate-then-recompute
 * would not have) and never clipped independently per array either: the
 * cutoff is computed ONCE, from the monthly series' own last point, and
 * applied to both `fullMonthly` and `fullAverage` — clipping each with its
 * own separate cutoff (two calls to the single-array `clipToWindow`) would
 * anchor the average on ITS OWN last point instead, which can differ from
 * the monthly line's last point whenever the trailing average window spans
 * a gap (see rollingAverage's own doc comment), silently drawing the two
 * lines over two different date ranges.
 */
export function HistoryPanelV2({ label, series, colorVar }: { label: string; series: CategoryHistoryLineSeries; colorVar: RankedBarChartProps["colorVar"] }) {
  const [windowKey, setWindowKey] = useState<HistoryWindow>("all");
  const [avgWindow, setAvgWindow] = useState<AverageWindow>(12);

  // `display` becomes the chart's ACCESSIBLE name (native SVG hover title,
  // aria-label, and screen-reader table fallback) — always the
  // full-precision exactDisplay, never rounded. `scaledDisplay` is the
  // hover/focus tooltip's large primary line ("$XX.XB" style).
  const fullMonthly: HistoryChartPoint[] = series.monthly.map((p) => ({ periodEnd: p.periodEnd, valueWhole: p.valueWhole, display: p.exactDisplay, scaledDisplay: p.scaledDisplay, label: p.monthLabel }));
  const fullAverage = rollingAverage(fullMonthly, avgWindow);

  // ONE cutoff, computed from `fullMonthly`'s own last point, applied to
  // BOTH arrays — filterHistoryToWindow's paired signature, not two
  // independent single-array clips (see this function's own doc comment
  // above for why that would let the two lines drift onto different date
  // ranges).
  const { monthly, total: average } = filterHistoryToWindow(fullMonthly, fullAverage, windowKey);
  // `series.monthly` is never empty here (buildCategoryHistoryLineSeries only
  // returns non-null once more than 4 months exist), and the window anchors
  // on the series' own last point, so `monthly` always has at least one
  // entry too — same non-null convention this file's HistoryPanel above
  // already relies on for its own points[0]/points[points.length-1].
  const first = monthly[0]!;
  const last = monthly[monthly.length - 1]!;

  // The muted "past 12 mo" secondary end label reads from
  // series.twelveMonthTotal (the exact rolling total, always computed on
  // the full series — see lib/front-door-transform.ts) — shown only when
  // its OWN latest point still falls inside the current time window (never
  // a stale total from outside what's plotted) and only once 12
  // consecutive months actually exist (never fabricated).
  const lastTwelveMonthTotal = series.twelveMonthTotal[series.twelveMonthTotal.length - 1];
  const secondaryEndLabel = lastTwelveMonthTotal && lastTwelveMonthTotal.periodEnd === last.periodEnd ? `${lastTwelveMonthTotal.scaledDisplay} past 12 mo` : null;
  // "$174.3B · Jul" — the value plus a dated month qualifier (matching the
  // approved mockup exactly, penny-history-scrub.html: `fmtB(...) + " · " +
  // monthLabel(...).slice(0,3)`); `last.label` is already "Jul 2026"-style
  // (formatMonthYearShort), so the first 3 characters are the month
  // abbreviation.
  const monthlyEndLabel = `${last.scaledDisplay} · ${last.label.slice(0, 3)}`;

  return (
    <div className="rank-hist">
      <div className="rank-hist-title">
        {label} — {monthly.length} months, {first.label} through {last.label}
      </div>
      <div className="rank-hist-controls">
        <div className="rank-hist-window" role="group" aria-label={`Time window — ${label}`}>
          {HISTORY_WINDOWS.map((opt) => (
            <button key={opt.key} type="button" aria-pressed={windowKey === opt.key} onClick={() => setWindowKey(opt.key)}>
              {opt.label}
            </button>
          ))}
        </div>
        <div className="rank-hist-window" role="group" aria-label={`Average window — ${label}`}>
          {AVERAGE_WINDOWS.map((opt) => (
            <button key={opt.key} type="button" aria-pressed={avgWindow === opt.key} onClick={() => setAvgWindow(opt.key)}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <AveragedHistoryChart monthly={monthly} average={average} color={`var(${colorVar})`} avgLabel="/mo avg" secondaryEndLabel={secondaryEndLabel} monthlyEndLabel={monthlyEndLabel} />
      <div className="rank-hist-note">
        {average.length > 0
          ? `Bold line: the ${avgWindow}-month rolling average of the monthly figures — computed on the full history, then clipped to this window. Faint line: the actual monthly figures it smooths. Monthly figures are lumpy — payment dates shift across month boundaries.`
          : `Monthly figures are lumpy — payment dates shift across month boundaries. The rolling average appears once ${avgWindow} consecutive months exist.`}
      </div>
    </div>
  );
}

/** The five fixed "Compare the big five" categories (Frame B) mapped to
 * their color token — a FIXED assignment (never a dynamic top-5), so a
 * color always means the same category regardless of which one is
 * currently biggest. Order matches the approved mockup's own legend order.
 * Exported so a test can assert this list's ids agree with
 * app/api/category-compare/route.ts's own independently-defined BIG_FIVE_IDS
 * — the two lists have no shared import (a server route constant and a
 * "use client" component constant), so nothing else stops them drifting
 * apart, which would silently restyle a real category as the gray dashed
 * "everything else" aggregate. */
export const BIG_FIVE_COLOR_VARS: ReadonlyArray<{ id: string; colorVar: string }> = [
  { id: "fiscal.mts.outlays.category.medicare", colorVar: "--cat-medicare" },
  { id: "fiscal.mts.outlays.category.social_security", colorVar: "--cat-social-security" },
  { id: "fiscal.mts.outlays.category.net_interest", colorVar: "--cat-net-interest" },
  { id: "fiscal.mts.outlays.category.national_defense", colorVar: "--cat-national-defense" },
  { id: "fiscal.mts.outlays.category.health", colorVar: "--cat-health" },
];
const REST_COLOR_VAR = "--cat-rest";

/** The GET /api/category-compare response shape this panel expects — a
 * local, narrow type describing only what this component reads, matching
 * this file's own existing convention for the /api/category-history fetch
 * above (never importing a server-only module's types into this
 * "use client" file). */
interface CategoryCompareApiPoint {
  periodEnd: string;
  monthLabel: string;
  valueWhole: string;
  scaledDisplay: string;
  exactDisplay: string;
}
interface CategoryCompareApiSeries {
  id: string;
  label: string;
  twelveMonthTotal: CategoryCompareApiPoint[];
}
interface CategoryCompareApiResponse {
  series: CategoryCompareApiSeries[];
  annotation: { anchorPeriodEnd: string; title: string; body: string[]; windowLabel: string } | null;
  citation: { agency: string; dataset: string; datasetUrl: string; accessedDisplay: string };
  cboCitation: { title: string; url: string; sentence: string };
}

function toChartPoints(points: CategoryCompareApiPoint[]): HistoryChartPoint[] {
  return points.map((p) => ({ periodEnd: p.periodEnd, valueWhole: p.valueWhole, display: p.exactDisplay, scaledDisplay: p.scaledDisplay, label: p.monthLabel }));
}

/**
 * Whether a lazily-fetched panel should (re)issue its fetch, given whether
 * it is currently open/expanded and the PREVIOUS fetch's own result
 * (`undefined` = never resolved — either nothing was ever requested, or a
 * request was in flight when the panel closed and got cancelled before it
 * resolved; `null`/a real value = it resolved, successfully or not).
 *
 * This is the fix for a real bug found in review: the original code used a
 * `useRef` "have I ever started a request" flag that, once set, never reset
 * — so closing the panel BEFORE its fetch resolved permanently wedged it in
 * the loading state (the cancelled fetch's `setData` never ran, `data`
 * stayed `undefined` forever, and the ref being already-true blocked every
 * future reopen from trying again). Keying the guard off `data` itself
 * instead — rather than a side-channel "did I ask" ref — means a request
 * that got cancelled before it resolved leaves `data` at `undefined`, so
 * the NEXT open just tries again, same as if nothing had ever been
 * requested. A completed request (`data` no longer `undefined`) is never
 * retried while the panel stays open — this still fetches at most once per
 * successful/failed resolution, matching every other lazy-fetch panel in
 * this file.
 *
 * Exported as a pure predicate specifically so the open→close→reopen
 * sequence is unit-testable without mounting React at all (this repo's test
 * setup has no jsdom/RTL — see vitest.config.ts's own doc comment).
 */
export function shouldIssueLazyFetch(open: boolean, data: unknown): boolean {
  return open && data === undefined;
}

/**
 * "Compare the big five" (Act I only, spending-history-scrub Frame B): a
 * disclosure button beside the ranked outlays chart that, on first open,
 * lazily fetches GET /api/category-compare (never inlined eagerly, same
 * lazy-fetch convention HistoryPanelV2's own /api/category-history fetch
 * above already established) and renders @penny/viz's CategoryCompareChart
 * — the five fixed categories plus a gray, dashed "everything else"
 * aggregate (off by default; its own legend chip turns it on), with the
 * server-computed spike annotation wired straight through from the
 * route's own display strings (never a literal figure in this file — the
 * no-hardcoded-stats sweep enforces that).
 */
function CategoryComparePanel() {
  const [open, setOpen] = useState(false);
  // `undefined` = not yet requested (or a previous request was cancelled
  // before it resolved — see shouldIssueLazyFetch's own doc comment);
  // `null` = the fetch resolved with nothing usable (a failed request, or a
  // non-OK response) — the honest "could not load" state, never a
  // fabricated chart.
  const [data, setData] = useState<CategoryCompareApiResponse | null | undefined>(undefined);

  useEffect(() => {
    if (!shouldIssueLazyFetch(open, data)) return;
    let cancelled = false;
    fetch("/api/category-compare")
      .then((res) => (res.ok ? (res.json() as Promise<CategoryCompareApiResponse>) : null))
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, data]);

  const chartSeries =
    data &&
    data.series.map((s) => {
      const fixed = BIG_FIVE_COLOR_VARS.find((c) => c.id === s.id);
      return {
        id: s.id,
        label: s.label,
        color: `var(${fixed ? fixed.colorVar : REST_COLOR_VAR})`,
        dashed: !fixed,
        defaultHidden: !fixed,
        points: toChartPoints(s.twelveMonthTotal),
      };
    });

  return (
    <div className="rank-compare">
      <button type="button" className="rank-compare-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? "Hide the big five comparison" : "Compare the big five"}
      </button>
      {open && (
        <div className="rank-compare-panel">
          {data === undefined ? (
            <div className="rank-hist rank-hist--pending" aria-busy="true">
              Loading the five largest spending categories…
            </div>
          ) : data === null || !chartSeries ? (
            <div className="rank-hist rank-hist--empty">Could not load the comparison chart.</div>
          ) : (
            <div className="rank-hist">
              <div className="rank-hist-title">The five largest categories, plus everything else — 12-month totals</div>
              <CategoryCompareChart series={chartSeries} annotation={data.annotation} />
              <p className="src">
                Source: {data.citation.agency},{" "}
                <a href={data.citation.datasetUrl} target="_blank" rel="noopener noreferrer">
                  {data.citation.dataset} ↗
                </a>
                , 12-month totals. Everything else sums the other published outlay functions, including the negative
                undistributed offsetting receipts. Accessed {data.citation.accessedDisplay}.{" "}
                {data.annotation && (
                  <>
                    This chart plots outlays, not the deficit (outlays minus receipts — a different figure). Writing
                    about the {data.annotation.windowLabel} deficits, the Congressional Budget Office said:
                    &ldquo;{data.cboCitation.sentence}&rdquo; (
                    <a href={data.cboCitation.url} target="_blank" rel="noopener noreferrer">
                      {data.cboCitation.title} ↗
                    </a>
                    ).
                  </>
                )}
              </p>
            </div>
          )}
        </div>
      )}
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
  compareBigFive = false,
}: RankedBarChartProps) {
  const [period, setPeriod] = useState<PeriodKey>(defaultPeriod);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // The v2 full-history line chart, fetched lazily per category (never all
  // ~27 up front — see this file's module doc and GET /api/category-history).
  // `undefined` = not yet requested (or a previous request for this id was
  // cancelled before it resolved — see shouldIssueLazyFetch's own doc
  // comment); `null` = fetched, and either the category has 4-or-fewer
  // months (fall back to the dot plot) or the request failed (same honest
  // fallback, never a fabricated chart).
  const [fetchedFull, setFetchedFull] = useState<Record<string, CategoryHistoryLineSeries | null>>({});

  useEffect(() => {
    if (!expandedId) return;
    if (!shouldIssueLazyFetch(true, fetchedFull[expandedId])) return;
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
  }, [expandedId, fetchedFull]);

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
      {compareBigFive && <CategoryComparePanel />}
    </div>
  );
}
