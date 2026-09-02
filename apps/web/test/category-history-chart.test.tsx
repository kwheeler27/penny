/**
 * Component-markup tests for @penny/viz's CategoryHistoryChart — rendered to
 * static HTML via react-dom/server, matching test/auction-components.test.tsx's
 * convention (no jsdom/RTL in this repo's test setup). @penny/viz itself
 * lists only `react` as a peer dependency (no react-dom), so this
 * component-rendering test lives here in apps/web, which already depends on
 * both react-dom and @penny/viz as real workspace dependencies — no new
 * package is needed.
 *
 * Covers the front door's "beaded chain" fix (Kevin's live-panel feedback,
 * fix/history-chart-polish): both lines become plain polylines with no
 * per-point dots except a single emphasized "latest" marker, while every
 * month stays independently reachable — by mouse hover (a native <title>)
 * AND by keyboard (tabIndex + role="img" + aria-label, the same fix issue #7
 * established for AuctionDotChart/AuctionLineChart) — backed by a
 * redundant, screen-reader-native <table> fallback per line.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CategoryHistoryChart, type CategoryHistoryChartPoint } from "@penny/viz";

function point(periodEnd: string, value: number, label: string): CategoryHistoryChartPoint {
  return { periodEnd, valueWhole: String(value), display: `$${value}`, label };
}

const MONTHLY_14 = [
  point("2025-06-30", 100, "Jun 2025"),
  point("2025-07-31", 110, "Jul 2025"),
  point("2025-08-31", 120, "Aug 2025"),
  point("2025-09-30", 130, "Sep 2025"),
  point("2025-10-31", 140, "Oct 2025"),
  point("2025-11-30", 150, "Nov 2025"),
  point("2025-12-31", 160, "Dec 2025"),
  point("2026-01-31", 170, "Jan 2026"),
  point("2026-02-28", 180, "Feb 2026"),
  point("2026-03-31", 190, "Mar 2026"),
  point("2026-04-30", 200, "Apr 2026"),
  point("2026-05-31", 210, "May 2026"),
  point("2026-06-30", 220, "Jun 2026"),
  point("2026-07-31", 230, "Jul 2026"),
];

const TOTAL_3 = [point("2026-05-31", 1800, "May 2026"), point("2026-06-30", 1900, "Jun 2026"), point("2026-07-31", 2000, "Jul 2026")];

const COLOR = "#112233";

describe("CategoryHistoryChart — marker removal", () => {
  it("renders nothing for an empty monthly series (the caller's job to show a gap note instead)", () => {
    const html = renderToStaticMarkup(<CategoryHistoryChart monthly={[]} total={[]} color={COLOR} />);
    expect(html).toBe("");
  });

  it("draws the monthly series as a thin (1.5px), low-opacity (0.4) polyline", () => {
    const html = renderToStaticMarkup(<CategoryHistoryChart monthly={MONTHLY_14} total={TOTAL_3} color={COLOR} />);
    expect(html).toContain('stroke-width="1.5"');
    expect(html).toContain('stroke-opacity="0.4"');
  });

  it("draws the 12-month total as a bold (2.5px), full-opacity polyline once it exists", () => {
    const html = renderToStaticMarkup(<CategoryHistoryChart monthly={MONTHLY_14} total={TOTAL_3} color={COLOR} />);
    expect(html).toContain('stroke-width="2.5"');
  });

  it("paints exactly one visible marker on the whole chart — the total line's own latest point — when a 12-month total exists", () => {
    const html = renderToStaticMarkup(<CategoryHistoryChart monthly={MONTHLY_14} total={TOTAL_3} color={COLOR} />);
    const visibleMarkers = (html.match(new RegExp(`fill="${COLOR}"`, "g")) || []).length;
    expect(visibleMarkers).toBe(1);
    expect(html).toContain('r="3.5"');
    expect(html).toContain("Jul 2026, 12-month total: $2000 (latest)");
    // No other point — on either line — is that color.
    expect(html).not.toContain("Jul 2026: $230 (latest)");
  });

  it("falls back to the monthly line's own latest point as the one visible marker when there is no 12-month total yet", () => {
    const html = renderToStaticMarkup(<CategoryHistoryChart monthly={MONTHLY_14} total={[]} color={COLOR} />);
    const visibleMarkers = (html.match(new RegExp(`fill="${COLOR}"`, "g")) || []).length;
    expect(visibleMarkers).toBe(1);
    expect(html).toContain("Jul 2026: $230 (latest)");
  });

  it("every non-latest point on both lines paints nothing (transparent) — never a visible dot", () => {
    const html = renderToStaticMarkup(<CategoryHistoryChart monthly={MONTHLY_14} total={TOTAL_3} color={COLOR} />);
    const transparentPoints = (html.match(/fill="transparent"/g) || []).length;
    // 14 monthly + 3 total points, minus the one visible marker.
    expect(transparentPoints).toBe(MONTHLY_14.length + TOTAL_3.length - 1);
  });
});

describe("CategoryHistoryChart — hover AND keyboard access preserved (issue #7, extended)", () => {
  it("keeps every month independently keyboard-focusable with its own accessible name, even though most paint nothing", () => {
    const html = renderToStaticMarkup(<CategoryHistoryChart monthly={MONTHLY_14} total={TOTAL_3} color={COLOR} />);
    const tabStops = (html.match(/tabindex="0"/g) || []).length;
    expect(tabStops).toBe(MONTHLY_14.length + TOTAL_3.length);
    expect(html).toContain("Jun 2025: $100");
    expect(html).toContain("Jan 2026: $170");
    expect(html).toContain("May 2026, 12-month total: $1800");
  });

  it("keeps a native <title> hover target on every point, not just the visible marker", () => {
    const html = renderToStaticMarkup(<CategoryHistoryChart monthly={MONTHLY_14} total={[]} color={COLOR} />);
    expect((html.match(/<title>/g) || []).length).toBe(MONTHLY_14.length);
  });

  it("uses a wider hit target (r=7) than the visible marker (r=3.5) so hover/click stays easy despite nothing being painted", () => {
    const html = renderToStaticMarkup(<CategoryHistoryChart monthly={MONTHLY_14} total={[]} color={COLOR} />);
    expect(html).toContain('r="7"');
  });

  it("backs every point with a redundant, screen-reader-native <table> fallback — one per line", () => {
    const html = renderToStaticMarkup(<CategoryHistoryChart monthly={MONTHLY_14} total={TOTAL_3} color={COLOR} />);
    expect((html.match(/<table/g) || []).length).toBe(2);
    expect(html).toContain("Monthly figures, as published");
    expect(html).toContain("12-month rolling total");
    expect(html).toContain("<caption");
  });

  it("omits the total's hidden table entirely when fewer than 12 months are ingested — never a fabricated total table", () => {
    const html = renderToStaticMarkup(<CategoryHistoryChart monthly={MONTHLY_14} total={[]} color={COLOR} />);
    expect((html.match(/<table/g) || []).length).toBe(1);
    expect(html).not.toContain("12-month rolling total");
  });
});
