"use client";

/**
 * Act I / Act II shared chart: a period toggle (fiscal-year-to-date / latest
 * month), ranked bars with an exact-value tooltip and a share-of-total
 * label, and a click-to-expand history panel per category. All the data
 * this component renders was already computed server-side, from the
 * database, by lib/front-door-data.ts — this file only assembles markup and
 * owns two pieces of purely-interactive UI state (which period is showing,
 * which row is expanded). Bar/dot pixel geometry below uses Number() on an
 * already-exact whole-dollar string, which is fine for a COSMETIC
 * proportion (never for a displayed figure) — see
 * packages/viz/src/money/decimal.ts's documented convention, which this
 * component follows.
 */
import type { CSSProperties } from "react";
import { useState } from "react";
import type { CategoryHistoryPanel, HistoryPoint, RankedPeriod } from "@/lib/front-door-transform";

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
        without a policy change. The full monthly history (FiscalData serves every month back to 2015) arrives with
        the backfill; this panel then becomes a real line chart with 12-month smoothing.
      </div>
    </div>
  );
}

export default function RankedBarChart({ idPrefix, colorVar, toggleLabels, periods, histories, footNote, monthOnlyNote }: RankedBarChartProps) {
  const [period, setPeriod] = useState<PeriodKey>("fytd");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const current = periods[period];

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
      <div className="rank-chart">
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
                {expanded && (panel ? <HistoryPanel label={row.label} panel={panel} /> : <div className="rank-hist rank-hist--empty">No history ingested yet for this category.</div>)}
              </div>
            );
          })}
        </div>
        <div className="rank-total">{current.totalDisplay}</div>
        {footNote && <div className="rank-foot">{footNote}</div>}
        {period === "month" && monthOnlyNote && <div className={footNote ? "rank-foot rank-foot--note" : "rank-foot"}>{monthOnlyNote}</div>}
      </div>
    </div>
  );
}
