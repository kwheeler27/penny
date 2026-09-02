/**
 * Local, decoupled shape for one Treasury auction — the apps/web-side
 * counterpart to lib/types.ts's `Reading`, which deliberately does not mirror
 * @penny/db's `Observation` row 1:1 (see that file's own doc comment). Every
 * numeric field is a decimal STRING exactly as published, never a JS number
 * (CLAUDE.md: money/rate figures are never coerced through float on the way
 * in) — offering_amount/total_accepted/the buyer-class *_accepted fields and
 * soma_accepted are whole-dollar amounts (no separate magnitude column, per
 * the shared contract — TreasuryDirect's auction API publishes these as
 * whole dollars); bid_to_cover/high_yield/high_discount_rate/
 * high_discount_margin are plain rate/ratio numbers, not currency.
 *
 * This is the CONTRACT this agent (AUCTION-PAGE) coded against for the new
 * `auction` table the DB agent owns (packages/db) — see
 * apps/web/lib/auctions-data.ts's own header comment for exactly which
 * @penny/db exports this file is blocked on.
 */

export type AuctionStatus = "announced" | "resulted";

export interface AuctionRecord {
  readonly cusip: string;
  /** As published — "Bill" | "Note" | "Bond" | "TIPS" | "FRN" | "CMB" (never assumed exhaustive; treated as an opaque string everywhere except the explicit Note/Bond filters this page uses). */
  readonly securityType: string;
  /** As published for THIS auction, e.g. "9-Year 11-Month" for a reopening close to its original term's midpoint. */
  readonly securityTerm: string;
  /** The family key: the term of the ORIGINAL issuance, e.g. "10-Year" even when securityTerm reads otherwise for a reopening. Reopenings group into their family by this field, never by securityTerm. */
  readonly originalSecurityTerm: string;
  /** YYYY-MM-DD. */
  readonly auctionDate: string;
  readonly issueDate: string;
  readonly announcementDate: string;
  /** Whole-dollar decimal string, or null — TBA until the announcement is out. */
  readonly offeringAmount: string | null;
  readonly totalAccepted: string | null;
  /** A plain ratio, e.g. "2.50" meaning 2.50×. */
  readonly bidToCover: string | null;
  /** A plain percent number, e.g. "4.512" meaning 4.512%. Null for a reopening the source didn't publish one for, and never derived from another field. */
  readonly highYield: string | null;
  readonly highDiscountRate: string | null;
  readonly highDiscountMargin: string | null;
  readonly primaryDealerAccepted: string | null;
  readonly directBidderAccepted: string | null;
  readonly indirectBidderAccepted: string | null;
  readonly noncompetitiveAccepted: string | null;
  /** The Fed's SOMA rollover add-on — beyond `totalAccepted`, never counted as competing for it (CLAUDE.md/ORCHESTRATION_PROMPT.md doctrine). Null is a gap (not yet known); a real "0" is a genuine reading (no add-on that round) — the takeaway generator treats both the same way (it omits the SOMA clause for either), but a future caller must not conflate them in copy. */
  readonly somaAccepted: string | null;
  readonly status: AuctionStatus;
  readonly sourceUrl: string;
  /** ISO 8601 timestamp string. */
  readonly publicationTime: string;
}

/** True when a row is a reopening of an earlier issuance — TreasuryDirect's
 * own signal (securityTerm reads as the remaining term, distinct from the
 * family's originalSecurityTerm), not a guess from cusip history (which this
 * page's bounded date-range queries wouldn't reliably have anyway).
 *
 * Excludes Bill/CMB rows unconditionally: @penny/db's schema doc comment
 * (packages/db/src/schema.ts, `auction.originalSecurityTerm`) documents that
 * a Bill's `original_security_term` is a coarser bucket that mixes several
 * genuinely different tenors (a "17-Week" original-term family contains
 * 4-Week, 8-Week, AND 17-Week `security_term` rows) — a mismatch there means
 * "a different bill," never "a reopening of this one," so treating it as a
 * reopening signal would mislabel ordinary bill rows.
 */
export function isReopening(a: Pick<AuctionRecord, "securityType" | "securityTerm" | "originalSecurityTerm">): boolean {
  if (a.securityType === "Bill" || a.securityType === "CMB") return false;
  return a.securityTerm !== a.originalSecurityTerm;
}

/** The two security types this page's "coupon auction" sections cover —
 * every place that means "Notes and Bonds, not bills/TIPS/FRNs" filters
 * against this explicit list rather than re-deriving it, so the definition
 * lives in exactly one place. */
export const COUPON_SECURITY_TYPES: readonly string[] = ["Note", "Bond"];

export function isCouponSecurity(a: Pick<AuctionRecord, "securityType">): boolean {
  return COUPON_SECURITY_TYPES.includes(a.securityType);
}
