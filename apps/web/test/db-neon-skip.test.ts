/**
 * Regression (production, 2026-08-31): ensureMigrated() ran drizzle's
 * migrator on the Neon branch too, and the deployed serverless bundle
 * doesn't contain the migrations folder — so every runtime query threw
 * "Can't find meta/_journal.json" and every page rendered as gaps.
 * Auto-migration is a PGlite-only convenience; on Neon it must be skipped.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const runMigrations = vi.fn(async () => {});
let neon = false;

vi.mock("@penny/db", () => ({
  getDb: () => ({}),
  isUsingNeon: () => neon,
  runMigrations,
}));

describe("ensureMigrated", () => {
  beforeEach(() => {
    vi.resetModules();
    runMigrations.mockClear();
  });

  it("never runs migrations when the database is Neon", async () => {
    neon = true;
    const { ensureMigrated } = await import("../lib/db");
    await ensureMigrated();
    expect(runMigrations).not.toHaveBeenCalled();
  });

  it("still auto-migrates the local PGlite database", async () => {
    neon = false;
    const { ensureMigrated } = await import("../lib/db");
    await ensureMigrated();
    expect(runMigrations).toHaveBeenCalledTimes(1);
  });
});
