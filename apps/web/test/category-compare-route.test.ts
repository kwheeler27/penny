/**
 * Integration test for GET /api/category-compare against a real (in-memory
 * PGlite) database — mirrors test/category-history-route.test.ts's own
 * setup pattern. Seeds 24 months (Jan 2019 - Dec 2020) for the five fixed
 * categories (flat, uninteresting figures — they exist only to confirm the
 * route wires them through) plus THREE of the real "other" outlay
 * categories (income_security, commerce_and_housing_credit, and the
 * negative undistributed_offsetting_receipts), designed by hand so the
 * "everything else" aggregate's peak, baseline, and top-2 contributors are
 * all independently computable — same fixture shape and expected figures
 * as test/category-compare-transform.test.ts's own unit tests, so this
 * test is really confirming the DB round-trip + JSON shape, not re-deriving
 * the math. Every OTHER real outlay category (agriculture, energy, etc.)
 * is left with NO observation rows at all, which doubles as a live check
 * that "no data ingested yet" contributes nothing to the aggregate rather
 * than blocking the route (CLAUDE.md: a gap, never a zero, and never a
 * fatal error).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getDb, observation, series } from "@penny/db";
import { getSeries, type SeriesId } from "@penny/registry";
import { ensureMigrated } from "../lib/db";
import { GET, BIG_FIVE_IDS as ROUTE_BIG_FIVE_IDS } from "../app/api/category-compare/route";
import { BIG_FIVE_COLOR_VARS } from "../components/ranked-bar-chart";

const MEDICARE = "fiscal.mts.outlays.category.medicare" as SeriesId;
const SOCIAL_SECURITY = "fiscal.mts.outlays.category.social_security" as SeriesId;
const NET_INTEREST = "fiscal.mts.outlays.category.net_interest" as SeriesId;
const NATIONAL_DEFENSE = "fiscal.mts.outlays.category.national_defense" as SeriesId;
const HEALTH = "fiscal.mts.outlays.category.health" as SeriesId;
const INCOME_SECURITY = "fiscal.mts.outlays.category.income_security" as SeriesId;
const COMMERCE_HOUSING = "fiscal.mts.outlays.category.commerce_and_housing_credit" as SeriesId;
const UNDISTRIBUTED = "fiscal.mts.outlays.category.undistributed_offsetting_receipts" as SeriesId;

const SEEDED_IDS: SeriesId[] = [MEDICARE, SOCIAL_SECURITY, NET_INTEREST, NATIONAL_DEFENSE, HEALTH, INCOME_SECURITY, COMMERCE_HOUSING, UNDISTRIBUTED];

function isLeapYear(y: number): boolean {
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
}
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function periodEndOf(y: number, m: number): string {
  const lastDay = m === 2 && isLeapYear(y) ? 29 : DAYS_IN_MONTH[m - 1]!;
  return `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

beforeAll(async () => {
  await ensureMigrated();
  const db = getDb();

  await db.insert(series).values(
    SEEDED_IDS.map((id) => {
      const s = getSeries(id)!;
      return {
        id: s.id,
        label: s.label,
        definition: s.definition,
        agency: s.agency,
        dataset: s.dataset,
        datasetUrl: s.datasetUrl,
        citation: s.citation,
        unit: s.unit as "usd",
        magnitude: s.magnitude,
        accountingConcept: s.accountingConcept as "outlay",
        cadence: s.cadence,
      };
    }),
  );

  const publicationTime = new Date("2026-01-31T00:00:00Z");
  const rows: (typeof observation.$inferInsert)[] = [];
  const month = (seriesId: SeriesId, y: number, m: number, value: string) => {
    const periodEnd = periodEndOf(y, m);
    rows.push({ seriesId, periodType: "month", periodStart: periodEnd, periodEnd, fiscalYear: m >= 10 ? y + 1 : y, value, publicationTime });
  };

  for (let y = 2019; y <= 2020; y++) {
    for (let m = 1; m <= 12; m++) {
      // The five fixed categories: flat, uninteresting — they exist only so
      // the route has SOMETHING to return for each; their own math is
      // already covered by test/category-compare-transform.test.ts.
      month(MEDICARE, y, m, "50000000000");
      month(SOCIAL_SECURITY, y, m, "80000000000");
      month(NET_INTEREST, y, m, "20000000000");
      month(NATIONAL_DEFENSE, y, m, "60000000000");
      month(HEALTH, y, m, "40000000000");
      // Income security: $10B/mo through 2019, $30B/mo in 2020.
      month(INCOME_SECURITY, y, m, y === 2019 ? "10000000000" : "30000000000");
      // Commerce and housing credit: $5B/mo through 2019, $15B/mo in 2020.
      month(COMMERCE_HOUSING, y, m, y === 2019 ? "5000000000" : "15000000000");
      // Undistributed offsetting receipts: constant, negative.
      month(UNDISTRIBUTED, y, m, "-2000000000");
    }
  }
  await db.insert(observation).values(rows);
});

function request(): NextRequest {
  return new NextRequest("http://localhost/api/category-compare");
}

describe("GET /api/category-compare", () => {
  it("returns exactly the five fixed categories plus the rest aggregate, in order", async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { series: Array<{ id: string; label: string }> };
    expect(body.series.map((s) => s.id)).toEqual([MEDICARE, SOCIAL_SECURITY, NET_INTEREST, NATIONAL_DEFENSE, HEALTH, "rest"]);
    expect(body.series.find((s) => s.id === "rest")!.label).toBe("Everything else");
  });

  it("the rest aggregate sums income_security + commerce_and_housing_credit + the negative undistributed_offsetting_receipts — never the fixed five, and never blocked by every OTHER un-ingested category", async () => {
    const res = await GET(request());
    const body = (await res.json()) as { series: Array<{ id: string; twelveMonthTotal: Array<{ periodEnd: string; valueWhole: string }> }> };
    const rest = body.series.find((s) => s.id === "rest")!.twelveMonthTotal;
    // Postgres's `numeric(20,4)` observation.value column always returns a
    // 4-decimal-place string (CLAUDE.md's "arbitrary precision" is real —
    // this is just the column's own fixed SCALE, not a rounding loss); the
    // exact-sum math carries that same scale through untouched, so the raw
    // `valueWhole` below reads e.g. "...000.0000", not "...000" — display
    // strings (scaledDisplay/exactDisplay, and the annotation's own copy,
    // asserted below) already round this away, which is why only THESE raw
    // valueWhole assertions need the trailing ".0000".
    // 2019: (10 + 5 - 2)B/mo * 12 = 156B.
    expect(rest.find((p) => p.periodEnd === "2019-12-31")!.valueWhole).toBe("156000000000.0000");
    // 2020: (30 + 15 - 2)B/mo * 12 = 516B — the peak.
    expect(rest.at(-1)!.valueWhole).toBe("516000000000.0000");
  });

  it("computes the annotation server-side from real data, naming the top-2 contributors and their computed share", async () => {
    const res = await GET(request());
    const body = (await res.json()) as { annotation: { anchorPeriodEnd: string; title: string; body: string[]; windowLabel: string } | null };
    expect(body.annotation).not.toBeNull();
    expect(body.annotation!.anchorPeriodEnd).toBe("2020-12-31");
    expect(body.annotation!.windowLabel).toBe("2020");
    // This fixture's rest series never comes back down from its own peak
    // (2020 is flat-but-higher than 2019, and the seeded data ends there),
    // so the peak IS simply the latest reading — the neutral "highest
    // total" wording applies, never an unverified "spike" claim (see
    // lib/category-compare-transform.test.ts's own dedicated spike-wording
    // tests for the receded-from-peak case).
    expect(body.annotation!.title).toBe("Highest 12-month total: Dec 2020, $516.0B");
    expect(body.annotation!.body[0]).toBe("Up $360.0B vs the 12 months ending Dec 2019.");
    // One contributor per body LINE (never joined into one long sentence) —
    // see lib/category-compare-transform.test.ts's own doc comment on why.
    expect(body.annotation!.body[1]).toBe("Income security (+$240.0B) and");
    expect(body.annotation!.body[2]).toBe("Commerce and housing credit (+$120.0B)");
    // The closing line states the top-2 contributors' own exact computed
    // share of the delta, never an unverified adjective.
    expect(body.annotation!.body[3]).toBe("Together, 100% of the increase.");
  });

  it("carries a Table-9-level MTS citation object and the static CBO attribution", async () => {
    const res = await GET(request());
    const body = (await res.json()) as {
      citation: { agency: string; dataset: string; datasetUrl: string; accessedDisplay: string };
      cboCitation: { title: string; url: string; sentence: string };
    };
    expect(body.citation.agency).toBe("U.S. Department of the Treasury, Bureau of the Fiscal Service");
    expect(body.citation.dataset).toContain("Table 9");
    expect(body.cboCitation.url).toBe("https://www.cbo.gov/publication/57539");
    expect(body.cboCitation.title).toBe("Monthly Budget Review: Summary for Fiscal Year 2021");
  });

  it("sets a 15-minute-revalidate Cache-Control header, matching /api/category-history's own lazy-fetch convention", async () => {
    const res = await GET(request());
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=900, stale-while-revalidate=86400");
  });

  it("rejects an unexpected query parameter — a Zod-validated input boundary even with nothing to validate", async () => {
    const res = await GET(new NextRequest("http://localhost/api/category-compare?foo=bar"));
    expect(res.status).toBe(400);
  });
});

// Found in review: the route's BIG_FIVE_IDS and the client component's
// BIG_FIVE_COLOR_VARS are two independently-written lists (a server route
// constant, a "use client" component constant) with no shared import — a
// divergence between them would silently restyle a real category as the
// gray dashed "everything else" aggregate. This is the safety net until
// the two are unified behind one shared export.
describe("BIG_FIVE_IDS (route) vs. BIG_FIVE_COLOR_VARS (ranked-bar-chart component)", () => {
  it("name exactly the same five series ids, in the same order", () => {
    expect(BIG_FIVE_COLOR_VARS.map((c) => c.id)).toEqual(ROUTE_BIG_FIVE_IDS);
  });
});
