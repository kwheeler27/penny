/**
 * Integration tests against a real (in-memory PGlite) database — proves the
 * full pipeline (lib/auctions-data.ts's queries against @penny/db's real
 * `auction` table/query helpers, through lib/auction-transform.ts's pure
 * builders) actually works end-to-end, not just against hand-built
 * fixtures (mirrors test/series-data.test.ts's own convention). `getDb()`
 * resolves to a fresh in-memory PGlite under vitest, seeded once in
 * beforeAll and read (never mutated) by every `it()` below.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, auction, type NewAuction } from "@penny/db";
import { ensureMigrated } from "../lib/db";
import {
  getAuctionsPageData,
  getLatestResultedCouponAuction,
  getOriginalAuctionForReopening,
  getOriginalAuctionsForUpcomingReopenings,
  getRecentCouponAuctions,
  getUpcomingAuctions,
} from "../lib/auctions-data";
import { reopeningFamilyKey } from "../lib/auction-transform";

function row(overrides: Partial<NewAuction> = {}): NewAuction {
  return {
    cusip: "91282CJZ0",
    securityType: "Note",
    securityTerm: "7-Year",
    originalSecurityTerm: "7-Year",
    auctionDate: "2026-08-27",
    issueDate: "2026-09-02",
    announcementDate: "2026-08-20",
    // total_accepted is the GRAND total (offering_amount + soma_accepted),
    // per TreasuryDirect's real publication convention — see
    // lib/auction-transform.ts's buildBuyerMix doc comment.
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
    publicationTime: new Date("2026-08-27T13:05:00.000Z"),
    ...overrides,
  };
}

// A 7-year family history, one auction per month, Jul 2025 -> Aug 2026 (14
// auctions total, ascending) — distinct cusips so the (cusip, auction_date)
// unique index is never violated.
const SEVEN_YEAR_FAMILY: NewAuction[] = [
  { auctionDate: "2025-07-29", bidToCover: "2.79", highYield: "4.092", cusip: "91282CFX1" },
  { auctionDate: "2025-08-28", bidToCover: "2.49", highYield: "4.05", cusip: "91282CGE2" },
  { auctionDate: "2025-09-25", bidToCover: "2.40", highYield: "3.95", cusip: "91282CGN2" },
  { auctionDate: "2025-10-28", bidToCover: "2.46", highYield: "3.90", cusip: "91282CGW2" },
  { auctionDate: "2025-11-26", bidToCover: "2.46", highYield: "3.78", cusip: "91282CHE3" },
  { auctionDate: "2025-12-24", bidToCover: "2.51", highYield: "3.95", cusip: "91282CHN3" },
  { auctionDate: "2026-01-29", bidToCover: "2.45", highYield: "4.05", cusip: "91282CHW3" },
  { auctionDate: "2026-02-26", bidToCover: "2.50", highYield: "3.90", cusip: "91282CJC4" },
  { auctionDate: "2026-03-26", bidToCover: "2.43", highYield: "4.20", cusip: "91282CJL4" },
  { auctionDate: "2026-04-28", bidToCover: "2.51", highYield: "4.35", cusip: "91282CJU4" },
  { auctionDate: "2026-05-28", bidToCover: "2.52", highYield: "4.42", cusip: "91282CKB4" },
  { auctionDate: "2026-06-25", bidToCover: "2.50", highYield: "4.40", cusip: "91282CKK4" },
  { auctionDate: "2026-07-28", bidToCover: "2.49", highYield: "4.48", cusip: "91282CKT4" },
  { auctionDate: "2026-08-27", bidToCover: "2.50", highYield: "4.512", cusip: "91282CJZ0" }, // latest
].map((o) => row(o));

const OTHER_RECENT: NewAuction[] = [
  row({
    cusip: "91282CJY3",
    securityType: "Note",
    securityTerm: "5-Year",
    originalSecurityTerm: "5-Year",
    auctionDate: "2026-08-26",
    highYield: "4.393",
    bidToCover: "2.37",
  }),
  row({
    cusip: "91282CJX5",
    securityType: "Bill",
    securityTerm: "4-Week",
    originalSecurityTerm: "17-Week",
    auctionDate: "2026-08-27",
    status: "resulted",
    offeringAmount: "90000000000",
    totalAccepted: "90000000000",
    highYield: null,
    highDiscountRate: "4.10",
    bidToCover: "2.90",
  }), // a Bill — must NEVER surface in the coupon-only queries
];

const UPCOMING: NewAuction[] = [
  row({
    cusip: "TBA1",
    securityType: "Note",
    securityTerm: "10-Year",
    originalSecurityTerm: "10-Year",
    auctionDate: "2026-08-12",
    status: "resulted",
    offeringAmount: "42000000000",
    totalAccepted: "42000000000",
    highYield: "4.683",
    bidToCover: "2.53",
  }), // the ORIGINAL 10-year, already resulted — resolves the reopening annotation below
  row({
    cusip: "TBA2",
    securityType: "Note",
    securityTerm: "9-Year 11-Month",
    originalSecurityTerm: "10-Year",
    auctionDate: "2026-09-09",
    status: "announced",
    offeringAmount: null,
    totalAccepted: null,
    highYield: null,
    bidToCover: null,
  }), // the reopening — should annotate "(the August 10-year, reopened)"
  row({
    cusip: "TBA3",
    securityType: "Bill",
    securityTerm: "17-Week",
    originalSecurityTerm: "17-Week",
    auctionDate: "2026-09-02",
    status: "announced",
    offeringAmount: "72000000000",
    totalAccepted: null,
  }),
];

beforeAll(async () => {
  await ensureMigrated();
  const db = getDb();
  await db.insert(auction).values([...SEVEN_YEAR_FAMILY, ...OTHER_RECENT, ...UPCOMING]);
});

describe("getLatestResultedCouponAuction", () => {
  it("finds the most recent resulted Note/Bond, excluding Bills even when a Bill auctioned the same day", async () => {
    const latest = await getLatestResultedCouponAuction();
    expect(latest).not.toBeNull();
    expect(latest!.cusip).toBe("91282CJZ0");
    expect(latest!.securityType).toBe("Note");
    expect(latest!.auctionDate).toBe("2026-08-27");
  });
});

describe("getRecentCouponAuctions / getUpcomingAuctions", () => {
  it("includes Notes but excludes Bills from the recent coupon window", async () => {
    const recent = await getRecentCouponAuctions("2026-08-01");
    expect(recent.some((a) => a.securityType === "Bill")).toBe(false);
    expect(recent.some((a) => a.cusip === "91282CJY3")).toBe(true); // the 5-year Note
    expect(recent.some((a) => a.cusip === "91282CJZ0")).toBe(true); // the latest 7-year
  });

  it("includes every announced security type, bills included", async () => {
    const upcoming = await getUpcomingAuctions("2026-08-01");
    expect(upcoming.some((a) => a.securityType === "Bill")).toBe(true);
    expect(upcoming.some((a) => a.cusip === "TBA2")).toBe(true);
  });
});

describe("getOriginalAuctionForReopening / getOriginalAuctionsForUpcomingReopenings", () => {
  it("resolves the original (non-reopened) auction for a real reopening", async () => {
    const original = await getOriginalAuctionForReopening({ securityType: "Note", originalSecurityTerm: "10-Year" }, "2026-09-09");
    expect(original).not.toBeNull();
    expect(original!.cusip).toBe("TBA1");
    expect(original!.auctionDate).toBe("2026-08-12");
  });

  it("batches the lookup across every upcoming row's family", async () => {
    const upcoming = await getUpcomingAuctions("2026-08-01");
    const map = await getOriginalAuctionsForUpcomingReopenings(upcoming);
    const reopening = upcoming.find((a) => a.cusip === "TBA2")!;
    expect(map.get(reopeningFamilyKey(reopening))?.cusip).toBe("TBA1");
  });
});

describe("getAuctionsPageData", () => {
  it("assembles a complete page from real seeded rows: tiles, buyer mix, takeaway, 14-point history, recent and upcoming tables", async () => {
    const data = await getAuctionsPageData();

    expect(data.latest?.cusip).toBe("91282CJZ0");
    expect(data.tiles?.soldDisplay).toBe("$44.0B");
    expect(data.tiles?.highYieldDisplay).toBe("4.512%");
    expect(data.tiles?.bidToCoverSubtitle).toContain("14-auction average");
    expect(data.historySubtitle).toBe("14 7-year auctions, July 2025 → August 2026 — all real results.");

    expect(data.buyerMix?.hasSoma).toBe(true);
    expect(data.buyerMix?.segments.map((s) => s.key)).toContain("soma");

    expect(data.takeaway).toContain("The Treasury sold $44.0B of 7-year notes");
    expect(data.takeaway).toContain("The Fed's SOMA rolled $5.7B");

    expect(data.bidToCoverPoints).toHaveLength(14);
    expect(data.bidToCoverPoints.at(-1)?.isLatest).toBe(true);
    expect(data.bidToCoverAverageDisplay).not.toBeNull();

    expect(data.highYieldPoints).toHaveLength(14);
    expect(data.highYieldCaption).toContain("4.512%");

    expect(data.recentRows.some((r) => r.securityLabel.includes("5-Year"))).toBe(true);
    expect(data.recentRows.some((r) => r.securityLabel.includes("Bill"))).toBe(false);

    const reopeningGroup = data.upcomingGroups.find((g) => g.auctionDate === "2026-09-09");
    expect(reopeningGroup?.securitiesLabel).toBe("9-Yr 11-Mo Note (the August 10-year, reopened)");
    expect(reopeningGroup?.sizeDisplay).toBe("TBA");

    expect(data.citation.dataset).toBe("TreasuryDirect Securities Auctions Data API");
    expect(data.citation.citation).toContain(data.accessDate);
  });
});
