import type { CSSProperties } from "react";
import type { DeficitChart } from "@/lib/front-door-transform";

/** Act III's monthly deficit/surplus column chart — every column, its
 * height, and its color are derived server-side from DeficitChart (built
 * from real DB readings in lib/front-door-data.ts); this component only
 * lays out divs. Column height is a cosmetic pixel proportion (Number() on
 * an already-exact whole-dollar string), never a displayed figure — the
 * displayed figure is DeficitColumn.scaledDisplay, computed via exact
 * decimal arithmetic in lib/front-door-transform.ts. */
export default function DeficitHistoryChart({ chart }: { chart: DeficitChart | null }) {
  if (!chart || chart.columns.length === 0) {
    return <div className="defchart-empty">No monthly deficit history has been ingested yet.</div>;
  }
  const maxAbs = Math.max(1, ...chart.columns.map((c) => Math.abs(Number(c.valueWhole))));

  return (
    <div className="defchart">
      <div className="defchart-title">The gap, month by month — {chart.monthCount} months of it</div>
      <div className="defchart-cols">
        {chart.columns.map((c) => {
          const h = (Math.abs(Number(c.valueWhole)) / maxAbs) * 50;
          const barStyle: CSSProperties = c.isDeficit
            ? { top: "50%", height: `${h}%`, background: "var(--series-outlays)" }
            : { bottom: "50%", height: `${h}%`, background: "var(--series-receipts)" };
          return (
            <div key={c.periodEnd} className="defchart-colwrap" title={`${c.monthLabel}: ${c.isDeficit ? "deficit" : "surplus"} ${c.scaledDisplay}`}>
              <div className="defchart-col" style={barStyle} />
            </div>
          );
        })}
      </div>
      <div className="defchart-axis">
        {chart.axisLabels.map((label, i) => (
          <span key={`${label}-${i}`}>{label}</span>
        ))}
      </div>
      <div className="defchart-cap">
        Orange months ran a deficit; blue months ran a surplus. {chart.surplusCaption} Hover any month for its
        figure. Source: Monthly Treasury Statement, monthly deficit/surplus, {chart.columns[0]?.monthLabel}–
        {chart.columns[chart.columns.length - 1]?.monthLabel}.
      </div>
    </div>
  );
}
