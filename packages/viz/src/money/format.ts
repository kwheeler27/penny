/**
 * Single shared formatter for every number this package renders (Numbers
 * are UI: one formatter, tabular figures, explicit signs, never a bespoke
 * `toFixed` at a call site). Money stays in BigInt/decimal-string form all
 * the way to `Intl.NumberFormat`, which accepts BigInt natively — the whole
 * pipeline never touches a JS `number` for a value that has to be exact.
 */
import { type MagnitudeName, scaleByMagnitude, toWholeDollarsBigInt, isNegativeDecimal } from "./decimal";

export type FormatUnit = "usd" | "index_point" | "persons" | "households";

export interface FormatValueOptions {
  /** "$6.1T" style. Default true — the space this library renders numbers in (tiles, node labels) is small. */
  readonly compact?: boolean;
  /** Render "+$1.2B" for a positive value, not just "$1.2B" — use for signed flows like the deficit/surplus balancing figure. Default false. */
  readonly explicitSign?: boolean;
}

/**
 * Formats a series value for display, given the unit and magnitude it was
 * published in (both come from the registry's SeriesDef — never inferred).
 * `usd` values are exact through BigInt; `index_point` values are not
 * dollars and are never magnitude-scaled or currency-formatted.
 */
export function formatSeriesValue(
  value: string,
  unit: FormatUnit,
  magnitude: MagnitudeName,
  opts: FormatValueOptions = {},
): string {
  if (unit === "index_point") return formatIndexPoint(value, opts);
  if (unit === "persons" || unit === "households") {
    const wholeCount = scaleByMagnitude(value, magnitude);
    return formatCount(wholeCount, opts);
  }
  const wholeDollarValue = scaleByMagnitude(value, magnitude);
  return formatUsd(wholeDollarValue, opts);
}

/** Formats an already-whole-magnitude (i.e. actual dollars) decimal string as USD currency. */
export function formatUsd(dollarsExact: string, opts: FormatValueOptions = {}): string {
  const { compact = true, explicitSign = false } = opts;
  const amount = toWholeDollarsBigInt(dollarsExact);
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 0,
    signDisplay: explicitSign ? "exceptZero" : "auto",
  });
  return formatter.format(amount);
}

/** Formats an already-whole-magnitude (i.e. actual persons/households) decimal
 * string as a plain grouped count — never a currency symbol, since a
 * headcount is not money (CLAUDE.md: accounting concepts never mix
 * silently). Reuses the same compact/sign behavior as formatUsd so a
 * Sankey node showing a population/household series reads consistently
 * with a dollar node, minus the "$". */
function formatCount(wholeValue: string, opts: FormatValueOptions): string {
  const { compact = true, explicitSign = false } = opts;
  const amount = toWholeDollarsBigInt(wholeValue);
  const formatter = new Intl.NumberFormat("en-US", {
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 0,
    signDisplay: explicitSign ? "exceptZero" : "auto",
  });
  return formatter.format(amount);
}

function formatIndexPoint(value: string, opts: FormatValueOptions): string {
  // Index points carry real fractional precision (e.g. CPI-U "314.5400")
  // and are never magnitude-scaled or given a currency symbol — a
  // different accounting concept from every USD series (CLAUDE.md).
  // BLS reports these to hundredths; Number() is safe at this magnitude
  // (a handful of significant digits, nowhere near float precision limits)
  // and this path never feeds a reconciliation sum.
  const n = Number(value);
  const formatter = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    signDisplay: opts.explicitSign ? "exceptZero" : "auto",
  });
  return formatter.format(n);
}

/** Plain-language name for a magnitude, for citation/detail copy ("as published, in millions of dollars"). */
export function magnitudeLabel(magnitude: MagnitudeName): string {
  switch (magnitude) {
    case "ones":
      return "whole dollars";
    case "thousands":
      return "thousands of dollars";
    case "millions":
      return "millions of dollars";
    case "billions":
      return "billions of dollars";
  }
}

/** True when the exact underlying value is negative (drives "deficit" vs. "surplus" wording, never the rounded display string). */
export { isNegativeDecimal as isNegativeValue };
