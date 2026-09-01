/**
 * Read-query helpers for the `auction` table — the family-grouping rule in
 * particular (see `auctionFamilyKey`) is easy to get wrong (see schema.ts's
 * doc comment on `auction.originalSecurityTerm`), so it lives here once,
 * tested, rather than being re-derived by every caller.
 */
import { and, desc, eq, gte, type SQL } from "drizzle-orm";
import type { PennyDb } from "../client";
import { auction, type Auction, type AuctionSecurityType } from "../schema";

/**
 * Which column identifies "the same security" across reopenings, by
 * security_type. Bills (and CMBs) must group by their actual current tenor
 * (`security_term`) — grouping by `original_security_term` silently mixes
 * different bill tenors together (verified live 2026-09-01: a "17-Week"
 * original-term family contains 4-Week, 8-Week, and 17-Week rows in roughly
 * equal numbers). Notes/Bonds/TIPS/FRNs are the opposite: a reopening's
 * `security_term` shortens as it ages ("10-Year" -> "9-Year 11-Month"), so
 * `original_security_term` is the correct "same security" key for those.
 */
export function auctionFamilyKey(securityType: AuctionSecurityType): "security_term" | "original_security_term" {
  return securityType === "Bill" || securityType === "CMB" ? "security_term" : "original_security_term";
}

/** The term VALUE to filter on for `auctionFamilyKey(securityType)`, read off of one already-fetched row — a small helper so callers don't have to duplicate the branch at every call site. */
export function auctionFamilyTerm(row: Pick<Auction, "securityType" | "securityTerm" | "originalSecurityTerm">): string {
  return auctionFamilyKey(row.securityType) === "security_term" ? row.securityTerm : row.originalSecurityTerm;
}

export interface AuctionFamilyHistoryParams {
  securityType: AuctionSecurityType;
  /** The family term value — a `security_term` for Bill/CMB, an `original_security_term` for everything else; see `auctionFamilyKey`. */
  term: string;
  /** Trailing auction count, most recent first before the reversal below. Default 14 — enough for a "trailing year" on every cadence this data actually has (monthly coupon auctions; more for weekly bills). */
  limit?: number;
}

/**
 * A family's trailing resulted auctions, ASCENDING by auction_date (ready to
 * feed straight into a chart's x-axis) — the query behind "this security's
 * own history." Only `status: "resulted"` rows: an announced-but-not-yet-run
 * auction has nothing to plot.
 */
export async function getAuctionFamilyHistory(db: PennyDb, params: AuctionFamilyHistoryParams): Promise<Auction[]> {
  const keyColumn = auctionFamilyKey(params.securityType) === "security_term" ? auction.securityTerm : auction.originalSecurityTerm;
  const rows = await db
    .select()
    .from(auction)
    .where(and(eq(auction.securityType, params.securityType), eq(keyColumn, params.term), eq(auction.status, "resulted")))
    .orderBy(desc(auction.auctionDate))
    .limit(params.limit ?? 14);
  return rows.reverse();
}

/** The single most recent resulted auction, optionally scoped to one family (same grouping rule as getAuctionFamilyHistory). Undefined when nothing resulted matches yet. */
export async function getLatestResultedAuction(
  db: PennyDb,
  family?: { securityType: AuctionSecurityType; term: string },
): Promise<Auction | undefined> {
  const conditions: SQL[] = [eq(auction.status, "resulted")];
  if (family) {
    const keyColumn = auctionFamilyKey(family.securityType) === "security_term" ? auction.securityTerm : auction.originalSecurityTerm;
    conditions.push(eq(auction.securityType, family.securityType), eq(keyColumn, family.term));
  }
  const rows = await db
    .select()
    .from(auction)
    .where(and(...conditions))
    .orderBy(desc(auction.auctionDate))
    .limit(1);
  return rows[0];
}

export interface RecentAuctionsParams {
  /** Inclusive lower bound on auction_date (YYYY-MM-DD). */
  sinceDate: string;
  /** Excludes Bills by default — the mockup's "last month of coupon auctions" table is Notes/Bonds/TIPS/FRNs; pass true to include Bills/CMBs too. */
  includeBills?: boolean;
  limit?: number;
}

/** Resulted auctions on or after `sinceDate`, most recent first — the "last month of auctions" table query. */
export async function getRecentResultedAuctions(db: PennyDb, params: RecentAuctionsParams): Promise<Auction[]> {
  const conditions = [eq(auction.status, "resulted"), gte(auction.auctionDate, params.sinceDate)];
  const rows = await db
    .select()
    .from(auction)
    .where(and(...conditions))
    .orderBy(desc(auction.auctionDate))
    .limit(params.limit ?? 200);
  if (params.includeBills) return rows;
  return rows.filter((r) => r.securityType !== "Bill" && r.securityType !== "CMB");
}

export interface UpcomingAuctionsParams {
  /** Inclusive lower bound on auction_date (YYYY-MM-DD) — normally "today". */
  fromDate: string;
  limit?: number;
}

/** The published calendar, ascending by auction_date — the "Coming up" table. Includes both announced-with-size and still-TBA rows (offering_amount null); status stays "announced" until a result upsert transitions it. */
export async function getUpcomingAuctions(db: PennyDb, params: UpcomingAuctionsParams): Promise<Auction[]> {
  return db
    .select()
    .from(auction)
    .where(and(eq(auction.status, "announced"), gte(auction.auctionDate, params.fromDate)))
    .orderBy(auction.auctionDate);
}

/** Look up one auction by its TreasuryDirect identity (cusip, auction_date) — the upsert's own read-before-write, and useful for a detail page / deep link. */
export async function getAuctionByCusipAndDate(db: PennyDb, cusip: string, auctionDate: string): Promise<Auction | undefined> {
  const rows = await db
    .select()
    .from(auction)
    .where(and(eq(auction.cusip, cusip), eq(auction.auctionDate, auctionDate)))
    .limit(1);
  return rows[0];
}
