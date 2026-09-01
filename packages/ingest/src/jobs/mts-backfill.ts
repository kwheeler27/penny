/**
 * MTS full-history backfill — Penny Atlas beat 1 ("the month, ranked — with
 * ‹ › stepper" + per-category history lines both ride on this). Fetches
 * Table 1 (totals), Table 4 (receipts by category), and Table 9 (outlays by
 * function) for every published month, not just the latest, and upserts
 * every observation through the SAME idempotent, revision-aware path
 * (`lib/upsert.ts`) the live monthly cron uses — this is a wider sweep of
 * the identical pipeline, not a separate one.
 *
 * Real, live-verified history (2026-09-01): FiscalData's earliest MTS
 * report for all three tables is record_date=2015-03-31 — there is no
 * report at all for January or February 2015 (Table 1 itself only reaches
 * back that far via that report's own multi-year recap; Table 4/9 never
 * carry a month other than a report's own). Those two months are therefore
 * a genuine source-coverage gap, not a label-mapping one, but the same
 * hard rule applies: never guess a value into existence. The backfill's
 * effective range is discovered at run time (fetchEarliestRecordDate /
 * fetchLatestRecordDate), so it naturally starts at 2015-03-31 without a
 * hardcoded assumption, and naturally extends forward as new reports
 * publish.
 *
 * Chunked + resumable: the full range is walked in `chunkMonths`-sized
 * windows (default 24 — comfortably under FiscalData's own per-request row
 * counts even at today's ~137-report history, and small enough that a
 * killed run only has to re-fetch one window's data). Each chunk's writes
 * go through `upsertObservations`, whose own value-compare idempotency
 * means simply re-running this job from scratch is ALWAYS safe (no
 * duplicates, ever) — the on-disk progress checkpoint
 * (`progressFilePath`) is an efficiency optimization on top of that
 * (skip re-fetching/re-checking chunks already known-complete), not a
 * correctness requirement.
 */
import { mtsSummaryResponseSchema, type MtsSummaryRecord } from "../fiscaldata/mts-summary";
import { mtsReceiptsResponseSchema, type MtsReceiptsRecord } from "../fiscaldata/mts-receipts";
import { mtsOutlaysByFunctionResponseSchema, type MtsOutlaysByFunctionRecord } from "../fiscaldata/mts-outlays";
import {
  fetchFiscalDataRange,
  fetchEarliestRecordDate,
  fetchLatestRecordDate,
  withRetry,
  FISCALDATA_PATHS,
} from "../lib/fiscaldata-client";
import { lastDayOfMonth } from "../lib/period";
import { upsertObservations, type UpsertManySummary } from "../lib/upsert";
import {
  extractOwnPeriodMtsTotals,
  assertReceiptsCategoriesPresent,
  parseMtsReceipts,
  parseMtsOutlaysByFunction,
  reconcileCategoriesToTotal,
  reconcileDeficitIdentity,
  type ReconciliationCheck,
} from "./mts-monthly";
import type { RawObservation } from "../lib/types";
import { getDb, type PennyDb } from "@penny/db";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Chunking — pure, unit-testable date-window arithmetic. Every date here is
// a `YYYY-MM-DD` string built by integer arithmetic (via lib/period.ts),
// never a JS `Date` round-trip.
// ---------------------------------------------------------------------------

export interface MtsBackfillChunk {
  from: string;
  to: string;
}

/** `dateStr` (a month-end date) shifted by `deltaMonths` whole calendar months, landing on THAT month's own last day. */
function shiftMonthEnd(dateStr: string, deltaMonths: number): string {
  const [yearStr, monthStr] = dateStr.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const totalMonths = year * 12 + (month - 1) + deltaMonths;
  const newYear = Math.floor(totalMonths / 12);
  const newMonth = (totalMonths % 12) + 1;
  return lastDayOfMonth(newYear, newMonth);
}

/**
 * Split [fromRecordDate, toRecordDate] (inclusive, both month-end dates)
 * into consecutive `chunkMonths`-month windows. The last chunk is clamped
 * to `toRecordDate` (it may be shorter than `chunkMonths`). Throws on an
 * inverted or non-positive-width range rather than silently returning no
 * chunks, so a caller's date-arithmetic bug surfaces immediately.
 */
