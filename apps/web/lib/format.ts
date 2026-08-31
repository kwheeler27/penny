/**
 * Pure, dependency-free presentation formatting. Nothing here touches the
 * database or React — every function is unit-tested directly (apps/web/test)
 * without a server, per the repo's testing convention.
 *
 * The rule this file exists to enforce (CLAUDE.md hard rule): a series'
 * `value` is an arbitrary-precision decimal STRING, stored exactly as
 * published, at whatever magnitude the source used (ones/thousands/millions/
 * billions). Converting to a human "$X" figure means multiplying by that
 * magnitude — and that conversion happens here, ONCE, at the presentation
 * boundary, via exact decimal-string arithmetic (shiftDecimalRight,
 * roundDecimalString), never a naive `parseFloat(value) * 1e6`. A stray
 * (@penny/viz's <FiscalSankey> does its own equivalent exact-decimal
 * arithmetic for the flow diagram — see packages/viz/src/money/decimal.ts —
 * so no float boundary is needed on this side of that integration either.)
 */
import type { Magnitude } from "@penny/registry";
import type { PeriodType } from "./types";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** How many decimal places to shift right to convert a series' stored value
 * (expressed at its published magnitude) into whole units of its `unit`. */
const MAGNITUDE_PLACES: Record<Magnitude, number> = {
  ones: 0,
  thousands: 3,
  millions: 6,
  billions: 9,
};

export function magnitudePlaces(magnitude: Magnitude): number {
  return MAGNITUDE_PLACES[magnitude];
}

/** Today's date (YYYY-MM-DD), for a citation's "Accessed" date — i.e. when a
 * reader is actually viewing/rendering the page, never the date an
 * observation's period happens to describe. The one intentional exception
 * to "never round-trip a date through `Date`": an access-date is genuinely
 * about wall-clock now, not a stored calendar value, so there is no
 * period/timezone to shift. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Shift a decimal string's point right by `places` digits — exact string
 * arithmetic, equivalent to multiplying by 10^places without ever coercing
 * through a JS float. `places` is always >= 0 for this app (every
 * @penny/registry magnitude is >= "ones"), so this never needs to shift left.
 */
export function shiftDecimalRight(value: string, places: number): string {
  const trimmed = value.trim();
  const neg = trimmed.startsWith("-");
  const abs = neg ? trimmed.slice(1) : trimmed;
  const [intPartRaw, fracPartRaw = ""] = abs.split(".");
  const intPart = intPartRaw || "0";
  if (places === 0) {
    const sign = neg && !isZero(intPart, fracPartRaw) ? "-" : "";
    return fracPartRaw ? `${sign}${intPart}.${fracPartRaw}` : `${sign}${intPart}`;
  }
  const digits = intPart + fracPartRaw;
  const pointPos = intPart.length + places;
  let newIntPart: string;
  let newFracPart: string;
  if (pointPos >= digits.length) {
    newIntPart = digits + "0".repeat(pointPos - digits.length);
    newFracPart = "";
  } else {
    newIntPart = digits.slice(0, pointPos);
    newFracPart = digits.slice(pointPos);
  }
  newIntPart = stripLeadingZeros(newIntPart);
  const sign = neg && !isZero(newIntPart, newFracPart) ? "-" : "";
  return newFracPart ? `${sign}${newIntPart}.${newFracPart}` : `${sign}${newIntPart}`;
}

function isZero(intPart: string, fracPart: string): boolean {
  return /^0*$/.test(intPart) && /^0*$/.test(fracPart);
}

/** Strip leading zeros from a non-negative integer digit string, keeping a
 * single "0" rather than an empty string when every digit is zero. */
function stripLeadingZeros(digits: string): string {
  const stripped = digits.replace(/^0+(?=\d)/, "");
  return stripped === "" ? "0" : stripped;
}

/**
 * Round a decimal string to `decimals` places using exact integer (BigInt)
 * arithmetic — half-up rounding, no float involved at any step.
 */
export function roundDecimalString(value: string, decimals: number): string {
  const trimmed = value.trim();
  const neg = trimmed.startsWith("-");
  const abs = neg ? trimmed.slice(1) : trimmed;
  const [intPartRaw, fracPartRaw = ""] = abs.split(".");
  const intPart = intPartRaw || "0";
  const fracPadded = (fracPartRaw + "0".repeat(decimals + 1)).slice(0, decimals + 1);
  const keptFrac = decimals > 0 ? fracPadded.slice(0, decimals) : "";
  const roundDigit = fracPadded.charCodeAt(decimals) - 48; // '0' === 48
  let combined = BigInt(intPart + keptFrac || "0");
  if (roundDigit >= 5) combined += 1n;
  const combinedStr = combined.toString().padStart(decimals + 1, "0");
  const newInt = decimals > 0 ? combinedStr.slice(0, -decimals) || "0" : combinedStr;
  const newFrac = decimals > 0 ? combinedStr.slice(-decimals) : "";
  const sign = neg && combined !== 0n ? "-" : "";
  return decimals > 0 ? `${sign}${newInt}.${newFrac}` : `${sign}${newInt}`;
}

/** Insert thousands separators into a non-negative plain decimal string's
 * integer portion. Sign handling is the caller's job (formatExactUsd /
 * formatIndexPoint), so a leading "−" always lands before any currency
 * symbol rather than between it and the digits. */
