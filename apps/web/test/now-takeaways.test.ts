/**
 * buildNowTakeaway — the /now tiles' computed takeaway headings
 * (docs/DESIGN_PRINCIPLES.md §1). Every claim variant is pinned here:
 * direction words from exact decimal comparison, the self-retracting cases
 * (single reading, fiscal-year rollover, sign crossings), and the honest
 * period phrases (named previous close, named month, adjacent vs spanned).
 */
import { describe, expect, it } from "vitest";
import { buildNowTakeaway } from "../lib/now-takeaways";
import type { Reading } from "../lib/types";
import type { PeriodType } from "../lib/types";

function reading(overrides: Partial<Reading> & { periodEnd: string; value: string; periodType: PeriodType }): Reading {
  return {
    seriesId: "fiscal.debt.total_public_debt_outstanding" as Reading["seriesId"],
    periodStart: overrides.periodEnd,
    fiscalYear: null,
    publicationTime: "2026-09-04T00:00:00Z",
    revisionOf: null,
    ...overrides,
  };
}

describe("buildNowTakeaway — self-retraction", () => {
  it("returns null with fewer than two readings — no data, no claim", () => {
    expect(buildNowTakeaway([], "millions")).toBeNull();
    expect(buildNowTakeaway([reading({ periodType: "day", periodEnd: "2026-08-27", value: "100.0000" })], "millions")).toBeNull();
  });

  it("returns null across a fiscal-year rollover — FYTD October vs FYTD September of the prior year is not a same-span comparison", () => {
    const latest = reading({ periodType: "fiscal_ytd", periodEnd: "2026-10-31", value: "-100000.0000", fiscalYear: 2027 });
    const prev = reading({ periodType: "fiscal_ytd", periodEnd: "2026-09-30", value: "-1800000.0000", fiscalYear: 2026 });
    expect(buildNowTakeaway([latest, prev], "millions")).toBeNull();
  });
});

describe("buildNowTakeaway — daily stocks", () => {
  it("names the direction, the exact delta, and the previous close's date", () => {
    // Values in whole dollars (debt to the penny's magnitude is "ones").
    const latest = reading({ periodType: "day", periodEnd: "2026-08-27", value: "40077529831942.94" });
    const prev = reading({ periodType: "day", periodEnd: "2026-08-26", value: "40068229831942.94" });
    expect(buildNowTakeaway([latest, prev], "ones")).toBe("Up $9.3B from the previous close (Aug 26, 2026)");
  });

  it("says Down when the latest close is lower", () => {
    const latest = reading({ periodType: "day", periodEnd: "2026-08-31", value: "1023554.0000" });
    const prev = reading({ periodType: "day", periodEnd: "2026-08-28", value: "1043554.0000" });
    expect(buildNowTakeaway([latest, prev], "millions")).toBe("Down $20.0B from the previous close (Aug 28, 2026)");
  });

  it("says Unchanged on an exactly-equal reading, never Up $0.0B", () => {
    const latest = reading({ periodType: "day", periodEnd: "2026-08-31", value: "1023554.0000" });
    const prev = reading({ periodType: "day", periodEnd: "2026-08-28", value: "1023554.0000" });
    expect(buildNowTakeaway([latest, prev], "millions")).toBe("Unchanged from the previous close (Aug 28, 2026)");
  });
});

describe("buildNowTakeaway — monthly flows", () => {
  it("compares against the named previous month", () => {
    const latest = reading({ periodType: "month", periodEnd: "2026-07-31", value: "104200.0000" });
    const prev = reading({ periodType: "month", periodEnd: "2026-06-30", value: "100000.0000" });
    expect(buildNowTakeaway([latest, prev], "millions")).toBe("Up $4.2B vs Jun 2026");
  });

  it("an ingestion gap stays honest — the month it actually compares against is named", () => {
    const latest = reading({ periodType: "month", periodEnd: "2026-07-31", value: "90000.0000" });
    const prev = reading({ periodType: "month", periodEnd: "2026-04-30", value: "95000.0000" });
    expect(buildNowTakeaway([latest, prev], "millions")).toBe("Down $5.0B vs Apr 2026");
  });
});

describe("buildNowTakeaway — FYTD deficit/surplus (negative = deficit)", () => {
  const fy = 2026;

  it("a deeper FYTD deficit month-over-month reads as the gap growing", () => {
    const latest = reading({ periodType: "fiscal_ytd", periodEnd: "2026-07-31", value: "-1798800.0000", fiscalYear: fy });
    const prev = reading({ periodType: "fiscal_ytd", periodEnd: "2026-06-30", value: "-1600000.0000", fiscalYear: fy });
    expect(buildNowTakeaway([latest, prev], "millions")).toBe("The gap grew $198.8B in July");
  });

  it("a surplus month shrinks the gap", () => {
    const latest = reading({ periodType: "fiscal_ytd", periodEnd: "2026-04-30", value: "-900000.0000", fiscalYear: fy });
    const prev = reading({ periodType: "fiscal_ytd", periodEnd: "2026-03-31", value: "-1100000.0000", fiscalYear: fy });
    expect(buildNowTakeaway([latest, prev], "millions")).toBe("The gap shrank $200.0B in April");
  });

  it("a positive FYTD balance is a surplus, in surplus words", () => {
    const latest = reading({ periodType: "fiscal_ytd", periodEnd: "2025-11-30", value: "50000.0000", fiscalYear: fy });
    const prev = reading({ periodType: "fiscal_ytd", periodEnd: "2025-10-31", value: "20000.0000", fiscalYear: fy });
    expect(buildNowTakeaway([latest, prev], "millions")).toBe("The surplus grew $30.0B in November");
  });

  it("a sign crossing self-retracts to a swing sentence — grew/shrank would be wrong on both sides", () => {
    const toDeficit = [
      reading({ periodType: "fiscal_ytd", periodEnd: "2025-12-31", value: "-40000.0000", fiscalYear: fy }),
      reading({ periodType: "fiscal_ytd", periodEnd: "2025-11-30", value: "10000.0000", fiscalYear: fy }),
    ];
    expect(buildNowTakeaway(toDeficit, "millions")).toBe("Swung to a deficit in December");
    const toSurplus = [
      reading({ periodType: "fiscal_ytd", periodEnd: "2026-04-30", value: "5000.0000", fiscalYear: fy }),
      reading({ periodType: "fiscal_ytd", periodEnd: "2026-03-31", value: "-30000.0000", fiscalYear: fy }),
    ];
    expect(buildNowTakeaway(toSurplus, "millions")).toBe("Swung to a surplus in April");
  });

  it("a non-adjacent previous month names the span instead of claiming a single month", () => {
    const latest = reading({ periodType: "fiscal_ytd", periodEnd: "2026-07-31", value: "-1798800.0000", fiscalYear: fy });
    const prev = reading({ periodType: "fiscal_ytd", periodEnd: "2026-05-31", value: "-1500000.0000", fiscalYear: fy });
    expect(buildNowTakeaway([latest, prev], "millions")).toBe("The gap grew $298.8B since May 2026");
  });
});
