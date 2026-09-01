import Link from "next/link";
import type { UpcomingAuctionGroup } from "@/lib/auction-transform";

export interface AuctionUpcomingTableProps {
  readonly groups: readonly UpcomingAuctionGroup[];
}

/**
 * "Coming up" (beat 4): the published calendar, one row per auction date,
 * securities grouped per day, announced size or "TBA". Every group comes
 * from lib/auction-transform.ts's `buildUpcomingGroups` — this component
 * only lays out markup, plus the static "bills are the metronome" note
 * (approved-mockup copy, unconditional prose, not a statistic).
 */
export default function AuctionUpcomingTable({ groups }: AuctionUpcomingTableProps) {
  if (groups.length === 0) {
    return <div className="auc-empty">No published auction calendar has been ingested yet.</div>;
  }

  return (
    <>
      <div className="auc-table-wrap">
        <table className="auc-table">
          <thead>
            <tr>
              <th scope="col">Auction date</th>
              <th scope="col">Security</th>
              <th scope="col" className="num">
                Announced size
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.auctionDate}>
                <td>{g.dateDisplay}</td>
                <td>{g.securitiesLabel}</td>
                <td className="num">{g.sizeDisplay}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="auc-bills-note">
        The bills are the metronome: hundreds of billions re-borrowed every single week, mostly rolling over
        maturing bills — the weekly rhythm behind{" "}
        <Link href="/#cadence">&ldquo;When does the money move?&rdquo;</Link>. The notes and bonds above them are
        where the year&rsquo;s new borrowing mostly lands.
      </div>
    </>
  );
}
