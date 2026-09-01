/**
 * Server-only orchestration layer between apps/web and:
 *  - @penny/db's `auction` table, via its own query helpers
 *    (`getAuctionFamilyHistory`, `getRecentResultedAuctions`,
 *    `getUpcomingAuctions`, `auctionFamilyTerm`) plus a couple of narrow
 *    queries of this file's own for needs those helpers don't cover exactly
 *    (a Note/Bond-only "latest," and the Coming Up table's reopening
 *    annotation) — packages/db/src/queries/auctions.ts, landed by the DB
 *    agent's half of this shared build.
 *  - @penny/registry's dataset-citation registry (`getDataset`,
 *    `datasetCitationFor`, id `treasurydirect.auctions`) — the "dataset-
 *    level citation entry" the auction page's citation lines render
 *    through, distinct from the per-value `series`/`getSeries` path every
 *    other page here uses, because an auction row's dozens of columns
 *    aren't a single registry `series` value per period.
 *
 * Every function returns AuctionRecord (lib/auction-types.ts), never a bare
 * `Auction` row — mirrors lib/series-data.ts's `Reading` boundary. Every
 * query runs through lib/db.ts's `safely()` wrapper, so a cold/unmigrated
 * database renders the page's gap states instead of a 500 (CLAUDE.md:
 * missing data is a gap, never a crash, for a public read-only instrument).
 */
import { and, desc, eq, lte, inArray } from "drizzle-orm";
import {
  auction,
  auctionFamilyTerm,
  getAuctionFamilyHistory,
  getRecentResultedAuctions,
  getUpcomingAuctions as dbGetUpcomingAuctions,
  type Auction,
  type AuctionSecurityType,
} from "@penny/db";
import { datasetCitationFor, getDataset } from "@penny/registry";
import { addDays } from "./calendar";
import { formatMonthYear, roundDecimalString, todayIso } from "./format";
import { isReopening, type AuctionRecord } from "./auction-types";
import {
  buildBidToCoverCaption,
  buildBidToCoverPoints,
  buildBuyerMix,
  buildHighYieldCaption,
  buildHighYieldPoints,
  buildHistorySubtitle,
  buildLatestAuctionTiles,
  buildRecentAuctionRows,
  buildTakeawaySentence,
  buildUpcomingGroups,
  familyLabel,
  reopeningFamilyKey,
  securityLabel,
  trailingAverage,
  type AuctionChartPoint,
  type BuyerMix,
  type LatestAuctionTiles,
  type RecentAuctionRow,
  type UpcomingAuctionGroup,
} from "./auction-transform";
import { safely } from "./db";

const AUCTION_DATASET_ID = "treasurydirect.auctions" as const;
const COUPON_TYPES: AuctionSecurityType[] = ["Note", "Bond"];
const RECENT_WINDOW_DAYS = 30;
const FAMILY_WINDOW_SIZE = 14;

export interface AuctionDatasetCitation {
  readonly agency: string;
  readonly dataset: string;
  readonly datasetUrl: string;
  readonly citation: string;
}

const FALLBACK_CITATION_TEXT =
  "U.S. Department of the Treasury, Bureau of the Fiscal Service, TreasuryDirect Securities Auctions Data API. Accessed {access_date}.";

/** The dataset-level citation the auction page's "Source:" lines render
 * through — reads @penny/registry's `treasurydirect.auctions` dataset entry
 * (packages/registry/datasets/treasurydirect/auctions.yaml). `citation`
 * comes back with `{access_date}` already substituted. Falls back to a
 * hardcoded citation ONLY if that registry entry is ever missing — a static
 * generated module, so this never fires in a correctly built repo; mirrors
 * lib/front-door-data.ts's own `?? "fallback"` convention. */
export function getAuctionDatasetCitation(accessDate: string): AuctionDatasetCitation {
  const def = getDataset(AUCTION_DATASET_ID);
  if (!def) {
    return {
      agency: "U.S. Department of the Treasury, Bureau of the Fiscal Service",
      dataset: "TreasuryDirect Securities Auctions Data API",
      datasetUrl: "https://www.treasurydirect.gov/auctions/auction-query/",
      citation: FALLBACK_CITATION_TEXT.replace("{access_date}", accessDate),
    };
  }
  return { agency: def.agency, dataset: def.dataset, datasetUrl: def.datasetUrl, citation: datasetCitationFor(AUCTION_DATASET_ID, accessDate) };
}

