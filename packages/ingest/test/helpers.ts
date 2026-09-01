import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { RawObservation } from "../src/lib/types";

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/ingest/test -> repo root is three levels up.
const FIXTURES_ROOT = join(HERE, "..", "..", "..", "db", "fixtures");
export const FIXTURES_RAW_ROOT = join(FIXTURES_ROOT, "raw");
export const FIXTURES_OBSERVATIONS_ROOT = join(FIXTURES_ROOT, "observations");

/** Load a captured API response fixture as parsed JSON. `relPath` is relative to db/fixtures/raw, e.g. "fiscaldata/mts_table_1/2026-07-31.json". */
export function loadRawFixture(relPath: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_RAW_ROOT, relPath), "utf8"));
}

/** Load one of the committed, pre-transformed db/fixtures/observations/*.json files that `pnpm seed` loads into PGlite — e.g. "mts-totals.json". Reading these directly (rather than only re-deriving observations from raw/ in memory) guards against the SHIPPED file drifting from what the parsers currently produce (a stale regen, a hand-edit). */
export function loadObservationFixture(filename: string): RawObservation[] {
  return JSON.parse(readFileSync(join(FIXTURES_OBSERVATIONS_ROOT, filename), "utf8")) as RawObservation[];
}
