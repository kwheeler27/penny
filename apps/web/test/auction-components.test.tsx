/**
 * Component-markup tests for the auction page's presentational pieces —
 * rendered to static HTML via react-dom/server, matching test/registry-
 * figure.test.tsx's convention (no jsdom/RTL in this repo's test setup).
 * Every component here is pure props-in/markup-out (no DB access of its
 * own), so these are hand-built fixtures, not database-backed.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LatestAuctionCard from "../components/latest-auction-card";
import AuctionHistoryCharts from "../components/auction-history-charts";
import AuctionRecentTable from "../components/auction-recent-table";
import AuctionUpcomingTable from "../components/auction-upcoming-table";
import type { AuctionRecord } from "../lib/auction-types";
import {
  buildBidToCoverCaption,
  buildBidToCoverPoints,
  buildBuyerMix,
  buildHighYieldCaption,
  buildHighYieldPoints,
  buildLatestAuctionTiles,
  buildRecentAuctionRow,
  buildTakeawaySentence,
  buildUpcomingGroups,
  trailingAverage,
} from "../lib/auction-transform";

function auction(overrides: Partial<AuctionRecord> = {}): AuctionRecord {
  return {
    cusip: "91282CJZ0",
    securityType: "Note",
    securityTerm: "7-Year",
    originalSecurityTerm: "7-Year",
    auctionDate: "2026-08-27",
    issueDate: "2026-09-02",
    announcementDate: "2026-08-20",
    // total_accepted is the GRAND total (offering_amount + soma_accepted) —
    // see lib/auction-transform.ts's buildBuyerMix doc comment.
    offeringAmount: "44000000000",
    totalAccepted: "49700000000",
    bidToCover: "2.50",
    highYield: "4.512",
    highDiscountRate: null,
    highDiscountMargin: null,
    primaryDealerAccepted: "5200000000",
    directBidderAccepted: "10500000000",
    indirectBidderAccepted: "28200000000",
    noncompetitiveAccepted: "100000000",
    somaAccepted: "5700000000",
    status: "resulted",
    sourceUrl: "https://www.treasurydirect.gov/TA_WS/securities/search?cusip=91282CJZ0",
    publicationTime: "2026-08-27T13:05:00.000Z",
    ...overrides,
  };
}

const CITATION = {
  agency: "U.S. Department of the Treasury, Bureau of the Fiscal Service",
  dataset: "TreasuryDirect Securities Auctions Data API",
  datasetUrl: "https://www.treasurydirect.gov/auctions/auction-query/",
  citation: "U.S. Department of the Treasury, Bureau of the Fiscal Service, TreasuryDirect Securities Auctions Data API. Accessed 2026-09-01.",
};

describe("LatestAuctionCard", () => {
  it("renders the gap state, never a fabricated card, when nothing has resulted yet", () => {
    const html = renderToStaticMarkup(<LatestAuctionCard latest={null} tiles={null} buyerMix={null} takeaway="" citation={CITATION} accessDate="2026-09-01" />);
    expect(html).toContain("No coupon auction has resulted yet");
    expect(html).not.toContain("auc-tile");
  });

  it("renders tiles, the buyer-mix bar with a hatched SOMA segment beyond a divider, the takeaway, definitions, and the citation", () => {
    const latest = auction();
    const tiles = buildLatestAuctionTiles(latest, ["2.79", "2.49", "2.40"]);
    const buyerMix = buildBuyerMix(latest)!;
    const takeaway = buildTakeawaySentence(latest, []);
    const html = renderToStaticMarkup(<LatestAuctionCard latest={latest} tiles={tiles} buyerMix={buyerMix} takeaway={takeaway} citation={CITATION} accessDate="2026-09-01" />);

    expect(html).toContain("7-Year Note");
    expect(html).toContain("$44.0B");
    expect(html).toContain("4.512%");
    expect(html).toContain("2.50×");
    expect(html).toContain("auc-mixbar-divider");
    expect(html).toContain("auc-mixbar-hatch");
    expect(html).toContain("SOMA");
    expect(html).toContain("The Treasury sold $44.0B of 7-year notes at a high yield of 4.512%");
    expect(html).toContain("as an add-on."); // the escaped apostrophe in "Fed's" makes a raw substring match on the full sentence unreliable
    expect(html).toContain("What these buyer classes mean");
    expect(html).toContain("Primary dealers");
    expect(html).toContain("TreasuryDirect Securities Auctions Data API");
  });

  it("never renders a null tile as a fabricated number — a real em dash, never $0/0%", () => {
    const latest = auction({ offeringAmount: null, totalAccepted: null, highYield: null, bidToCover: null, somaAccepted: null });
    const tiles = buildLatestAuctionTiles(latest, []);
    const html = renderToStaticMarkup(<LatestAuctionCard latest={latest} tiles={tiles} buyerMix={buildBuyerMix(latest)} takeaway={buildTakeawaySentence(latest, [])} citation={CITATION} accessDate="2026-09-01" />);
    expect(html).toContain("auc-tile-v--gap");
    expect(html).not.toMatch(/\$0\b/);
  });
});

describe("AuctionHistoryCharts", () => {
  const family = [
    auction({ auctionDate: "2025-07-29", bidToCover: "2.79", highYield: "4.092", cusip: "a" }),
    auction({ auctionDate: "2025-08-28", bidToCover: "2.49", highYield: "4.05", cusip: "b" }),
    auction(), // latest
  ];

  it("renders the gap state when there is no family history at all", () => {
    const html = renderToStaticMarkup(
      <AuctionHistoryCharts historySubtitle="" bidToCoverPoints={[]} bidToCoverAverageValue={null} bidToCoverAverageDisplay={null} bidToCoverCaption="" highYieldPoints={[]} highYieldCaption="" />,
    );
    expect(html).toContain("No trailing auction history");
  });

  it("renders both charts with focusable, individually-labeled points and a visually-hidden table fallback (issue #7)", () => {
    const bidToCoverPoints = buildBidToCoverPoints(family, "2026-08-27");
    const highYieldPoints = buildHighYieldPoints(family, "2026-08-27");
    const avg = trailingAverage(bidToCoverPoints.map((p) => p.valueWhole));
    const html = renderToStaticMarkup(
      <AuctionHistoryCharts
        historySubtitle="3 7-year auctions, July 2025 → August 2026 — all real results."
        bidToCoverPoints={bidToCoverPoints}
        bidToCoverAverageValue={avg != null ? Number(avg) : null}
        bidToCoverAverageDisplay={avg != null ? `${avg}×` : null}
        bidToCoverCaption={buildBidToCoverCaption(bidToCoverPoints, avg != null ? `${avg}×` : null)}
        highYieldPoints={highYieldPoints}
        highYieldCaption={buildHighYieldCaption(highYieldPoints)}
      />,
    );

    // Every point is independently focusable with its own accessible name —
    // never hover-only via a bare <title>.
    expect(html).toContain('tabindex="0"');
    expect((html.match(/tabindex="0"/g) || []).length).toBeGreaterThanOrEqual(6); // 3 bid-to-cover + 3 high-yield points
    expect(html).toContain("July 29, 2025: 2.79×");
    expect(html).toContain("August 27, 2026: 4.512%");
    // The redundant, screen-reader-native table fallback.
    expect(html).toContain("<table");
    expect(html).toContain("<caption");
    expect(html).toContain("July 2025");
  });
});

describe("AuctionRecentTable", () => {
  it("renders the gap state for an empty window", () => {
    const html = renderToStaticMarkup(<AuctionRecentTable rows={[]} />);
    expect(html).toContain("No coupon auctions have resulted");
  });

  it("renders an em dash for a null high yield and labels a reopening", () => {
    const row = buildRecentAuctionRow(auction({ highYield: null, securityTerm: "1-Year 11-Month", originalSecurityTerm: "2-Year" }));
    const html = renderToStaticMarkup(<AuctionRecentTable rows={[row]} />);
    expect(html).toContain("—");
    expect(html).toContain("(reopening)");
    expect(html).not.toContain("null");
  });
});

describe("AuctionUpcomingTable", () => {
  it("renders the gap state for an empty calendar", () => {
    const html = renderToStaticMarkup(<AuctionUpcomingTable groups={[]} />);
    expect(html).toContain("No published auction calendar");
  });

  it("renders grouped securities, a collapsed single TBA, and the bills-metronome note linking back to the cadence section", () => {
    const groups = buildUpcomingGroups(
      [
        auction({ securityType: "Bill", securityTerm: "4-Week", originalSecurityTerm: "4-Week", auctionDate: "2026-09-03", offeringAmount: "90000000000" }),
        auction({ securityType: "Bill", securityTerm: "8-Week", originalSecurityTerm: "8-Week", auctionDate: "2026-09-03", offeringAmount: "85000000000" }),
      ],
      new Map(),
    );
    const html = renderToStaticMarkup(<AuctionUpcomingTable groups={groups} />);
    expect(html).toContain("4-Week Bill · 8-Week Bill");
    expect(html).toContain("$90B · $85B");
    expect(html).toContain('href="/#cadence"');
    expect(html).toContain("metronome");
  });
});
