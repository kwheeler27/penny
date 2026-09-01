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

/** A registry series' stored value -> a human headcount string, doing the
 * magnitude scale-up and rounding in one call — the `persons`/`households`
 * counterpart to formatSeriesUsd. A headcount is not money (CLAUDE.md:
 * accounting concepts never mix silently), so this never adds a currency
 * sign and defaults to 0 decimals (a fractional person/household is not
 * meaningful). Returns both the rounded display string and the
 * full-precision scaled value, mirroring formatSeriesUsd's shape exactly so
 * every call site (RegistryFigure) can share one branching pattern. */
export function formatSeriesCount(
  storedValue: string,
  magnitude: Magnitude,
  decimals = 0,
): { display: string; exact: string; decimals: number } {
  const places = magnitudePlaces(magnitude);
  const exact = shiftDecimalRight(storedValue, places);
  const { sign, abs } = splitSign(roundDecimalString(exact, decimals));
  return { display: `${sign}${groupThousandsUnsigned(abs)}`, exact, decimals };
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

/** "2026-08-28" -> "August" — the bare month name, no year (front-door
 * period-toggle copy: "FY 2026 through August" / "August only"). */
export function formatMonthName(dateStr: string): string {
  const parsed = parseYmd(dateStr);
  if (!parsed) return dateStr;
  return MONTH_NAMES[parsed.mo - 1] ?? String(parsed.mo);
}

/** "2026-08-28" -> "Aug 2026" — compact form for a chart axis tick. */
export function formatMonthYearShort(dateStr: string): string {
  const parsed = parseYmd(dateStr);
  if (!parsed) return dateStr;
  const monthName = MONTH_NAMES[parsed.mo - 1] ?? String(parsed.mo);
  return `${monthName.slice(0, 3)} ${parsed.y}`;
}

// ---------- fixed-scale abbreviation & derived ratios (front-door charts) ----------
// Everything below is exact BigInt arithmetic — never Number()/parseFloat,
// even for an illustrative "for scale" ratio that isn't itself a stored
// series value. See packages/viz/src/money/decimal.ts's own doc comment:
// Number() is only ever acceptable for a COSMETIC pixel proportion, never a
// displayed figure.
//
// This duplicates (deliberately, in miniature) the same sign/digits/scale
// decimal parsing @penny/viz/src/money/decimal.ts already implements, rather
// than importing it: @penny/viz's package entrypoint is one barrel
// (src/index.ts) that also re-exports its React-hook-using scrollytelling
// components, so importing anything from "@penny/viz" here would pull that
// whole module graph into every Server Component that imports this file
// (nearly every page) — Next's Server/Client boundary check then fails the
// build the moment any of those files' hooks are reachable from a Server
// Component's module graph, even though this file only ever wanted the pure
// money math. Reusing @penny/viz's SHAPE (not its code) keeps the two
// implementations trivially comparable if either ever changes.

interface ParsedDecimal {
  readonly sign: 1 | -1;
  readonly digits: bigint;
  readonly scale: number;
}

function parseDecimal(value: string): ParsedDecimal {
  const trimmed = value.trim();
  const neg = trimmed.startsWith("-");
  const abs = neg ? trimmed.slice(1) : trimmed;
  const [intPartRaw, fracPartRaw = ""] = abs.split(".");
  const digitsStr = (intPartRaw || "0") + fracPartRaw;
  const digits = BigInt(digitsStr === "" ? "0" : digitsStr);
  return { sign: digits === 0n ? 1 : neg ? -1 : 1, digits, scale: fracPartRaw.length };
}

function formatParsedDecimal(v: bigint, scale: number): string {
  const neg = v < 0n;
  const digits = (neg ? -v : v).toString();
  if (scale === 0) return (neg && v !== 0n ? "-" : "") + digits;
  const padded = digits.padStart(scale + 1, "0");
  const intPart = padded.slice(0, padded.length - scale);
  const fracPart = padded.slice(padded.length - scale);
  return (neg && v !== 0n ? "-" : "") + intPart + "." + fracPart;
}

/** -1/0/1 exact comparison of two decimal strings. */
export function compareDecimalStrings(a: string, b: string): -1 | 0 | 1 {
  const pa = parseDecimal(a);
  const pb = parseDecimal(b);
  const scale = Math.max(pa.scale, pb.scale);
  const av = (pa.sign < 0 ? -1n : 1n) * pa.digits * 10n ** BigInt(scale - pa.scale);
  const bv = (pb.sign < 0 ? -1n : 1n) * pb.digits * 10n ** BigInt(scale - pb.scale);
  return av < bv ? -1 : av > bv ? 1 : 0;
}

/** Exact a - b, as a decimal string. */
export function subtractDecimalStrings(a: string, b: string): string {
  const pa = parseDecimal(a);
  const pb = parseDecimal(b);
  const scale = Math.max(pa.scale, pb.scale);
  const av = (pa.sign < 0 ? -1n : 1n) * pa.digits * 10n ** BigInt(scale - pa.scale);
  const bv = (pb.sign < 0 ? -1n : 1n) * pb.digits * 10n ** BigInt(scale - pb.scale);
  return formatParsedDecimal(av - bv, scale);
}

/** True when the exact value is negative (a plain "starts with -" check
 * would also flag an exact "-0", which is not negative). */
export function isNegativeDecimalString(a: string): boolean {
  const p = parseDecimal(a);
  return p.sign < 0 && p.digits !== 0n;
}

/** Strips a leading "-" from a decimal string, exactly (string-level, never
 * via Number()/Math.abs). */
export function absDecimalString(a: string): string {
  const trimmed = a.trim();
  return trimmed.startsWith("-") ? trimmed.slice(1) : trimmed;
}

export type FixedScale = "T" | "B" | "M";

const FIXED_SCALE_EXPONENT: Record<FixedScale, number> = { T: 12, B: 9, M: 6 };

/**
 * Rounds `value` (already expressed in whole units — e.g. whole dollars, or
 * a whole headcount) to a FIXED order of magnitude the caller names, to
 * `decimals` places, as an unsigned digit BigInt plus a sign. Unlike
 * `Intl.NumberFormat`'s "compact" notation (which auto-picks K/M/B/T per
 * value — see @penny/viz's formatUsd), this always uses the scale the
 * caller asked for: the front door's bar-chart rows and Act III bridge fix
 * every value in view to billions regardless of a category's own size, per
 * the approved mockup.
 */
function scaleDigits(value: string, scale: FixedScale, decimals: number): { sign: 1 | -1; digits: bigint } {
  const exponent = FIXED_SCALE_EXPONENT[scale];
  const p = parseDecimal(value);
  // value = sign * digits / 10^p.scale; want value / 10^exponent, to
  // `decimals` places = sign * digits / 10^(p.scale + exponent - decimals),
  // rounded to the nearest integer (half-up).
  const shift = p.scale + exponent - decimals;
  if (shift >= 0) {
    const divisor = 10n ** BigInt(shift);
    const half = divisor / 2n;
    return { sign: p.sign, digits: (p.digits + half) / divisor };
  }
  return { sign: p.sign, digits: p.digits * 10n ** BigInt(-shift) };
}

/** Renders an unsigned digit BigInt (already scaled to `decimals` places, no
 * decimal point) as a plain magnitude string — "1,384.4" — no sign, no
 * currency symbol, no scale suffix; callers add those. */
function digitsToMagnitude(digits: bigint, decimals: number, grouped: boolean): string {
  const str = digits.toString().padStart(decimals + 1, "0");
  const intPart = decimals > 0 ? str.slice(0, -decimals) || "0" : str;
  const fracPart = decimals > 0 ? str.slice(-decimals) : "";
  const groupedInt = grouped ? groupThousandsUnsigned(intPart) : intPart;
  return fracPart ? `${groupedInt}.${fracPart}` : groupedInt;
}

/** A true minus sign ("−"), or "" — never rendered for an exact-zero result
 * (mirrors formatExactUsd's own sign convention). */
function signPrefix(sign: 1 | -1, digits: bigint): string {
  return sign < 0 && digits !== 0n ? "−" : "";
}

/** A whole-dollar decimal string -> "$1,384.4B" style, at a FIXED scale. */
export function formatUsdScale(wholeDollarValue: string, scale: FixedScale, decimals = 1): string {
  const { sign, digits } = scaleDigits(wholeDollarValue, scale, decimals);
  return `${signPrefix(sign, digits)}$${digitsToMagnitude(digits, decimals, true)}${scale}`;
}

/** A plain whole-count decimal string (e.g. a Census headcount, already
 * scaled to whole units) -> "132.2M" style — no currency sign. */
export function formatCountScale(wholeValue: string, scale: FixedScale, decimals = 1): string {
  const { sign, digits } = scaleDigits(wholeValue, scale, decimals);
  return `${signPrefix(sign, digits)}${digitsToMagnitude(digits, decimals, true)}${scale}`;
}

/**
 * `value`'s share of `total`, as a signed percentage string ("22.0%",
 * "−2.2%") — exact BigInt division, half-up rounded to `decimals` places.
 * A negative share means `value` ran opposite the period's net direction
 * (e.g. an outlay category that was actually a net offsetting receipt that
 * period) — never hidden behind an absolute value.
 */
export function formatSharePercent(value: string, total: string, decimals = 1): string {
  const v = parseDecimal(value);
  const t = parseDecimal(total);
  if (t.digits === 0n) return "—";
  const sign: 1 | -1 = v.digits === 0n ? 1 : ((v.sign * t.sign) as 1 | -1);
  const numerator = v.digits * 10n ** BigInt(t.scale + decimals + 2); // +2 for the *100
  const denominator = t.digits * 10n ** BigInt(v.scale);
  const half = denominator / 2n;
  const digits = (numerator + half) / denominator;
  return `${signPrefix(sign, digits)}${digitsToMagnitude(digits, decimals, false)}%`;
}

/**
 * Exact a/b, to `decimals` places, as a plain signed decimal string — no
 * currency sign, no grouping, no "%" suffix. The shared primitive behind
 * every illustrative "for scale" ratio the front door displays (spend per
 * household, debt per resident, ...).
 */
export function divideDecimalStrings(a: string, b: string, decimals: number): string {
  const pa = parseDecimal(a);
  const pb = parseDecimal(b);
  if (pb.digits === 0n) return "0";
  const sign: 1 | -1 = pa.digits === 0n ? 1 : ((pa.sign * pb.sign) as 1 | -1);
  const numerator = pa.digits * 10n ** BigInt(pb.scale + decimals);
  const denominator = pb.digits * 10n ** BigInt(pa.scale);
  const half = denominator / 2n;
  const digits = (numerator + half) / denominator;
  return `${signPrefix(sign, digits)}${digitsToMagnitude(digits, decimals, false)}`;
}

/**
 * Rounds a signed INTEGER decimal string (no fractional part — callers pass
 * the output of `divideDecimalStrings(..., 0)`) to `sigFigs` significant
 * figures, e.g. "47532" -> "47500" at 3 sig figs. Used only for the
 * illustrative "≈" for-scale facts, where a round number reads more
 * honestly as an approximation than a spuriously precise one. Exact BigInt
 * arithmetic — never Number()/parseFloat.
 */
export function roundToSignificantFigures(integerValue: string, sigFigs: number): string {
  const trimmed = integerValue.trim();
  const neg = trimmed.startsWith("-") || trimmed.startsWith("−");
  const digitsOnly = (neg ? trimmed.slice(1) : trimmed).replace(/\D/g, "");
  const abs = BigInt(digitsOnly === "" ? "0" : digitsOnly);
  if (abs === 0n) return "0";
  const digitCount = abs.toString().length;
  const dropExponent = digitCount - sigFigs;
  if (dropExponent <= 0) return (neg ? "−" : "") + abs.toString();
  const divisor = 10n ** BigInt(dropExponent);
  const half = divisor / 2n;
  const rounded = ((abs + half) / divisor) * divisor;
  return (neg && rounded !== 0n ? "−" : "") + rounded.toString();
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
