import { describe, expect, it } from "vitest";
import {
  initialCompareVisibility,
  isCompareSeriesVisible,
  toggleCompareSeries,
  computeVisibleValueDomain,
  decollideEndLabels,
  computeCompareGeometry,
  findNearestCompareMonth,
  type CompareSeriesInput,
  type CompareVisibility,
} from "../src/layout/compareLayout";
import type { HistoryChartPoint } from "../src/layout/averagedHistoryLayout";

function point(periodEnd: string, valueWhole: string): HistoryChartPoint {
  return { periodEnd, valueWhole, display: `$${valueWhole}`, label: periodEnd };
}

const OPTS = { width: 1016, height: 380, padLeft: 64, padRight: 148, padTop: 24, padBottom: 26 };

const FIXED_FIVE: CompareSeriesInput[] = [
  { id: "medicare", points: [point("2026-01-31", "500"), point("2026-02-28", "520"), point("2026-03-31", "540")] },
  { id: "socsec", points: [point("2026-01-31", "900"), point("2026-02-28", "910"), point("2026-03-31", "920")] },
  { id: "netint", points: [point("2026-01-31", "300"), point("2026-02-28", "310"), point("2026-03-31", "320")] },
  { id: "defense", points: [point("2026-01-31", "700"), point("2026-02-28", "710"), point("2026-03-31", "720")] },
  { id: "health", points: [point("2026-01-31", "500"), point("2026-02-28", "505"), point("2026-03-31", "510")] },
];
const REST: CompareSeriesInput = { id: "rest", defaultHidden: true, points: [point("2026-01-31", "1000"), point("2026-02-28", "3800"), point("2026-03-31", "1500")] };
const SIX: CompareSeriesInput[] = [...FIXED_FIVE, REST];

describe("initialCompareVisibility — seeds hiddenIds from defaultHidden only", () => {
  it("hides only the defaultHidden series, isolates nothing", () => {
    const v = initialCompareVisibility(SIX);
    expect(v.hiddenIds.has("rest")).toBe(true);
    expect(v.hiddenIds.size).toBe(1);
    expect(v.isolatedId).toBeNull();
  });

  it("hides nothing when no series sets defaultHidden", () => {
    const v = initialCompareVisibility(FIXED_FIVE);
    expect(v.hiddenIds.size).toBe(0);
  });
});

describe("isCompareSeriesVisible", () => {
  it("a series not in hiddenIds is visible when nothing is isolated", () => {
    const v: CompareVisibility = { hiddenIds: new Set(), isolatedId: null };
    expect(isCompareSeriesVisible("medicare", v)).toBe(true);
  });

  it("a hidden series is invisible when nothing is isolated", () => {
    const v: CompareVisibility = { hiddenIds: new Set(["rest"]), isolatedId: null };
    expect(isCompareSeriesVisible("rest", v)).toBe(false);
  });

  it("isolation overrides hiddenIds entirely: only the isolated series is visible, even one that's also hidden", () => {
    const v: CompareVisibility = { hiddenIds: new Set(["rest"]), isolatedId: "rest" };
    expect(isCompareSeriesVisible("rest", v)).toBe(true);
    expect(isCompareSeriesVisible("medicare", v)).toBe(false);
  });
});

describe("toggleCompareSeries — reconciling 'off by default, chip turns it on' with 'click isolates, click again restores'", () => {
  it("clicking a HIDDEN series (nothing isolated) turns it ON — joins the rest, does NOT isolate it alone", () => {
    const start = initialCompareVisibility(SIX);
    const next = toggleCompareSeries(start, "rest");
    expect(next.isolatedId).toBeNull();
    expect(next.hiddenIds.has("rest")).toBe(false);
    // Every fixed-five series is still visible alongside it.
    for (const s of FIXED_FIVE) expect(isCompareSeriesVisible(s.id, next)).toBe(true);
    expect(isCompareSeriesVisible("rest", next)).toBe(true);
  });

  it("clicking a VISIBLE, non-hidden, non-isolated series ISOLATES it", () => {
    const start = initialCompareVisibility(SIX);
    const next = toggleCompareSeries(start, "medicare");
    expect(next.isolatedId).toBe("medicare");
    expect(isCompareSeriesVisible("medicare", next)).toBe(true);
    expect(isCompareSeriesVisible("socsec", next)).toBe(false);
    expect(isCompareSeriesVisible("rest", next)).toBe(false); // still off by default too, but moot: isolation hides it either way
  });

  it("clicking the currently isolated series again RESTORES — back to whatever hiddenIds said before isolating", () => {
    const start = initialCompareVisibility(SIX);
    const isolated = toggleCompareSeries(start, "medicare");
    const restored = toggleCompareSeries(isolated, "medicare");
    expect(restored.isolatedId).toBeNull();
    expect(restored.hiddenIds).toEqual(start.hiddenIds); // hiddenIds untouched by isolate/restore
    expect(isCompareSeriesVisible("rest", restored)).toBe(false); // still off by default, unaffected
    expect(isCompareSeriesVisible("socsec", restored)).toBe(true);
  });

  it("clicking a DIFFERENT series while one is isolated switches the isolation target directly (no need to restore first)", () => {
    const start = initialCompareVisibility(SIX);
    const isolatedMedicare = toggleCompareSeries(start, "medicare");
    const isolatedSocsec = toggleCompareSeries(isolatedMedicare, "socsec");
    expect(isolatedSocsec.isolatedId).toBe("socsec");
    expect(isCompareSeriesVisible("medicare", isolatedSocsec)).toBe(false);
    expect(isCompareSeriesVisible("socsec", isolatedSocsec)).toBe(true);
  });

  it("a SECOND click on 'Everything else' after its first click turned it on falls through to the ordinary isolate rule — nothing everything-else-specific happens beyond the very first click", () => {
    const start = initialCompareVisibility(SIX);
    const turnedOn = toggleCompareSeries(start, "rest");
    const isolated = toggleCompareSeries(turnedOn, "rest");
    expect(isolated.isolatedId).toBe("rest");
    expect(isCompareSeriesVisible("rest", isolated)).toBe(true);
    expect(isCompareSeriesVisible("medicare", isolated)).toBe(false);
    // A third click restores, and "rest" stays visible afterward (it was
    // already turned on, not hidden, before this isolate/restore round).
    const restored = toggleCompareSeries(isolated, "rest");
    expect(restored.isolatedId).toBeNull();
    expect(isCompareSeriesVisible("rest", restored)).toBe(true);
  });

  it("never mutates the input CompareVisibility object or its hiddenIds Set", () => {
    const start = initialCompareVisibility(SIX);
    const startHiddenSnapshot = new Set(start.hiddenIds);
    toggleCompareSeries(start, "rest");
    expect(start.hiddenIds).toEqual(startHiddenSnapshot);
  });
});

