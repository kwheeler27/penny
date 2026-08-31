/**
 * DB factory: one interface, two backends. `DATABASE_URL` set -> Neon
 * Postgres (`drizzle-orm/neon-http`); unset -> PGlite (`drizzle-orm/pglite`),
 * zero config, no credentials — the dev/test/seed default (PLAN.md §4).
 *
 * Both branches are driven by the same `schema.ts`, so Neon-compatible SQL
 * is the only SQL this package ever emits.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/db/src -> repo root is three levels up.
const DEFAULT_PGLITE_DATA_DIR = join(HERE, "..", "..", "..", ".pglite", "penny");

export type PennyDb = PgliteDatabase<typeof schema> | NeonHttpDatabase<typeof schema>;

export interface CreateDbOptions {
  /** Neon connection string. Defaults to process.env.DATABASE_URL. */
  databaseUrl?: string;
  /**
   * Directory for a file-backed PGlite instance (persists across process
   * runs — useful for local `pnpm seed` + `pnpm dev`). Omit for an
   * in-memory instance, which is what tests want: isolated, thrown away
   * when the process exits.
   */
  pgliteDataDir?: string;
}

/**
 * Create a fresh db handle. Most callers want the memoized `getDb()` below;
 * use this directly only when you need an isolated instance (tests, or a
 * script that must not share the process-wide singleton).
 */
export function createDb(options: CreateDbOptions = {}): PennyDb {
  const url = options.databaseUrl ?? process.env.DATABASE_URL;
  if (url) {
    return drizzleNeon(neon(url), { schema });
  }
  if (!options.pgliteDataDir) {
    return drizzlePglite(new PGlite(), { schema });
  }
  // PGlite's file-backed mode requires the directory to already exist.
  mkdirSync(options.pgliteDataDir, { recursive: true });
  return drizzlePglite(new PGlite(options.pgliteDataDir), { schema });
}

let cached: PennyDb | undefined;

/**
 * Process-wide memoized db handle, chosen once by env at first call.
 *
 * Unlike `createDb()` (which defaults to an in-memory, thrown-away PGlite —
 * exactly right for test isolation), `getDb()` defaults an unset
 * `DATABASE_URL` to a file-backed PGlite under `.pglite/penny` at the repo
 * root, so `pnpm seed` today and `next dev` tomorrow see the same data
 * instead of each getting a fresh empty database. Vitest sets
 * `process.env.VITEST` in every worker; a test that wants `getDb()`'s
 * singleton behavior specifically (rather than `createDb()` directly) still
 * gets isolated in-memory PGlite, never the shared on-disk one.
 */
export function getDb(): PennyDb {
  if (!cached) {
    // createDb() checks databaseUrl/DATABASE_URL first and ignores
    // pgliteDataDir entirely when Neon applies, so it's safe to always pass
    // this through.
    cached = createDb({
      pgliteDataDir: process.env.VITEST ? undefined : (process.env.PGLITE_DATA_DIR ?? DEFAULT_PGLITE_DATA_DIR),
    });
  }
  return cached;
}

/** True when `getDb()`/`createDb()` (with no explicit databaseUrl) would resolve to Neon rather than PGlite. */
export function isUsingNeon(databaseUrl = process.env.DATABASE_URL): boolean {
  return Boolean(databaseUrl);
}

export { schema };
