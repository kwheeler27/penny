import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, type PennyDb } from "../src/client";
import { runMigrations } from "../src/migrate";
import { seedAuctionFixtures } from "../src/seed";
import { auction, type NewAuction } from "../src/schema";
import {
  auctionFamilyKey,
  auctionFamilyTerm,
  getAuctionFamilyHistory,
  getLatestResultedAuction,
  getRecentResultedAuctions,
  getUpcomingAuctions,
  getAuctionByCusipAndDate,
} from "../src/queries/auctions";

async function freshDb(): Promise<PennyDb> {
  const db = createDb();
  await runMigrations(db);
  return db;
}

let cusipCounter = 0;
/** A resulted auction row with sensible defaults, one field at a time overridable — every test that doesn't care about a specific column gets a self-consistent, always-unique-cusip row for free. */
function row(overrides: Partial<NewAuction> = {}): NewAuction {
  cusipCounter += 1;
  return {
    cusip: `TESTCUSIP${cusipCounter}`,
    securityType: "Note",
    securityTerm: "10-Year",
    originalSecurityTerm: "10-Year",
    auctionDate: "2026-01-15",
    issueDate: "2026-01-17",
    announcementDate: "2026-01-08",
    offeringAmount: "42000000000",
    totalAccepted: "42000000000",
    bidToCover: "2.500000",
    highYield: "4.500000",
    highDiscountRate: null,
    highDiscountMargin: null,
    primaryDealerAccepted: "10000000000",
    directBidderAccepted: "5000000000",
    indirectBidderAccepted: "25000000000",
    noncompetitiveAccepted: "2000000000",
    somaAccepted: "0",
    status: "resulted",
    sourceUrl: "https://www.treasurydirect.gov/TA_WS/securities/auctioned?days=14",
    publicationTime: new Date("2026-01-15T15:33:00Z"),
    ...overrides,
  };
}

describe("@penny/db auction schema + migration (PGlite)", () => {
  it("migrates cleanly and round-trips a resulted row, numeric columns as exact strings", async () => {
    const db = await freshDb();
    const [inserted] = await db.insert(auction).values(row({ cusip: "912810US5", bidToCover: "2.820000" })).returning();
    const [reread] = await db.select().from(auction).where(eq(auction.cusip, "912810US5"));
    expect(reread?.id).toBe(inserted?.id);
    expect(typeof reread?.offeringAmount).toBe("string");
    expect(reread?.bidToCover).toBe("2.820000");
    expect(reread?.status).toBe("resulted");
  });

  it("rejects a duplicate (cusip, auction_date) — the identity/idempotency key", async () => {
    const db = await freshDb();
    await db.insert(auction).values(row({ cusip: "DUPTEST", auctionDate: "2026-02-01" }));
    await expect(db.insert(auction).values(row({ cusip: "DUPTEST", auctionDate: "2026-02-01" }))).rejects.toThrow();
  });

  it("allows the same cusip on a different auction_date (a reopening under the same CUSIP)", async () => {
    const db = await freshDb();
    await db.insert(auction).values(row({ cusip: "REOPEN1", auctionDate: "2026-02-01" }));
    await expect(db.insert(auction).values(row({ cusip: "REOPEN1", auctionDate: "2026-03-01" }))).resolves.not.toThrow();
  });

  it("an announced row (all result columns null) is a valid insert", async () => {
    const db = await freshDb();
    const [inserted] = await db
      .insert(auction)
      .values(
        row({
          cusip: "ANNOUNCEDONLY",
          status: "announced",
          offeringAmount: null,
          totalAccepted: null,
          bidToCover: null,
          highYield: null,
          highDiscountRate: null,
          highDiscountMargin: null,
          primaryDealerAccepted: null,
          directBidderAccepted: null,
          indirectBidderAccepted: null,
          noncompetitiveAccepted: null,
          somaAccepted: null,
        }),
      )
      .returning();
    expect(inserted?.status).toBe("announced");
    expect(inserted?.totalAccepted).toBeNull();
  });

  it("rejects an unrecognized security_type at the database level (enum, not just app-level validation)", async () => {
    const db = await freshDb();
    await expect(
      db.insert(auction).values({ ...row({ cusip: "BADTYPE" }), securityType: "NotARealType" as never }),
    ).rejects.toThrow();
  });

  it("rejects a null on a required column (issue_date)", async () => {
    const db = await freshDb();
    await expect(
      db.insert(auction).values({ ...row({ cusip: "BADNULL" }), issueDate: null as unknown as string }),
    ).rejects.toThrow();
  });

  it("somaAccepted stores a genuine zero distinctly from null (a real $0 SOMA add-on, not a gap)", async () => {
    const db = await freshDb();
    const [zeroRow] = await db.insert(auction).values(row({ cusip: "SOMAZERO", somaAccepted: "0" })).returning();
    const [nullRow] = await db.insert(auction).values(row({ cusip: "SOMANULL", status: "announced", somaAccepted: null, offeringAmount: null, totalAccepted: null, bidToCover: null, highYield: null, primaryDealerAccepted: null, directBidderAccepted: null, indirectBidderAccepted: null, noncompetitiveAccepted: null })).returning();
    expect(zeroRow?.somaAccepted).toBe("0.00");
    expect(nullRow?.somaAccepted).toBeNull();
  });
});

