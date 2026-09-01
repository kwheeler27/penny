import { describe, it, expect } from "vitest";
import { createDb, runMigrations, getAuctionByCusipAndDate } from "@penny/db";
import { upsertAuction, upsertAuctions } from "../src/lib/upsert-auctions";
import type { RawAuction } from "../src/lib/types";

async function freshDb() {
  const db = createDb();
  await runMigrations(db);
  return db;
}

const ANNOUNCED: RawAuction = {
  cusip: "912797TEST",
  securityType: "Bill",
  securityTerm: "17-Week",
  originalSecurityTerm: "17-Week",
  auctionDate: "2026-09-08",
  issueDate: "2026-09-10",
  announcementDate: "2026-09-03",
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
  status: "announced",
  sourceUrl: "https://www.treasurydirect.gov/TA_WS/securities/upcoming",
  publicationTime: "2026-09-01T00:00:00.000Z",
};

const RESULTED: RawAuction = {
  ...ANNOUNCED,
  offeringAmount: "72000000000",
  totalAccepted: "72000000000",
  bidToCover: "2.900000",
  highDiscountRate: "3.700000",
  primaryDealerAccepted: "20000000000",
  directBidderAccepted: "1000000000",
  indirectBidderAccepted: "40000000000",
  noncompetitiveAccepted: "1000000000",
  somaAccepted: "0",
  status: "resulted",
  sourceUrl: "https://www.treasurydirect.gov/TA_WS/securities/auctioned?days=14",
  publicationTime: "2026-09-08T15:33:00.000Z",
};

describe("upsertAuction — announced -> resulted lifecycle", () => {
  it("inserts a fresh announced row", async () => {
    const db = await freshDb();
    const result = await upsertAuction(db, ANNOUNCED);
    expect(result.outcome).toBe("inserted");
    expect(result.statusTransition).toBe(false);

    const row = await getAuctionByCusipAndDate(db, ANNOUNCED.cusip, ANNOUNCED.auctionDate);
    expect(row?.status).toBe("announced");
    expect(row?.offeringAmount).toBeNull();
  });

  it("re-applying the identical announced row is unchanged (no write, same id)", async () => {
    const db = await freshDb();
    const first = await upsertAuction(db, ANNOUNCED);
    const second = await upsertAuction(db, ANNOUNCED);
    expect(second.outcome).toBe("unchanged");
    expect(second.id).toBe(first.id);
  });

  it("the announced -> resulted transition UPDATES the same row (same id), fills in results, and reports statusTransition", async () => {
    const db = await freshDb();
    const announced = await upsertAuction(db, ANNOUNCED);
    const resulted = await upsertAuction(db, RESULTED);

    expect(resulted.outcome).toBe("updated");
    expect(resulted.statusTransition).toBe(true);
    expect(resulted.id).toBe(announced.id); // SAME row — never a second row for the same (cusip, auction_date).

    const row = await getAuctionByCusipAndDate(db, ANNOUNCED.cusip, ANNOUNCED.auctionDate);
    expect(row?.status).toBe("resulted");
    expect(row?.offeringAmount).toBe("72000000000.00");
    expect(row?.bidToCover).toBe("2.900000");
    expect(row?.highDiscountRate).toBe("3.700000");
    expect(row?.highYield).toBeNull();
  });

  it("never destroys the announced record's provenance: ingested_at is untouched by the resulted update", async () => {
    const db = await freshDb();
    await upsertAuction(db, ANNOUNCED);
    const afterAnnounced = await getAuctionByCusipAndDate(db, ANNOUNCED.cusip, ANNOUNCED.auctionDate);
    const firstSeenAt = afterAnnounced?.ingestedAt.getTime();

    await upsertAuction(db, RESULTED);
    const afterResulted = await getAuctionByCusipAndDate(db, ANNOUNCED.cusip, ANNOUNCED.auctionDate);
    expect(afterResulted?.ingestedAt.getTime()).toBe(firstSeenAt);
    // publication_time, in contrast, DID move forward — it tracks the data, not the row's birth.
    expect(afterResulted?.publicationTime.toISOString()).toBe(RESULTED.publicationTime);
  });

  it("re-applying the identical resulted row a second time is unchanged", async () => {
    const db = await freshDb();
    await upsertAuction(db, ANNOUNCED);
    const first = await upsertAuction(db, RESULTED);
    const second = await upsertAuction(db, RESULTED);
    expect(second.outcome).toBe("unchanged");
    expect(second.id).toBe(first.id);
  });

  it("a late correction to an already-resulted row is 'updated' but NOT flagged as a status transition", async () => {
    const db = await freshDb();
    await upsertAuction(db, ANNOUNCED);
    await upsertAuction(db, RESULTED);

    const corrected: RawAuction = { ...RESULTED, bidToCover: "2.950000", publicationTime: "2026-09-09T12:00:00.000Z" };
    const result = await upsertAuction(db, corrected);
    expect(result.outcome).toBe("updated");
    expect(result.statusTransition).toBe(false);

    const row = await getAuctionByCusipAndDate(db, ANNOUNCED.cusip, ANNOUNCED.auctionDate);
    expect(row?.bidToCover).toBe("2.950000");
  });

  it("a value that only differs in trailing-zero formatting is 'unchanged', not a spurious update", async () => {
    const db = await freshDb();
    await upsertAuction(db, ANNOUNCED);
    await upsertAuction(db, RESULTED);

    const reformatted: RawAuction = { ...RESULTED, bidToCover: "2.9000000", publicationTime: "2026-09-09T12:00:00.000Z" };
    const result = await upsertAuction(db, reformatted);
    expect(result.outcome).toBe("unchanged");
  });

  it("different auction_dates for the same cusip never collide (a reopening auctioned again under the same CUSIP)", async () => {
    const db = await freshDb();
    const first = await upsertAuction(db, ANNOUNCED);
    const second = await upsertAuction(db, { ...ANNOUNCED, auctionDate: "2026-10-06", announcementDate: "2026-10-01", issueDate: "2026-10-08" });
    expect(first.id).not.toBe(second.id);
  });
});

describe("upsertAuctions — batch summary", () => {
  it("summarizes inserted/updated/unchanged/statusTransitions across a batch", async () => {
    const db = await freshDb();
    const firstBatch = await upsertAuctions(db, [ANNOUNCED]);
    expect(firstBatch).toMatchObject({ inserted: 1, updated: 0, unchanged: 0, statusTransitions: 0 });

    const secondBatch = await upsertAuctions(db, [RESULTED]);
    expect(secondBatch).toMatchObject({ inserted: 0, updated: 1, unchanged: 0, statusTransitions: 1 });

    const thirdBatch = await upsertAuctions(db, [RESULTED]);
    expect(thirdBatch).toMatchObject({ inserted: 0, updated: 0, unchanged: 1, statusTransitions: 0 });
  });
});
