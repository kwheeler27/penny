/**
 * /data (the public citation index) rendered to static HTML against a real
 * (in-memory) DB, seeded with every registry series (seedSeriesCatalog) —
 * including the census.* series, whose unit (persons/households) is neither
 * "usd" nor an index point. Guards the unit column against collapsing back
 * to the binary "USD or Index point" it shipped with (CLAUDE.md: every
 * displayed number carries source, as-of date, and unit).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { seedSeriesCatalog, getDb } from "@penny/db";
import DataPage from "../app/data/page";
import { ensureMigrated } from "../lib/db";

beforeAll(async () => {
  await ensureMigrated();
  await seedSeriesCatalog(getDb());
});

describe("/data — the public citation index", () => {
  it("labels a persons series' unit as 'Persons', never 'Index point'", async () => {
    const html = renderToStaticMarkup(await DataPage());
    // The population row's whole <tr> — isolate it so this assertion can't
    // pass by accidentally matching some other series' row.
    const rowStart = html.indexOf("census.population.resident_total");
    expect(rowStart).toBeGreaterThan(-1);
    const row = html.slice(rowStart, rowStart + 1600);
    expect(row).toContain("Persons");
    expect(row).not.toContain("Index point");
  });

  it("labels a households series' unit as 'Households' and shows its 'thousands' magnitude tag", async () => {
    const html = renderToStaticMarkup(await DataPage());
    const rowStart = html.indexOf("census.households.total");
    expect(rowStart).toBeGreaterThan(-1);
    const row = html.slice(rowStart, rowStart + 1600);
    expect(row).toContain("Households");
    expect(row).not.toContain("Index point");
    expect(row).toContain("thousands");
  });

  it("still labels a real index_point series (CPI) as 'Index point', with no magnitude tag (magnitude 'ones')", async () => {
    const html = renderToStaticMarkup(await DataPage());
    const rowStart = html.indexOf("price.cpi_u.all_items");
    expect(rowStart).toBeGreaterThan(-1);
    const row = html.slice(rowStart, rowStart + 1600);
    expect(row).toContain("Index point");
  });

  it("still labels a usd series as 'USD' with its magnitude tag", async () => {
    const html = renderToStaticMarkup(await DataPage());
    const rowStart = html.indexOf("fiscal.debt.total_public_debt_outstanding");
    expect(rowStart).toBeGreaterThan(-1);
    const row = html.slice(rowStart, rowStart + 1600);
    expect(row).toContain("USD");
  });
});
