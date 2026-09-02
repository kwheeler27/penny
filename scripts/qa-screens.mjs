#!/usr/bin/env node
/**
 * QA screenshots for manual visual review — NOT a test (no assertions).
 * Builds/starts `next start` against the seeded local PGlite DB, captures
 * full-page screenshots of / and /report/where-the-money-goes at desktop
 * (1440x900) and mobile (375x812), plus one dark-mode shot of /, then kills
 * the server unconditionally (8GB-RAM rule: never leave a server running).
 *
 * Usage: `pnpm qa:screens` (root script) or `node scripts/qa-screens.mjs`.
 * Requires `pnpm --filter @penny/web build` to have already produced
 * apps/web/.next (this script does NOT rebuild, to keep it fast and
 * side-effect-free on repeated runs — run `pnpm --filter @penny/web build`
 * first if you've changed anything).
 *
 * Uses `npx playwright@1.56.1 screenshot` (its bundled chromium is already
 * cached on this machine) rather than adding the `playwright` package as a
 * workspace dependency.
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const WEB_DIR = join(REPO_ROOT, "apps", "web");
const OUT_DIR = "/private/tmp/claude-501/-Users-kevinwheeler-projects/8d6c47a7-9270-4ce7-ac59-d419fe4fd5c5/scratchpad/qa";
const PORT = 3419;
const BASE_URL = `http://localhost:${PORT}`;

const SHOTS = [
  { path: "/", viewport: "1440,900", file: "front-door-desktop.png" },
  { path: "/", viewport: "375,812", file: "front-door-mobile.png" },
  { path: "/report/where-the-money-goes", viewport: "1440,900", file: "chapter-1-desktop.png" },
  { path: "/report/where-the-money-goes", viewport: "375,812", file: "chapter-1-mobile.png" },
  { path: "/", viewport: "1440,900", file: "front-door-desktop-dark.png", colorScheme: "dark" },
  { path: "/auctions", viewport: "1440,900", file: "auctions-desktop.png" },
  { path: "/auctions", viewport: "375,812", file: "auctions-mobile.png" },
  { path: "/auctions", viewport: "1440,900", file: "auctions-desktop-dark.png", colorScheme: "dark" },
];

function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url);
        if (res.ok || (res.status >= 300 && res.status < 500)) {
          resolve();
          return;
        }
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) {
        reject(new Error(`server did not become ready within ${timeoutMs}ms`));
        return;
      }
      setTimeout(tick, 300);
    };
    tick();
  });
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  console.log(`starting next start -p ${PORT} in ${WEB_DIR} ...`);
  const server = spawn("pnpm", ["exec", "next", "start", "-p", String(PORT)], {
    cwd: WEB_DIR,
    detached: true, // own process group, so we can kill next's child processes too
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverOutput = "";
  server.stdout.on("data", (d) => (serverOutput += d.toString()));
  server.stderr.on("data", (d) => (serverOutput += d.toString()));

  const killServer = () => {
    if (server.pid) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        // already dead
      }
    }
  };
  process.on("exit", killServer);

  try {
    await waitForServer(BASE_URL);
    console.log("server ready, capturing screenshots...");

    for (const shot of SHOTS) {
      const outPath = join(OUT_DIR, shot.file);
      const args = [
        "playwright@1.56.1",
        "screenshot",
        "--full-page",
        "--viewport-size",
        shot.viewport,
        "--wait-for-timeout",
        "600",
      ];
      if (shot.colorScheme) args.push("--color-scheme", shot.colorScheme);
      args.push(`${BASE_URL}${shot.path}`, outPath);
      console.log(`  ${shot.file} <- ${shot.path} @ ${shot.viewport}${shot.colorScheme ? ` (${shot.colorScheme})` : ""}`);
      execFileSync("npx", args, { stdio: "inherit" });
    }
    console.log(`done. screenshots written to ${OUT_DIR}`);
  } finally {
    killServer();
  }
}

main().catch((err) => {
  console.error(err);
  console.error("---- server output ----");
  process.exitCode = 1;
});
