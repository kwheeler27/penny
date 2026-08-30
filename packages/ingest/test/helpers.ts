import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/ingest/test -> repo root is three levels up.
export const FIXTURES_RAW_ROOT = join(HERE, "..", "..", "..", "db", "fixtures", "raw");

/** Load a captured API response fixture as parsed JSON. `relPath` is relative to db/fixtures/raw, e.g. "fiscaldata/mts_table_1/2026-07-31.json". */
export function loadRawFixture(relPath: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_RAW_ROOT, relPath), "utf8"));
}