function asAuctionSecurityType(s: string): AuctionSecurityType {
  return s as AuctionSecurityType;
}

function toAuctionRecord(row: Auction): AuctionRecord {
  return {
    cusip: row.cusip,
    securityType: row.securityType,
    securityTerm: row.securityTerm,
    originalSecurityTerm: row.originalSecurityTerm,
    auctionDate: row.auctionDate,
    issueDate: row.issueDate,
    announcementDate: row.announcementDate,
    offeringAmount: row.offeringAmount,
    totalAccepted: row.totalAccepted,
    bidToCover: row.bidToCover,
    highYield: row.highYield,
    highDiscountRate: row.highDiscountRate,
    highDiscountMargin: row.highDiscountMargin,
    primaryDealerAccepted: row.primaryDealerAccepted,
    directBidderAccepted: row.directBidderAccepted,
    indirectBidderAccepted: row.indirectBidderAccepted,
    noncompetitiveAccepted: row.noncompetitiveAccepted,
    somaAccepted: row.somaAccepted,
    status: row.status,
    sourceUrl: row.sourceUrl,
    publicationTime: row.publicationTime.toISOString(),
  };
}

/** The most recently resulted Note/Bond auction — the "latest coupon
 * auction" card's subject. Explicitly Note/Bond only (never TIPS/FRN, and
 * never a Bill/CMB — those get the "bills are the metronome" note instead
 * of this card). Null is a real gap (nothing resulted yet). None of
 * queries/auctions.ts's ready-made helpers filter to a specific
 * security-type LIST, so this is this file's own narrow query — still
 * through the shared `auction` table/drizzle, never a second data path. */
export async function getLatestResultedCouponAuction(): Promise<AuctionRecord | null> {
  const rows = await safely(
    (db) =>
      db
        .select()
        .from(auction)
        .where(and(eq(auction.status, "resulted"), inArray(auction.securityType, COUPON_TYPES)))
        .orderBy(desc(auction.auctionDate))
        .limit(1),
    [] as Auction[],
  );
  const row = rows[0];
  return row ? toAuctionRecord(row) : null;
}

/** A family's trailing resulted auctions, ascending by auction date,
 * including `latest` itself as the final point — the input to both "this
 * security's own history" charts and the takeaway generator's trailing
 * comparisons. Delegates the Bill-vs-other family-grouping rule entirely to
 * @penny/db's `getAuctionFamilyHistory`/`auctionFamilyTerm` (see
 * packages/db/src/queries/auctions.ts) rather than re-deriving it here. */
export async function getFamilyHistory(latest: AuctionRecord, limit = FAMILY_WINDOW_SIZE): Promise<AuctionRecord[]> {
  const securityType = asAuctionSecurityType(latest.securityType);
  const term = auctionFamilyTerm({ securityType, securityTerm: latest.securityTerm, originalSecurityTerm: latest.originalSecurityTerm });
  const rows = await safely((db) => getAuctionFamilyHistory(db, { securityType, term, limit }), [] as Auction[]);
  return rows.map(toAuctionRecord);
}

/** Resulted Note/Bond/TIPS/FRN auctions on or after `sinceDate` — the
 * "recent coupon auctions" table's ~30-day window. Bills/CMBs excluded
 * (queries/auctions.ts's own default), matching the approved mockup, which
 * includes a TIPS reopening row in this same table. */
export async function getRecentCouponAuctions(sinceDate: string): Promise<AuctionRecord[]> {
  const rows = await safely((db) => getRecentResultedAuctions(db, { sinceDate, includeBills: false, limit: 200 }), [] as Auction[]);
  return rows.map(toAuctionRecord);
}

/** Every announced (not yet resulted) auction on or after `fromDate` — the
 * "coming up" table, every security type (bills included). */
export async function getUpcomingAuctions(fromDate: string): Promise<AuctionRecord[]> {
  const rows = await safely((db) => dbGetUpcomingAuctions(db, { fromDate, limit: 100 }), [] as Auction[]);
  return rows.map(toAuctionRecord);
}

