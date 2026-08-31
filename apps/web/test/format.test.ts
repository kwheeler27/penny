import { describe, expect, it } from "vitest";
import {
  defaultUsdDecimals,
  describePeriod,
  formatDateHuman,
  formatDateShort,
  formatExactUsd,
  formatIndexPoint,
  formatMonthYear,
  formatSeriesUsd,
  magnitudePlaces,
  roundDecimalString,
  shiftDecimalRight,
} from "../lib/format";

describe("shiftDecimalRight (exact magnitude scaling, no float)", () => {
  it("shifts a plain integer string by N places", () => {
    expect(shiftDecimalRight("542345", 6)).toBe("542345000000");
  });

  it("shifts a value that already has a fractional part", () => {
    expect(shiftDecimalRight("542345.6", 6)).toBe("542345600000");
  });

  it("is a no-op at 0 places", () => {
    expect(shiftDecimalRight("36345909729842.98", 0)).toBe("36345909729842.98");
  });

  it("preserves a negative sign", () => {
    expect(shiftDecimalRight("-100000", 6)).toBe("-100000000000");
  });

  it("never produces a negative sign on an exact-zero result", () => {
    expect(shiftDecimalRight("-0", 6)).toBe("0");
    expect(shiftDecimalRight("-0.00", 0)).toBe("0.00");
  });
});

describe("roundDecimalString (exact BigInt rounding, no float)", () => {
  it("rounds half up", () => {
    expect(roundDecimalString("1.005", 2)).toBe("1.01");
    expect(roundDecimalString("1.004", 2)).toBe("1.00");
  });

  it("rounds to 0 decimals", () => {
    expect(roundDecimalString("542345600000.6", 0)).toBe("542345600001");
  });

  it("carries a rounding overflow into a new digit", () => {
    expect(roundDecimalString("9.996", 2)).toBe("10.00");
  });

  it("handles a value with no existing fractional part", () => {
    expect(roundDecimalString("700123", 2)).toBe("700123.00");
  });

  it("rounds a negative value correctly and keeps the sign", () => {
    expect(roundDecimalString("-1.005", 2)).toBe("-1.01");
  });
});

describe("formatExactUsd", () => {
  it("groups thousands and adds a dollar sign", () => {
    expect(formatExactUsd("36345909729842.98", 2)).toBe("$36,345,909,729,842.98");
  });

  it("renders a negative value with a leading minus sign before the currency symbol", () => {
    expect(formatExactUsd("-100000000000", 0)).toBe("−$100,000,000,000");
  });

  it("renders whole dollars with 0 decimals when asked", () => {
    expect(formatExactUsd("542345600000.4", 0)).toBe("$542,345,600,000");
  });
});

describe("formatSeriesUsd (registry value -> display, per published magnitude)", () => {
  it("scales a 'millions' series up to whole dollars with 0 default decimals", () => {
    const { display, exact, decimals } = formatSeriesUsd("542345.6", "millions");
    expect(exact).toBe("542345600000");
    expect(decimals).toBe(0);
    expect(display).toBe("$542,345,600,000");
  });

  it("keeps an 'ones' series (Debt to the Penny) at 2 default decimals with no scaling", () => {
    const { display, exact } = formatSeriesUsd("36345909729842.98", "ones");
    expect(exact).toBe("36345909729842.98");
    expect(display).toBe("$36,345,909,729,842.98");
  });

  it("scales a 'billions' series", () => {
    expect(formatSeriesUsd("1.9", "billions").display).toBe("$1,900,000,000");
  });

  it("honors an explicit precision override", () => {
    expect(formatSeriesUsd("542345.6", "millions", 2).display).toBe("$542,345,600,000.00");
  });
});

describe("magnitudePlaces / defaultUsdDecimals", () => {
  it("maps every magnitude to its power-of-ten shift", () => {
    expect(magnitudePlaces("ones")).toBe(0);
    expect(magnitudePlaces("thousands")).toBe(3);
    expect(magnitudePlaces("millions")).toBe(6);
    expect(magnitudePlaces("billions")).toBe(9);
  });

  it("defaults to 2 decimals only for 'ones', 0 for every aggregated magnitude", () => {
    expect(defaultUsdDecimals("ones")).toBe(2);
    expect(defaultUsdDecimals("thousands")).toBe(0);
    expect(defaultUsdDecimals("millions")).toBe(0);
    expect(defaultUsdDecimals("billions")).toBe(0);
  });
});

describe("formatIndexPoint", () => {
  it("formats CPI to 3 decimals by default, no currency sign", () => {
    expect(formatIndexPoint("314.54")).toBe("314.540");
  });

  it("respects an explicit precision", () => {
    expect(formatIndexPoint("314.5", 1)).toBe("314.5");
  });
});

describe("calendar-date formatting (string-parsed, never via `new Date()`)", () => {
  it("formats a plain YYYY-MM-DD into a human date", () => {
    expect(formatDateHuman("2026-08-28")).toBe("August 28, 2026");
    expect(formatDateShort("2026-08-28")).toBe("Aug 28, 2026");
    expect(formatMonthYear("2026-08-28")).toBe("August 2026");
  });

  it("falls back to the raw string for anything that isn't YYYY-MM-DD", () => {
    expect(formatDateHuman("not-a-date")).toBe("not-a-date");
  });
});

describe("describePeriod", () => {
  it("describes a daily reading as 'as of'", () => {
    expect(describePeriod("day", "2026-08-28", null)).toBe("as of August 28, 2026");
  });
  it("describes a monthly reading as 'for'", () => {
    expect(describePeriod("month", "2026-07-31", null)).toBe("for July 2026");
  });
  it("describes a fiscal-year-to-date reading distinctly from a plain month, including the fiscal year", () => {
    expect(describePeriod("fiscal_ytd", "2026-07-31", 2026)).toBe("fiscal year to date through July 31, 2026 (FY2026)");
  });
});
