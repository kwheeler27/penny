/**
 * Full auction history backfill — every coupon family needs its own
 * trailing year (and every family's "own history" chart needs more than
 * just the current cron's daily/14-day window) to compare against, per the
 * shared data contract. Walks `/TA_WS/securities/search` (verified live
 * 2026-09-01: no row cap, unlike `/auctioned`'s 250-row ceiling — see
 * lib/treasurydirect-client.ts) in calendar-year chunks, upserting each
 * chunk through the SAME idempotent path (lib/upsert-auctions.ts) the daily
 * jobs use — this is a wider sweep of the identical pipeline, not a
 * separate one.
 *
 * Chunked + resumable, same shape as jobs/mts-backfill.ts: a checkpoint file
 * (`.backfill-state/auctions-backfill-progress.json`, gitignored) records
 * the last calendar year fully upserted so a killed run resumes rather than
 * restarting. Simply re-running the whole thing with the checkpoint cleared
 * is ALSO always safe — `upsertAuctions`' own idempotency guarantees no
 * duplicates — the checkpoint is purely an efficiency optimization on top
 * of that, never a correctness requirement.
 *
 * IMPORTANT — the checkpoint is TARGET-BLIND (same caution as
 * jobs/mts-backfill.ts): the progress file records "which date range is
 * done" but not WHICH DATABASE it was done against. Point this job at a
 * different `DATABASE_URL` (a fresh Neon branch, a different environment,
 * or back to local PGlite) without clearing `.backfill-state/` first, and
 * it will skip chunks as "already done" that the new target has never
 * actually received — a silent, large gap, not a loud failure. Delete (or
 * move) `.backfill-state/auctions-backfill-progress.json` any time the
 * target database changes.
 */
import { tdAuctionResponseSchema, parseTdAuctionResponse } from "../treasurydirect/auction";
import { fetchAuctionSearch, auctionSearchUrl, withTdRetry } from "../lib/treasurydirect-client";
import { upsertAuctions, type UpsertAuctionsSummary } from "../lib/upsert-auctions";
import { getDb, type PennyDb } from "@penny/db";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Chunking — pure, unit-testable calendar-year date-window arithmetic.
// ---------------------------------------------------------------------------

export interface AuctionsBackfillChunk {
  from: string;
  to: string;
}

/** Split [fromDate, toDate] (inclusive `YYYY-MM-DD`) into calendar-year windows, the first/last clamped to the requested bounds. Pure string/integer arithmetic — never a `Date` round-trip. */
export function enumerateYearChunks(fromDate: string, toDate: string): AuctionsBackfillChunk[] {
  if (fromDate > toDate) {
    throw new Error(`enumerateYearChunks: fromDate ${fromDate} is after toDate ${toDate}`);
  }
  const fromYear = Number(fromDate.slice(0, 4));
  const toYear = Number(toDate.slice(0, 4));
  const chunks: AuctionsBackfillChunk[] = [];
  for (let year = fromYear; year <= toYear; year++) {
    chunks.push({
      from: year === fromYear ? fromDate : `${year}-01-01`,
      to: year === toYear ? toDate : `${year}-12-31`,
    });
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Progress checkpoint — see the module doc comment's target-blindness warning.
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/ingest/src/jobs -> packages/ingest is two levels up.
export const DEFAULT_AUCTIONS_BACKFILL_PROGRESS_FILE_PATH = join(HERE, "..", "..", ".backfill-state", "auctions-backfill-progress.json");

interface BackfillProgress {
  completedThroughDate: string;
}

function loadProgress(path: string): BackfillProgress | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed?.completedThroughDate === "string") return parsed as BackfillProgress;
  } catch {
    // A corrupt/partial checkpoint file is never fatal — worst case this job just re-does a chunk it already finished, and upsertAuctions makes that a no-op.
  }
  return undefined;
}

