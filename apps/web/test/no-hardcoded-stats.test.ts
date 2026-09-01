/**
 * Sweep test: every figure the front door renders must come from the
 * database through lib/front-door-data.ts / lib/series-data.ts (CLAUDE.md:
 * "its embedded numbers must NOT be hardcoded... every figure renders from
 * the database through the registry citation path"). No such sweep existed
 * in this repo yet (checked before writing this one — see the WEB agent
 * handoff report), so this is a new, narrowly-scoped one: it reads the
 * front door's own page + presentational components + data-orchestration
 * layer as plain text and asserts none of them contain a long run of digits
 * — the shape of a real dollar figure or headcount in this domain (every
 * one of them is at least 6 digits; a page number, a year, a CSS pixel
 * value, or a chart's SVG viewBox constant never is). lib/format.ts and
 * lib/front-door-transform.ts are deliberately EXCLUDED: they are the
 * generic math/formatting layer, expected to contain small structural
 * constants (10n ** BigInt(exponent), padding, decimal places) but never a
 * literal statistic.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");

const FRONT_DOOR_FILES = [
  "app/page.tsx",
  "lib/front-door-data.ts",
  "components/hero-strip.tsx",
  "components/ranked-bar-chart.tsx",
  "components/for-scale-fact.tsx",
  "components/deficit-history-chart.tsx",
  "components/fiscal-bridge.tsx",
  "components/how-borrowing-works.tsx",
];

// A run of 6+ consecutive digits — the shape of a real dollar figure or
// headcount in this domain, and not the shape of any legitimate structural
// constant (years, SVG/CSS geometry, decimal places) in these files.
const LONG_DIGIT_RUN = /\d{6,}/;

describe("no hardcoded statistics on the front door", () => {
  for (const relPath of FRONT_DOOR_FILES) {
    it(`${relPath} contains no long hardcoded numeric literal`, () => {
      const source = readFileSync(join(ROOT, relPath), "utf8");
      const match = source.match(LONG_DIGIT_RUN);
      expect(match, match ? `found "${match[0]}" in ${relPath} — every figure must come from lib/front-door-data.ts, never a literal` : undefined).toBeNull();
    });
  }

  it("app/page.tsx does not contain any of the approved mockup's own example figures verbatim", () => {
    const source = readFileSync(join(ROOT, "app/page.tsx"), "utf8");
    // Spot-checked literals from penny-front-door.html's DATA/HIST script —
    // none of them belong in the real page's source, only in its rendered
    // (database-sourced) output.
    for (const literal of ["1384438183069", "6284235715734", "40077529831942", "132.2M", "342M", "47,500", "303,000"]) {
      expect(source).not.toContain(literal);
    }
  });
});
