/**
 * The published auction calendar — `/TA_WS/securities/upcoming`. Rows here
 * are always `status: "announced"` on first ingest (see
 * `treasurydirect/auction.ts`'s `deriveStatus`) — some already carry a real
 * offering size, others are still TBA (`offering_amount` null) with only a
 * projected `announcement_date`/`issue_date`/`auction_date` (verified live:
 * TreasuryDirect populates those three even before the real announcement).
 * `runAuctionsResultedJob` later upserts the SAME row once it's resulted —
 * this job never needs to know that will happen.
 */
import { tdAuctionResponseSchema, parseTdAuctionResponse } from "../treasurydirect/auction";
import { fetchUpcoming, upcomingUrl, withTdRetry } from "../lib/treasurydirect-client";
import { upsertAuctions, type UpsertAuctionsSummary } from "../lib/upsert-auctions";
import { getDb, type PennyDb } from "@penny/db";

export interface AuctionsUpcomingJobResult {
  recordCount: number;
  summary: UpsertAuctionsSummary;
}

export async function runAuctionsUpcomingJob(db: PennyDb): Promise<AuctionsUpcomingJobResult> {
  const json = await withTdRetry(() => fetchUpcoming());
  const records = tdAuctionResponseSchema.parse(json);
  const raws = parseTdAuctionResponse(records, upcomingUrl());
  const summary = await upsertAuctions(db, raws);
  return { recordCount: records.length, summary };
}

async function main() {
  const db = getDb();
  const result = await runAuctionsUpcomingJob(db);
  console.log(
    `Upcoming auctions ingest complete (${result.recordCount} record(s)): +${result.summary.inserted} ~${result.summary.updated} =${result.summary.unchanged}`,
  );
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
