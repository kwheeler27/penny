/**
 * Field-mapping tests against the REAL captured snapshot
 * (`db/fixtures/raw/treasurydirect/auctioned/2023-12-20_to_2026-08-27.json`,
 * 1,176 rows, live 2026-09-01) — never hand-invented records. See that
 * fixture's SOURCE.md for the verified facts these tests guard.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tdAuctionResponseSchema, parseTdAuctionResponse, TD_SECURITY_TYPES } from "../src/treasurydirect/auction";
import type { RawAuction } from "../src/lib/types";

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/ingest/test -> repo root is three levels up.
const FIXTURE_PATH = join(
  HERE,
  "..",
  "..",
  "..",
  "db",
  "fixtures",
  "raw",
  "treasurydirect",
  "auctioned",
  "2023-12-20_to_2026-08-27.json",
);

const rawJson = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
const records = tdAuctionResponseSchema.parse(rawJson);
const rows: RawAuction[] = parseTdAuctionResponse(records, "https://www.treasurydirect.gov/TA_WS/securities/search?test=1");

function find(cusip: string, auctionDate: string): RawAuction {
  const row = rows.find((r) => r.cusip === cusip && r.auctionDate === auctionDate);
  if (!row) throw new Error(`fixture row not found: ${cusip} / ${auctionDate}`);
  return row;
}

describe("tdAuctionResponseSchema + parseTdAuctionResponse — live fixture", () => {
  it("parses and maps every one of the 1,176 real rows without a schema-validation failure", () => {
    expect(rows).toHaveLength(1176);
  });

  it("hand-checks EVERY column for one real TIPS reopening (912810US5, 2026-08-20 — the 29-Yr 6-Mo TIPS reopening)", () => {
    const row = find("912810US5", "2026-08-20");
    expect(row).toEqual({
      cusip: "912810US5",
      securityType: "TIPS",
      securityTerm: "29-Year 6-Month",
      originalSecurityTerm: "30-Year",
      auctionDate: "2026-08-20",
      issueDate: "2026-08-31",
      announcementDate: "2026-08-13",
      offeringAmount: "8000000000",
      totalAccepted: "9028453400",
      bidToCover: "2.820000",
      highYield: "2.9730",
      highDiscountRate: null,
      highDiscountMargin: null,
      primaryDealerAccepted: "167000000",
      directBidderAccepted: "1068130000",
      indirectBidderAccepted: "6707611400",
      noncompetitiveAccepted: "57266200",
      somaAccepted: "1028445800",
      status: "resulted",
      sourceUrl: "https://www.treasurydirect.gov/TA_WS/securities/search?test=1",
      // updatedTimestamp "2026-08-20T13:03:23" is EDT (UTC-4) -> 17:03:23Z.
      publicationTime: "2026-08-20T17:03:23.000Z",
    });
  });

  it("the shared build-brief test case: the 2026-08-26 1-Yr 11-Mo FRN reopening has bid-to-cover but null high_yield", () => {
    const row = find("91282CRD5", "2026-08-26");
    expect(row.securityType).toBe("FRN");
    expect(row.bidToCover).toBe("3.140000");
    expect(row.highYield).toBeNull();
    expect(row.highDiscountMargin).toBe("0.055000");
    expect(row.highDiscountRate).toBeNull();
    expect(row.status).toBe("resulted");
  });

  it("a Bill row has high_discount_rate populated and high_yield null (never the reverse)", () => {
    const bills = rows.filter((r) => r.securityType === "Bill" && r.status === "resulted");
    expect(bills.length).toBeGreaterThan(100);
    for (const b of bills) {
      expect(b.highDiscountRate, b.cusip).not.toBeNull();
      expect(b.highYield, b.cusip).toBeNull();
      expect(b.highDiscountMargin, b.cusip).toBeNull();
    }
  });

  it("a nominal Note/Bond row has high_yield populated and the other two null", () => {
    const nominal = rows.filter((r) => (r.securityType === "Note" || r.securityType === "Bond") && r.status === "resulted");
    // TIPS/FRN are their own security_type values, so this set is genuinely nominal-only.
    expect(nominal.length).toBeGreaterThan(50);
    for (const r of nominal) {
      expect(r.highYield, r.cusip).not.toBeNull();
      expect(r.highDiscountRate, r.cusip).toBeNull();
      expect(r.highDiscountMargin, r.cusip).toBeNull();
    }
  });

  it("magnitude spot-check: a known real offering size maps through as whole dollars, not thousands/millions", () => {
    // The 2026-08-20 TIPS reopening's announced offering was $8 billion.
    const row = find("912810US5", "2026-08-20");
    expect(row.offeringAmount).toBe("8000000000"); // $8,000,000,000 — not "8000" (millions) or "8" (billions).
  });

  it("distinguishes TIPS and FRN from nominal Note/Bond via the `type` field (never the coarser `securityType`)", () => {
    const types = new Set(rows.map((r) => r.securityType));
    for (const t of ["Bill", "Note", "Bond", "TIPS", "FRN", "CMB"] as const) {
      expect(types.has(t), `expected at least one real ${t} row in the fixture`).toBe(true);
    }
  });

  it("rejects an unrecognized security_type at the Zod boundary rather than silently passing it through", () => {
    const [sample] = records;
    const bad = { ...sample, type: "SomeNewSecurityKind" };
    expect(() => tdAuctionResponseSchema.parse([bad])).toThrow();
  });

  it("original_security_term family grouping: a 13-Week reopening groups into the 26-Week family in live data", () => {
    const reopening13wk = rows.filter((r) => r.securityType === "Bill" && r.securityTerm === "13-Week" && r.originalSecurityTerm === "26-Week");
    expect(reopening13wk.length).toBeGreaterThan(20);
  });

  it("REGRESSION GUARD: original_security_term alone silently mixes different bill tenors — the exact reason auctionFamilyKey() exists in @penny/db", () => {
    const seventeenWeekFamily = rows.filter((r) => r.securityType === "Bill" && r.originalSecurityTerm === "17-Week");
    const distinctTenors = new Set(seventeenWeekFamily.map((r) => r.securityTerm));
    // If this ever shrinks to a single tenor, the mixed-tenor caveat documented
    // in @penny/db's schema.ts/queries/auctions.ts no longer reflects reality
    // and should be re-verified against a fresh live sample before removing it.
    expect(distinctTenors).toEqual(new Set(["4-Week", "8-Week", "17-Week"]));
  });

  it("TD_SECURITY_TYPES matches @penny/db's auction_security_type enum values", async () => {
    const { auctionSecurityTypeEnum } = await import("@penny/db");
    expect([...TD_SECURITY_TYPES].sort()).toEqual([...auctionSecurityTypeEnum.enumValues].sort());
  });
});
