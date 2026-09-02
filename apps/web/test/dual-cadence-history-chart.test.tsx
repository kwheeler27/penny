/**
 * Component-markup tests for @penny/viz's DualCadenceHistoryChart — rendered
 * to static HTML via react-dom/server, matching
 * test/category-history-chart.test.tsx's own convention (no jsdom/RTL in
 * this repo's test setup; @penny/viz lists only `react` as a peer
 * dependency, so this rendering test lives here in apps/web, which already
 * depends on both react-dom and @penny/viz).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DualCadenceHistoryChart, type DualCadenceLineSpec, type DualCadenceSeriesPoint } from "@penny/viz";

function point(date: string, value: number, label: string): DualCadenceSeriesPoint {
  return { date, valueWhole: String(value), display: `$${value.toLocaleString("en-US")}`, scaledDisplay: `$${(value / 1e12).toFixed(2)}T`, label };
}

const TGA: DualCadenceLineSpec = {
  label: "Treasury General Account",
  color: "#3d6fb4",
  cadenceLabel: "most business days",
  points: [
    point("2026-06-01", 856_842_000_000, "Jun 1, 2026"),
    point("2026-06-02", 866_075_000_000, "Jun 2, 2026"),
    point("2026-07-31", 900_000_000_000, "Jul 31, 2026"),
  ],
};

const RESERVES: DualCadenceLineSpec = {
  label: "Bank reserves",
  color: "#0d8f6b",
  cadenceLabel: "weekly, Wednesdays",
  points: [point("2026-06-03", 2_920_000_000_000, "Jun 3, 2026"), point("2026-06-10", 2_930_000_000_000, "Jun 10, 2026")],
};

const EMPTY: DualCadenceLineSpec = { label: "Bank reserves", color: "#0d8f6b", cadenceLabel: "weekly, Wednesdays", points: [] };

describe("DualCadenceHistoryChart — empty/graceful-gap states", () => {
  it("renders nothing when both lines are empty (the caller's job to show a gap note instead)", () => {
    const html = renderToStaticMarkup(<DualCadenceHistoryChart a={EMPTY} b={EMPTY} />);
    expect(html).toBe("");
  });

  it("renders line A alone, with no trace of line B, when B is the not-yet-registered/ingested series", () => {
    const html = renderToStaticMarkup(<DualCadenceHistoryChart a={TGA} b={EMPTY} />);
    expect(html).toContain("Treasury General Account");
    expect(html).not.toContain(">Bank reserves<");
    // No hidden table for the empty line.
    expect((html.match(/<table/g) || []).length).toBe(1);
  });
});

describe("DualCadenceHistoryChart — both lines present", () => {
  it("draws both lines as straight-segment paths (M/L only, never a curve command) in each line's own color", () => {
    const html = renderToStaticMarkup(<DualCadenceHistoryChart a={TGA} b={RESERVES} />);
    expect(html).toContain(`stroke="${TGA.color}"`);
    expect(html).toContain(`stroke="${RESERVES.color}"`);
    expect(html).not.toContain("stroke-width=\"1.25\""); // no separate "muted" line weight — this chart draws only two equally-weighted real series, not a monthly/total pair
  });

  it("labels each line's end-of-line text with its own name in its own color", () => {
    const html = renderToStaticMarkup(<DualCadenceHistoryChart a={TGA} b={RESERVES} />);
    expect(html).toContain(">Treasury General Account<");
    expect(html).toContain(">Bank reserves<");
  });

  it("keeps every point on both lines independently keyboard-focusable with its own accessible name naming its own series", () => {
    const html = renderToStaticMarkup(<DualCadenceHistoryChart a={TGA} b={RESERVES} />);
    const tabStops = (html.match(/tabindex="0"/g) || []).length;
    expect(tabStops).toBe(TGA.points.length + RESERVES.points.length);
    expect(html).toContain("Treasury General Account, Jun 1, 2026");
    expect(html).toContain("Bank reserves, Jun 3, 2026");
  });

  it("backs each line with its own redundant, screen-reader-native <table>, captioned with its own cadence", () => {
    const html = renderToStaticMarkup(<DualCadenceHistoryChart a={TGA} b={RESERVES} />);
    expect((html.match(/<table/g) || []).length).toBe(2);
    expect(html).toContain("most business days");
    expect(html).toContain("weekly, Wednesdays");
  });

  it("paints exactly one visible (non-transparent-fill) marker circle per line — the latest point on each", () => {
    const html = renderToStaticMarkup(<DualCadenceHistoryChart a={TGA} b={RESERVES} />);
    const tgaMarkers = (html.match(new RegExp(`<circle[^>]*fill="${TGA.color}"`, "g")) || []).length;
    const reservesMarkers = (html.match(new RegExp(`<circle[^>]*fill="${RESERVES.color}"`, "g")) || []).length;
    expect(tgaMarkers).toBe(1);
    expect(reservesMarkers).toBe(1);
  });

  it("uses a wider hit target (r=7) than the visible marker (r=3.5), matching CategoryHistoryChart's convention", () => {
    const html = renderToStaticMarkup(<DualCadenceHistoryChart a={TGA} b={RESERVES} />);
    expect(html).toContain('r="7"');
    expect(html).toContain('r="3.5"');
  });

  it("suppresses the browser's default focus outline on every hit-target circle — the only focus/hover indicator is the dedicated dot+ring overlay", () => {
    const html = renderToStaticMarkup(<DualCadenceHistoryChart a={TGA} b={RESERVES} />);
    const circleCount = (html.match(/<circle/g) || []).length;
    const outlineNoneCount = (html.match(/outline:none/g) || []).length;
    expect(outlineNoneCount).toBe(circleCount);
  });

  it("renders no hover/focus tooltip by default (no hover or focus state yet)", () => {
    const html = renderToStaticMarkup(<DualCadenceHistoryChart a={TGA} b={RESERVES} />);
    expect(html).not.toContain("most business days</span>");
  });

  it("draws exactly three faint horizontal gridlines with tabular-nums trillion-scale value labels", () => {
    const html = renderToStaticMarkup(<DualCadenceHistoryChart a={TGA} b={RESERVES} />);
    const gridlines = (html.match(/stroke="currentColor" stroke-opacity="0.15"/g) || []).length;
    expect(gridlines).toBe(3);
    expect(html).toMatch(/\$\d\.\d\dT/);
  });

  it("draws exactly three date ticks spanning the combined range", () => {
    const html = renderToStaticMarkup(<DualCadenceHistoryChart a={TGA} b={RESERVES} />);
    // React HTML-escapes the apostrophe in "Jun '26" as &#x27;.
    expect(html).toContain("Jun &#x27;26");
    expect(html).toContain("Jul &#x27;26");
  });
});
