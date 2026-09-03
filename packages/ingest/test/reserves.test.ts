/**
 * Reserve balances at the Fed (H.4.1, FRED WRBWFRBL — "Wednesday Level," a
 * genuine point-in-time balance, not WRESBAL's week-average; see
 * ../src/fred/wrbwfrbl.ts's header comment) — monetary.fed.reserve_balances.
 * Mirrors the structure of jobs.test.ts (parser + known-value checks) plus
 * upsert.test.ts (idempotency against a real in-memory PGlite instance) for
 * this one series, plus the FRED_API_KEY-unset skip path that's unique to
 * this job.
 */
import { describe, it, expect } from "vitest";
import { createDb, runMigrations, seedSeriesCatalog } from "@penny/db";
import {
  parseWrbwfrblCsv,
  parseWrbwfrblObservations,
  rowsFromFredJson,
  fredObservationsResponseSchema,
  FRED_MISSING_SENTINEL,
} from "../src/fred/wrbwfrbl";
import { upsertObservations } from "../src/lib/upsert";
import { runReservesWeeklyJob } from "../src/jobs/reserves-weekly";
import { loadRawFixtureText } from "./helpers";

const RAW_CSV = loadRawFixtureText("fred/wrbwfrbl/2015-01-07_to_2026-08-26.csv");

describe("WRBWFRBL (reserve balances) — CSV parsing against the raw snapshot", () => {
  const rows = parseWrbwfrblCsv(RAW_CSV);
  const observations = parseWrbwfrblObservations(rows, "2026-09-02T00:00:00Z");

  it("known-value spot check: 2026-08-26, hand-verified against the live FRED CSV export (see SOURCE.md)", () => {
    const row = observations.find((o) => o.periodEnd === "2026-08-26");
    expect(row?.value).toBe("2916824");
    expect(row?.periodType).toBe("day");
    expect(row?.periodStart).toBe("2026-08-26");
    expect(row?.fiscalYear).toBeNull(); // a Fed balance-sheet figure — no Treasury fiscal-year semantics, same as CPI.
  });

  it("a second known-value spot check, at the start of the fixture window", () => {
    const row = observations.find((o) => o.periodEnd === "2015-01-07");
    expect(row?.value).toBe("2710273");
  });

  it("magnitude sanity: latest reading at declared magnitude=millions lands in the trillions, not billions or quadrillions", () => {
    const row = observations.find((o) => o.periodEnd === "2026-08-26")!;
    // 2,916,824 "millions" = $2,916,824,000,000. Total bank reserves at the
    // Fed have run in the low multi-trillions since the post-2020 QE era —
    // this bounds the check to that real order of magnitude without
    // hardcoding a brittle exact-dollar assertion.
    const magnitudeCheck = BigInt(row.value) * 1_000_000n;
    expect(magnitudeCheck).toBeGreaterThan(1_000_000_000_000n); // > $1T
    expect(magnitudeCheck).toBeLessThan(10_000_000_000_000n); // < $10T
  });

  it("every observation falls on a Wednesday — H.4.1's own as-of convention, verified live across the full source history (see SOURCE.md)", () => {
    for (const o of observations) {
      const [y, m, d] = o.periodEnd.split("-").map(Number) as [number, number, number];
      expect(new Date(Date.UTC(y, m - 1, d)).getUTCDay()).toBe(3); // 3 = Wednesday
    }
  });

  it("covers the full committed window with no unexpected gaps: 608 weekly rows, 2015-01-07 through 2026-08-26", () => {
    expect(observations).toHaveLength(608);
    expect(observations[0]?.periodEnd).toBe("2015-01-07");
    expect(observations[observations.length - 1]?.periodEnd).toBe("2026-08-26");
  });
});

describe("WRBWFRBL — missing-value handling", () => {
  it("FRED's '.' sentinel is skipped as a gap on the CSV path, never coerced to zero", () => {
    const csv = "observation_date,WRBWFRBL\n2024-01-03,3200000\n2024-01-10,.\n2024-01-17,3195000\n";
    const rows = parseWrbwfrblCsv(csv);
    expect(rows.find((r) => r.date === "2024-01-10")?.value).toBe(FRED_MISSING_SENTINEL);

    const observations = parseWrbwfrblObservations(rows, "2026-09-02T00:00:00Z");
    expect(observations).toHaveLength(2);
    expect(observations.find((o) => o.periodEnd === "2024-01-10")).toBeUndefined();
    expect(observations.every((o) => o.value !== "0")).toBe(true);
  });

  it("the same sentinel is skipped on the JSON API path via the shared transform", () => {
    const response = fredObservationsResponseSchema.parse({
      observations: [
        { realtime_start: "2024-01-04", realtime_end: "9999-12-31", date: "2024-01-03", value: "3200000" },
        { realtime_start: "2024-01-11", realtime_end: "9999-12-31", date: "2024-01-10", value: "." },
      ],
    });
    const rows = rowsFromFredJson(response);
    const observations = parseWrbwfrblObservations(rows, "2026-09-02T00:00:00Z");
    expect(observations).toHaveLength(1);
    expect(observations[0]?.periodEnd).toBe("2024-01-03");
  });
});

describe("WRBWFRBL ingest idempotency — against real fixture-derived observations in PGlite", () => {
  it("re-ingesting the same data is a no-op the second time; a changed value inserts a revision, never an in-place update", async () => {
    const db = createDb();
    await runMigrations(db);
    await seedSeriesCatalog(db);

    const rows = parseWrbwfrblCsv(RAW_CSV).slice(0, 5);
    const first = parseWrbwfrblObservations(rows, "2026-09-02T00:00:00Z");

    const s1 = await upsertObservations(db, first);
    expect(s1.inserted).toBe(first.length);
    expect(s1.revised).toBe(0);
    expect(s1.unchanged).toBe(0);

    const s2 = await upsertObservations(db, first);
    expect(s2.inserted).toBe(0);
    expect(s2.revised).toBe(0);
    expect(s2.unchanged).toBe(first.length);

    const revised = [{ ...first[0]!, value: "9999999", publicationTime: "2026-09-10T00:00:00Z" }, ...first.slice(1)];
    const s3 = await upsertObservations(db, revised);
    expect(s3.revised).toBe(1);
    expect(s3.unchanged).toBe(first.length - 1);
    expect(s3.inserted).toBe(0);
  });
});

describe("Reserve balances weekly job — FRED_API_KEY unset skip path", () => {
  it("skips loudly, exits without a live call, and returns skipped:true when FRED_API_KEY is unset", async () => {
    const original = process.env.FRED_API_KEY;
    delete process.env.FRED_API_KEY;
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (() => {
      fetchCalled = true;
      throw new Error("fetch should never be called when FRED_API_KEY is unset");
    }) as typeof fetch;

    try {
      const db = createDb();
      await runMigrations(db);
      await seedSeriesCatalog(db);

      const result = await runReservesWeeklyJob(db);
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe("FRED_API_KEY not set");
      expect(result.summary).toBeUndefined();
      expect(fetchCalled).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
      if (original !== undefined) process.env.FRED_API_KEY = original;
    }
  });
});