function saveProgress(path: string, progress: BackfillProgress): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(progress, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Live job
// ---------------------------------------------------------------------------

export interface AuctionsBackfillOptions {
  /** Defaults to 1980-01-01 — before TreasuryDirect's earliest available electronic auction record (1979-10-31, verified live 2026-09-01). Safe to leave earlier than actual history: `/search` simply returns whatever's available for a range with no data yet, it never errors. */
  fromDate?: string;
  /** Defaults to today (UTC date). */
  toDate?: string;
  /** Set to `null` to disable checkpointing entirely (e.g. in tests). Defaults to DEFAULT_AUCTIONS_BACKFILL_PROGRESS_FILE_PATH. */
  progressFilePath?: string | null;
}

export interface AuctionsBackfillChunkResult extends AuctionsBackfillChunk {
  recordCount: number;
  summary: UpsertAuctionsSummary;
}

export interface AuctionsBackfillResult {
  fromDate: string;
  toDate: string;
  chunksProcessed: number;
  chunksSkippedViaCheckpoint: number;
  recordsProcessed: number;
  inserted: number;
  updated: number;
  unchanged: number;
  statusTransitions: number;
  chunks: AuctionsBackfillChunkResult[];
}

/** Full auction history backfill: walk the requested range one calendar year at a time, sequentially (never concurrent — the same "be polite to the source" rule every other job in this package follows). */
export async function runAuctionsBackfillJob(db: PennyDb, options: AuctionsBackfillOptions = {}): Promise<AuctionsBackfillResult> {
  const fromDate = options.fromDate ?? "1980-01-01";
  const toDate = options.toDate ?? new Date().toISOString().slice(0, 10);
  const progressFilePath = options.progressFilePath === null ? null : options.progressFilePath ?? DEFAULT_AUCTIONS_BACKFILL_PROGRESS_FILE_PATH;

  const allChunks = enumerateYearChunks(fromDate, toDate);
  const progress = progressFilePath ? loadProgress(progressFilePath) : undefined;
  let chunksSkippedViaCheckpoint = 0;

  const chunkResults: AuctionsBackfillChunkResult[] = [];
  for (const chunk of allChunks) {
    if (progress && chunk.to <= progress.completedThroughDate) {
      chunksSkippedViaCheckpoint++;
      continue;
    }

    const json = await withTdRetry(() => fetchAuctionSearch(chunk.from, chunk.to));
    const records = tdAuctionResponseSchema.parse(json);
    const raws = parseTdAuctionResponse(records, auctionSearchUrl(chunk.from, chunk.to));
    const summary = await upsertAuctions(db, raws);

    chunkResults.push({ ...chunk, recordCount: records.length, summary });
    if (progressFilePath) saveProgress(progressFilePath, { completedThroughDate: chunk.to });
  }

  return {
    fromDate,
    toDate,
    chunksProcessed: chunkResults.length,
    chunksSkippedViaCheckpoint,
    recordsProcessed: chunkResults.reduce((n, c) => n + c.recordCount, 0),
    inserted: chunkResults.reduce((n, c) => n + c.summary.inserted, 0),
    updated: chunkResults.reduce((n, c) => n + c.summary.updated, 0),
    unchanged: chunkResults.reduce((n, c) => n + c.summary.unchanged, 0),
    statusTransitions: chunkResults.reduce((n, c) => n + c.summary.statusTransitions, 0),
    chunks: chunkResults,
  };
}

async function main() {
  const db = getDb();
  const result = await runAuctionsBackfillJob(db);
  console.log(
    `Auctions backfill complete: ${result.fromDate}..${result.toDate}, ${result.recordsProcessed} record(s) across ${result.chunksProcessed} chunk(s) (${result.chunksSkippedViaCheckpoint} skipped via checkpoint)`,
  );
  console.log(`  +${result.inserted} ~${result.updated} (${result.statusTransitions} announced->resulted) =${result.unchanged}`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
