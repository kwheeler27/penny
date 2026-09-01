/**
 * `pnpm seed` — makes local dev/UI work possible with zero credentials and
 * zero live API calls (ORCHESTRATION_PROMPT.md: "UI work runs against
 * seeded fixtures, never live APIs").
 *
 * 1. Migrate whichever backend the db factory resolves to.
 * 2. Upsert every @penny/registry series into the `series` table — the
 *    registry YAML is the source of truth; this just mirrors it into SQL.
 * 3. Load observation fixtures, if any exist yet, from
 *    db/fixtures/observations/*.json — a plain JSON array of rows shaped
 *    like NewObservation (seriesId/periodType/periodStart/periodEnd/
 *    fiscalYear/value/publicationTime as ISO strings). This directory is
 *    empty until the ingest workstream lands real API snapshots; an empty
 *    or missing directory is not an error.
 *
 * CLI: `tsx src/seed.ts` (or `pnpm --filter @penny/db run seed`, or the root
 * `pnpm seed`).
 */
import { fileURLToPath } from "node:url";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { sql } from "drizzle-orm";
import { SERIES, SERIES_IDS } from "@penny/registry";
import { getDb, type PennyDb } from "./client";
import { runMigrations } from "./migrate";
import { series, observation, auction, type NewObservation, type NewAuction } from "./schema";

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/db/src -> repo root is three levels up.
const REPO_ROOT = join(HERE, "..", "..", "..");
const FIXTURES_DIR = join(REPO_ROOT, "db", "fixtures", "observations");
const AUCTION_FIXTURES_DIR = join(REPO_ROOT, "db", "fixtures", "auctions");

export async function seedSeriesCatalog(db: PennyDb): Promise<number> {
  const rows = SERIES_IDS.map((id) => {
    const s = SERIES[id];
    return {
      id: s.id,
      label: s.label,
      definition: s.definition,
      agency: s.agency,
      dataset: s.dataset,
      datasetUrl: s.datasetUrl,
      citation: s.citation,
      unit: s.unit,
      magnitude: s.magnitude,
      accountingConcept: s.accountingConcept,
      cadence: s.cadence,
    };
  });
  if (rows.length === 0) return 0;
  await db
    .insert(series)
    .values(rows)
    .onConflictDoUpdate({
      target: series.id,
      set: {
        label: sql`excluded.label`,
        definition: sql`excluded.definition`,
        agency: sql`excluded.agency`,
        dataset: sql`excluded.dataset`,
        datasetUrl: sql`excluded.dataset_url`,
        citation: sql`excluded.citation`,
        unit: sql`excluded.unit`,
        magnitude: sql`excluded.magnitude`,
        accountingConcept: sql`excluded.accounting_concept`,
        cadence: sql`excluded.cadence`,
        updatedAt: sql`now()`,
      },
    });
  return rows.length;
}

/**
 * Rows per `INSERT`. PGlite's wire-protocol layer breaks with a raw
 * `RangeError: Invalid array length` once a single query's bound-parameter
 * count crosses roughly 32,767 (reproduced live 2026-09-01: a 7-column,
 * 5,206-row insert — 36,442 params — fails; the same shape at 4,000 rows/
 * 28,000 params succeeds) — an Int16-sized field somewhere in its protocol
 * implementation, not a Postgres/Neon limit. This surfaced for the first
 * time once the MTS backfill produced a single fixture file
 * (`mts-outlays-categories.json`) north of 5,000 rows; every fixture before
 * that backfill was small enough to never hit it. 1,000 rows/batch (7,000
 * params at today's 7-column `observation` shape) keeps a wide, durable
 * margin for both today's files and future growth, on both PGlite and Neon.
 */
const SEED_BATCH_SIZE = 1000;

export async function seedObservationFixtures(db: PennyDb): Promise<number> {
  if (!existsSync(FIXTURES_DIR)) return 0;
  const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"));
  let total = 0;
  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(FIXTURES_DIR, file), "utf8"));
    const rawRows = (Array.isArray(raw) ? raw : [raw]) as Array<Omit<NewObservation, "publicationTime"> & { publicationTime: string }>;
    if (rawRows.length === 0) continue;
    // Fixture JSON carries publicationTime as an ISO string (it's JSON — there's no Date type);
    // Drizzle's timestamp column mapper calls `.toISOString()` on the value it's given, which a
    // plain string doesn't have. Convert here, at the seed boundary, same as lib/upsert.ts does
    // for the live ingest path.
    const rows: NewObservation[] = rawRows.map((row) => ({
      ...row,
      publicationTime: new Date(row.publicationTime),
    }));
    for (let i = 0; i < rows.length; i += SEED_BATCH_SIZE) {
      await db
        .insert(observation)
        .values(rows.slice(i, i + SEED_BATCH_SIZE))
        .onConflictDoNothing();
    }
    total += rows.length;
  }
  return total;
}

/**
 * Loads db/fixtures/auctions/*.json (built by
 * `pnpm --filter @penny/ingest run build-auction-fixtures` from real
 * TreasuryDirect snapshots — see that script's doc comment) into the
 * `auction` table. A plain `onConflictDoNothing()` on the (cusip,
 * auction_date) identity, same as seedObservationFixtures above — fine
 * here because a fixture file is a flat, already-deduplicated snapshot
 * with no announced->resulted transition to apply (that upsert logic
 * lives in @penny/ingest's lib/upsert-auctions.ts, which this package
 * must not depend on). An empty or missing directory is not an error.
 */
export async function seedAuctionFixtures(db: PennyDb): Promise<number> {
  if (!existsSync(AUCTION_FIXTURES_DIR)) return 0;
  const files = readdirSync(AUCTION_FIXTURES_DIR).filter((f) => f.endsWith(".json"));
  let total = 0;
  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(AUCTION_FIXTURES_DIR, file), "utf8"));
    const rawRows = (Array.isArray(raw) ? raw : [raw]) as Array<Omit<NewAuction, "publicationTime"> & { publicationTime: string }>;
    if (rawRows.length === 0) continue;
    // Same publicationTime string->Date conversion as seedObservationFixtures above, and for the same reason.
    const rows: NewAuction[] = rawRows.map((row) => ({ ...row, publicationTime: new Date(row.publicationTime) }));
    for (let i = 0; i < rows.length; i += SEED_BATCH_SIZE) {
      await db.insert(auction).values(rows.slice(i, i + SEED_BATCH_SIZE)).onConflictDoNothing();
    }
    total += rows.length;
  }
  return total;
}

async function main() {
  const db = getDb();
  await runMigrations(db);
  const seriesCount = await seedSeriesCatalog(db);
  console.log(`seeded ${seriesCount} series from @penny/registry`);
  const obsCount = await seedObservationFixtures(db);
  if (obsCount > 0) {
    console.log(`seeded ${obsCount} observation(s) from db/fixtures/observations/*.json`);
  } else {
    console.log(
      "no observation fixtures found at db/fixtures/observations/*.json (expected until the ingest workstream lands real API snapshots)",
    );
  }
  const auctionCount = await seedAuctionFixtures(db);
  if (auctionCount > 0) {
    console.log(`seeded ${auctionCount} auction(s) from db/fixtures/auctions/*.json`);
  } else {
    console.log("no auction fixtures found at db/fixtures/auctions/*.json");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
