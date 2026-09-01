import type { RecentAuctionRow } from "@/lib/auction-transform";

export interface AuctionRecentTableProps {
  readonly rows: readonly RecentAuctionRow[];
}

/**
 * "The last month of coupon auctions" (beat 4): date, security (reopenings
 * labeled), high yield (— when null), bid-to-cover, and an indirect-share
 * mini bar + percent. Every row comes from lib/auction-transform.ts's
 * `buildRecentAuctionRows` — this component only lays out markup.
 */
export default function AuctionRecentTable({ rows }: AuctionRecentTableProps) {
  if (rows.length === 0) {
    return <div className="auc-empty">No coupon auctions have resulted in the last 30 days.</div>;
  }

  return (
    <div className="auc-table-wrap">
      <table className="auc-table">
        <thead>
          <tr>
            <th scope="col">Auctioned</th>
            <th scope="col">Security</th>
            <th scope="col" className="num">
              High yield
            </th>
            <th scope="col" className="num">
              Bid-to-cover
            </th>
            <th scope="col">Indirect share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.auctionDate}-${r.securityLabel}`}>
              <td>{r.dateDisplay}</td>
              <td>{r.securityLabel}</td>
              <td className="num">{r.highYieldDisplay}</td>
              <td className="num">{r.bidToCoverDisplay}</td>
              <td>
                {r.indirectShareWidthPercent > 0 && <span className="auc-indbar" style={{ width: `${Math.max(r.indirectShareWidthPercent, 4)}px` }} aria-hidden="true" />}
                {r.indirectShareDisplay}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
