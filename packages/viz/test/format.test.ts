import { describe, expect, it } from "vitest";
import { formatSeriesValue, formatUsd, magnitudeLabel } from "../src/money/format";

describe("money/format (single shared formatter)", () => {
  it("formats a millions-magnitude USD value compactly", () => {
    expect(formatSeriesValue("355000", "usd", "millions")).toBe("$355.0B");
  });

  it("formats an ones-magnitude USD value (Debt to the Penny scale) compactly", () => {
    expect(formatSeriesValue("36345909729842.98", "usd", "ones")).toBe("$36.3T");
  });

  it("explicit sign renders + for a positive balancing value and - for negative", () => {
    expect(formatSeriesValue("195900", "usd", "millions", { explicitSign: true })).toMatch(/^\+\$195\.9B$/);
    expect(formatSeriesValue("-50000", "usd", "millions", { explicitSign: true })).toMatch(/^-\$50\.0B$/);
  });

  it("index_point values are never currency-formatted or magnitude-scaled", () => {
    expect(formatSeriesValue("314.5400", "index_point", "ones")).toBe("314.54");
  });

  it("non-compact mode renders full standard currency notation", () => {
    expect(formatUsd("355000000000", { compact: false })).toBe("$355,000,000,000");
  });

  it("magnitudeLabel names every magnitude in plain language", () => {
    expect(magnitudeLabel("ones")).toMatch(/whole dollars/);
    expect(magnitudeLabel("millions")).toMatch(/millions/);
    expect(magnitudeLabel("billions")).toMatch(/billions/);
    expect(magnitudeLabel("thousands")).toMatch(/thousands/);
  });
});
