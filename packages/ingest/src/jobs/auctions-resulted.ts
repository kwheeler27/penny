/**
 * Recently auctioned (resulted) securities — Phase 2's auction monitor.
 * `/TA_WS/securities/auctioned?days=N` (verified live 2026-09-01: capped at
 * 250 rows regardless of N — comfortably more than any sane daily lookback
 * needs; see lib/treasurydirect-client.ts). Upserts through the SAME
 * idempotent path (lib/upsert-auctions.ts) the backfill job uses.
 */
import { tdAuctionResponseSchema, parseTdAuctionResponse } from "../treasurydirect/auction";
import { fetchAuctioned, auctionedUrl, withTdRetry } from "../lib/treasurydirect-client";
import { upsertAuctions, type UpsertAuctionsSummary } from "../lib/upsert-auctions";
import { getDb, type PennyDb } from "@penny/db";

export interface AuctionsResultedJobResult {
  days: number;
  recordCount: number;
  summary: UpsertAuctionsSummary;
}

/** Default lookback of 14 days: comfortably covers even a missed run (this cron runs daily), while staying far under the endpoint's 250-row cap for any realistic auction cadence. */
export async function runAuctionsResultedJob(db: PennyDb, days = 14): Promise<AuctionsResultedJobResult> {
  const json = await withTdRetry(() => fetchAuctioned(days));
  const records = tdAuctionResponseSchema.parse(json);
  const raws = parseTdAuctionResponse(records, auctionedUrl(days));
  const summary = await upsertAuctions(db, raws);
  return { days, recordCount: records.length, summary };
}

async function main() {
  const db = getDb();
  const result = await runAuctionsResultedJob(db);
  console.log(
    `Resulted auctions ingest complete (days=${result.days}, ${result.recordCount} record(s)): ` +
      `+${result.summary.inserted} ~${result.summary.updated} (${result.summary.statusTransitions} announced->resulted) =${result.summary.unchanged}`,
  );
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
