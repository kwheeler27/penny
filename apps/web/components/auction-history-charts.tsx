import { AuctionDotChartClient, AuctionLineChartClient } from "./auction-charts-client";
import type { AuctionChartPoint } from "@/lib/auction-transform";

export interface AuctionHistoryChartsProps {
  readonly historySubtitle: string;
  readonly bidToCoverPoints: readonly AuctionChartPoint[];
  readonly bidToCoverAverageValue: number | null;
  readonly bidToCoverAverageDisplay: string | null;
  readonly bidToCoverCaption: string;
  readonly highYieldPoints: readonly AuctionChartPoint[];
  readonly highYieldCaption: string;
}

const BID_TO_COVER_TICK_FORMAT = { decimals: 1, suffix: "×" };
const HIGH_YIELD_TICK_FORMAT = { decimals: 1, suffix: "%" };

/**
 * "This security's own history" (beat 4): the bid-to-cover dot-per-auction
 * chart with a trailing-average dashed line, and the high-yield line —
 * both @penny/viz components, fed already-computed points from
 * lib/auction-transform.ts. Renders each chart's own graceful gap state
 * independently, since a family can have a bid-to-cover reading history
 * without (yet) a full high-yield one, or vice versa.
 */
export default function AuctionHistoryCharts({
  historySubtitle,
  bidToCoverPoints,
  bidToCoverAverageValue,
  bidToCoverAverageDisplay,
  bidToCoverCaption,
  highYieldPoints,
  highYieldCaption,
}: AuctionHistoryChartsProps) {
  if (bidToCoverPoints.length === 0 && highYieldPoints.length === 0) {
    return <div className="auc-empty">No trailing auction history has been ingested yet for this security&rsquo;s family.</div>;
  }

  const referenceLabel = bidToCoverAverageDisplay ? `${bidToCoverPoints.length}-auction average ${bidToCoverAverageDisplay}` : null;

  return (
    <>
      {historySubtitle && <p className="sub">{historySubtitle}</p>}
      <div className="auc-charts2">
        <div className="auc-chart">
          <div className="auc-chart-title">Demand: bid-to-cover, dot per auction</div>
          {bidToCoverPoints.length > 0 ? (
            <AuctionDotChartClient
              points={bidToCoverPoints}
              color="var(--series-borrowing)"
              referenceValue={bidToCoverAverageValue}
              referenceLabel={referenceLabel}
              valueTickFormat={BID_TO_COVER_TICK_FORMAT}
              ariaLabel={`Bid-to-cover ratio across ${bidToCoverPoints.length} auctions`}
            />
          ) : (
            <div className="auc-chart-empty">No bid-to-cover history yet.</div>
          )}
          {bidToCoverCaption && <div className="auc-chart-cap">{bidToCoverCaption}</div>}
        </div>
        <div className="auc-chart">
          <div className="auc-chart-title">Price of borrowing: high yield at auction</div>
          {highYieldPoints.length > 0 ? (
            <AuctionLineChartClient
              points={highYieldPoints}
              color="var(--series-receipts)"
              valueTickFormat={HIGH_YIELD_TICK_FORMAT}
              ariaLabel={`High yield at auction across ${highYieldPoints.length} auctions`}
            />
          ) : (
            <div className="auc-chart-empty">No high-yield history yet.</div>
          )}
          {highYieldCaption && <div className="auc-chart-cap">{highYieldCaption}</div>}
        </div>
      </div>
    </>
  );
}
