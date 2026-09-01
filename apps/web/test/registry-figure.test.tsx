/**
 * RegistryFigure rendered to static HTML against a real (in-memory) DB —
 * the "has a reading," "gap," and "unknown series id" branches. A fresh
 * module (this test file) gets its own empty in-memory PGlite singleton
 * (see series-data.test.ts's header comment), seeded here with exactly one
 * observation.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getDb, observation, seedSeriesCatalog } from "@penny/db";
import type { SeriesId } from "@penny/registry";
import RegistryFigure from "../components/registry-figure";
import { ensureMigrated } from "../lib/db";
import { todayIso } from "../lib/format";

const DEBT_ID = "fiscal.debt.total_public_debt_outstanding" as SeriesId;
const TGA_ID = "fiscal.tga.closing_balance" as SeriesId; // left with zero observations, on purpose

beforeAll(async () => {
  await ensureMigrated();
  const db = getDb();
  await seedSeriesCatalog(db);
  await db.insert(observation).values({
    seriesId: DEBT_ID,
    periodType: "day",
    periodStart: "2026-08-28",
    periodEnd: "2026-08-28",
    fiscalYear: 2026,
    value: "36345909729842.98",
    publicationTime: new Date("2026-08-29T00:00:00Z"),
  });
});

describe("RegistryFigure", () => {
  it("renders a formatted value, the agency/dataset, and the as-of date when a reading exists", async () => {
    const html = renderToStaticMarkup(await RegistryFigure({ id: DEBT_ID, periodType: "day" }));
    expect(html).toContain("$36,345,909,729,842.98");
    expect(html).toContain("Bureau of the Fiscal Service");
    expect(html).toContain("August 28, 2026");
  });

  it("renders a visible gap, never a zero, for a series with no observations", async () => {
    const html = renderToStaticMarkup(await RegistryFigure({ id: TGA_ID, periodType: "day" }));
    expect(html).toContain("No report yet");
    expect(html).not.toMatch(/\$0\b/);
  });

  it("renders a visible error rather than a number for a runtime id that isn't a real registry series", async () => {
    const html = renderToStaticMarkup(await RegistryFigure({ id: "not.a.real.series" as SeriesId }));
    expect(html).toContain("Unknown series id");
  });

  it("cites today's real access date in the citation, never the observation's own period_end date (a different fact, already shown separately as the as-of date)", async () => {
    const html = renderToStaticMarkup(await RegistryFigure({ id: DEBT_ID, periodType: "day" }));
    expect(html).toContain(`Accessed ${todayIso()}.`);
    // The seeded observation's period_end is 2026-08-28 — the pre-fix bug
    // substituted that date into the citation's access-date slot instead.
    expect(html).not.toContain("Accessed 2026-08-28");
  });

  it("sign='absolute' renders the reading's magnitude without a leading minus, for copy that has already named the direction", async () => {
    await getDb()
      .insert(observation)
      .values({
        seriesId: "fiscal.mts.deficit.total" as SeriesId,
        periodType: "fiscal_ytd",
        periodStart: "2025-10-01",
        periodEnd: "2026-07-31",
        fiscalYear: 2026,
        value: "-1798816211853.03",
        publicationTime: new Date("2026-08-29T00:00:00Z"),
      });
    const asPublished = renderToStaticMarkup(
      await RegistryFigure({ id: "fiscal.mts.deficit.total" as SeriesId, periodType: "fiscal_ytd" }),
    );
    // formatExactUsd renders a true minus sign (U+2212), not an ASCII hyphen.
    expect(asPublished).toContain("−$1,798,816,211,853.03");

    const absolute = renderToStaticMarkup(
      await RegistryFigure({ id: "fiscal.mts.deficit.total" as SeriesId, periodType: "fiscal_ytd", sign: "absolute" }),
    );
    expect(absolute).toContain("$1,798,816,211,853.03");
    expect(absolute).not.toContain("−$1,798,816,211,853.03");
    expect(absolute).not.toContain("-$1,798,816,211,853.03");
  });

  it("renders a persons/households series as a plain grouped headcount — never a currency figure, and never falls through to formatIndexPoint's decimal-tail convention", async () => {
    await getDb()
      .insert(observation)
      .values({
        seriesId: "census.population.resident_total" as SeriesId,
        periodType: "day",
        periodStart: "2025-07-01",
        periodEnd: "2025-07-01",
        fiscalYear: null,
        value: "341784857", // magnitude "ones" — already a whole headcount
        publicationTime: new Date("2026-01-27T00:00:00Z"),
      });
    const html = renderToStaticMarkup(await RegistryFigure({ id: "census.population.resident_total" as SeriesId, periodType: "day" }));
    expect(html).toContain("341,784,857");
    // formatIndexPoint's would-be fallback renders 3 decimals unconditionally.
    expect(html).not.toContain("341,784,857.000");
    expect(html).not.toContain("$341,784,857");
  });
});
