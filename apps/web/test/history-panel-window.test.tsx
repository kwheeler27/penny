/**
 * Component-markup test for components/ranked-bar-chart.tsx's HistoryPanelV2
 * — the click-to-expand v2 line-chart panel — covering BOTH toggle groups:
 * the [1Y · 5Y · 10Y · All] time window (Kevin's fix/history-chart-polish
 * feedback) and the new [12-mo avg · 6-mo avg] rolling-average window
 * (spending-history-scrub rev 2: one panel, one linear axis, a bold rolling
 * AVERAGE over the faint monthly line — see that file's own doc comment on
 * HistoryPanelV2). Rendered to static HTML via react-dom/server, matching
 * test/auction-components.test.tsx's convention (no jsdom/RTL in this
 * repo's test setup, so a button CLICK can't be simulated here — the
 * window-filtering and averaging math itself is covered independently by
 * packages/viz's own layout tests). This test instead confirms the default
 * render: every button exists with the right label and aria-pressed state,
 * the panel's own "N months, X through Y" heading reflects the (unfiltered,
 * at this default) window truthfully, and the explanatory note describes
 * the average honestly, and the chart itself (plus its screen-reader table
 * fallbacks) actually renders underneath the toggles.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HistoryPanelV2 } from "../components/ranked-bar-chart";
import type { CategoryHistoryLineSeries, HistoryLinePoint } from "../lib/front-door-transform";

function linePoint(periodEnd: string, monthLabel: string, value: number): HistoryLinePoint {
  return { periodEnd, monthLabel, valueWhole: String(value), scaledDisplay: `$${value}B`, exactDisplay: `$${value},000,000` };
}

const SERIES: CategoryHistoryLineSeries = {
  monthly: [
    linePoint("2025-06-30", "Jun 2025", 100),
    linePoint("2025-07-31", "Jul 2025", 110),
    linePoint("2025-08-31", "Aug 2025", 120),
    linePoint("2025-09-30", "Sep 2025", 130),
    linePoint("2025-10-31", "Oct 2025", 140),
    linePoint("2025-11-30", "Nov 2025", 150),
    linePoint("2025-12-31", "Dec 2025", 160),
    linePoint("2026-01-31", "Jan 2026", 170),
    linePoint("2026-02-28", "Feb 2026", 180),
    linePoint("2026-03-31", "Mar 2026", 190),
    linePoint("2026-04-30", "Apr 2026", 200),
    linePoint("2026-05-31", "May 2026", 210),
    linePoint("2026-06-30", "Jun 2026", 220),
    linePoint("2026-07-31", "Jul 2026", 230),
  ],
  twelveMonthTotal: [linePoint("2026-05-31", "May 2026", 1800), linePoint("2026-06-30", "Jun 2026", 1900), linePoint("2026-07-31", "Jul 2026", 2000)],
};

// 13 months only (< 12 + 1 window of headroom means the FULL series can
// still produce one 12-month average point, but not two) — used below to
// exercise the "average appears once N consecutive months exist" honesty
// check at both window sizes without a second full fixture.
const SHORT_SERIES: CategoryHistoryLineSeries = {
  monthly: SERIES.monthly.slice(0, 5), // 5 months — fewer than even a 6-mo average needs.
  twelveMonthTotal: [],
};

describe("HistoryPanelV2 — time-window selector", () => {
  it("renders all four time-window buttons, with All pressed by default", () => {
    const html = renderToStaticMarkup(<HistoryPanelV2 label="Social Security" series={SERIES} colorVar="--series-outlays" />);
    expect(html).toContain('role="group"');
    expect(html).toContain(">1Y<");
    expect(html).toContain(">5Y<");
    expect(html).toContain(">10Y<");
    expect(html).toContain(">All<");
  });

  it('the "N months, X through Y" heading reflects the full series at the default "All" window — every displayed claim stays true', () => {
    const html = renderToStaticMarkup(<HistoryPanelV2 label="Social Security" series={SERIES} colorVar="--series-outlays" />);
    expect(html).toContain("Social Security — 14 months, Jun 2025 through Jul 2026");
  });

  it("still renders the chart and its accessible fallbacks underneath the toggles — not just the controls row", () => {
    const html = renderToStaticMarkup(<HistoryPanelV2 label="Social Security" series={SERIES} colorVar="--series-outlays" />);
    expect(html).toContain("<svg");
    expect(html).toContain("<table");
  });
});

describe("HistoryPanelV2 — average-window selector (spending-history-scrub rev 2)", () => {
  it("renders both average-window buttons, with 12-mo avg pressed by default", () => {
    const html = renderToStaticMarkup(<HistoryPanelV2 label="Social Security" series={SERIES} colorVar="--series-outlays" />);
    expect(html).toContain(">12-mo avg<");
    expect(html).toContain(">6-mo avg<");
  });

  it("exactly two buttons are pressed by default — All (time window) and 12-mo avg (average window) — every other button unpressed", () => {
    const html = renderToStaticMarkup(<HistoryPanelV2 label="Social Security" series={SERIES} colorVar="--series-outlays" />);
    expect((html.match(/aria-pressed="true"/g) || []).length).toBe(2);
    expect((html.match(/aria-pressed="false"/g) || []).length).toBe(4);
  });

  it("both toggle groups render inside one controls row, matching the approved mockup's layout", () => {
    const html = renderToStaticMarkup(<HistoryPanelV2 label="Social Security" series={SERIES} colorVar="--series-outlays" />);
    expect(html).toContain('class="rank-hist-controls"');
  });
});

describe("HistoryPanelV2 — explanatory note describes the average honestly", () => {
  it("names the rolling-average window (12-mo by default) once it exists", () => {
    const html = renderToStaticMarkup(<HistoryPanelV2 label="Social Security" series={SERIES} colorVar="--series-outlays" />);
    expect(html).toContain("rolling average");
    expect(html).not.toContain("appears once");
  });

  it("says the average has not appeared yet, rather than fabricating one, when fewer than 12 consecutive months exist", () => {
    const html = renderToStaticMarkup(<HistoryPanelV2 label="Social Security" series={SHORT_SERIES} colorVar="--series-outlays" />);
    expect(html).toContain("appears once 12 consecutive months exist");
  });
});
