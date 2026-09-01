/**
 * Pure unit tests for lib/auction-transform.ts — no database, hand-built
 * fixtures only (mirrors test/front-door-transform.test.ts's convention).
 * Fixture shapes echo the approved mockup's real Sep 1, 2026 7-year-note
 * data (penny-auction-page.html) purely as realistic numbers to exercise
 * against — nothing here is asserted to reproduce the mockup's own prose
 * verbatim; the real page must never hardcode any of it (see
 * test/no-hardcoded-stats.test.ts's auctions sweep).
 */
import { describe, expect, it } from "vitest";
import type { AuctionRecord } from "../lib/auction-types";
import {
  buildBidToCoverCaption,
  buildBidToCoverPoints,
  buildBuyerMix,
  buildHighYieldCaption,
  buildHighYieldPoints,
  buildHistorySubtitle,
  buildLatestAuctionTiles,
  buildRecentAuctionRow,
  buildRecentAuctionRows,
  buildTakeawaySentence,
  buildUpcomingGroups,
  buildUpcomingSecurityLabel,
  formatDateShortNoYear,
  humanSecurityTypeWord,
  reopeningFamilyKey,
  securityLabel,
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
    // total_accepted is the GRAND total per TreasuryDirect's real
    // publication convention — offering_amount ($44.0B, what the four
    // competitive buyer classes below sum to) PLUS soma_accepted ($5.7B) —
    // never offering_amount alone (see lib/auction-transform.ts's own
    // comment on buildBuyerMix, verified live 2026-09-01 against real
    // Note/Bond rows).
    offeringAmount: "44000000000",
    totalAccepted: "49700000000",
    bidToCover: "2.50",
    highYield: "4.512",
    highDiscountRate: null,
    highDiscountMargin: null,
    // Sums exactly to totalAccepted (44.0B) — primary + direct + indirect +
    // noncompetitive must reach the announced total for the mix bar's four
    // competitive segments to fill their share of the 100% denominator
    // correctly; only the separate SOMA add-on sits beyond it.
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

// The mockup's real 14-auction 7-year window, oldest first, EXCLUDING the
// latest (Aug 27, 2026) — used as `priorFamily` throughout.
const PRIOR_FAMILY: AuctionRecord[] = [
  { auctionDate: "2025-07-29", bidToCover: "2.79", highYield: "4.092" },
  { auctionDate: "2025-08-28", bidToCover: "2.49", highYield: "4.05" },
  { auctionDate: "2025-09-25", bidToCover: "2.40", highYield: "3.95" },
  { auctionDate: "2025-10-28", bidToCover: "2.46", highYield: "3.90" },
  { auctionDate: "2025-11-26", bidToCover: "2.46", highYield: "3.78" },
  { auctionDate: "2025-12-24", bidToCover: "2.51", highYield: "3.95" },
  { auctionDate: "2026-01-29", bidToCover: "2.45", highYield: "4.05" },
  { auctionDate: "2026-02-26", bidToCover: "2.50", highYield: "3.90" },
  { auctionDate: "2026-03-26", bidToCover: "2.43", highYield: "4.20" },
  { auctionDate: "2026-04-28", bidToCover: "2.51", highYield: "4.35" },
  { auctionDate: "2026-05-28", bidToCover: "2.52", highYield: "4.42" },
  { auctionDate: "2026-06-25", bidToCover: "2.50", highYield: "4.40" },
  { auctionDate: "2026-07-28", bidToCover: "2.49", highYield: "4.48" },
].map((o) => auction({ ...o, indirectBidderAccepted: "22000000000", totalAccepted: "44000000000", somaAccepted: "0" }));

describe("securityLabel / humanSecurityTypeWord", () => {
  it("labels a plain (non-reopened) Note by its original term", () => {
    expect(securityLabel(auction())).toBe("7-Year Note");
  });

  it("labels a new-issue (non-reopened) TIPS or FRN with its OWN type word, never relabeled as a nominal Note/Bond", () => {
    // A TIPS's "high yield" is a real yield and an FRN's is a discount
    // margin — a completely different convention than a nominal Note/Bond's
    // yield. Collapsing either into "Note"/"Bond" with no marker put a real
    // yield in the same unlabeled column as nominal yields (real fixture:
    // CUSIP 91282CRE3, a 10-Year TIPS, rendered as "10-Year Note").
    expect(securityLabel(auction({ securityType: "TIPS", securityTerm: "10-Year", originalSecurityTerm: "10-Year" }))).toBe("10-Year TIPS");
    expect(securityLabel(auction({ securityType: "FRN", securityTerm: "2-Year", originalSecurityTerm: "2-Year" }))).toBe("2-Year FRN");
    expect(securityLabel(auction({ securityType: "TIPS", securityTerm: "30-Year", originalSecurityTerm: "30-Year" }))).toBe("30-Year TIPS");
  });

  it("labels a Note/Bond reopening with the abbreviated term and a plain qualifier", () => {
    const a = auction({ securityType: "Note", securityTerm: "1-Year 11-Month", originalSecurityTerm: "2-Year" });
    expect(securityLabel(a)).toBe("1-Yr 11-Mo Note (reopening)");
  });

  it("labels a TIPS reopening as a Bond with a TIPS-specific qualifier, per term length", () => {
    const a = auction({ securityType: "TIPS", securityTerm: "29-Year 6-Month", originalSecurityTerm: "30-Year" });
    expect(securityLabel(a)).toBe("29-Yr 6-Mo Bond (TIPS reopening)");
    expect(humanSecurityTypeWord(a)).toBe("Bond");
  });

  it("resolves a TIPS/FRN's Note-vs-Bond word from its original term length (<=10yr Note, >10yr Bond)", () => {
    expect(humanSecurityTypeWord(auction({ securityType: "TIPS", originalSecurityTerm: "10-Year" }))).toBe("Note");
    expect(humanSecurityTypeWord(auction({ securityType: "TIPS", originalSecurityTerm: "5-Year" }))).toBe("Note");
    expect(humanSecurityTypeWord(auction({ securityType: "FRN", originalSecurityTerm: "2-Year" }))).toBe("Note");
    expect(humanSecurityTypeWord(auction({ securityType: "TIPS", originalSecurityTerm: "20-Year" }))).toBe("Bond");
  });

  it("passes a Bill's type word through unchanged", () => {
    expect(humanSecurityTypeWord(auction({ securityType: "Bill", originalSecurityTerm: "17-Week" }))).toBe("Bill");
  });

  it("labels a Bill by its own actual securityTerm, never its coarser originalSecurityTerm family bucket", () => {
    // Real shape (verified live 2026-09-01): a "17-Week" original-term
    // family's rows carry their own real current tenor as securityTerm —
    // 4-Week and 8-Week bills auctioned the same week must read as their
    // own tenor, never collapse to the family's "17-Week" bucket.
    expect(securityLabel(auction({ securityType: "Bill", securityTerm: "4-Week", originalSecurityTerm: "17-Week" }))).toBe("4-Week Bill");
    expect(securityLabel(auction({ securityType: "Bill", securityTerm: "8-Week", originalSecurityTerm: "17-Week" }))).toBe("8-Week Bill");
    expect(securityLabel(auction({ securityType: "Bill", securityTerm: "17-Week", originalSecurityTerm: "17-Week" }))).toBe("17-Week Bill");
  });

  it("never treats a Bill/CMB's mismatched original_security_term as a reopening signal (a coarser bucket, not the same security — @penny/db schema doc)", () => {
    // A real shape per packages/db's own doc comment: a "17-Week"
    // original-term family also contains 4-Week and 8-Week security_term
    // rows — different bills entirely, not reopenings of one another.
    const fourWeekBill = auction({ securityType: "Bill", securityTerm: "4-Week", originalSecurityTerm: "17-Week" });
    expect(securityLabel(fourWeekBill)).toBe("4-Week Bill");
    expect(securityLabel(fourWeekBill)).not.toContain("reopening");

    const cmb = auction({ securityType: "CMB", securityTerm: "8-Day", originalSecurityTerm: "42-Day" });
    expect(securityLabel(cmb)).not.toContain("reopening");
  });
});

describe("buildUpcomingSecurityLabel", () => {
  it("derives the richer '(the {month} {term}, reopened)' form when the original auction is known", () => {
    const reopening = auction({ securityType: "Note", securityTerm: "9-Year 11-Month", originalSecurityTerm: "10-Year", auctionDate: "2026-09-09" });
    const original = auction({ securityType: "Note", securityTerm: "10-Year", originalSecurityTerm: "10-Year", auctionDate: "2026-08-12" });
    expect(buildUpcomingSecurityLabel(reopening, original)).toBe("9-Yr 11-Mo Note (the August 10-year, reopened)");
  });

  it("falls back to the plain qualifier when the original auction isn't known — never invents a month", () => {
    const reopening = auction({ securityType: "Note", securityTerm: "9-Year 11-Month", originalSecurityTerm: "10-Year" });
    expect(buildUpcomingSecurityLabel(reopening, null)).toBe(securityLabel(reopening));
    expect(buildUpcomingSecurityLabel(reopening, undefined)).toBe(securityLabel(reopening));
  });

  it("is a no-op for a non-reopening regardless of what's passed as `original`", () => {
    const fresh = auction();
    expect(buildUpcomingSecurityLabel(fresh, auction({ auctionDate: "2020-01-01" }))).toBe(securityLabel(fresh));
  });
});

describe("buildBuyerMix", () => {
  it("computes each buyer-class segment's share against the competitive SUBTOTAL (total accepted minus SOMA), never the SOMA-inclusive total", () => {
    const mix = buildBuyerMix(auction());
    expect(mix).not.toBeNull();
    // Subtotal = 49.7B total_accepted - 5.7B soma = 44.0B, matching the
    // announced offering — Treasury's own results-release convention (the
    // "Subtotal" line bid-to-cover is computed against).
    expect(mix!.subtotalDisplay).toBe("$44.0B");
    const keys = mix!.segments.map((s) => s.key);
    expect(keys).toEqual(["primary", "direct", "indirect", "noncompetitive", "soma"]);
    // Primary 5.2B / 44.0B subtotal.
    expect(mix!.segments.find((s) => s.key === "primary")!.shareDisplay).toBe("11.8%");
    // Indirect 28.2B / 44.0B subtotal.
    expect(mix!.segments.find((s) => s.key === "indirect")!.shareDisplay).toBe("64.1%");
    const soma = mix!.segments.find((s) => s.key === "soma")!;
    expect(soma.hatch).toBe(true);
    // SOMA's own share is stated as a percent of the OFFERING (5.7B / 44.0B
    // offering) — never the subtotal or the SOMA-inclusive total, since it
    // isn't competing demand (CLAUDE.md: accounting concepts never mix
    // silently).
    expect(soma.shareDisplay).toBe("13.0%");
    // Segment WIDTHS stay proportional to the SOMA-inclusive total_accepted
    // (cosmetic pixel proportions only — never a displayed figure),
    // preserving the approved mockup's visual bar composition unchanged.
    const widthSum = mix!.segments.reduce((s, seg) => s + seg.widthPercent, 0);
    expect(widthSum).toBeCloseTo(100, 0);
  });

  it("omits a buyer class with no reading, rather than drawing a false zero segment", () => {
    const mix = buildBuyerMix(auction({ noncompetitiveAccepted: null }));
    expect(mix!.segments.map((s) => s.key)).not.toContain("noncompetitive");
  });

  it("omits the SOMA segment entirely for a null OR a genuine zero SOMA reading", () => {
    expect(buildBuyerMix(auction({ somaAccepted: null }))!.hasSoma).toBe(false);
    expect(buildBuyerMix(auction({ somaAccepted: "0" }))!.hasSoma).toBe(false);
  });

  it("returns null (a whole-card gap) when there's no totalAccepted to divide by", () => {
    expect(buildBuyerMix(auction({ totalAccepted: null }))).toBeNull();
  });

  it("returns null when SOMA consumes the entire total accepted, leaving no positive competitive subtotal", () => {
    expect(buildBuyerMix(auction({ totalAccepted: "5700000000", somaAccepted: "5700000000" }))).toBeNull();
  });
});

describe("buildLatestAuctionTiles", () => {
  it("builds the sold/high-yield/bid-to-cover tiles with the SOMA add-on noted on the sold subtitle", () => {
    const tiles = buildLatestAuctionTiles(auction(), PRIOR_FAMILY.map((p) => p.bidToCover!));
    expect(tiles.soldDisplay).toBe("$44.0B");
    expect(tiles.soldSubtitle).toBe("announced offering · +$5.7B SOMA add-on");
    expect(tiles.highYieldDisplay).toBe("4.512%");
    expect(tiles.bidToCoverDisplay).toBe("2.50×");
    expect(tiles.bidToCoverSubtitle).toContain("$2.50 of bids per $1 accepted");
    expect(tiles.bidToCoverSubtitle).toContain("14-auction average: 2.50×");
  });

  it("omits the SOMA clause from the sold subtitle when there's no add-on", () => {
    const tiles = buildLatestAuctionTiles(auction({ somaAccepted: null }), []);
    expect(tiles.soldSubtitle).toBe("announced offering");
  });

  it("renders every tile as a gap (null) when the underlying reading is null", () => {
    const tiles = buildLatestAuctionTiles(auction({ offeringAmount: null, totalAccepted: null, highYield: null, bidToCover: null }), []);
    expect(tiles.soldDisplay).toBeNull();
    expect(tiles.highYieldDisplay).toBeNull();
    expect(tiles.bidToCoverDisplay).toBeNull();
  });
});

describe("trailingAverage", () => {
  it("computes an exact mean via BigInt division, never float drift", () => {
    expect(trailingAverage(["1", "2"])).toBe("1.5000");
    expect(trailingAverage(["0.1", "0.2"])).toBe("0.1500");
  });

  it("returns null for an empty list — never a fabricated average of nothing", () => {
    expect(trailingAverage([])).toBeNull();
  });
});

describe("buildTakeawaySentence", () => {
  const latest = auction();

  it("composes all four clauses from the mockup-shaped fixture, citing a plausible past-year comparator", () => {
    const text = buildTakeawaySentence(latest, PRIOR_FAMILY);
    expect(text).toContain("The Treasury sold $44.0B of 7-year notes at a high yield of 4.512%");
    expect(text).toContain("highest for this security in at least the past year");
    // Cites whichever prior auction actually held the window's previous-high
    // figure (the fixture's yields trend upward toward the latest auction,
    // so that's the most recent prior point, not the oldest one) — the
    // generator must cite the TRUE runner-up, not assume it's the oldest.
    expect(text).toMatch(/\(\w+ 2026: 4\.480%\)/);
    expect(text).toContain("Bidders offered $2.50 for every $1 accepted");
    expect(text).toContain("this security's average of");
    expect(text).toContain("across its last 14 auctions");
    expect(text).toContain("Indirect bidders took");
    expect(text).toContain("14-auction average share of");
    expect(text).toContain("The Fed's SOMA rolled $5.7B of maturing holdings into the new note as an add-on.");
  });

  it("never claims a superlative when the window doesn't span at least a year", () => {
    const shortWindow = PRIOR_FAMILY.slice(-2); // last 2 auctions only, ~2 months of span
    const text = buildTakeawaySentence(latest, shortWindow);
    expect(text).not.toContain("in at least the past year");
    expect(text).toContain("The Treasury sold $44.0B of 7-year notes at a high yield of 4.512%.");
  });

  it("never claims a superlative when the latest yield isn't actually the window's extreme", () => {
    // latest (4.512%) sits between the window's min and max here.
    const midRange = auction({ highYield: "4.10" });
    const text = buildTakeawaySentence(midRange, PRIOR_FAMILY);
    expect(text).not.toContain("in at least the past year");
    // Always 3 decimals, matching Treasury's own published convention and
    // this generator's other yield figures (e.g. "4.512%") — never trimmed
    // to "4.1%" just because the trailing digits happen to be zero.
    expect(text).toContain("high yield of 4.100%");
  });

  it("omits the yield clause entirely for a reopening with no published high_yield", () => {
    const reopening = auction({ highYield: null });
    const text = buildTakeawaySentence(reopening, PRIOR_FAMILY);
    expect(text).not.toContain("high yield");
    expect(text).toContain("The Treasury sold $44.0B of 7-year notes.");
  });

  it("omits the SOMA sentence for a null SOMA reading and for a genuine zero reading", () => {
    expect(buildTakeawaySentence(auction({ somaAccepted: null }), PRIOR_FAMILY)).not.toContain("SOMA");
    expect(buildTakeawaySentence(auction({ somaAccepted: "0" }), PRIOR_FAMILY)).not.toContain("SOMA");
  });

  it("states both numbers when the latest bid-to-cover matches the trailing average exactly", () => {
    const matching = auction({ bidToCover: "2.50" });
    const flatFamily = PRIOR_FAMILY.map((p) => ({ ...p, bidToCover: "2.50" }));
    const text = buildTakeawaySentence(matching, flatFamily);
    expect(text).toContain("matching this security's average of $2.50");
  });

  it("never says 'above'/'below' when the latest and the average round to the SAME displayed figure (compares at display precision, not exact precision)", () => {
    // Exact mean 2.5007 (14 auctions averaging to a hair above 2.50) vs. a
    // latest reading of exactly 2.5000 — both display as "$2.50", so calling
    // one "below" the other reads as a contradiction ("$2.50 ... below ...
    // average of $2.50" — a real bug caught against the 7-Year/30-Year/
    // 5-Year families).
    const nearFlatFamily = PRIOR_FAMILY.map((p, i) => ({ ...p, bidToCover: i === 0 ? "2.5098" : "2.50" })); // mean of the 14 values (13 at 2.50 + latest 2.50) with one nudged prior = 2.5007
    const text = buildTakeawaySentence(auction({ bidToCover: "2.50" }), nearFlatFamily);
    expect(text).toContain("matching this security's average of $2.50");
    expect(text).not.toMatch(/\$2\.50 .*(above|below) this security's average of \$2\.50/);
  });

  it("computes the indirect-bidder share and its trailing average against the competitive SUBTOTAL, never the SOMA-inclusive total — the SOMA-heavy latest auction reads 'above' its trailing average here, the OPPOSITE of what the SOMA-inclusive total_accepted basis would say", () => {
    // Latest: indirect 28.2B, soma 5.7B, total_accepted 49.7B -> subtotal
    // 44.0B. Share of subtotal = 64.09%. Share of the SOMA-inclusive total
    // would instead be 56.74% — LOWER than the flat 50% prior average,
    // which would flip this specific comparison to "below" instead of
    // "above" (the exact reversal shape the real 10-Year/3-Year/30-Year
    // families exhibited).
    const text = buildTakeawaySentence(auction(), PRIOR_FAMILY);
    expect(text).toContain("Indirect bidders took 64.1% of the amount accepted competitively, above their 14-auction average share of");
  });

  it("degrades gracefully to plain single-figure sentences when there is no prior family history at all", () => {
    const text = buildTakeawaySentence(latest, []);
    expect(text).toContain("The Treasury sold $44.0B of 7-year notes at a high yield of 4.512%.");
    expect(text).toContain("Bidders offered $2.50 for every $1 accepted.");
    expect(text).not.toContain("average");
  });

  it("never contains any banned adjective, in any case, across a wide sweep of inputs", () => {
    const BANNED = /\b(weak|strong|solid|soft|robust|tepid)\w*\b/i;
    const cases: [AuctionRecord, AuctionRecord[]][] = [
      [latest, PRIOR_FAMILY],
      [latest, []],
      [auction({ highYield: null }), PRIOR_FAMILY],
      [auction({ bidToCover: null }), PRIOR_FAMILY],
      [auction({ indirectBidderAccepted: null }), PRIOR_FAMILY],
      [auction({ somaAccepted: null }), PRIOR_FAMILY],
      [auction({ highYield: "2.79" }), PRIOR_FAMILY], // forces the "lowest" branch
      [auction({ highYield: "10" }), PRIOR_FAMILY], // forces the "highest" branch
      [auction({ totalAccepted: null, highYield: null, bidToCover: null, indirectBidderAccepted: null, somaAccepted: null }), PRIOR_FAMILY],
    ];
    for (const [a, prior] of cases) {
      const text = buildTakeawaySentence(a, prior);
      expect(text).not.toMatch(BANNED);
    }
  });
});

describe("chart point builders", () => {
  const family = [...PRIOR_FAMILY, auction()]; // ascending, latest last

  it("marks exactly the latest auction date as isLatest, and drops points with no reading", () => {
    const btc = buildBidToCoverPoints(family, "2026-08-27");
    expect(btc).toHaveLength(14);
    expect(btc.filter((p) => p.isLatest)).toHaveLength(1);
    expect(btc.find((p) => p.isLatest)!.date).toBe("2026-08-27");
    expect(btc[0]!.display).toBe("2.79×");

    const withGap = buildBidToCoverPoints([...family, auction({ auctionDate: "2026-09-24", bidToCover: null })], "2026-08-27");
    expect(withGap).toHaveLength(14); // the null-bidToCover row is dropped, not zero-filled
  });

  it("formats high-yield points to 3 decimals with a percent sign", () => {
    const yieldPoints = buildHighYieldPoints(family, "2026-08-27");
    expect(yieldPoints[yieldPoints.length - 1]!.display).toBe("4.512%");
  });
});

describe("caption builders", () => {
  it("states the chronological window and average for the bid-to-cover caption, never an 'outlier' characterization", () => {
    const points = buildBidToCoverPoints([...PRIOR_FAMILY, auction()], "2026-08-27");
    const caption = buildBidToCoverCaption(points, "2.50×");
    expect(caption).toContain("14 auctions shown");
    expect(caption).toContain("July 2025");
    expect(caption).toContain("August 2026");
    expect(caption).toContain("2.50×");
    expect(caption.toLowerCase()).not.toContain("outlier");
  });

  it("states first-to-last chronologically for the high-yield caption, without asserting a min/max claim", () => {
    const points = buildHighYieldPoints([...PRIOR_FAMILY, auction()], "2026-08-27");
    const caption = buildHighYieldCaption(points);
    expect(caption).toContain("4.092%");
    expect(caption).toContain("4.512%");
  });

  it("returns an empty string, never a broken sentence, for an empty point list", () => {
    expect(buildBidToCoverCaption([], null)).toBe("");
    expect(buildHighYieldCaption([])).toBe("");
  });
});

describe("buildRecentAuctionRow / buildRecentAuctionRows", () => {
  it("renders a null high yield as an em dash, never a fabricated figure", () => {
    const row = buildRecentAuctionRow(auction({ highYield: null, securityType: "Note", securityTerm: "1-Year 11-Month", originalSecurityTerm: "2-Year" }));
    expect(row.highYieldDisplay).toBe("—");
    expect(row.securityLabel).toBe("1-Yr 11-Mo Note (reopening)");
  });

  it("sorts rows most-recent-first regardless of input order", () => {
    const rows = buildRecentAuctionRows([auction({ auctionDate: "2026-08-12" }), auction({ auctionDate: "2026-08-27" }), auction({ auctionDate: "2026-08-19" })]);
    expect(rows.map((r) => r.auctionDate)).toEqual(["2026-08-27", "2026-08-19", "2026-08-12"]);
  });
});

describe("buildUpcomingGroups", () => {
  it("groups multiple securities on the same date into one row, joining labels and sizes in order", () => {
    const groups = buildUpcomingGroups(
      [
        auction({ securityType: "Bill", originalSecurityTerm: "4-Week", securityTerm: "4-Week", auctionDate: "2026-09-03", offeringAmount: "90000000000" }),
        auction({ securityType: "Bill", originalSecurityTerm: "8-Week", securityTerm: "8-Week", auctionDate: "2026-09-03", offeringAmount: "85000000000" }),
      ],
      new Map(),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.securitiesLabel).toBe("4-Week Bill · 8-Week Bill");
    expect(groups[0]!.sizeDisplay).toBe("$90B · $85B");
  });

  it("collapses to a single 'TBA' when every security that day is TBA, rather than repeating it per security", () => {
    const groups = buildUpcomingGroups(
      [
        auction({ securityType: "Bill", originalSecurityTerm: "6-Week", securityTerm: "6-Week", auctionDate: "2026-09-08", offeringAmount: null }),
        auction({ securityType: "Note", originalSecurityTerm: "3-Year", securityTerm: "3-Year", auctionDate: "2026-09-08", offeringAmount: null }),
      ],
      new Map(),
    );
    expect(groups[0]!.sizeDisplay).toBe("TBA");
  });

  it("resolves the reopening annotation from the supplied original-auction map, keyed by term+type", () => {
    const reopening = auction({ securityType: "Note", securityTerm: "9-Year 11-Month", originalSecurityTerm: "10-Year", auctionDate: "2026-09-09", offeringAmount: null });
    const original = auction({ securityType: "Note", securityTerm: "10-Year", originalSecurityTerm: "10-Year", auctionDate: "2026-08-12" });
    const map = new Map([[reopeningFamilyKey(reopening), original]]);
    const groups = buildUpcomingGroups([reopening], map);
    expect(groups[0]!.securitiesLabel).toBe("9-Yr 11-Mo Note (the August 10-year, reopened)");
  });

  it("sorts groups ascending by date", () => {
    const groups = buildUpcomingGroups([auction({ auctionDate: "2026-09-10" }), auction({ auctionDate: "2026-09-02" })], new Map());
    expect(groups.map((g) => g.auctionDate)).toEqual(["2026-09-02", "2026-09-10"]);
  });
});

describe("buildHistorySubtitle", () => {
  it("states the count and real chronological window, WITHOUT repeating the page's own static 'only fair comparison' framing", () => {
    const family = [...PRIOR_FAMILY, auction()];
    const subtitle = buildHistorySubtitle(family);
    expect(subtitle).toBe("14 7-year auctions, July 2025 → August 2026 — all real results.");
    // app/auctions/page.tsx already renders this sentence as static copy
    // right above this subtitle — repeating it here produced a visible
    // duplicate line on the real page (caught via a real screenshot).
    expect(subtitle).not.toContain("only fair comparison");
  });

  it("returns an empty string for an empty family", () => {
    expect(buildHistorySubtitle([])).toBe("");
  });
});

describe("formatDateShortNoYear", () => {
  it("formats without a year, zero-padding never leaking through", () => {
    expect(formatDateShortNoYear("2026-09-02")).toBe("Sep 2");
    expect(formatDateShortNoYear("2026-08-27")).toBe("Aug 27");
  });
});