export function enumerateMtsBackfillChunks(fromRecordDate: string, toRecordDate: string, chunkMonths: number): MtsBackfillChunk[] {
  if (chunkMonths < 1) throw new Error(`chunkMonths must be >= 1, got ${chunkMonths}`);
  if (fromRecordDate > toRecordDate) {
    throw new Error(`enumerateMtsBackfillChunks: fromRecordDate ${fromRecordDate} is after toRecordDate ${toRecordDate}`);
  }
  const chunks: MtsBackfillChunk[] = [];
  let cursor = fromRecordDate;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const naturalEnd = shiftMonthEnd(cursor, chunkMonths - 1);
    const to = naturalEnd > toRecordDate ? toRecordDate : naturalEnd;
    chunks.push({ from: cursor, to });
    if (to >= toRecordDate) break;
    cursor = shiftMonthEnd(cursor, chunkMonths);
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Progress checkpoint — a plain local JSON file recording the last chunk
// fully upserted. Purely an efficiency optimization (see module doc); never
// consulted for correctness.
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/ingest/src/jobs -> packages/ingest is two levels up.
export const DEFAULT_PROGRESS_FILE_PATH = join(HERE, "..", "..", ".backfill-state", "mts-backfill-progress.json");

interface BackfillProgress {
  /** The `to` record_date of the last chunk that completed (fetched, reconciled, and upserted) without error. */
  completedThroughRecordDate: string;
}

function loadProgress(path: string): BackfillProgress | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed?.completedThroughRecordDate === "string") return parsed as BackfillProgress;
  } catch {
    // A corrupt/partial checkpoint file is never fatal — worst case this
    // job just re-does a chunk it already finished, and upsertObservations
    // makes that a no-op.
  }
  return undefined;
}

