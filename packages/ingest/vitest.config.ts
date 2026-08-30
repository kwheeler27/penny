import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    // Reconciliation/upsert tests spin up a real (in-memory) PGlite instance
    // and run migrations — give CI/slow disks headroom, matching @buck/db's
    // own vitest config, without needing a watch/retry loop.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