describe("computeVisibleValueDomain — the y-scale refit math", () => {
  it("domain covers only VISIBLE series' values, always including 0", () => {
    const v = initialCompareVisibility(SIX); // rest hidden
    const domain = computeVisibleValueDomain(SIX, v);
    expect(domain.lo).toBe(0);
    expect(domain.hi).toBe(920); // socsec's own max — the largest of the five, "rest" (max 3800) excluded
  });

  it("turning 'rest' on widens hi to include its own larger values — the refit", () => {
    const start = initialCompareVisibility(SIX);
    const withRest = toggleCompareSeries(start, "rest");
    const domain = computeVisibleValueDomain(SIX, withRest);
    expect(domain.hi).toBe(3800);
  });

  it("isolating a single series narrows the domain to JUST that series", () => {
    const v = toggleCompareSeries(initialCompareVisibility(SIX), "netint");
    const domain = computeVisibleValueDomain(SIX, v);
    expect(domain.hi).toBe(320);
  });

  it("falls back to a safe non-degenerate domain when nothing is visible at all", () => {
    // Isolate a series with zero points to simulate "nothing visible".
    const empty: CompareSeriesInput = { id: "empty", points: [] };
    const v: CompareVisibility = { hiddenIds: new Set(), isolatedId: "empty" };
    const domain = computeVisibleValueDomain([empty], v);
    expect(domain).toEqual({ lo: 0, hi: 1 });
  });

  it("includes a genuinely negative visible value in the low bound (never assumes all-positive)", () => {
    const negative: CompareSeriesInput = { id: "neg", points: [point("2026-01-31", "-250")] };
    const v: CompareVisibility = { hiddenIds: new Set(), isolatedId: null };
    const domain = computeVisibleValueDomain([negative], v);
    expect(domain.lo).toBe(-250);
    expect(domain.hi).toBe(0);
  });
});

describe("decollideEndLabels — min gaps and clamping", () => {
  it("leaves already-well-spaced labels untouched", () => {
    const result = decollideEndLabels([{ id: "a", y: 10 }, { id: "b", y: 50 }, { id: "c", y: 90 }], 20, 0, 200);
    expect(result.find((r) => r.id === "a")!.y).toBe(10);
    expect(result.find((r) => r.id === "b")!.y).toBe(50);
    expect(result.find((r) => r.id === "c")!.y).toBe(90);
  });

  it("pushes two overlapping labels apart by exactly minGap", () => {
    const result = decollideEndLabels([{ id: "a", y: 100 }, { id: "b", y: 105 }], 20, 0, 400);
    const a = result.find((r) => r.id === "a")!;
    const b = result.find((r) => r.id === "b")!;
    expect(b.y - a.y).toBeGreaterThanOrEqual(20);
  });

  it("cascades the push through a chain of many colliding labels, keeping every adjacent gap >= minGap", () => {
    const candidates = [
      { id: "a", y: 100 },
      { id: "b", y: 101 },
      { id: "c", y: 102 },
      { id: "d", y: 103 },
      { id: "e", y: 104 },
      { id: "f", y: 105 },
    ];
    const result = decollideEndLabels(candidates, 20, 0, 400);
    const sorted = [...result].sort((x, y) => x.y - y.y);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.y - sorted[i - 1]!.y).toBeGreaterThanOrEqual(20 - 1e-9);
    }
  });

  it("clamps a bottom overflow to `hi`, and resolves any min-gap violation that clamp reintroduces further up the stack", () => {
    // Six labels needing 20px each, starting near the bottom of a chart
    // only 60px tall (0..60) — the naive push-down would run well past 60.
    const candidates = [
      { id: "a", y: 40 },
      { id: "b", y: 41 },
      { id: "c", y: 42 },
      { id: "d", y: 43 },
    ];
    const result = decollideEndLabels(candidates, 20, 0, 60);
    for (const r of result) {
      expect(r.y).toBeLessThanOrEqual(60 + 1e-9);
      expect(r.y).toBeGreaterThanOrEqual(0 - 1e-9);
    }
    const sorted = [...result].sort((x, y) => x.y - y.y);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.y - sorted[i - 1]!.y).toBeGreaterThanOrEqual(20 - 1e-9);
    }
  });

  it("preserves every candidate's own id — a result is matched back by id, never by array position", () => {
    const result = decollideEndLabels([{ id: "z", y: 5 }, { id: "a", y: 3 }], 10, 0, 100);
    expect(result.map((r) => r.id).sort()).toEqual(["a", "z"]);
  });

  it("handles zero and one candidates without throwing", () => {
    expect(decollideEndLabels([], 20, 0, 100)).toEqual([]);
    expect(decollideEndLabels([{ id: "solo", y: 42 }], 20, 0, 100)).toEqual([{ id: "solo", y: 42 }]);
  });
});