function groupThousandsUnsigned(decimal: string): string {
  const [intPart, fracPart] = decimal.split(".");
  const grouped = (intPart ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fracPart ? `${grouped}.${fracPart}` : grouped;
}

/** Split a rounded decimal string into its sign (a true minus sign, "−", or
 * "" for non-negative) and its non-negative magnitude. */
function splitSign(decimal: string): { sign: string; abs: string } {
  return decimal.startsWith("-") ? { sign: "−", abs: decimal.slice(1) } : { sign: "", abs: decimal };
}

/** Default decimal places for a USD figure at a given published magnitude.
 * "ones" series (Debt to the Penny, the TGA... ) are literally to-the-cent
 * sources, so show 2 decimals; every already-aggregated magnitude
 * (thousands/millions/billions) shows whole dollars — a fractional dollar at
 * that scale is not meaningful and the source doesn't intend it to be read
 * that precisely. */
export function defaultUsdDecimals(magnitude: Magnitude): number {
  return magnitude === "ones" ? 2 : 0;
}

/** Full-precision, comma-grouped USD string from a value already expressed
 * in whole dollars (i.e. post shiftDecimalRight). `$1,234,567` / `−$4.20`
 * (a true minus sign ahead of the currency symbol) / `$0`. */
export function formatExactUsd(wholeDollarValue: string, decimals: number): string {
  const { sign, abs } = splitSign(roundDecimalString(wholeDollarValue, decimals));
  return `${sign}$${groupThousandsUnsigned(abs)}`;
}

/** A registry series' stored value -> a human USD string, doing the
 * magnitude scale-up and rounding in one call. Returns both the rounded
 * display string and the full-precision scaled value (for a tooltip/caption
 * that wants to show the exact figure regardless of display rounding). */
export function formatSeriesUsd(
  storedValue: string,
  magnitude: Magnitude,
  decimals?: number,
): { display: string; exact: string; decimals: number } {
  const places = magnitudePlaces(magnitude);
  const exact = shiftDecimalRight(storedValue, places);
  const d = decimals ?? defaultUsdDecimals(magnitude);
  return { display: formatExactUsd(exact, d), exact, decimals: d };
}

/** An index-point series (CPI) -> plain grouped number, BLS convention of 3
 * decimals unless overridden. No currency sign, no magnitude scaling (every
 * index_point series in the registry is magnitude "ones"). */
export function formatIndexPoint(storedValue: string, decimals = 3): string {
  const { sign, abs } = splitSign(roundDecimalString(storedValue, decimals));
  return `${sign}${groupThousandsUnsigned(abs)}`;
}

// ---------- calendar-date formatting (no Date object, ever) ----------
// CLAUDE.md hard rule: calendar dates are YYYY-MM-DD strings, never
// round-tripped through `Date`, where the local/UTC offset can shift the
// displayed day. Every function below parses the string's digits directly.

function parseYmd(dateStr: string): { y: string; mo: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!m) return null;
  return { y: m[1]!, mo: Number(m[2]), d: Number(m[3]) };
}

/** "2026-08-28" -> "August 28, 2026". Falls back to the raw string for
 * anything that isn't a plain YYYY-MM-DD (defensive; should never happen for
 * a `date`-column value coming out of @penny/db). */
export function formatDateHuman(dateStr: string): string {
  const parsed = parseYmd(dateStr);
  if (!parsed) return dateStr;
  const monthName = MONTH_NAMES[parsed.mo - 1] ?? String(parsed.mo);
  return `${monthName} ${parsed.d}, ${parsed.y}`;
}

/** "2026-08-28" -> "Aug 28, 2026" — compact form for tiles. */
export function formatDateShort(dateStr: string): string {
  const parsed = parseYmd(dateStr);
  if (!parsed) return dateStr;
  const monthName = MONTH_NAMES[parsed.mo - 1] ?? String(parsed.mo);
  return `${monthName.slice(0, 3)} ${parsed.d}, ${parsed.y}`;
}

/** "2026-08-28" -> "August 2026". */
export function formatMonthYear(dateStr: string): string {
  const parsed = parseYmd(dateStr);
  if (!parsed) return dateStr;
  const monthName = MONTH_NAMES[parsed.mo - 1] ?? String(parsed.mo);
  return `${monthName} ${parsed.y}`;
}

/**
 * A plain-language description of what period a reading covers — this is
 * what tells a reader "fiscal-year-to-date" from "just this month" from
 * "as of this specific day," which is exactly the accounting-concept-mixing
 * the hard rules guard against if left implicit.
 */
export function describePeriod(periodType: PeriodType, periodEnd: string, fiscalYear: number | null): string {
  switch (periodType) {
    case "day":
      return `as of ${formatDateHuman(periodEnd)}`;
    case "month":
      return `for ${formatMonthYear(periodEnd)}`;
    case "fiscal_ytd":
      return `fiscal year to date through ${formatDateHuman(periodEnd)}${fiscalYear ? ` (FY${fiscalYear})` : ""}`;
    case "year":
      return fiscalYear ? `for FY${fiscalYear}` : `for ${periodEnd.slice(0, 4)}`;
    default:
      return periodEnd;
  }
}
