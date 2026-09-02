/**
 * Component-markup test for components/ranked-bar-chart.tsx's HistoryPanelV2
 * — the click-to-expand v2 line-chart panel — covering the new
 * [1Y · 5Y · 10Y · All] time-window toggle (Kevin's live-panel feedback,
 * fix/history-chart-polish). Rendered to static HTML via react-dom/server,
 * matching test/auction-components.test.tsx's convention (no jsdom/RTL in
 * this repo's test setup, so a button CLICK can't be simulated here — the
 * window-filtering math itself is covered exhaustively, independent of any
 * component, by packages/viz/test/categoryHistoryLayout.test.ts's
 * `filterHistoryToWindow` suite). This test instead confirms the default
 * ("All") render: the four buttons exist with the right labels and
 * aria-pressed state, and the panel's own "N months, X through Y" heading
 * reflects the (unfiltered, at this default) window truthfully.
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

describe("HistoryPanelV2 — time-window selector", () => {
  it("renders all four window buttons, styled/accessible like the existing FYTD/month toggle, with All pressed by default", () => {
    const html = renderToStaticMarkup(<HistoryPanelV2 label="Social Security" series={SERIES} colorVar="--series-outlays" />);
    expect(html).toContain('role="group"');
    expect(html).toContain(">1Y<");
    expect(html).toContain(">5Y<");
    expect(html).toContain(">10Y<");
    expect(html).toContain(">All<");
    // Exactly one button pressed: "All".
    expect((html.match(/aria-pressed="true"/g) || []).length).toBe(1);
    expect((html.match(/aria-pressed="false"/g) || []).length).toBe(3);
  });

  it('the "N months, X through Y" heading reflects the full series at the default "All" window — every displayed claim stays true', () => {
    const html = renderToStaticMarkup(<HistoryPanelV2 label="Social Security" series={SERIES} colorVar="--series-outlays" />);
    expect(html).toContain("Social Security — 14 months, Jun 2025 through Jul 2026");
  });

  it("still renders the chart and its accessible fallbacks underneath the toggle", () => {
    const html = renderToStaticMarkup(<HistoryPanelV2 label="Social Security" series={SERIES} colorVar="--series-outlays" />);
    expect(html).toContain("<svg");
    expect(html).toContain("<table");
  });
});
