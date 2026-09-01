/**
 * Backfill-job-specific tests: chunk-window arithmetic, per-chunk parsing
 * (including the table-date-set-divergence guard), and the live job's
 * chunking/checkpoint/idempotency behavior end to end against a stubbed
 * `fetch` serving REAL captured MTS data (never hand-invented) sliced by
 * whatever date range the job actually requests — see reconciliation.test.ts
 * for the exhaustive month-by-month reconciliation coverage; this file is
 * about the backfill job's own orchestration logic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, runMigrations, seedSeriesCatalog } from "@penny/db";
import {
  enumerateMtsBackfillChunks,
  parseMtsBackfillChunk,
  runMtsBackfillJob,
} from "../src/jobs/mts-backfill";
import { mtsSummaryResponseSchema, type MtsSummaryResponse } from "../src/fiscaldata/mts-summary";
import { mtsReceiptsResponseSchema, type MtsReceiptsResponse } from "../src/fiscaldata/mts-receipts";
import { mtsOutlaysByFunctionResponseSchema, type MtsOutlaysByFunctionResponse } from "../src/fiscaldata/mts-outlays";
import { loadRawFixture } from "./helpers";

const RANGE_FILE = "2015-03-31_to_2026-07-31.json";
const fullTable1 = mtsSummaryResponseSchema.parse(loadRawFixture(`fiscaldata/mts_table_1/${RANGE_FILE}`));
const fullTable4 = mtsReceiptsResponseSchema.parse(loadRawFixture(`fiscaldata/mts_table_4/${RANGE_FILE}`));
const fullTable9 = mtsOutlaysByFunctionResponseSchema.parse(loadRawFixture(`fiscaldata/mts_table_9/${RANGE_FILE}`));

function sliceByRange<T extends { record_date: string }>(rows: readonly T[], from: string, to: string): T[] {
  return rows.filter((r) => r.record_date >= from && r.record_date <= to);
}

// ---------------------------------------------------------------------------
// enumerateMtsBackfillChunks — pure date-window arithmetic
// ---------------------------------------------------------------------------

describe("enumerateMtsBackfillChunks", () => {
  it("splits a range evenly divisible by chunkMonths into equal-width windows", () => {
    const chunks = enumerateMtsBackfillChunks("2015-01-31", "2016-12-31", 12);
    expect(chunks).toEqual([
      { from: "2015-01-31", to: "2015-12-31" },
      { from: "2016-01-31", to: "2016-12-31" },
    ]);
  });

  it("clamps the final chunk when the range isn't evenly divisible", () => {
    const chunks = enumerateMtsBackfillChunks("2015-03-31", "2026-07-31", 24);
    expect(chunks[0]).toEqual({ from: "2015-03-31", to: "2017-02-28" });
    const last = chunks[chunks.length - 1]!;
    expect(last.to).toBe("2026-07-31");
    expect(last.from <= last.to).toBe(true);
    // every chunk boundary is contiguous: each chunk's `from` is exactly the month after the previous chunk's `to`.
    for (let i = 1; i < chunks.length; i++) {
      const prevTo = chunks[i - 1]!.to;
      const [y, m] = prevTo.split("-").map(Number) as [number, number];
      const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
      expect(chunks[i]!.from.startsWith(nextMonth)).toBe(true);
    }
  });

  it("a single-month chunk width produces one chunk per month", () => {
    const chunks = enumerateMtsBackfillChunks("2020-01-31", "2020-04-30", 1);
    expect(chunks).toEqual([
      { from: "2020-01-31", to: "2020-01-31" },
      { from: "2020-02-29", to: "2020-02-29" }, // leap year
      { from: "2020-03-31", to: "2020-03-31" },
      { from: "2020-04-30", to: "2020-04-30" },
    ]);
  });

  it("a range narrower than chunkMonths produces exactly one (clamped) chunk", () => {
    const chunks = enumerateMtsBackfillChunks("2020-01-31", "2020-03-31", 24);
    expect(chunks).toEqual([{ from: "2020-01-31", to: "2020-03-31" }]);
  });

  it("throws on an inverted range rather than silently returning nothing", () => {
    expect(() => enumerateMtsBackfillChunks("2020-06-30", "2020-01-31", 12)).toThrow(/after/);
  });

  it("throws on a non-positive chunkMonths", () => {
    expect(() => enumerateMtsBackfillChunks("2020-01-31", "2020-12-31", 0)).toThrow(/chunkMonths/);
  });
});

// ---------------------------------------------------------------------------
// parseMtsBackfillChunk — real data, sliced to a small real window
// ---------------------------------------------------------------------------

describe("parseMtsBackfillChunk", () => {
  const from = "2015-03-31";
  const to = "2015-09-30"; // the 7-month partial-FY2015 window used elsewhere in this suite -- small, and 100% real captured data.

  it("parses a 7-report window into totals/receipts/outlays that all reconcile, with no reconciliation exceptions", () => {
    const result = parseMtsBackfillChunk(
      { data: sliceByRange(fullTable1.data, from, to) },
      { data: sliceByRange(fullTable4.data, from, to) },
      { data: sliceByRange(fullTable9.data, from, to) },
    );
    expect(result.recordDates).toEqual(["2015-03-31", "2015-04-30", "2015-05-31", "2015-06-30", "2015-07-31", "2015-08-31", "2015-09-30"]);
    expect(result.totals).toHaveLength(7 * 6); // 3 series (receipts/outlays/deficit) * 2 periodTypes (month/fiscal_ytd) * 7 reports.
    for (const c of [...result.reconciliation.receipts, ...result.reconciliation.outlays, ...result.reconciliation.deficitIdentity]) {
      expect(c.ok, `${c.periodType} ${c.periodEnd}: diff=${c.difference}`).toBe(true);
    }
  });

  it("throws loudly when Table 4 and Table 9 report different record_date sets, rather than silently reconciling a partial window", () => {
    const table4Slice = sliceByRange(fullTable4.data, from, to);
    const table9Slice = sliceByRange(fullTable9.data, from, to).filter((r) => r.record_date !== "2015-06-30"); // drop one report's outlays entirely.
    expect(() =>
      parseMtsBackfillChunk({ data: sliceByRange(fullTable1.data, from, to) }, { data: table4Slice }, { data: table9Slice }),
    ).toThrow(/different record_date sets/);
  });

  it("throws loudly when a report's Table 1 data is missing entirely for one of Table 4/9's record_dates", () => {
    const table1Slice = sliceByRange(fullTable1.data, from, to).filter((r) => r.record_date !== "2015-06-30");
    expect(() =>
      parseMtsBackfillChunk({ data: table1Slice }, { data: sliceByRange(fullTable4.data, from, to) }, { data: sliceByRange(fullTable9.data, from, to) }),
    ).toThrow(/no Table 1 rows found/);
  });
});

// ---------------------------------------------------------------------------
// runMtsBackfillJob — end to end against a stubbed fetch serving real,
// range-sliced fixture data (same pattern reconciliation.test.ts uses for
// runMtsMonthlyJob), and a real (in-memory) PGlite instance.
// ---------------------------------------------------------------------------

describe("runMtsBackfillJob", () => {
  const originalFetch = global.fetch;

  function fakeResponse(body: unknown): Response {
    return { ok: true, status: 200, statusText: "OK", json: async () => body } as Response;
  }

  /** Serves the REAL full-history fixture responses, range-filtered exactly like the live FiscalData API would for whatever `record_date:gte:X,record_date:lte:Y` (or `sort=record_date`/`sort=-record_date` earliest/latest lookup) the job's own fiscaldata-client helpers construct. */
  function installFetchStub() {
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const table = url.includes("mts_table_1") ? "table1" : url.includes("mts_table_4") ? "table4" : url.includes("mts_table_9") ? "table9" : undefined;
      if (!table) throw new Error(`unexpected fetch url in mts-backfill test stub: ${url}`);
      const full = { table1: fullTable1, table4: fullTable4, table9: fullTable9 }[table] as
        | MtsSummaryResponse
        | MtsReceiptsResponse
        | MtsOutlaysByFunctionResponse;

      // A range fetch's query ALSO includes `sort=record_date` (ascending), so
      // the range-filter check must run BEFORE the earliest/latest single-row
      // checks below, not after -- otherwise every range fetch would be
      // mistaken for an "earliest" lookup and only ever return one row.
      // buildUrl() runs the filter value through encodeURIComponent, so
      // ":"/"," arrive percent-encoded -- decode before matching.
      const rangeMatch = /filter=record_date:gte:([\d-]+),record_date:lte:([\d-]+)/.exec(decodeURIComponent(url));
      if (rangeMatch) {
        const [, from, to] = rangeMatch as unknown as [string, string, string];
        // `full.data` is a union of the three tables' record arrays here (picked at runtime via `table`), which TS can't
        // distribute through sliceByRange's generic cleanly -- every element still has `record_date`, which is all this test stub needs.
        return fakeResponse({ data: sliceByRange(full.data as Array<{ record_date: string }>, from, to), meta: full.meta });
      }
      if (url.includes("sort=-record_date")) {
        const latest = [...full.data].sort((a, b) => (a.record_date > b.record_date ? -1 : 1))[0];
        return fakeResponse({ data: [latest], meta: full.meta });
      }
      if (url.includes("sort=record_date")) {
        const earliest = [...full.data].sort((a, b) => (a.record_date < b.record_date ? -1 : 1))[0];
        return fakeResponse({ data: [earliest], meta: full.meta });
      }
      throw new Error(`unrecognized fetch query shape in mts-backfill test stub: ${url}`);
    }) as unknown as typeof fetch;
  }

  beforeEach(() => installFetchStub());
  afterEach(() => {
    global.fetch = originalFetch;
  });

  async function freshDb() {
    const db = createDb();
    await runMigrations(db);
    await seedSeriesCatalog(db);
    return db;
  }

  it("backfills a small real window (the 7-report partial-FY2015 range) across multiple chunks, and re-running is a full no-op", async () => {
    const db = await freshDb();

    const first = await runMtsBackfillJob(db, {
      fromRecordDate: "2015-03-31",
      toRecordDate: "2015-09-30",
      chunkMonths: 3, // forces 3 chunks: [Mar-May], [Jun-Aug], [Sep] -- exercises multi-chunk behavior, not just one big window.
      progressFilePath: null,
    });

    expect(first.fromRecordDate).toBe("2015-03-31");
    expect(first.toRecordDate).toBe("2015-09-30");
    expect(first.chunksProcessed).toBe(3);
    expect(first.monthsCovered).toBe(7);
    expect(first.totals.inserted).toBe(7 * 6);
    expect(first.totals.revised).toBe(0);
    expect(first.receipts.inserted).toBeGreaterThan(0);
    expect(first.outlays.inserted).toBeGreaterThan(0);

    const second = await runMtsBackfillJob(db, {
      fromRecordDate: "2015-03-31",
      toRecordDate: "2015-09-30",
      chunkMonths: 3,
      progressFilePath: null,
    });
    expect(second.totals.inserted).toBe(0);
    expect(second.totals.revised).toBe(0);
    expect(second.totals.unchanged).toBe(first.totals.inserted);
    expect(second.receipts.inserted).toBe(0);
    expect(second.receipts.unchanged).toBe(first.receipts.inserted);
    expect(second.outlays.inserted).toBe(0);
    expect(second.outlays.unchanged).toBe(first.outlays.inserted);
  });

  it("discovers the full available range on its own (fromRecordDate/toRecordDate omitted) via fetchEarliestRecordDate/fetchLatestRecordDate", async () => {
    const db = await freshDb();
    const result = await runMtsBackfillJob(db, { chunkMonths: 36, progressFilePath: null });
    expect(result.fromRecordDate).toBe("2015-03-31");
    expect(result.toRecordDate).toBe("2026-07-31");
    expect(result.monthsCovered).toBe(137);
  }, 30_000);

  it("a checkpoint file lets a second call skip chunks the first call already completed, without re-fetching them", async () => {
    const db = await freshDb();
    const progressDir = mkdtempSync(join(tmpdir(), "mts-backfill-test-"));
    const progressFilePath = join(progressDir, "progress.json");
    try {
      const first = await runMtsBackfillJob(db, {
        fromRecordDate: "2015-03-31",
        toRecordDate: "2015-09-30",
        chunkMonths: 3,
        progressFilePath,
      });
      expect(first.chunksProcessed).toBe(3);
      expect(first.chunksSkippedViaCheckpoint).toBe(0);
      expect(existsSync(progressFilePath)).toBe(true);
      expect(JSON.parse(readFileSync(progressFilePath, "utf8")).completedThroughRecordDate).toBe("2015-09-30");

      const fetchCallsAfterFirst = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

      const second = await runMtsBackfillJob(db, {
        fromRecordDate: "2015-03-31",
        toRecordDate: "2015-09-30",
        chunkMonths: 3,
        progressFilePath,
      });
      expect(second.chunksProcessed).toBe(0);
      expect(second.chunksSkippedViaCheckpoint).toBe(3);
      // no NEW range-fetch calls were made for the (all-skipped) chunks -- only the 2 fetches (earliest/latest aren't used here since dates are explicit) that a from/to-provided run makes zero of; total call count must not have grown.
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(fetchCallsAfterFirst);
    } finally {
      rmSync(progressDir, { recursive: true, force: true });
    }
  });

  it("a partially-advanced checkpoint resumes from where it left off, not from the start", async () => {
    const db = await freshDb();
    const progressDir = mkdtempSync(join(tmpdir(), "mts-backfill-test-"));
    const progressFilePath = join(progressDir, "progress.json");
    try {
      // Manually seed a checkpoint claiming the first chunk (Mar-May) already completed.
      const { writeFileSync, mkdirSync } = await import("node:fs");
      mkdirSync(progressDir, { recursive: true });
      writeFileSync(progressFilePath, JSON.stringify({ completedThroughRecordDate: "2015-05-31" }));

      const result = await runMtsBackfillJob(db, {
        fromRecordDate: "2015-03-31",
        toRecordDate: "2015-09-30",
        chunkMonths: 3,
        progressFilePath,
      });
      expect(result.chunksSkippedViaCheckpoint).toBe(1);
      expect(result.chunksProcessed).toBe(2);
      // the skipped chunk's own months were never upserted by THIS run (they simply weren't touched -- still zero rows for them in this fresh db), while the two processed chunks (Jun-Aug, Sep) were.
      expect(result.monthsCovered).toBe(4); // Jun, Jul, Aug, Sep
    } finally {
      rmSync(progressDir, { recursive: true, force: true });
    }
  });
});
