import { describe, it, expect } from "vitest";
import { decimalEquals, decimalSum, decimalSubtract, parseDecimal } from "../src/lib/decimal";

describe("lib/decimal — exact decimal-string arithmetic (no float involved)", () => {
  it("parses sign, integer, and fraction parts", () => {
    expect(parseDecimal("-123.4500")).toEqual({ negative: true, intPart: "123", fracPart: "4500" });
    expect(parseDecimal("700123")).toEqual({ negative: false, intPart: "700123", fracPart: "" });
  });

  it("throws on scientific notation or other non-plain-decimal strings — callers must validate with Zod first", () => {
    expect(() => parseDecimal("1.5e10")).toThrow();
    expect(() => parseDecimal("$100")).toThrow();
    expect(() => parseDecimal("1,000")).toThrow();
  });

  it("decimalEquals is formatting-insensitive: trailing zeros, leading zeros, -0", () => {
    expect(decimalEquals("700123", "700123.0000")).toBe(true);
    expect(decimalEquals("0700123", "700123")).toBe(true);
    expect(decimalEquals("-0", "0")).toBe(true);
    expect(decimalEquals("-0.00", "0")).toBe(true);
    expect(decimalEquals("1.50", "1.5")).toBe(true);
    expect(decimalEquals("1.50", "1.05")).toBe(false);
  });

  it("decimalSum is exact at trillion-dollar magnitude — the exact scenario Number() would silently corrupt", () => {
    // 36,345,909,729,842.98 exceeds Number.MAX_SAFE_INTEGER once you need cent precision; float addition would round.
    const sum = decimalSum(["28345909729842.98", "8000000000000.00"]);
    expect(sum).toBe("36345909729842.98");
  });

  it("decimalSum handles mixed scales by widening to the largest", () => {
    expect(decimalSum(["1", "0.5", "0.25"])).toBe("1.75");
  });

  it("decimalSum of values that cancel to exactly zero", () => {
    expect(decimalEquals(decimalSum(["100.50", "-100.50"]), "0")).toBe(true);
  });

  it("decimalSubtract matches the MTS deficit sign-correction use case", () => {
    // Treasury's raw outlays-minus-receipts convention, negated to receipts-minus-outlays (registry's documented convention).
    expect(decimalSubtract("0", "432307874621.48")).toBe("-432307874621.48");
    expect(decimalSubtract("0", "-215024135197.77")).toBe("215024135197.77");
  });

  it("decimalSum on an empty array is zero, not an error (a category legitimately absent this month contributes nothing)", () => {
    expect(decimalSum([])).toBe("0");
  });
});
