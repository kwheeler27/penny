import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    // Migrations touch the filesystem (PGlite WASM init); give CI/slow disks
    // headroom without needing a watch/retry loop.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
