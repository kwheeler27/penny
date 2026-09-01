/**
 * End-to-end job tests against a stubbed `fetch` serving the REAL captured
 * fixtures (never hand-invented), same pattern as mts-backfill.test.ts /
 * dts-cadence-daily.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createDb, runMigrations, getAuctionByCusipAndDate } from "@penny/db";
import { runAuctionsResultedJob } from "../src/jobs/auctions-resulted";
import { runAuctionsUpcomingJob } from "../src/jobs/auctions-upcoming";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = join(HERE, "..", "..", "..", "db", "fixtures", "raw", "treasurydirect");

const auctionedFixture = JSON.parse(readFileSync(join(FIXTURES_ROOT, "auctioned", "2023-12-20_to_2026-08-27.json"), "utf8"));
const upcomingFixture = JSON.parse(readFileSync(join(FIXTURES_ROOT, "upcoming", "2026-09-01.json"), "utf8"));

async function freshDb() {
  const db = createDb();
  await runMigrations(db);
  return db;
}

function fakeResponse(body: unknown): Response {
  return { ok: true, status: 200, statusText: "OK", json: async () => body } as Response;
}

describe("runAuctionsResultedJob", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (!url.includes("/securities/auctioned")) throw new Error(`unexpected fetch url in resulted-job test stub: ${url}`);
      return fakeResponse(auctionedFixture);
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("ingests the full real fixture and upserts every row, and re-running is a full no-op", async () => {
    const db = await freshDb();
    const first = await runAuctionsResultedJob(db, 14);
    expect(first.recordCount).toBe(1176);
    expect(first.summary.inserted).toBe(1176);
    expect(first.summary.updated).toBe(0);

    const second = await runAuctionsResultedJob(db, 14);
    expect(second.summary.inserted).toBe(0);
    expect(second.summary.updated).toBe(0);
    expect(second.summary.unchanged).toBe(1176);
  });

  it("a resulted row is queryable by (cusip, auction_date) afterward, with source_url recorded", async () => {
    const db = await freshDb();
    await runAuctionsResultedJob(db, 14);
    const row = await getAuctionByCusipAndDate(db, "912810US5", "2026-08-20");
    expect(row?.status).toBe("resulted");
    expect(row?.sourceUrl).toContain("/securities/auctioned?days=14");
  });
});

describe("runAuctionsUpcomingJob", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (!url.includes("/securities/upcoming")) throw new Error(`unexpected fetch url in upcoming-job test stub: ${url}`);
      return fakeResponse(upcomingFixture);
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("ingests the published calendar as announced rows, TBA offerings included", async () => {
    const db = await freshDb();
    const result = await runAuctionsUpcomingJob(db);
    expect(result.recordCount).toBe(9);
    expect(result.summary.inserted).toBe(9);

    const tba = await getAuctionByCusipAndDate(db, "912797VG9", "2026-09-08");
    expect(tba?.status).toBe("announced");
    expect(tba?.offeringAmount).toBeNull();
    expect(tba?.announcementDate).toBe("2026-09-03"); // populated even though TBA — verified live behavior.
  });

  it("re-running is a full no-op", async () => {
    const db = await freshDb();
    await runAuctionsUpcomingJob(db);
    const second = await runAuctionsUpcomingJob(db);
    expect(second.summary.inserted).toBe(0);
    expect(second.summary.unchanged).toBe(9);
  });
});

describe("both live jobs run back to back (the ordinary daily-cron case)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/securities/auctioned")) return fakeResponse(auctionedFixture);
      if (url.includes("/securities/upcoming")) return fakeResponse(upcomingFixture);
      throw new Error(`unexpected fetch url in combined-job test stub: ${url}`);
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("inserts every row from both feeds exactly once, with no cross-contamination", async () => {
    // The two real fixtures genuinely don't overlap in auction_date
    // (auctioned's latest is 2026-08-27; upcoming's earliest is
    // 2026-09-02 — verified live 2026-09-01, and expected: an auction
    // moves from the calendar to results on the day it happens). The
    // announced -> resulted UPDATE-not-insert transition itself is
    // exercised with a real, clearly-synthetic pair in
    // upsert-auctions.test.ts; this test guards the ordinary case.
    const db = await freshDb();
    const auctionedResult = await runAuctionsResultedJob(db, 14);
    const upcomingResult = await runAuctionsUpcomingJob(db);
    expect(auctionedResult.summary.inserted).toBe(1176);
    expect(upcomingResult.summary.inserted).toBe(9);
  });
});