describe("auctionFamilyKey / auctionFamilyTerm", () => {
  it("Bill and CMB group by security_term (the actual current tenor)", () => {
    expect(auctionFamilyKey("Bill")).toBe("security_term");
    expect(auctionFamilyKey("CMB")).toBe("security_term");
  });

  it("Note/Bond/TIPS/FRN group by original_security_term (the issuing family)", () => {
    expect(auctionFamilyKey("Note")).toBe("original_security_term");
    expect(auctionFamilyKey("Bond")).toBe("original_security_term");
    expect(auctionFamilyKey("TIPS")).toBe("original_security_term");
    expect(auctionFamilyKey("FRN")).toBe("original_security_term");
  });

  it("auctionFamilyTerm reads off the right column per the rule above", () => {
    expect(auctionFamilyTerm({ securityType: "Bill", securityTerm: "4-Week", originalSecurityTerm: "17-Week" })).toBe("4-Week");
    expect(auctionFamilyTerm({ securityType: "Note", securityTerm: "9-Year 11-Month", originalSecurityTerm: "10-Year" })).toBe("10-Year");
  });
});

describe("getAuctionFamilyHistory — the Bill mixed-tenor regression guard", () => {
  it("does NOT mix 4-Week/8-Week/17-Week bills together even though they share original_security_term '17-Week'", async () => {
    const db = await freshDb();
    // Three genuinely different bill tenors, all real reopenings of the same "17-Week" lineage (verified live 2026-09-01 — see schema.ts's doc comment).
    await db.insert(auction).values([
      row({ cusip: "B4WK1", securityType: "Bill", securityTerm: "4-Week", originalSecurityTerm: "17-Week", auctionDate: "2026-01-06" }),
      row({ cusip: "B8WK1", securityType: "Bill", securityTerm: "8-Week", originalSecurityTerm: "17-Week", auctionDate: "2026-01-06" }),
      row({ cusip: "B17WK1", securityType: "Bill", securityTerm: "17-Week", originalSecurityTerm: "17-Week", auctionDate: "2026-01-06" }),
      row({ cusip: "B4WK2", securityType: "Bill", securityTerm: "4-Week", originalSecurityTerm: "17-Week", auctionDate: "2026-01-13" }),
    ]);

    const fourWeekHistory = await getAuctionFamilyHistory(db, { securityType: "Bill", term: "4-Week" });
    expect(fourWeekHistory.map((r) => r.cusip)).toEqual(["B4WK1", "B4WK2"]);
    expect(fourWeekHistory.every((r) => r.securityTerm === "4-Week")).toBe(true);

    const seventeenWeekHistory = await getAuctionFamilyHistory(db, { securityType: "Bill", term: "17-Week" });
    expect(seventeenWeekHistory.map((r) => r.cusip)).toEqual(["B17WK1"]);
  });

  it("Note/Bond DOES group reopenings together under original_security_term, ascending by auction_date", async () => {
    const db = await freshDb();
    await db.insert(auction).values([
      row({ cusip: "N10Y1", securityType: "Note", securityTerm: "10-Year", originalSecurityTerm: "10-Year", auctionDate: "2026-01-22" }),
      row({ cusip: "N10Y2", securityType: "Note", securityTerm: "9-Year 11-Month", originalSecurityTerm: "10-Year", auctionDate: "2026-03-19" }),
      row({ cusip: "N10Y3", securityType: "Note", securityTerm: "9-Year 8-Month", originalSecurityTerm: "10-Year", auctionDate: "2026-05-21" }),
    ]);
    const history = await getAuctionFamilyHistory(db, { securityType: "Note", term: "10-Year" });
    expect(history.map((r) => r.cusip)).toEqual(["N10Y1", "N10Y2", "N10Y3"]); // ascending
  });

  it("a 10-Year TIPS and a 10-Year nominal Note never mix (distinguished by security_type, not term alone)", async () => {
    const db = await freshDb();
    await db.insert(auction).values([
      row({ cusip: "TIPS10Y", securityType: "TIPS", securityTerm: "10-Year", originalSecurityTerm: "10-Year", auctionDate: "2026-01-22" }),
      row({ cusip: "NOTE10Y", securityType: "Note", securityTerm: "10-Year", originalSecurityTerm: "10-Year", auctionDate: "2026-01-22" }),
    ]);
    const tipsHistory = await getAuctionFamilyHistory(db, { securityType: "TIPS", term: "10-Year" });
    expect(tipsHistory.map((r) => r.cusip)).toEqual(["TIPS10Y"]);
  });

  it("excludes announced (not-yet-resulted) rows from a family's history", async () => {
    const db = await freshDb();
    await db.insert(auction).values([
      row({ cusip: "RESULTED1", securityType: "Note", originalSecurityTerm: "10-Year", auctionDate: "2026-01-22", status: "resulted" }),
      row({
        cusip: "ANNOUNCED1",
        securityType: "Note",
        originalSecurityTerm: "10-Year",
        auctionDate: "2026-02-22",
        status: "announced",
        offeringAmount: null,
        totalAccepted: null,
        bidToCover: null,
        highYield: null,
        primaryDealerAccepted: null,
        directBidderAccepted: null,
        indirectBidderAccepted: null,
        noncompetitiveAccepted: null,
        somaAccepted: null,
      }),
    ]);
    const history = await getAuctionFamilyHistory(db, { securityType: "Note", term: "10-Year" });
    expect(history.map((r) => r.cusip)).toEqual(["RESULTED1"]);
  });

  it("respects the limit, keeping the MOST RECENT N (then returning them ascending)", async () => {
    const db = await freshDb();
    await db.insert(auction).values([
      row({ cusip: "L1", securityType: "Note", originalSecurityTerm: "7-Year", auctionDate: "2026-01-01" }),
      row({ cusip: "L2", securityType: "Note", originalSecurityTerm: "7-Year", auctionDate: "2026-02-01" }),
      row({ cusip: "L3", securityType: "Note", originalSecurityTerm: "7-Year", auctionDate: "2026-03-01" }),
    ]);
    const history = await getAuctionFamilyHistory(db, { securityType: "Note", term: "7-Year", limit: 2 });
    expect(history.map((r) => r.cusip)).toEqual(["L2", "L3"]);
  });
});

