/**
 * The one place ingest jobs write to `auction`. Deliberately NOT
 * lib/upsert.ts's model (insert-a-new-row-per-revision): an auction is one
 * real-world event known incompletely (`status: "announced"`) and then
 * completely (`status: "resulted"`) — the announced row and the resulted
 * row are the SAME row, upserted on the (cusip, auction_date) identity, per
 * the shared data contract. "Never destroy the announced record's
 * provenance" means two concrete things this module enforces:
 *
 *  1. The transition is an UPDATE of the existing row, never a
 *     delete-and-reinsert — the row's `id` (and anything a future
 *     feature FKs against it) survives the transition.
 *  2. `ingestedAt` (first-seen time) is never included in the UPDATE's
 *     `set` — only a fresh INSERT ever sets it (via its column default).
 *
 * Idempotency: re-running with unchanged data does not even issue a write
 * ("unchanged" skips straight past both insert and update) — judged on the
 * DATA columns only (never `publication_time`/`source_url`), so a re-fetch
 * that finds no substantive change doesn't bump `publication_time` either.
 * `publication_time` therefore means "as of when this row's data last
 * changed," not "as of when we last checked" — which is also what makes it
 * a meaningful signal of the announced -> resulted transition itself,
 * rather than ticking on every run regardless.
 */
import { eq } from "drizzle-orm";
import { auction, getAuctionByCusipAndDate, type PennyDb, type Auction, type NewAuction } from "@penny/db";
import { decimalEquals } from "./decimal";
import type { RawAuction } from "./types";

export type UpsertAuctionOutcome = "inserted" | "updated" | "unchanged";

export interface UpsertAuctionResult {
  outcome: UpsertAuctionOutcome;
  /** The row's id — stable across an announced -> resulted "updated" transition. */
  id: number;
  /** True only when this call's outcome was "updated" AND it moved status announced -> resulted specifically (vs. e.g. a late correction to an already-resulted row). */
  statusTransition: boolean;
}

function amountEquals(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return decimalEquals(a, b);
}

/** Every column that can genuinely change between two fetches of the same (cusip, auction_date) — i.e. everything except `id`, `cusip`/`auctionDate` (the identity itself), and the two provenance-only fields `sourceUrl`/`publicationTime` (excluded deliberately — see module doc comment). */
function auctionDataEquals(existing: Auction, raw: RawAuction): boolean {
  return (
    existing.securityType === raw.securityType &&
    existing.securityTerm === raw.securityTerm &&
    existing.originalSecurityTerm === raw.originalSecurityTerm &&
    existing.issueDate === raw.issueDate &&
    existing.announcementDate === raw.announcementDate &&
    existing.status === raw.status &&
    amountEquals(existing.offeringAmount, raw.offeringAmount) &&
    amountEquals(existing.totalAccepted, raw.totalAccepted) &&
    amountEquals(existing.bidToCover, raw.bidToCover) &&
    amountEquals(existing.highYield, raw.highYield) &&
    amountEquals(existing.highDiscountRate, raw.highDiscountRate) &&
    amountEquals(existing.highDiscountMargin, raw.highDiscountMargin) &&
    amountEquals(existing.primaryDealerAccepted, raw.primaryDealerAccepted) &&
    amountEquals(existing.directBidderAccepted, raw.directBidderAccepted) &&
    amountEquals(existing.indirectBidderAccepted, raw.indirectBidderAccepted) &&
    amountEquals(existing.noncompetitiveAccepted, raw.noncompetitiveAccepted) &&
    amountEquals(existing.somaAccepted, raw.somaAccepted)
  );
}

/** Shared field mapping for both the insert and update paths below — keeps the (long) column list in exactly one place. */
function toAuctionValues(raw: RawAuction): Omit<NewAuction, "id" | "ingestedAt"> {
  return {
    cusip: raw.cusip,
    securityType: raw.securityType,
    securityTerm: raw.securityTerm,
    originalSecurityTerm: raw.originalSecurityTerm,
    auctionDate: raw.auctionDate,
    issueDate: raw.issueDate,
    announcementDate: raw.announcementDate,
    offeringAmount: raw.offeringAmount,
    totalAccepted: raw.totalAccepted,
    bidToCover: raw.bidToCover,
    highYield: raw.highYield,
    highDiscountRate: raw.highDiscountRate,
    highDiscountMargin: raw.highDiscountMargin,
    primaryDealerAccepted: raw.primaryDealerAccepted,
    directBidderAccepted: raw.directBidderAccepted,
    indirectBidderAccepted: raw.indirectBidderAccepted,
    noncompetitiveAccepted: raw.noncompetitiveAccepted,
    somaAccepted: raw.somaAccepted,
    status: raw.status,
    sourceUrl: raw.sourceUrl,
    publicationTime: new Date(raw.publicationTime),
  };
}

/** Idempotently apply one parsed auction row. Safe to call repeatedly with the same input ("unchanged" after the first call), and safe to call with a later, more-complete row for the same (cusip, auction_date) — the announced -> resulted case. */
export async function upsertAuction(db: PennyDb, raw: RawAuction): Promise<UpsertAuctionResult> {
  const existing = await getAuctionByCusipAndDate(db, raw.cusip, raw.auctionDate);

  if (!existing) {
    const [row] = await db.insert(auction).values(toAuctionValues(raw)).returning();
    if (!row) throw new Error("insert returned no row");
    return { outcome: "inserted", id: row.id, statusTransition: false };
  }

  if (auctionDataEquals(existing, raw)) {
    return { outcome: "unchanged", id: existing.id, statusTransition: false };
  }

  const statusTransition = existing.status === "announced" && raw.status === "resulted";

  const [row] = await db
    .update(auction)
    // ingestedAt deliberately absent from `set` — see module doc comment.
    .set(toAuctionValues(raw))
    .where(eq(auction.id, existing.id))
    .returning();
  if (!row) throw new Error("update returned no row");
  return { outcome: "updated", id: row.id, statusTransition };
}

export interface UpsertAuctionsSummary {
  inserted: number;
  updated: number;
  unchanged: number;
  /** How many of the "updated" rows specifically moved announced -> resulted this call — a subset of `updated`, surfaced separately because it's the one transition the shared data contract calls out by name. */
  statusTransitions: number;
  results: UpsertAuctionResult[];
}

/** Apply a batch of parsed auction rows sequentially (not Promise.all — same rationale as lib/upsert.ts: keeps writes ordered and easy to reason about, and this is ingest-job volume, never request volume). */
export async function upsertAuctions(db: PennyDb, raws: readonly RawAuction[]): Promise<UpsertAuctionsSummary> {
  const results: UpsertAuctionResult[] = [];
  for (const raw of raws) {
    results.push(await upsertAuction(db, raw));
  }
  return {
    inserted: results.filter((r) => r.outcome === "inserted").length,
    updated: results.filter((r) => r.outcome === "updated").length,
    unchanged: results.filter((r) => r.outcome === "unchanged").length,
    statusTransitions: results.filter((r) => r.statusTransition).length,
    results,
  };
}