/** The family's original (non-reopened) auction on or before
 * `onOrBeforeDate` — used only to build the Coming Up table's "(the August
 * 10-year, reopened)" annotation. Null when no such record has been
 * ingested (yet, or it falls outside the backfill) — the caller renders the
 * plain "(reopening)" qualifier instead of guessing (CLAUDE.md: never
 * assert a fact the data doesn't support). Not provided by queries/
 * auctions.ts (a bespoke need of this page), so this is a narrow query of
 * this file's own, using the same `auction` table. */
export async function getOriginalAuctionForReopening(a: Pick<AuctionRecord, "securityType" | "originalSecurityTerm">, onOrBeforeDate: string): Promise<AuctionRecord | null> {
  const rows = await safely(
    (db) =>
      db
        .select()
        .from(auction)
        .where(
          and(
            eq(auction.status, "resulted"),
            eq(auction.securityType, asAuctionSecurityType(a.securityType)),
            eq(auction.originalSecurityTerm, a.originalSecurityTerm),
            eq(auction.securityTerm, auction.originalSecurityTerm), // the ORIGINAL issuance is the row where these two columns agree
            lte(auction.auctionDate, onOrBeforeDate),
          ),
        )
        .orderBy(desc(auction.auctionDate))
        .limit(1),
    [] as Auction[],
  );
  const row = rows[0];
  return row ? toAuctionRecord(row) : null;
}

/** For every DISTINCT reopening family present in `upcoming`, resolves its
 * original auction record (or null when not derivable) — one small batch of
 * queries, not N+1 per row, since several reopenings in the same window
 * often share a family. Bill/CMB rows are never reopenings (isReopening
 * excludes them per @penny/db's own family-grouping caveat), so they never
 * generate a lookup here. */
export async function getOriginalAuctionsForUpcomingReopenings(upcoming: readonly AuctionRecord[]): Promise<Map<string, AuctionRecord | null>> {
  const reopenings = upcoming.filter(isReopening);
  const families = new Map<string, AuctionRecord>();
  for (const a of reopenings) if (!families.has(reopeningFamilyKey(a))) families.set(reopeningFamilyKey(a), a);

  const result = new Map<string, AuctionRecord | null>();
  await Promise.all(
    [...families.entries()].map(async ([key, sample]) => {
      const earliestDate = reopenings.filter((a) => reopeningFamilyKey(a) === key).reduce((min, a) => (a.auctionDate < min ? a.auctionDate : min), sample.auctionDate);
      result.set(key, await getOriginalAuctionForReopening(sample, earliestDate));
    }),
  );
  return result;
}

/** A compact summary of the latest resulted coupon auction — for the front
 * door's fourth hero-strip cell ("Latest auction"), which shows only the
 * security, its high yield, and the date; never the full card. Null is a
 * real gap. */
export interface LatestAuctionSummary {
  readonly securityLabel: string;
  readonly highYieldDisplay: string | null;
  readonly auctionDate: string;
  /** The registry dataset's short label ("TreasuryDirect auction results")
   * — for the front door's fourth hero cell's source line, which (unlike
   * this page's own citation lines) doesn't render through a full
   * AuctionDatasetCitation object. */
  readonly datasetLabel: string;
}

export async function getLatestAuctionSummary(): Promise<LatestAuctionSummary | null> {
  const latest = await getLatestResultedCouponAuction();
  if (!latest) return null;
  const datasetLabel = getDataset(AUCTION_DATASET_ID)?.label ?? "TreasuryDirect auction results";
  return {
    securityLabel: securityLabel(latest),
    highYieldDisplay: latest.highYield != null ? `${roundDecimalString(latest.highYield, 3)}%` : null,
    auctionDate: latest.auctionDate,
    datasetLabel,
  };
}

// ---------- the /auctions page orchestrator ----------

