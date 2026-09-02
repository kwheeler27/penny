/**
 * TreasuryDirect Securities Auctions Data API — the shared record shape and
 * pure parser for `/securities/auctioned`, `/securities/upcoming`, and
 * `/securities/search` (verified live 2026-09-01: all three return the
 * identical 120-field record; only which fields are populated differs).
 * `.passthrough()` on the raw schema because only the ~20 fields the
 * `auction` table actually stores are validated here — the other ~100 are
 * real TreasuryDirect fields (CUSIP metadata, PDF/XML filenames, STRIPS
 * terms, etc.) this dataset has no use for yet and shouldn't fail parsing
 * over.
 */
import { z } from "zod";
import { zonedWallClockToUtcIso } from "../lib/time";
import type { RawAuction, AuctionSecurityType } from "../lib/types";

/**
 * TreasuryDirect's OWN fine-grained discriminator. Deliberately validated
 * here as a closed enum (rather than left as free text) so an unmapped
 * seventh value TreasuryDirect might introduce fails LOUDLY at the API
 * boundary instead of silently mis-bucketing a new security type — see
 * schema.ts's `auctionSecurityTypeEnum` doc comment in @penny/db for why
 * `type`, not the coarser `securityType`, is what this dataset stores.
 */
export const TD_SECURITY_TYPES = ["Bill", "Note", "Bond", "TIPS", "FRN", "CMB"] as const satisfies readonly AuctionSecurityType[];

/** A plain `YYYY-MM-DDTHH:mm:ss` TreasuryDirect date/time string (no offset) — used for auctionDate/issueDate/announcementDate/updatedTimestamp alike. */
const tdDateTimeString = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);

/** A TreasuryDirect numeric field: signed decimal delivered as a string, or an empty string meaning "not applicable / not yet known" — this dataset's equivalent of FiscalData's "null" sentinel, just spelled differently. Never call Number()/parseFloat() on the result. */
export const tdAmountString = z.union([z.literal(""), z.string().regex(/^-?\d+(\.\d+)?$/)]);

/** Turn a `tdAmountString` value into a decimal string or null. Never parses to `number`. */
export function parseTdAmount(raw: string): string | null {
  return raw === "" ? null : raw;
}

export const tdAuctionRecordSchema = z
  .object({
    cusip: z.string().min(1),
    type: z.enum(TD_SECURITY_TYPES),
    securityTerm: z.string().min(1),
    originalSecurityTerm: z.string().min(1),
    auctionDate: tdDateTimeString,
    issueDate: tdDateTimeString,
    announcementDate: tdDateTimeString,
    updatedTimestamp: tdDateTimeString,
    offeringAmount: tdAmountString,
    totalAccepted: tdAmountString,
    bidToCoverRatio: tdAmountString,
    highYield: tdAmountString,
    highDiscountRate: tdAmountString,
    highDiscountMargin: tdAmountString,
    primaryDealerAccepted: tdAmountString,
    directBidderAccepted: tdAmountString,
    indirectBidderAccepted: tdAmountString,
    noncompetitiveAccepted: tdAmountString,
    somaAccepted: tdAmountString,
  })
  .passthrough();

export type TdAuctionRecord = z.infer<typeof tdAuctionRecordSchema>;

/** TreasuryDirect's three endpoints return a bare JSON array, not FiscalData's `{ data, meta, links }` envelope. */
export const tdAuctionResponseSchema = z.array(tdAuctionRecordSchema);
export type TdAuctionResponse = z.infer<typeof tdAuctionResponseSchema>;

/** `"2026-09-01T00:00:00"` -> `"2026-09-01"`. A pure string slice — never through `new Date()` — per the "transaction dates are calendar dates, never timezone-shifted through Date round-trips" house rule. Throws if the date-time string isn't midnight, which every auctionDate/issueDate/announcementDate in this API always is (verified live) — a loud failure here would mean the source started publishing an actual time-of-day on what's documented as a pure date, worth knowing immediately rather than silently truncating real information. */
function tdDateOnly(dateTime: string): string {
  const [datePart, timePart] = dateTime.split("T");
  if (timePart !== "00:00:00") {
    throw new Error(`expected a midnight date-only TreasuryDirect timestamp, got ${JSON.stringify(dateTime)}`);
  }
  return datePart as string;
}

/**
 * A record counts as "resulted" once `totalAccepted` is populated — the one
 * field every resulted auction carries regardless of security type (unlike
 * `highYield`/`highDiscountRate`/`highDiscountMargin`, which are mutually
 * exclusive by convention and so can't individually signal "has results").
 * Judged on data presence, not on which endpoint produced the record, so a
 * record from `/upcoming` that happens to already carry results (a same-day
 * edge case) is still classified correctly.
 */
function deriveStatus(record: TdAuctionRecord): "announced" | "resulted" {
  return record.totalAccepted === "" ? "announced" : "resulted";
}

/**
 * Pure transform: one TreasuryDirect record -> one `RawAuction`, ready for
 * `lib/upsert-auctions.ts`. `sourceUrl` is threaded through by the caller
 * (the job) rather than read off the record, since it names the REQUEST
 * that produced this record, not anything TreasuryDirect itself publishes.
 */
export function mapTdRecordToRawAuction(record: TdAuctionRecord, sourceUrl: string): RawAuction {
  return {
    cusip: record.cusip,
    securityType: record.type,
    securityTerm: record.securityTerm,
    originalSecurityTerm: record.originalSecurityTerm,
    auctionDate: tdDateOnly(record.auctionDate),
    issueDate: tdDateOnly(record.issueDate),
    announcementDate: tdDateOnly(record.announcementDate),
    offeringAmount: parseTdAmount(record.offeringAmount),
    totalAccepted: parseTdAmount(record.totalAccepted),
    bidToCover: parseTdAmount(record.bidToCoverRatio),
    highYield: parseTdAmount(record.highYield),
    highDiscountRate: parseTdAmount(record.highDiscountRate),
    highDiscountMargin: parseTdAmount(record.highDiscountMargin),
    primaryDealerAccepted: parseTdAmount(record.primaryDealerAccepted),
    directBidderAccepted: parseTdAmount(record.directBidderAccepted),
    indirectBidderAccepted: parseTdAmount(record.indirectBidderAccepted),
    noncompetitiveAccepted: parseTdAmount(record.noncompetitiveAccepted),
    somaAccepted: parseTdAmount(record.somaAccepted),
    status: deriveStatus(record),
    sourceUrl,
    publicationTime: zonedWallClockToUtcIso(record.updatedTimestamp),
  };
}

/** Parse an entire raw TreasuryDirect response (already Zod-validated) into RawAuction rows. */
export function parseTdAuctionResponse(records: readonly TdAuctionRecord[], sourceUrl: string): RawAuction[] {
  return records.map((r) => mapTdRecordToRawAuction(r, sourceUrl));
}
