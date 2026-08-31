import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @penny/db's PGlite (dev/local) branch loads a WASM Postgres engine via
  // import.meta.url-relative asset paths — Turbopack's bundling of that
  // pattern for the Node.js server target produces a path Node's fs APIs
  // reject ("path argument must be of type string... Received an instance
  // of URL"). Marking the package external makes Next require() it at
  // runtime instead of bundling it, which resolves those asset paths
  // correctly. Irrelevant to prod (DATABASE_URL set -> the Neon branch,
  // @neondatabase/serverless, no WASM) but needed for local dev/build to
  // read real data from the seeded PGlite fallback.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Monorepo: the workspace root (pnpm-workspace.yaml) is two levels up from
  // this project (apps/web -> apps -> repo root). Setting this explicitly
  // avoids Next's "inferred workspace root" warning and, more importantly,
  // makes output file tracing (the Vercel serverless bundle) walk the whole
  // workspace rather than guessing.
  outputFileTracingRoot: path.join(__dirname, "..", ".."),
  // /report/where-the-money-goes reads apps/web/content/chapter-1.* at
  // request/build time via a dynamic fs.readFile (see that route), which
  // Next's static import-graph trace can miss — make sure the narrative
  // agent's content files ship in the deployed bundle regardless.
  outputFileTracingIncludes: {
    "/report/where-the-money-goes": ["./content/**/*"],
  },
};

export default nextConfig;
