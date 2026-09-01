import type { CSSProperties } from "react";
import type { BridgeData } from "@/lib/front-door-transform";

/**
 * Act III's outlays/receipts/gap bridge. Widths are cosmetic pixel
 * proportions (BridgeData.smallerPercentOfLarger/gapPercentOfLarger,
 * computed once in lib/front-door-transform.ts from exact decimal values,
 * always in [0, 100]) — every displayed figure (outlaysDisplay/
 * receiptsDisplay/gapDisplay/debtTrillionsDisplay) is exact decimal
 * arithmetic.
 *
 * Never assumes a deficit: `bridge.direction` (derived from the sign of the
 * gap, the same way the hero strip's own deficit/surplus cell is) decides
 * which of outlays/receipts is the 100%-width top bar, which color each row
 * gets, and what the gap row is called — a surplus period renders as
 * honestly as a deficit period, not as a hardcoded "spending exceeded
 * revenue" with a bar geometry that only works when it did.
 *
 * Uses the `backgroundColor` longhand (never the `background` shorthand) in
 * every inline style below: React's `style` prop wins over any external
 * stylesheet rule for the same longhand property, so a shorthand
 * `background: ...` here would silently zero out `.bridge-bar--hatch`'s
 * `background-image` from globals.css and the hatch pattern would never
 * paint.
 */
export default function FiscalBridge({ bridge }: { bridge: BridgeData | null }) {
  if (!bridge) {
    return <div className="bridge-empty">No fiscal-year-to-date report has been ingested yet.</div>;
  }

  const isSurplus = bridge.direction === "surplus";
  const topLabel = isSurplus ? "Receipts" : "Outlays";
  const topDisplay = isSurplus ? bridge.receiptsDisplay : bridge.outlaysDisplay;
  const topColor = isSurplus ? "var(--series-receipts)" : "var(--series-outlays)";
  const bottomLabel = isSurplus ? "Outlays" : "Receipts";
  const bottomDisplay = isSurplus ? bridge.outlaysDisplay : bridge.receiptsDisplay;
  const bottomColor = isSurplus ? "var(--series-outlays)" : "var(--series-receipts)";
  const gapLabel = bridge.direction === "deficit" ? "Borrowing fills the rest" : bridge.direction === "surplus" ? "Left over — the surplus" : "No gap — receipts matched outlays";
  const gapColor = bridge.direction === "surplus" ? "var(--series-receipts)" : "var(--series-borrowing)";

  const bottomStyle: CSSProperties = { left: 0, width: `${bridge.smallerPercentOfLarger}%`, backgroundColor: bottomColor };
  const gapStyle: CSSProperties = {
    left: `${bridge.smallerPercentOfLarger}%`,
    width: `${bridge.gapPercentOfLarger}%`,
    backgroundColor: gapColor,
  };

  return (
    <div className="bridge">
      <div className="bridge-row">
        <div className="bridge-lab">{topLabel}</div>
        <div className="bridge-track">
          <div className="bridge-bar" style={{ left: 0, width: "100%", backgroundColor: topColor }}>
            <span className="bridge-inlab">{topDisplay}</span>
          </div>
        </div>
      </div>
      <div className="bridge-row">
        <div className="bridge-lab">{bottomLabel}</div>
        <div className="bridge-track">
          <div className="bridge-bar" style={bottomStyle}>
            <span className="bridge-inlab">{bottomDisplay}</span>
          </div>
          <div className="bridge-gap-brace" style={{ left: `${bridge.smallerPercentOfLarger}%` }} />
        </div>
      </div>
      <div className="bridge-row">
        <div className="bridge-lab">{gapLabel}</div>
        <div className="bridge-track">
          <div className="bridge-bar bridge-bar--hatch" style={gapStyle}>
            <span className="bridge-inlab">{bridge.gapDisplay}</span>
          </div>
        </div>
      </div>
      <div className="bridge-note">
        {bridge.direction === "deficit" && (
          <>
            Borrowing like this, accumulated over time, is what the debt measures: total public debt outstanding
            stood at <b>{bridge.debtTrillionsDisplay}</b> on {bridge.debtAsOfDisplay}.
          </>
        )}
        {bridge.direction === "surplus" && (
          <>
            A single period&rsquo;s surplus doesn&rsquo;t erase the debt: total public debt outstanding — built up
            over decades — still stood at <b>{bridge.debtTrillionsDisplay}</b> on {bridge.debtAsOfDisplay}.
          </>
        )}
        {bridge.direction === "balanced" && (
          <>
            Total public debt outstanding stood at <b>{bridge.debtTrillionsDisplay}</b> on {bridge.debtAsOfDisplay}.
          </>
        )}
      </div>
    </div>
  );
}
