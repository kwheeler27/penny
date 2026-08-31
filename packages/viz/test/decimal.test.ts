import { describe, expect, it } from "vitest";
import {
  addDecimal,
  subtractDecimal,
  sumDecimal,
  compareDecimal,
  isZeroDecimal,
  isNegativeDecimal,
  negateDecimal,
  scaleByMagnitude,
  toWholeDollarsBigInt,
} from "../src/money/decimal";

describe("decimal arithmetic (exact, never through JS float)", () => {
  it("adds values with different scales exactly", () => {
    expect(addDecimal("100", "0.50")).toBe("100.50");
    expect(addDecimal("0.1", "0.2")).toBe("0.3"); // the classic float trap (0.1+0.2=0.30000000000000004 in JS numbers)
  });

  it("subtracts exactly, including going negative", () => {
    expect(subtractDecimal("100", "150")).toBe("-50");
    expect(subtractDecimal("355000", "550900")).toBe("-195900");
  });

  it("sums a list exactly, empty list sums to 0", () => {
    expect(sumDecimal(["1.1", "2.2", "3.3"])).toBe("6.6");
    expect(sumDecimal([])).toBe("0");
  });

  it("preserves full precision on a large decimal value (db.test.ts's debt-to-the-penny fixture)", () => {
    // The exact value packages/db/test/db.test.ts asserts survives as a
    // string with no float round-trip through Postgres numeric(20,4).
    const exact = "36345909729842.9800";
    expect(addDecimal(exact, "0")).toBe(exact);
    expect(sumDecimal([exact, "0.02"])).toBe("36345909729843.0000");
  });

  it("documents the float trap this module exists to avoid: Number() silently loses digits past ~15-17 significant figures", () => {
    const lossy = "123456789012345.6789";
    expect(Number(lossy).toString()).not.toBe(lossy); // float already wrong here...
    expect(addDecimal(lossy, "0")).toBe(lossy); // ...decimal.ts is exact regardless of magnitude.
  });

  it("compareDecimal is exact and scale-independent", () => {
    expect(compareDecimal("1.50", "1.5")).toBe(0);
    expect(compareDecimal("1.49", "1.5")).toBe(-1);
    expect(compareDecimal("2", "1.999999")).toBe(1);
  });

  it("isZeroDecimal / isNegativeDecimal read sign correctly, including -0 forms", () => {
    expect(isZeroDecimal("0")).toBe(true);
    expect(isZeroDecimal("0.00")).toBe(true);
    expect(isZeroDecimal("-0.00")).toBe(true);
    expect(isNegativeDecimal("-0.00")).toBe(false); // negative zero is zero, not negative
    expect(isNegativeDecimal("-1")).toBe(true);
    expect(isNegativeDecimal("1")).toBe(false);
  });

  it("negateDecimal flips sign and round-trips", () => {
    expect(negateDecimal("195900")).toBe("-195900");
    expect(negateDecimal("-195900")).toBe("195900");
    expect(negateDecimal("0")).toBe("0");
  });

  it("scaleByMagnitude shifts the decimal point exactly, never via float multiply", () => {
    expect(scaleByMagnitude("355000", "millions")).toBe("355000000000");
    expect(scaleByMagnitude("1.5", "billions")).toBe("1500000000");
    expect(scaleByMagnitude("36345909729842.98", "ones")).toBe("36345909729842.98");
    expect(scaleByMagnitude("314.54", "thousands")).toBe("314540");
  });

  it("toWholeDollarsBigInt rounds half-away-from-zero without float", () => {
    expect(toWholeDollarsBigInt("100.49")).toBe(100n);
    expect(toWholeDollarsBigInt("100.50")).toBe(101n);
    expect(toWholeDollarsBigInt("-100.50")).toBe(-101n);
    expect(toWholeDollarsBigInt("36345909729842.98")).toBe(36345909729843n);
  });
});