export interface AuctionsPageData {
  readonly latest: AuctionRecord | null;
  readonly tiles: LatestAuctionTiles | null;
  readonly buyerMix: BuyerMix | null;
  readonly takeaway: string;
  readonly historySubtitle: string;
  /** The "This security's own history" section's own citation fragment
   * ("7-Year Note auctions of July 2025–August 2026") — null when there's
   * no family history to cite (the section renders its own gap state
   * instead). Scoped to exactly the window the charts show, never the
   * page-wide access window used elsewhere. */
  readonly historyCitationRangeLabel: string | null;
  readonly bidToCoverPoints: readonly AuctionChartPoint[];
  readonly bidToCoverAverageValue: number | null;
  readonly bidToCoverAverageDisplay: string | null;
  readonly bidToCoverCaption: string;
  readonly highYieldPoints: readonly AuctionChartPoint[];
  readonly highYieldCaption: string;
  readonly recentRows: readonly RecentAuctionRow[];
  readonly upcomingGroups: readonly UpcomingAuctionGroup[];
  readonly citation: AuctionDatasetCitation;
  readonly accessDate: string;
}

/**
 * Everything the /auctions route needs, in one call — mirrors
 * lib/front-door-data.ts's `getFrontDoorData`: this is the ONLY place
 * app/auctions/page.tsx (or a component it renders) reads @penny/db or
 * @penny/registry directly; every component below it receives already-
 * resolved data through props.
 */
export async function getAuctionsPageData(): Promise<AuctionsPageData> {
  const today = todayIso();
  const citation = getAuctionDatasetCitation(today);

  const [latest, upcomingRaw, recentRaw] = await Promise.all([
    getLatestResultedCouponAuction(),
    getUpcomingAuctions(today),
    getRecentCouponAuctions(addDays(today, -RECENT_WINDOW_DAYS)),
  ]);

  const originalAuctionByFamily = await getOriginalAuctionsForUpcomingReopenings(upcomingRaw);
  const upcomingGroups = buildUpcomingGroups(upcomingRaw, originalAuctionByFamily);
  const recentRows = buildRecentAuctionRows(recentRaw);

  const empty: AuctionsPageData = {
    latest: null,
    tiles: null,
    buyerMix: null,
    takeaway: "",
    historySubtitle: "",
    historyCitationRangeLabel: null,
    bidToCoverPoints: [],
    bidToCoverAverageValue: null,
    bidToCoverAverageDisplay: null,
    bidToCoverCaption: "",
    highYieldPoints: [],
    highYieldCaption: "",
    recentRows,
    upcomingGroups,
    citation,
    accessDate: today,
  };
  if (!latest) return empty;

  const family = await getFamilyHistory(latest, FAMILY_WINDOW_SIZE);
  const priorFamily = family.filter((a) => !(a.cusip === latest.cusip && a.auctionDate === latest.auctionDate));

  const tiles = buildLatestAuctionTiles(
    latest,
    priorFamily.map((p) => p.bidToCover).filter((v): v is string => v != null),
  );
  const buyerMix = buildBuyerMix(latest);
  const takeaway = buildTakeawaySentence(latest, priorFamily);
  const historySubtitle = buildHistorySubtitle(family);
  const historyCitationRangeLabel =
    family.length > 0 ? `${familyLabel(family[family.length - 1]!)} auctions of ${formatMonthYear(family[0]!.auctionDate)}–${formatMonthYear(family[family.length - 1]!.auctionDate)}` : null;

  const bidToCoverPoints = buildBidToCoverPoints(family, latest.auctionDate);
  const bidToCoverValues = family.map((a) => a.bidToCover).filter((v): v is string => v != null);
  const bidToCoverAverageExact = trailingAverage(bidToCoverValues);
  const bidToCoverAverageValue = bidToCoverAverageExact != null ? Number(bidToCoverAverageExact) : null;
  const bidToCoverAverageDisplay = bidToCoverAverageExact != null ? `${roundDecimalString(bidToCoverAverageExact, 2)}×` : null;
  const bidToCoverCaption = buildBidToCoverCaption(bidToCoverPoints, bidToCoverAverageDisplay);

  const highYieldPoints = buildHighYieldPoints(family, latest.auctionDate);
  const highYieldCaption = buildHighYieldCaption(highYieldPoints);

  return {
    latest,
    tiles,
    buyerMix,
    takeaway,
    historySubtitle,
    historyCitationRangeLabel,
    bidToCoverPoints,
    bidToCoverAverageValue,
    bidToCoverAverageDisplay,
    bidToCoverCaption,
    highYieldPoints,
    highYieldCaption,
    recentRows,
    upcomingGroups,
    citation,
    accessDate: today,
  };
}
