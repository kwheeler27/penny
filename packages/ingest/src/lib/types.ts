import type { SeriesId } from "@penny/registry";

/** Mirrors @penny/db's `period_type` enum. Duplicated here (rather than imported) because @penny/db is a runtime dependency we want ingest's pure transform functions to stay decoupled from — see raw-observation.ts. Kept in sync by packages/db/test/db.test.ts and packages/ingest/test/reconciliation.test.ts both exercising the same enum values end to end. */
export type PeriodType = "day" | "month" | "fiscal_ytd" | "year";

/**
 * The shape every ingest transform function produces, before it ever
 * touches a database: a fully-identified observation, still carrying its
 * value as the exact string the source published (never `number`).
 * `@penny/db`'s `NewObservation` is the same shape with a couple of
 * DB-specific fields (`revisionOf`, `ingestedAt`) layered on by the upsert
 * step, not by the parser.
 */
export interface RawObservation {
  seriesId: SeriesId;
  periodType: PeriodType;
  periodStart: string;
  periodEnd: string;
  fiscalYear: number | null;
  /** Exact decimal string as published by the source — never Number()'d. */
  value: string;
  /** ISO 8601 timestamp. See each job's doc comment for how this is derived when the source has no distinct publication-date field. */
  publicationTime: string;
}

/** Mirrors @penny/db's `auction_security_type` enum. Duplicated (rather than imported) for the same reason PeriodType is above: keep ingest's pure transform functions decoupled from the @penny/db runtime dependency. Kept in sync by treasurydirect/auction.test.ts asserting against the live @penny/db enum. */
export type AuctionSecurityType = "Bill" | "Note" | "Bond" | "TIPS" | "FRN" | "CMB";

/** Mirrors @penny/db's `auction_status` enum — see the note above. */
export type AuctionStatus = "announced" | "resulted";

/**
 * The shape treasurydirect/auction.ts's parser produces, before it ever
 * touches a database — the auction-table analogue of RawObservation above.
 * `@penny/db`'s `NewAuction` is the same shape with `ingestedAt` layered on
 * by the upsert step (lib/upsert-auctions.ts), not by the parser.
 */
export interface RawAuction {
  cusip: string;
  securityType: AuctionSecurityType;
  securityTerm: string;
  originalSecurityTerm: string;
  auctionDate: string;
  issueDate: string;
  announcementDate: string;
  offeringAmount: string | null;
  totalAccepted: string | null;
  bidToCover: string | null;
  highYield: string | null;
  highDiscountRate: string | null;
  highDiscountMargin: string | null;
  primaryDealerAccepted: string | null;
  directBidderAccepted: string | null;
  indirectBidderAccepted: string | null;
  noncompetitiveAccepted: string | null;
  somaAccepted: string | null;
  status: AuctionStatus;
  sourceUrl: string;
  /** ISO 8601 timestamp, UTC — see lib/time.ts for how this is derived from TreasuryDirect's Eastern-local `updatedTimestamp`. */
  publicationTime: string;
}