function saveProgress(path: string, progress: BackfillProgress): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(progress, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Per-chunk parse — Table 4/9 need no per-report slicing (each report only
// ever describes its own month; verified live across the full history that
// this never overlaps across reports), but Table 1 does (see
// extractOwnPeriodMtsTotals's doc comment).
// ---------------------------------------------------------------------------

export interface MtsBackfillChunkObservations {
  recordDates: string[];
  totals: RawObservation[];
  receipts: RawObservation[];
  outlays: RawObservation[];
  reconciliation: { receipts: ReconciliationCheck[]; outlays: ReconciliationCheck[]; deficitIdentity: ReconciliationCheck[] };
}

/** Turn one chunk's three already-fetched, already-Zod-validated responses into observations + reconciliation checks. Throws (rather than returning a partial result) on any reconciliation failure, any table-date-set mismatch across the three tables, or any receipts-category/outlays-label gap — a chunk either fully checks out or the whole backfill stops, per CLAUDE.md's zero-tolerance rule. */
export function parseMtsBackfillChunk(
  table1: { data: MtsSummaryRecord[] },
  table4: { data: MtsReceiptsRecord[] },
  table9: { data: MtsOutlaysByFunctionRecord[] },
): MtsBackfillChunkObservations {
  const table4Dates = [...new Set(table4.data.map((r) => r.record_date))].sort();
  const table9Dates = [...new Set(table9.data.map((r) => r.record_date))].sort();
  if (JSON.stringify(table4Dates) !== JSON.stringify(table9Dates)) {
    throw new Error(
      `MTS Table 4 and Table 9 report different record_date sets in this chunk (receipts: ${JSON.stringify(table4Dates)}, outlays: ${JSON.stringify(table9Dates)}) — the two tables are expected to publish in lockstep; investigate before trusting either.`,
    );
  }
  const recordDates = table4Dates;

  const totals: RawObservation[] = [];
  for (const recordDate of recordDates) {
    totals.push(...extractOwnPeriodMtsTotals(table1.data, recordDate));
    assertReceiptsCategoriesPresent(table4.data, recordDate);
  }

  const receipts = parseMtsReceipts(table4);
  const outlays = parseMtsOutlaysByFunction(table9);

  const receiptsCheck = reconcileCategoriesToTotal(
    receipts,
    totals.filter((t) => t.seriesId === "fiscal.mts.receipts.total"),
  );
  const outlaysCheck = reconcileCategoriesToTotal(
    outlays,
    totals.filter((t) => t.seriesId === "fiscal.mts.outlays.total"),
  );
  const deficitCheck = reconcileDeficitIdentity(totals);

  const failed = [...receiptsCheck, ...outlaysCheck, ...deficitCheck].filter((c) => !c.ok);
  if (failed.length > 0) {
    throw new Error(`MTS backfill reconciliation failed for record_dates ${JSON.stringify(recordDates)}: ${JSON.stringify(failed, null, 2)}`);
  }

  return { recordDates, totals, receipts, outlays, reconciliation: { receipts: receiptsCheck, outlays: outlaysCheck, deficitIdentity: deficitCheck } };
}

// ---------------------------------------------------------------------------
// Live job
// ---------------------------------------------------------------------------

export interface MtsBackfillOptions {
  /** Defaults to the earliest record_date FiscalData has for MTS Table 1 (discovered live, not hardcoded). */
  fromRecordDate?: string;
  /** Defaults to the latest published record_date. */
  toRecordDate?: string;
  /** Months of history fetched per request/chunk. Default 24 — see module doc. */
  chunkMonths?: number;
  /** Set to `null` to disable checkpointing entirely (e.g. in tests). Defaults to DEFAULT_PROGRESS_FILE_PATH. */
  progressFilePath?: string | null;
}

export interface MtsBackfillChunkResult extends MtsBackfillChunk {
  recordDates: string[];
  totals: UpsertManySummary;
  receipts: UpsertManySummary;
  outlays: UpsertManySummary;
}

export interface MtsBackfillResult {
  fromRecordDate: string;
  toRecordDate: string;
  chunksProcessed: number;
  chunksSkippedViaCheckpoint: number;
  monthsCovered: number;
  totals: { inserted: number; revised: number; unchanged: number };
  receipts: { inserted: number; revised: number; unchanged: number };
  outlays: { inserted: number; revised: number; unchanged: number };
  chunks: MtsBackfillChunkResult[];
}

function sumUpsert(summaries: UpsertManySummary[]): { inserted: number; revised: number; unchanged: number } {
  return {
    inserted: summaries.reduce((n, s) => n + s.inserted, 0),
    revised: summaries.reduce((n, s) => n + s.revised, 0),
    unchanged: summaries.reduce((n, s) => n + s.unchanged, 0),
  };
}

/** Full MTS history backfill: discover the available range, walk it chunk by chunk, reconcile and upsert each chunk in turn. Sequential end to end (one chunk's 3 requests, then the next) — never concurrent, per the "be polite to FiscalData" rule. */
export async function runMtsBackfillJob(db: PennyDb, options: MtsBackfillOptions = {}): Promise<MtsBackfillResult> {
  const chunkMonths = options.chunkMonths ?? 24;
  const progressFilePath = options.progressFilePath === null ? null : options.progressFilePath ?? DEFAULT_PROGRESS_FILE_PATH;

  const fromRecordDate = options.fromRecordDate ?? (await withRetry(() => fetchEarliestRecordDate(FISCALDATA_PATHS.mtsTable1)));
  const toRecordDate = options.toRecordDate ?? (await withRetry(() => fetchLatestRecordDate(FISCALDATA_PATHS.mtsTable1)));

  const allChunks = enumerateMtsBackfillChunks(fromRecordDate, toRecordDate, chunkMonths);

  const progress = progressFilePath ? loadProgress(progressFilePath) : undefined;
  let chunksSkippedViaCheckpoint = 0;

  const chunkResults: MtsBackfillChunkResult[] = [];
  for (const chunk of allChunks) {
    if (progress && chunk.to <= progress.completedThroughRecordDate) {
      chunksSkippedViaCheckpoint++;
      continue;
    }

    const table1Json = await withRetry(() => fetchFiscalDataRange(FISCALDATA_PATHS.mtsTable1, chunk.from, chunk.to, 10_000));
    const table4Json = await withRetry(() => fetchFiscalDataRange(FISCALDATA_PATHS.mtsTable4, chunk.from, chunk.to, 10_000));
    const table9Json = await withRetry(() => fetchFiscalDataRange(FISCALDATA_PATHS.mtsTable9, chunk.from, chunk.to, 10_000));

    const table1 = mtsSummaryResponseSchema.parse(table1Json);
    const table4 = mtsReceiptsResponseSchema.parse(table4Json);
    const table9 = mtsOutlaysByFunctionResponseSchema.parse(table9Json);

    const parsed = parseMtsBackfillChunk(table1, table4, table9);

    const totalsResult = await upsertObservations(db, parsed.totals);
    const receiptsResult = await upsertObservations(db, parsed.receipts);
    const outlaysResult = await upsertObservations(db, parsed.outlays);

    chunkResults.push({ ...chunk, recordDates: parsed.recordDates, totals: totalsResult, receipts: receiptsResult, outlays: outlaysResult });

    if (progressFilePath) saveProgress(progressFilePath, { completedThroughRecordDate: chunk.to });
  }

  const monthsCovered = chunkResults.reduce((n, c) => n + c.recordDates.length, 0);

  return {
    fromRecordDate,
    toRecordDate,
    chunksProcessed: chunkResults.length,
    chunksSkippedViaCheckpoint,
    monthsCovered,
    totals: sumUpsert(chunkResults.map((c) => c.totals)),
    receipts: sumUpsert(chunkResults.map((c) => c.receipts)),
    outlays: sumUpsert(chunkResults.map((c) => c.outlays)),
    chunks: chunkResults,
  };
}

async function main() {
  const db = getDb();
  const result = await runMtsBackfillJob(db);
  console.log(
    `MTS backfill complete: ${result.fromRecordDate}..${result.toRecordDate}, ${result.monthsCovered} month(s) across ${result.chunksProcessed} chunk(s) (${result.chunksSkippedViaCheckpoint} skipped via checkpoint)`,
  );
  console.log(`  totals: +${result.totals.inserted} ~${result.totals.revised} =${result.totals.unchanged}`);
  console.log(`  receipts categories: +${result.receipts.inserted} ~${result.receipts.revised} =${result.receipts.unchanged}`);
  console.log(`  outlay categories: +${result.outlays.inserted} ~${result.outlays.revised} =${result.outlays.unchanged}`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
