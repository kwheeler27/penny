/**
 * Component-markup tests for components/ranked-bar-chart.tsx's "Compare the
 * big five" disclosure (Act I only, spending-history-scrub) — rendered to
 * static HTML via react-dom/server, matching this repo's existing
 * no-jsdom/RTL convention (test/auction-components.test.tsx). A button
 * click can't be simulated here, so this covers only what a static render
 * can honestly assert: the button exists (with the right initial
 * aria-expanded state) exactly when the new `compareBigFive` prop is set,
 * and is entirely absent otherwise — the explicit-prop gate the approved
 * spec asked for (never an `idPrefix === "spend"` string check).
 *
 * The open/close/reopen FETCH LIFECYCLE — which this file's own static
 * renders can't exercise (there's no jsdom/RTL here to click a button and
 * await a re-render) — is instead covered directly against the exported
 * `shouldIssueLazyFetch` predicate below: a real bug caught in review had
 * closing the panel before its fetch resolved permanently wedge it in the
 * loading state forever (a `useRef` "already requested" flag that never
 * reset), reproducible without mounting any React at all once the guard is
 * expressed as a pure function of (open, data).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RankedBarChart, { shouldIssueLazyFetch } from "../components/ranked-bar-chart";
import type { RankedPeriod } from "../lib/front-door-transform";

const PERIOD: RankedPeriod = {
  periodLabel: "Test month",
  rows: [{ id: "cat-a", label: "Category A", valueWhole: "100000000000", exactDisplay: "$100,000,000,000", scaledDisplay: "$100.0B", shareDisplay: "100.0%", negative: false }],
  totalWhole: "100000000000",
  totalDisplay: "$100.0B",
};

const BASE_PROPS = {
  idPrefix: "spend",
  colorVar: "--series-outlays" as const,
  toggleLabels: { fytd: "Fiscal year to date", month: "Latest month" },
  periods: { fytd: PERIOD, month: PERIOD },
  histories: {},
};

describe('RankedBarChart — "Compare the big five" (compareBigFive prop)', () => {
  it("renders the disclosure button, closed by default, when compareBigFive is set", () => {
    const html = renderToStaticMarkup(<RankedBarChart {...BASE_PROPS} compareBigFive />);
    expect(html).toContain("Compare the big five");
    expect(html).toContain('class="rank-compare-toggle"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("never renders the panel's own contents before the button is opened (no eager fetch/render)", () => {
    const html = renderToStaticMarkup(<RankedBarChart {...BASE_PROPS} compareBigFive />);
    expect(html).not.toContain("rank-compare-panel");
    expect(html).not.toContain("Loading the five largest spending categories");
  });

  it("omits the disclosure entirely when compareBigFive is not set — Act II's usage of this same component", () => {
    const html = renderToStaticMarkup(<RankedBarChart {...BASE_PROPS} />);
    expect(html).not.toContain("Compare the big five");
    expect(html).not.toContain("rank-compare");
  });

  it("omits the disclosure when compareBigFive is explicitly false", () => {
    const html = renderToStaticMarkup(<RankedBarChart {...BASE_PROPS} compareBigFive={false} />);
    expect(html).not.toContain("Compare the big five");
  });
});

describe("shouldIssueLazyFetch — a pure state-machine model of the open→close→reopen fetch lifecycle", () => {
  it("does not fetch while closed, even with no prior data", () => {
    expect(shouldIssueLazyFetch(false, undefined)).toBe(false);
  });

  it("fetches on first open, before any data exists", () => {
    expect(shouldIssueLazyFetch(true, undefined)).toBe(true);
  });

  it("does not re-fetch while still open once data has resolved (success or failure)", () => {
    expect(shouldIssueLazyFetch(true, { some: "payload" })).toBe(false);
    expect(shouldIssueLazyFetch(true, null)).toBe(false);
  });

  it("does not fetch once closed, regardless of whether data ever resolved", () => {
    expect(shouldIssueLazyFetch(false, undefined)).toBe(false);
    expect(shouldIssueLazyFetch(false, { some: "payload" })).toBe(false);
    expect(shouldIssueLazyFetch(false, null)).toBe(false);
  });

  it("REGRESSION: closing before the fetch resolves, then reopening, issues a fresh fetch — never wedges in loading forever", () => {
    // t0: closed, nothing requested yet.
    let open = false;
    let data: unknown = undefined;
    expect(shouldIssueLazyFetch(open, data)).toBe(false);

    // t1: opened — a fetch is issued.
    open = true;
    expect(shouldIssueLazyFetch(open, data)).toBe(true);

    // t2: closed again BEFORE the in-flight fetch resolved — its `cancelled`
    // flag fires in the effect's cleanup, so `data` is never set; it stays
    // `undefined` forever for that abandoned request.
    open = false;
    expect(shouldIssueLazyFetch(open, data)).toBe(false); // not while closed

    // t3: reopened. The old `useRef`-based guard (found in review) would
    // stay permanently blocked here, since the ref was set true at t1 and
    // never reset — wedging the panel in "Loading…" forever. The
    // data-keyed predicate instead correctly says: still no data, still
    // open — fetch again.
    open = true;
    expect(shouldIssueLazyFetch(open, data)).toBe(true);

    // t4: THIS TIME the fetch resolves before another close.
    data = { some: "payload" };
    expect(shouldIssueLazyFetch(open, data)).toBe(false);
  });
});