describe("getLatestResultedAuction", () => {
  it("returns the most recent resulted auction overall", async () => {
    const db = await freshDb();
    await db.insert(auction).values([
      row({ cusip: "OLD1", auctionDate: "2026-01-01" }),
      row({ cusip: "NEW1", auctionDate: "2026-06-01" }),
    ]);
    const latest = await getLatestResultedAuction(db);
    expect(latest?.cusip).toBe("NEW1");
  });

  it("scoped to a family, ignores other families' more-recent auctions", async () => {
    const db = await freshDb();
    await db.insert(auction).values([
      row({ cusip: "SEVENYR1", securityType: "Note", originalSecurityTerm: "7-Year", auctionDate: "2026-01-01" }),
      row({ cusip: "TENYR1", securityType: "Note", originalSecurityTerm: "10-Year", auctionDate: "2026-06-01" }),
    ]);
    const latest = await getLatestResultedAuction(db, { securityType: "Note", term: "7-Year" });
    expect(latest?.cusip).toBe("SEVENYR1");
  });

  it("returns undefined when nothing resulted matches (not a throw)", async () => {
    const db = await freshDb();
    expect(await getLatestResultedAuction(db)).toBeUndefined();
  });
});

describe("getRecentResultedAuctions", () => {
  it("excludes Bills by default (the 'coupon auctions' table)", async () => {
    const db = await freshDb();
    await db.insert(auction).values([
      row({ cusip: "BILLROW", securityType: "Bill", securityTerm: "4-Week", originalSecurityTerm: "17-Week", auctionDate: "2026-06-01" }),
      row({ cusip: "NOTEROW", securityType: "Note", auctionDate: "2026-06-02" }),
    ]);
    const recent = await getRecentResultedAuctions(db, { sinceDate: "2026-01-01" });
    expect(recent.map((r) => r.cusip)).toEqual(["NOTEROW"]);
  });

  it("includeBills: true brings Bills back in, most recent first", async () => {
    const db = await freshDb();
    await db.insert(auction).values([
      row({ cusip: "BILLROW2", securityType: "Bill", securityTerm: "4-Week", originalSecurityTerm: "17-Week", auctionDate: "2026-06-01" }),
      row({ cusip: "NOTEROW2", securityType: "Note", auctionDate: "2026-06-02" }),
    ]);
    const recent = await getRecentResultedAuctions(db, { sinceDate: "2026-01-01", includeBills: true });
    expect(recent.map((r) => r.cusip)).toEqual(["NOTEROW2", "BILLROW2"]);
  });

  it("respects sinceDate", async () => {
    const db = await freshDb();
    await db.insert(auction).values([
      row({ cusip: "TOOOLD", securityType: "Note", auctionDate: "2025-01-01" }),
      row({ cusip: "RECENT", securityType: "Note", auctionDate: "2026-06-01" }),
    ]);
    const recent = await getRecentResultedAuctions(db, { sinceDate: "2026-01-01" });
    expect(recent.map((r) => r.cusip)).toEqual(["RECENT"]);
  });
});

