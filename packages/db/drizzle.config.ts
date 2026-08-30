import { defineConfig } from "drizzle-kit";

// Neon-compatible SQL only (CLAUDE.md hard rule). `pnpm db:generate` diffs
// this schema against ./drizzle/*.sql and writes the next migration; commit
// the result. Generation doesn't need a live database, so DATABASE_URL is a
// placeholder here — it's only read by drizzle-kit's introspection/push
// commands, which this package doesn't use.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://placeholder/placeholder",
  },
});
