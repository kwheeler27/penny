/**
 * Regenerates db/fixtures/auctions/*.json — the pre-transformed rows
 * `@penny/db`'s `pnpm seed` loads into local PGlite with zero credentials
 * and zero live API calls (ORCHESTRATION_PROMPT.md), the `auction`-table
 * analogue of build-observation-fixtures.ts. Run this after touching
 * treasurydirect/auction.ts's mapping or refreshing
 * db/fixtures/raw/treasurydirect/*.
 *
 * Writes the FULL real captured history (1,176 resulted auctions + 9
 * upcoming/announced ones) — small enough at this dataset's row count that
 * there's no reason to seed a trimmed subset; every family the auctions
 * page's "own history" chart needs a trailing year for is present.
 *
 * CLI: `pnpm --filter @penny/ingest run build-auction-fixtures`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tdAuctionResponseSchema, parseTdAuctionResponse } from "./treasurydirect/auction";
import { auctionedUrl, upcomingUrl } from "./lib/treasurydirect-client";
import type { RawAuction } from "./lib/types";

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/ingest/src -> repo root is three levels up.
const REPO_ROOT = join(HERE, "..", "..", "..");
const RAW_ROOT = join(REPO_ROOT, "db", "fixtures", "raw", "treasurydirect");
const OUT_DIR = join(REPO_ROOT, "db", "fixtures", "auctions");

function loadRaw(relPath: string): unknown {
  return JSON.parse(readFileSync(join(RAW_ROOT, relPath), "utf8"));
}

/** De-dupe by (cusip, auction_date) — later entries win, mirroring lib/upsert-auctions.ts's real identity key, in case a future refresh's raw snapshots ever overlap. */
function dedupe(rows: readonly RawAuction[]): RawAuction[] {
  const map = new Map<string, RawAuction>();
  for (const r of rows) map.set(`${r.cusip}|${r.auctionDate}`, r);
  return [...map.values()];
}

function write(filename: string, rows: readonly RawAuction[]): void {
  writeFileSync(join(OUT_DIR, filename), JSON.stringify(rows, null, 2) + "\n");
  console.log(`wrote ${rows.length} auction row(s) to db/fixtures/auctions/${filename}`);
}

function main() {
  const resultedJson = loadRaw("auctioned/2023-12-20_to_2026-08-27.json");
  const resultedRecords = tdAuctionResponseSchema.parse(resultedJson);
  const resulted = parseTdAuctionResponse(resultedRecords, auctionedUrl(986)); // days=986 spans this exact captured range — a documented approximation of the real request, not a live re-fetch.

  const upcomingJson = loadRaw("upcoming/2026-09-01.json");
  const upcomingRecords = tdAuctionResponseSchema.parse(upcomingJson);
  const upcoming = parseTdAuctionResponse(upcomingRecords, upcomingUrl());

  write("auctions.json", dedupe([...resulted, ...upcoming]));
}

main();
