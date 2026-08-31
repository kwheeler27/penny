import path from "node:path";
import { defineConfig } from "vitest/config";

// Node environment (no jsdom/@vitejs/plugin-react) is deliberate: component
// tests render via react-dom/server's renderToStaticMarkup against plain
// React.createElement trees (no JSX-in-test-files requirement), and every
// other test here is pure business logic (formatting, chapter parsing,
// series-data queries against an in-memory PGlite instance). Vitest's
// default esbuild transform already handles the .tsx sources under
// test — a browser-like DOM was never needed. Keeping this dependency-free
// matters on the 8GB dev machine and avoids a package this agent cannot
// pnpm install for itself (see WEB agent handoff report).
export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's "@/*" -> "./*" path mapping — TypeScript's
    // `paths` only affects type-checking, so Vite/Vitest needs its own
    // alias to resolve the same imports at runtime.
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    passWithNoTests: true,
    environment: "node",
  },
});