describe("computeCompareGeometry", () => {
  it("returns the empty geometry (no series, no ticks) when every input series has zero points", () => {
    const emptySeries: CompareSeriesInput[] = [{ id: "a", points: [] }];
    const geometry = computeCompareGeometry(emptySeries, initialCompareVisibility(emptySeries), OPTS);
    expect(geometry.series).toHaveLength(0);
    expect(geometry.months).toHaveLength(0);
  });

  it("computes geometry ONLY for visible series — a hidden series costs nothing to lay out", () => {
    const v = initialCompareVisibility(SIX); // rest hidden
    const geometry = computeCompareGeometry(SIX, v, OPTS);
    expect(geometry.series).toHaveLength(5);
    expect(geometry.series.some((s) => s.id === "rest")).toBe(false);
  });

  it("the x-domain (month positions) stays FIXED across visibility changes — includes every series' months regardless of hidden state", () => {
    const hidden = computeCompareGeometry(SIX, initialCompareVisibility(SIX), OPTS);
    const shown = computeCompareGeometry(SIX, toggleCompareSeries(initialCompareVisibility(SIX), "rest"), OPTS);
    expect(hidden.months).toEqual(shown.months);
  });

  it("the y-domain (value ticks) REFITS once a hidden series is turned on — same as computeVisibleValueDomain's own guarantee", () => {
    const hidden = computeCompareGeometry(SIX, initialCompareVisibility(SIX), OPTS);
    const shown = computeCompareGeometry(SIX, toggleCompareSeries(initialCompareVisibility(SIX), "rest"), OPTS);
    expect(hidden.valueTicks[0]!.value).toBe(920); // fixed five's own max
    expect(shown.valueTicks[0]!.value).toBe(3800); // rest's own max, now included
  });

  it("every returned point's x/y falls within the declared canvas extent", () => {
    const geometry = computeCompareGeometry(SIX, toggleCompareSeries(initialCompareVisibility(SIX), "rest"), OPTS);
    for (const s of geometry.series) {
      for (const p of s.points) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(OPTS.width);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(OPTS.height);
      }
    }
  });

  it("year ticks apply the same collision-drop guard as categoryHistoryLayout's own year ticks (shared MIN_YEAR_TICK_GAP_PX)", () => {
    // 24 months spanning two calendar years, all series aligned.
    const months = Array.from({ length: 24 }, (_, i) => {
      const y = 2025 + Math.floor(i / 12);
      const m = (i % 12) + 1;
      return `${y}-${String(m).padStart(2, "0")}-28`;
    });
    const longSeries: CompareSeriesInput[] = [{ id: "a", points: months.map((periodEnd, i) => point(periodEnd, String(100 + i))) }];
    const geometry = computeCompareGeometry(longSeries, initialCompareVisibility(longSeries), OPTS);
    const years = geometry.yearTicks.map((t) => t.label);
    expect(years).toEqual([...new Set(years)]);
    expect(years).toContain("2025");
    expect(years).toContain("2026");
  });
});

describe("findNearestCompareMonth", () => {
  it("finds the closest month by x-distance", () => {
    const months = [{ periodEnd: "2026-01-31", x: 0 }, { periodEnd: "2026-02-28", x: 20 }, { periodEnd: "2026-03-31", x: 40 }];
    expect(findNearestCompareMonth(months, 5)).toBe("2026-01-31");
    expect(findNearestCompareMonth(months, 19)).toBe("2026-02-28");
    expect(findNearestCompareMonth(months, 39)).toBe("2026-03-31");
  });

  it("returns null for an empty months list", () => {
    expect(findNearestCompareMonth([], 10)).toBeNull();
  });
});
