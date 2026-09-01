/**
 * Integration test for GET /api/category-history against a real (in-memory
 * PGlite) database — the on-demand replacement for the eager
 * getFullCategoryMonthlyHistory(allCategoryIds) call this route's own doc
 * comment describes removing from lib/front-door-data.ts. Mirrors
 * test/front-door-data.test.ts's own setup pattern (same fixture shape:
 * Social Security gets exactly 4 monthly points — today's-seed shape, falls
 * back to the dot plot; National Defense gets a 5th, older point, pushing it
 * past the v2-line-chart threshold).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getDb, observation, series } from "@penny/db";
import { getSeries, type SeriesId } from "@penny/registry";
import { ensureMigrated } from "../lib/db";
import { GET } from "../app/api/category-history/route";

const SOCIAL_SECURITY = "fiscal.mts.outlays.category.social_security" as SeriesId;
const NATIONAL_DEFENSE = "fiscal.mts.outlays.category.national_defense" as SeriesId;
const NEEDED_IDS: SeriesId[] = [SOCIAL_SECURITY, NATIONAL_DEFENSE];

beforeAll(async () => {
  await ensureMigrated();
  const db = getDb();

  await db.insert(series).values(
    NEEDED_IDS.map((id) => {
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

  const publicationTime = new Date("2026-07-31T00:00:00Z");
  const month = (seriesId: SeriesId, periodEnd: string, fiscalYear: number, value: string) => ({
    seriesId,
    periodType: "month" as const,
    periodStart: periodEnd,
    periodEnd,
    fiscalYear,
    value,
    publicationTime,
  });

  await db.insert(observation).values([
    // Social Security — exactly 4 months (today's-seed shape).
    month(SOCIAL_SECURITY, "2024-09-30", 2024, "124187000000"),
    month(SOCIAL_SECURITY, "2025-07-31", 2025, "132746000000"),
    month(SOCIAL_SECURITY, "2026-06-30", 2026, "146737000000"),
    month(SOCIAL_SECURITY, "2026-07-31", 2026, "140676887928.32"),

    // National Defense — the SAME 4 months, plus a 5th, older point that
    // pushes it past the 4-period dot-plot threshold.
    month(NATIONAL_DEFENSE, "2023-09-30", 2023, "70000000000"),
    month(NATIONAL_DEFENSE, "2024-09-30", 2024, "76219000000"),
    month(NATIONAL_DEFENSE, "2025-07-31", 2025, "75544000000"),
    month(NATIONAL_DEFENSE, "2026-06-30", 2026, "82229000000"),
    month(NATIONAL_DEFENSE, "2026-07-31", 2026, "90571408631.42"),
  ]);
});

function requestFor(id: string): NextRequest {
  return new NextRequest(`http://localhost/api/category-history?id=${encodeURIComponent(id)}`);
}

describe("GET /api/category-history", () => {
  it("success path: returns null for a category with exactly 4 ingested months — the dot plot renders instead", async () => {
    const res = await GET(requestFor(SOCIAL_SECURITY));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { series: unknown };
    expect(body.series).toBeNull();
  });

  it("success path: returns the full monthly series, with an exact (not rounded-to-billions) hover figure, once a category's backfill exceeds 4 months", async () => {
    const res = await GET(requestFor(NATIONAL_DEFENSE));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      series: { monthly: Array<{ periodEnd: string; exactDisplay: string; scaledDisplay: string }>; twelveMonthTotal: unknown[] } | null;
    };
    expect(body.series).not.toBeNull();
    expect(body.series!.monthly).toHaveLength(5);
    expect(body.series!.monthly[0]!.periodEnd).toBe("2023-09-30");
    expect(body.series!.monthly[4]!.periodEnd).toBe("2026-07-31");
    // Fewer than 12 months exist — no rolling total yet, never fabricated.
    expect(body.series!.twelveMonthTotal).toHaveLength(0);
    // The July 2026 point's exactDisplay must be the full-precision figure
    // (to the dollar), not scaledDisplay's fixed-billions rounding — this is
    // what fixes the hover's "exact figure" claim (components/ranked-bar-
    // chart.tsx's HistoryPanelV2).
    const july = body.series!.monthly[4]!;
    expect(july.exactDisplay).toBe("$90,571,408,631.42");
    expect(july.scaledDisplay).toBe("$90.6B");
    expect(july.exactDisplay).not.toBe(july.scaledDisplay);
  });

  it("failure path: an id outside the receipts/outlays category allowlist is rejected with 404, never a 500 or an arbitrary registry lookup", async () => {
    const res = await GET(requestFor("fiscal.debt.total_public_debt_outstanding"));
    expect(res.status).toBe(404);
  });

  it("failure path: an empty/missing id is rejected with 404", async () => {
    const res = await GET(requestFor(""));
    expect(res.status).toBe(404);
  });
});
