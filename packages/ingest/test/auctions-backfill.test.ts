/**
 * Backfill-job-specific tests: calendar-year chunk arithmetic, and the live
 * job's chunking/checkpoint/idempotency behavior end to end against a
 * stubbed `fetch` serving the REAL captured fixture, range-sliced exactly
 * as the live `/securities/search` endpoint would slice it — same pattern
 * as jobs/mts-backfill.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, runMigrations } from "@penny/db";
import { enumerateYearChunks, runAuctionsBackfillJob } from "../src/jobs/auctions-backfill";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, "..", "..", "..", "db", "fixtures", "raw", "treasurydirect", "auctioned", "2023-12-20_to_2026-08-27.json");
const fullFixture: Array<{ auctionDate: string }> = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

function sliceByRange<T extends { auctionDate: string }>(rows: readonly T[], from: string, to: string): T[] {
  return rows.filter((r) => {
    const date = r.auctionDate.slice(0, 10);
    return date >= from && date <= to;
  });
}

async function freshDb() {
  const db = createDb();
  await runMigrations(db);
  return db;
}

describe("enumerateYearChunks", () => {
  it("splits a multi-year range into calendar-year windows, clamped at both ends", () => {
    const chunks = enumerateYearChunks("2024-03-15", "2026-08-27");
    expect(chunks).toEqual([
      { from: "2024-03-15", to: "2024-12-31" },
      { from: "2025-01-01", to: "2025-12-31" },
      { from: "2026-01-01", to: "2026-08-27" },
    ]);
  });

  it("a single-year range produces exactly one (clamped) chunk", () => {
    expect(enumerateYearChunks("2026-01-01", "2026-08-27")).toEqual([{ from: "2026-01-01", to: "2026-08-27" }]);
  });

  it("throws on an inverted range rather than silently returning nothing", () => {
    expect(() => enumerateYearChunks("2026-06-30", "2026-01-01")).toThrow(/after/);
  });
});

describe("runAuctionsBackfillJob", () => {
  const originalFetch = global.fetch;

  function fakeResponse(body: unknown): Response {
    return { ok: true, status: 200, statusText: "OK", json: async () => body } as Response;
  }

  /** Serves the REAL fixture, sliced by whatever [startDate, endDate] the job's own auctionSearchUrl() built. */
  function installFetchStub() {
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const m = /startDate=([\d-]+)&endDate=([\d-]+)/.exec(url);
      if (!m) throw new Error(`unexpected fetch url in auctions-backfill test stub: ${url}`);
      const [, from, to] = m as unknown as [string, string, string];
      return fakeResponse(sliceByRange(fullFixture, from, to));
    }) as unknown as typeof fetch;
  }

  beforeEach(() => installFetchStub());
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("backfills a real 2.7-year window across multiple calendar-year chunks, and re-running is a full no-op", async () => {
    const db = await freshDb();

    const first = await runAuctionsBackfillJob(db, {
      fromDate: "2023-12-20",
      toDate: "2026-08-27",
      progressFilePath: null,
    });

    expect(first.chunksProcessed).toBe(4); // 2023 (partial), 2024, 2025, 2026 (partial)
    expect(first.recordsProcessed).toBe(1176);
    expect(first.inserted).toBe(1176);
    expect(first.updated).toBe(0);

    const second = await runAuctionsBackfillJob(db, {
      fromDate: "2023-12-20",
      toDate: "2026-08-27",
      progressFilePath: null,
    });
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(1176);
  });

  it("a checkpoint file lets a second call skip chunks the first call already completed, without re-fetching them", async () => {
    const db = await freshDb();
    const progressDir = mkdtempSync(join(tmpdir(), "auctions-backfill-test-"));
    const progressFilePath = join(progressDir, "progress.json");
    try {
      const first = await runAuctionsBackfillJob(db, { fromDate: "2023-12-20", toDate: "2026-08-27", progressFilePath });
      expect(first.chunksProcessed).toBe(4);
      expect(first.chunksSkippedViaCheckpoint).toBe(0);
      expect(existsSync(progressFilePath)).toBe(true);
      expect(JSON.parse(readFileSync(progressFilePath, "utf8")).completedThroughDate).toBe("2026-08-27");

      const fetchCallsAfterFirst = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

      const second = await runAuctionsBackfillJob(db, { fromDate: "2023-12-20", toDate: "2026-08-27", progressFilePath });
      expect(second.chunksProcessed).toBe(0);
      expect(second.chunksSkippedViaCheckpoint).toBe(4);
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(fetchCallsAfterFirst);
    } finally {
      rmSync(progressDir, { recursive: true, force: true });
    }
  });

  it("a partially-advanced checkpoint resumes from where it left off, not from the start", async () => {
    const db = await freshDb();
    const progressDir = mkdtempSync(join(tmpdir(), "auctions-backfill-test-"));
    const progressFilePath = join(progressDir, "progress.json");
    try {
      mkdirSync(progressDir, { recursive: true });
      writeFileSync(progressFilePath, JSON.stringify({ completedThroughDate: "2024-12-31" }));

      const result = await runAuctionsBackfillJob(db, { fromDate: "2023-12-20", toDate: "2026-08-27", progressFilePath });
      expect(result.chunksSkippedViaCheckpoint).toBe(2); // 2023 + 2024 already "done"
      expect(result.chunksProcessed).toBe(2); // 2025, 2026
      expect(result.recordsProcessed).toBe(sliceByRange(fullFixture, "2025-01-01", "2026-08-27").length);
    } finally {
      rmSync(progressDir, { recursive: true, force: true });
    }
  });
});