describe("getUpcomingAuctions", () => {
  it("returns only announced rows on/after fromDate, ascending by auction_date", async () => {
    const db = await freshDb();
    const announcedRow = (overrides: Partial<NewAuction>) =>
      row({
        status: "announced",
        offeringAmount: null,
        totalAccepted: null,
        bidToCover: null,
        highYield: null,
        primaryDealerAccepted: null,
        directBidderAccepted: null,
        indirectBidderAccepted: null,
        noncompetitiveAccepted: null,
        somaAccepted: null,
        ...overrides,
      });
    await db.insert(auction).values([
      row({ cusip: "PASTRESULTED", auctionDate: "2026-01-01", status: "resulted" }),
      announcedRow({ cusip: "SOON", auctionDate: "2026-09-08" }),
      announcedRow({ cusip: "LATER", auctionDate: "2026-09-10" }),
      announcedRow({ cusip: "TOOSOON", auctionDate: "2026-08-01" }),
    ]);
    const upcoming = await getUpcomingAuctions(db, { fromDate: "2026-09-01" });
    expect(upcoming.map((r) => r.cusip)).toEqual(["SOON", "LATER"]);
  });
});

describe("seedAuctionFixtures", () => {
  it("loads the real db/fixtures/auctions/*.json snapshot, converting publicationTime to a real Date, both resulted and announced rows present", async () => {
    const db = await freshDb();
    const count = await seedAuctionFixtures(db);
    expect(count).toBeGreaterThan(1000); // the full real snapshot: 1,176 resulted + 9 upcoming.

    const resultedSample = await getAuctionByCusipAndDate(db, "912810US5", "2026-08-20");
    expect(resultedSample?.status).toBe("resulted");
    expect(resultedSample?.publicationTime).toBeInstanceOf(Date);

    // 912797VG9 is a reused CUSIP: it already resulted once (2026-06-08, a
    // 26-Week bill) and is reopened again on 2026-09-08 (13-Week, still
    // TBA at capture time) — the (cusip, auction_date) COMPOUND key is the
    // real identity, never cusip alone. See getAuctionByCusipAndDate.
    const announcedSample = await getAuctionByCusipAndDate(db, "912797VG9", "2026-09-08");
    expect(announcedSample?.status).toBe("announced");
    expect(announcedSample?.offeringAmount).toBeNull();
    const alreadyResultedReopeningOfSameCusip = await getAuctionByCusipAndDate(db, "912797VG9", "2026-06-08");
    expect(alreadyResultedReopeningOfSameCusip?.status).toBe("resulted");
  });

  it("is idempotent: re-running does not duplicate rows", async () => {
    const db = await freshDb();
    const first = await seedAuctionFixtures(db);
    const before = await db.select().from(auction);
    await seedAuctionFixtures(db);
    const after = await db.select().from(auction);
    expect(before.length).toBe(first);
    expect(after.length).toBe(before.length);
  });
});

describe("getAuctionByCusipAndDate", () => {
  it("finds an existing row", async () => {
    const db = await freshDb();
    await db.insert(auction).values(row({ cusip: "FINDME", auctionDate: "2026-05-05" }));
    const found = await getAuctionByCusipAndDate(db, "FINDME", "2026-05-05");
    expect(found?.cusip).toBe("FINDME");
  });

  it("returns undefined (not a throw) when nothing matches", async () => {
    const db = await freshDb();
    expect(await getAuctionByCusipAndDate(db, "NOPE", "2026-05-05")).toBeUndefined();
  });
});
