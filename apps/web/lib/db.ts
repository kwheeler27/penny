/**
 * Server-only database bootstrap. Never import this from a Client Component
 * — @penny/db pulls in Node built-ins (node:fs, node:path) and, for the
 * PGlite branch, a WASM Postgres engine, none of which exist in a browser
 * bundle. Next's own build will fail loudly (not silently) if a 'use
 * client' file ever imports this, which is the enforcement mechanism here —
 * this repo intentionally doesn't add the `server-only` npm package for one
 * import guard (see WEB agent handoff report on the no-new-deps-without-
 * install constraint).
 *
 * `ensureMigrated()` makes every page resilient to "forgot to run `pnpm
 * seed`": migrations are idempotent (drizzle tracks what's applied in
 * __drizzle_migrations), so calling this before every query is cheap and
 * turns a missing-relation crash into, at worst, a correctly-empty (all-gap)
 * page instead of a 500.
 */
import { getDb, runMigrations, type PennyDb } from "@penny/db";

let migrated: Promise<void> | null = null;

export function ensureMigrated(): Promise<void> {
  if (!migrated) {
    migrated = runMigrations(getDb()).catch((err) => {
      // Reset so a transient failure (e.g. a cold Neon connection) can be
      // retried on the next call rather than permanently wedging the page.
      migrated = null;
      throw err;
    });
  }
  return migrated;
}

export async function db(): Promise<PennyDb> {
  await ensureMigrated();
  return getDb();
}

/**
 * Run a query, treating any failure (unmigrated schema, a cold/unreachable
 * database) as "no data" rather than crashing the page. CLAUDE.md: missing
 * data renders as a gap, never a zero AND never a fatal error for a public
 * read-only instrument — a reader should see "no report" tiles, not a stack
 * trace, if the database is briefly unavailable.
 */
export async function safely<T>(fn: (handle: PennyDb) => Promise<T>, fallback: T): Promise<T> {
  try {
    const handle = await db();
    return await fn(handle);
  } catch (err) {
    console.error("[@penny/web] database query failed, rendering as a gap:", err);
    return fallback;
  }
}
