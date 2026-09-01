import LatestAuctionCard from "@/components/latest-auction-card";
import AuctionHistoryCharts from "@/components/auction-history-charts";
import AuctionRecentTable from "@/components/auction-recent-table";
import AuctionUpcomingTable from "@/components/auction-upcoming-table";
import { getAuctionsPageData } from "@/lib/auctions-data";
import { formatDateHuman } from "@/lib/format";

// Matches the front door's own ISR window (lib/front-door-data.ts) — new
// auction results/announcements land at most a few times a week, so a
// 15-minute revalidation window is generous, not stale.
export const revalidate = 900;

// Page names are officially TBD (ORCHESTRATION_PROMPT.md) — this metadata
// title deliberately mirrors the H1's own plain-language framing rather
// than baking in the word "Auctions" beyond the nav label.
export const metadata = { title: "Who lends to the government" };

export default async function AuctionsPage() {
  const data = await getAuctionsPageData();
  const accessDisplay = formatDateHuman(data.accessDate);

  const recentDates = data.recentRows.map((r) => r.auctionDate); // sorted most-recent-first by buildRecentAuctionRows
  const recentRangeLabel =
    recentDates.length === 0
      ? null
      : recentDates[0] === recentDates[recentDates.length - 1]
        ? formatDateHuman(recentDates[0]!)
        : `${formatDateHuman(recentDates[recentDates.length - 1]!)}–${formatDateHuman(recentDates[0]!)}`;

  return (
    <div className="page">
      <div className="prose-width auc-hero">
        <div className="auc-kicker">The story · beat 4</div>
        <h1>Who lends to the government, and at what price?</h1>
        <p className="page-lede">
          Every week the Treasury sells new debt at auction — the deficit, financed in public, on a published
          calendar. This page keeps the running record: the latest result, how demand compares with that
          security&rsquo;s own history, and what&rsquo;s coming next.
        </p>
      </div>

      <section className="section">
        <div className="prose-width">
          <h2>The latest coupon auction</h2>
        </div>
        <LatestAuctionCard latest={data.latest} tiles={data.tiles} buyerMix={data.buyerMix} takeaway={data.takeaway} citation={data.citation} accessDate={data.accessDate} />
      </section>

      <section className="section">
        <div className="prose-width">
          <h2>This security&rsquo;s own history</h2>
          <p className="sub">The only fair comparison for an auction is the same security&rsquo;s previous auctions.</p>
        </div>
        <AuctionHistoryCharts
          historySubtitle={data.historySubtitle}
          bidToCoverPoints={data.bidToCoverPoints}
          bidToCoverAverageValue={data.bidToCoverAverageValue}
          bidToCoverAverageDisplay={data.bidToCoverAverageDisplay}
          bidToCoverCaption={data.bidToCoverCaption}
          highYieldPoints={data.highYieldPoints}
          highYieldCaption={data.highYieldCaption}
        />
        {(data.bidToCoverPoints.length > 0 || data.highYieldPoints.length > 0) && (
          <p className="src">
            Source: {data.citation.agency},{" "}
            <a href={data.citation.datasetUrl} target="_blank" rel="noopener noreferrer">
              {data.citation.dataset} ↗
            </a>
            {data.historyCitationRangeLabel ? `, ${data.historyCitationRangeLabel}` : ""}. Accessed {accessDisplay}.
          </p>
        )}
      </section>

      <section className="section">
        <div className="prose-width">
          <h2>The last month of coupon auctions</h2>
          <p className="sub">
            Notes, bonds, TIPS, and floating-rate notes from the past 30 days — bills run on their own weekly
            cadence, covered below.
          </p>
        </div>
        <AuctionRecentTable rows={data.recentRows} />
        <p className="src">
          Source: {data.citation.agency},{" "}
          <a href={data.citation.datasetUrl} target="_blank" rel="noopener noreferrer">
            {data.citation.dataset} ↗
          </a>
          {recentRangeLabel ? `, auctions of ${recentRangeLabel}` : ""}. Accessed {accessDisplay}. Yields for
          inflation-indexed (TIPS) and floating-rate (FRN) securities follow their own conventions, distinct from a
          nominal Note or Bond&rsquo;s yield — shown per the published record and labeled by security type in the
          table above.
        </p>
      </section>

      <section className="section">
        <div className="prose-width">
          <h2>Coming up</h2>
          <p className="sub">The published calendar — announced sizes where the announcement is out, &ldquo;TBA&rdquo; until then.</p>
        </div>
        <AuctionUpcomingTable groups={data.upcomingGroups} />
        <p className="src">
          Source: {data.citation.agency},{" "}
          <a href={data.citation.datasetUrl} target="_blank" rel="noopener noreferrer">
            {data.citation.dataset} ↗
          </a>
          , upcoming auctions. Accessed {accessDisplay}.
        </p>
      </section>
    </div>
  );
}
