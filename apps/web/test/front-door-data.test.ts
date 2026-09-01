/**
 * Integration test for lib/front-door-data.ts against a real (in-memory
 * PGlite) database — verifies the DB -> lib/front-door-transform.ts wiring:
 * ranked rows and shares built from seeded observations, a negative row's
 * negative share, the click-to-expand history payload matching what was
 * seeded, the deficit chart's column count matching the seeded monthly
 * history, and the graceful-gap path for the Census "for scale" facts when
 * no Census observation has been ingested (register the series is not
 * enough — an unfetched reading is still a gap).
 *
 * Deliberately does NOT call @penny/db's seedSeriesCatalog(): that seeds
 * every @penny/registry series (37 rows, including the census.* series) in
 * one bulk insert. This file seeds only the handful of `series` rows its
 * own fixtures actually reference, so the test stays a fast, minimal,
 * self-contained fixture of exactly the MTS/debt/TGA series it exercises —
 * the Census gap path below is covered on its own terms (registered but
 * unfetched), not by this scoped seed omitting it.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, observation, series } from "@penny/db";
import { getSeries, type SeriesId } from "@penny/registry";
import { ensureMigrated } from "../lib/db";
import { getFrontDoorData } from "../lib/front-door-data";

const OUTLAYS_TOTAL = "fiscal.mts.outlays.total" as SeriesId;
const RECEIPTS_TOTAL = "fiscal.mts.receipts.total" as SeriesId;
const DEFICIT_TOTAL = "fiscal.mts.deficit.total" as SeriesId;
const SOCIAL_SECURITY = "fiscal.mts.outlays.category.social_security" as SeriesId;
const NATIONAL_DEFENSE = "fiscal.mts.outlays.category.national_defense" as SeriesId;
const UNDISTRIBUTED = "fiscal.mts.outlays.category.undistributed_offsetting_receipts" as SeriesId;
const CUSTOMS_DUTIES = "fiscal.mts.receipts.category.customs_duties" as SeriesId;
const INDIVIDUAL_INCOME_TAX = "fiscal.mts.receipts.category.individual_income_tax" as SeriesId;
const NET_INTEREST = "fiscal.mts.outlays.category.net_interest" as SeriesId;
const DEBT_ID = "fiscal.debt.total_public_debt_outstanding" as SeriesId;
const TGA_ID = "fiscal.tga.closing_balance" as SeriesId;

const NEEDED_IDS: SeriesId[] = [
  OUTLAYS_TOTAL,
  RECEIPTS_TOTAL,
  DEFICIT_TOTAL,
  SOCIAL_SECURITY,
  NATIONAL_DEFENSE,
  UNDISTRIBUTED,
  CUSTOMS_DUTIES,
  INDIVIDUAL_INCOME_TAX,
  NET_INTEREST,
  DEBT_ID,
  TGA_ID,
];

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
        // Both casts are safe: every id in NEEDED_IDS is a fiscal.* series
        // (unit "usd", a fiscal accountingConcept), never one of the
        // census.* ids this scoped seed deliberately omits (see header
        // comment) — narrower than packages/db's actual enum values, which
        // now also accept "persons"/"households"/"population".
        unit: s.unit as "usd",
        magnitude: s.magnitude,
        accountingConcept: s.accountingConcept as "receipt" | "outlay" | "deficit" | "debt" | "balance" | "interest" | "price_index" | "projection",
        cadence: s.cadence,
      };
    }),
  );

  const FYTD = { periodType: "fiscal_ytd" as const, periodStart: "2025-10-01", periodEnd: "2026-07-31", fiscalYear: 2026 };
  const MONTH = { periodType: "month" as const, periodStart: "2026-07-01", periodEnd: "2026-07-31", fiscalYear: 2026 };
  const publicationTime = new Date("2026-07-31T00:00:00Z");

  await db.insert(observation).values([
    // Totals — both periods, so getMtsFlow resolves for each.
    { seriesId: OUTLAYS_TOTAL, ...FYTD, value: "6284235715734.18", publicationTime },
    { seriesId: OUTLAYS_TOTAL, ...MONTH, value: "766317750177.27", publicationTime },
    { seriesId: RECEIPTS_TOTAL, ...FYTD, value: "4485419503881.15", publicationTime },
    { seriesId: RECEIPTS_TOTAL, ...MONTH, value: "334009875555.79", publicationTime },
    { seriesId: DEFICIT_TOTAL, ...FYTD, value: "-1798816211853.03", publicationTime },
    { seriesId: DEFICIT_TOTAL, ...MONTH, value: "-432307874621.48", publicationTime },

    // Outlay categories — FYTD (ranked rows + shares).
    { seriesId: SOCIAL_SECURITY, ...FYTD, value: "1384438183069.17", publicationTime },
    { seriesId: NATIONAL_DEFENSE, ...FYTD, value: "803701596629.04", publicationTime },
    { seriesId: UNDISTRIBUTED, ...FYTD, value: "-136620830131.93", publicationTime }, // the negative row
    { seriesId: NET_INTEREST, ...FYTD, value: "931356018861.05", publicationTime },
    { seriesId: SOCIAL_SECURITY, ...MONTH, value: "140676887928.32", publicationTime },
    { seriesId: NATIONAL_DEFENSE, ...MONTH, value: "90571408631.42", publicationTime },

    // Receipt categories — customs duties runs negative in the month view only.
    { seriesId: INDIVIDUAL_INCOME_TAX, ...FYTD, value: "2368957104098.08", publicationTime },
    { seriesId: CUSTOMS_DUTIES, ...FYTD, value: "154472685103.20", publicationTime },
    { seriesId: INDIVIDUAL_INCOME_TAX, ...MONTH, value: "173271094383.06", publicationTime },
    { seriesId: CUSTOMS_DUTIES, ...MONTH, value: "-8546441906.97", publicationTime },

    // Debt / TGA (hero strip).
    { seriesId: DEBT_ID, periodType: "day", periodStart: "2026-08-27", periodEnd: "2026-08-27", fiscalYear: 2026, value: "40077529831942.94", publicationTime },
    { seriesId: TGA_ID, periodType: "day", periodStart: "2026-08-27", periodEnd: "2026-08-27", fiscalYear: 2026, value: "950804", publicationTime }, // magnitude "millions"

    // Social Security's 4-period monthly history (click-to-expand panel).
    { seriesId: SOCIAL_SECURITY, periodType: "month", periodStart: "2024-09-01", periodEnd: "2024-09-30", fiscalYear: 2024, value: "124187000000", publicationTime },
    { seriesId: SOCIAL_SECURITY, periodType: "month", periodStart: "2025-07-01", periodEnd: "2025-07-31", fiscalYear: 2025, value: "132746000000", publicationTime },
    { seriesId: SOCIAL_SECURITY, periodType: "month", periodStart: "2026-06-01", periodEnd: "2026-06-30", fiscalYear: 2026, value: "146737000000", publicationTime },
    // 2026-07-31 already inserted above (the "current month" row IS the history's last point).

    // National defense gets the SAME 4-period monthly history, but ALSO the
    // real fiscal_ytd total at that September close — so this fixture
    // covers both anchor-chip paths: Social Security exercises the
    // honest-fallback path (no fiscal_ytd reading at 2024-09-30 for it),
    // National defense exercises the real-FY-total path.
    { seriesId: NATIONAL_DEFENSE, periodType: "month", periodStart: "2024-09-01", periodEnd: "2024-09-30", fiscalYear: 2024, value: "76219000000", publicationTime },
    { seriesId: NATIONAL_DEFENSE, periodType: "month", periodStart: "2025-07-01", periodEnd: "2025-07-31", fiscalYear: 2025, value: "75544000000", publicationTime },
    { seriesId: NATIONAL_DEFENSE, periodType: "month", periodStart: "2026-06-01", periodEnd: "2026-06-30", fiscalYear: 2026, value: "82229000000", publicationTime },
    // 2026-07 NATIONAL_DEFENSE FYTD/month rows already inserted above.
    {
      seriesId: NATIONAL_DEFENSE,
      periodType: "fiscal_ytd",
      periodStart: "2023-10-01",
      periodEnd: "2024-09-30",
      fiscalYear: 2024,
      value: "874192000000",
      publicationTime,
    },

    // Deficit's monthly history — 3 months, deliberately not 46: this test
    // verifies the WIRING (chart column count == what's actually in the DB),
    // not a specific repo fixture's row count.
    { seriesId: DEFICIT_TOTAL, periodType: "month", periodStart: "2026-05-01", periodEnd: "2026-05-31", fiscalYear: 2026, value: "-292648000000", publicationTime },
    { seriesId: DEFICIT_TOTAL, periodType: "month", periodStart: "2026-06-01", periodEnd: "2026-06-30", fiscalYear: 2026, value: "-120305000000", publicationTime },
    // 2026-07-31 already inserted above as the 3rd month.
  ]);
});

describe("getFrontDoorData", () => {
  it("ranks outlay rows descending by value, with shares computed from the seeded total", async () => {
    const data = await getFrontDoorData();
    const rows = data.outlays.periods.fytd!.rows;
    expect(rows.map((r) => r.id)).toEqual([SOCIAL_SECURITY, NET_INTEREST, NATIONAL_DEFENSE, UNDISTRIBUTED]);
    expect(rows[0]!.shareDisplay).toBe("22.0%");
  });

  it("renders a negative row with a negative share, never clamped to positive", () => {
    return getFrontDoorData().then((data) => {
      const row = data.outlays.periods.fytd!.rows.find((r) => r.id === UNDISTRIBUTED)!;
      expect(row.negative).toBe(true);
      expect(row.shareDisplay.startsWith("−")).toBe(true);
    });
  });

  it("the click-to-expand history payload matches what was actually seeded in the database", async () => {
    const data = await getFrontDoorData();
    const panel = data.outlays.histories[SOCIAL_SECURITY]!;
    expect(panel.points.map((p) => p.periodEnd)).toEqual(["2024-09-30", "2025-07-31", "2026-06-30", "2026-07-31"]);
    // 146737000000 -> $146.7B, matching the seeded row exactly (magnitude "ones").
    expect(panel.points[2]!.scaledDisplay).toBe("$146.7B");
    // No fiscal_ytd reading was seeded for Social Security at 2024-09-30 —
    // the anchor chip falls back to the September MONTH figure, but labeled
    // honestly for what it is, never silently as a fiscal-year total.
    expect(panel.chips[0]).toEqual({ kind: "anchor", label: "September 2024 (prior FY's final month)", display: "$124.2B" });
  });

  it("uses the real fiscal_ytd total for the anchor chip when one was actually ingested at that period_end", async () => {
    const data = await getFrontDoorData();
    const panel = data.outlays.histories[NATIONAL_DEFENSE]!;
    expect(panel.points.map((p) => p.periodEnd)).toEqual(["2024-09-30", "2025-07-31", "2026-06-30", "2026-07-31"]);
    // 874192000000 (the seeded fiscal_ytd reading) -> $874.2B, NOT the
    // September MONTH figure ($76.2B) that would be silently wrong here.
    expect(panel.chips[0]).toEqual({ kind: "anchor", label: "FY2024 full year", display: "$874.2B" });
  });

  it("the deficit chart's column count matches however many months are actually in the database, never a hardcoded count", async () => {
    const data = await getFrontDoorData();
    expect(data.deficitChart!.monthCount).toBe(3);
    expect(data.deficitChart!.columns).toHaveLength(3);
    expect(data.deficitChart!.columns.every((c) => c.isDeficit)).toBe(true);
  });

  it("shows a dynamic negative-month note for the receipts chart, naming the actual category and month that went negative", async () => {
    const data = await getFrontDoorData();
    expect(data.receipts.monthOnlyNote).toContain("Customs duties");
    expect(data.receipts.monthOnlyNote).toContain("July");
  });

  it("renders the Census-dependent facts as a gap (null) — the series exists in the registry but has no ingested reading", async () => {
    const data = await getFrontDoorData();
    expect(getSeries("census.households.total" as SeriesId)).toBeDefined(); // the series IS registered...
    expect(data.forScale.perHouseholdSpend).toBeNull(); // ...but with nothing ingested, it's still a gap.
    expect(data.forScale.debtPerHousehold).toBeNull();
    expect(data.forScale.debtPerResident).toBeNull();
  });

  it("still computes the Census-independent interest-per-tax-dollar fact", async () => {
    const data = await getFrontDoorData();
    expect(data.forScale.interestPerTaxDollar!.valueDisplay).toBe("39¢ per $1");
  });

  it("renders hero cells from seeded debt/TGA/deficit readings", async () => {
    const data = await getFrontDoorData();
    const debtCell = data.heroCells.find((c) => c.label === "Total public debt")!;
    expect(debtCell.valueDisplay).toBe("$40,077,529,831,942.94");
    const tgaCell = data.heroCells.find((c) => c.label === "Treasury cash (TGA)")!;
    expect(tgaCell.valueDisplay).toBe("$950.8B");
  });
});
