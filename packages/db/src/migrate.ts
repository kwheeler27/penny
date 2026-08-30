/**
 * Apply committed migrations (./drizzle/*.sql) to whichever backend the db
 * factory resolves to. Safe to run repeatedly — drizzle's migrator tracks
 * applied migrations in a __drizzle_migrations table.
 *
 * CLI: `tsx src/migrate.ts` (or `pnpm --filter @buck/db run migrate`).
 * Also imported by seed.ts and by tests that need a migrated PGlite handle.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { migrate as migrateNeon } from "drizzle-orm/neon-http/migrator";
import { type BuckDb, isUsingNeon } from "./client";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = join(HERE, "..", "drizzle");

export async function runMigrations(db: BuckDb, databaseUrl = process.env.DATABASE_URL): Promise<void> {
  if (isUsingNeon(databaseUrl)) {
    await migrateNeon(db as Parameters<typeof migrateNeon>[0], { migrationsFolder: MIGRATIONS_FOLDER });
  } else {
    await migratePglite(db as Parameters<typeof migratePglite>[0], { migrationsFolder: MIGRATIONS_FOLDER });
  }
}

async function main() {
  // Extensionless on purpose — see CONTRACTS agent's handoff report and
  // tsconfig.base.json's `moduleResolution: "Bundler"`: a `.js`-suffixed
  // relative import across these packages fails to resolve under Next
  // 16's Turbopack when this module is pulled into apps/web's build (this
  // one-line fix made by the WEB agent after `next build` failed with
  // "Module not found: Can't resolve './client.js'" — packages/db is
  // otherwise outside its ownership; flagged in that agent's report).
  const { getDb } = await import("./client");
  const db = getDb();
  await runMigrations(db);
  console.log("migrations applied");
}

// Only run when invoked directly (`tsx src/migrate.ts`), not on import.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
