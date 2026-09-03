/**
 * Exact decimal-string arithmetic for money values.
 *
 * CLAUDE.md hard rule: money is never round-tripped through float
 * arithmetic. `@penny/db`'s `observation.value` is Postgres `numeric`,
 * returned by the driver as a decimal STRING (e.g. "36345909729842.9800")
 * specifically so nothing accidentally casts it through a JS `number` and
 * loses precision. Every reconciliation check in this package (category
 * sums vs. published totals, the receipts + borrowing = outlays identity)
 * must run on these strings via BigInt, never on `Number(value)`.
 *
 * `Number()` conversion is only ever acceptable for cosmetic pixel
 * proportions (see layout/sankeyGeometry.ts) — never for a sum that is
 * asserted to be exact, and never for a displayed figure (see money/format.ts).
 */

export interface ParsedDecimal {
  readonly sign: 1 | -1;
  /** All digits (integer + fractional) with the decimal point removed, as an unsigned BigInt. */
  readonly digits: bigint;
  /** Number of digits after the decimal point. `value = sign * digits / 10^scale`. */
  readonly scale: number;
}

const DECIMAL_STRING = /^[+-]?(\d+)?(\.\d+)?$/;

/** Parses a plain decimal string (as Postgres `numeric` renders it) into an exact sign/digits/scale triple. Never uses `Number()` or `parseFloat`. */
export function parseDecimal(input: string): ParsedDecimal {
  const trimmed = input.trim();
  if (!DECIMAL_STRING.test(trimmed) || trimmed === "" || trimmed === "+" || trimmed === "-") {
    throw new Error(`Not a plain decimal string: ${JSON.stringify(input)}`);
  }
  const sign: 1 | -1 = trimmed.startsWith("-") ? -1 : 1;
  const unsigned = trimmed.replace(/^[+-]/, "");
  const [intPart = "", fracPart = ""] = unsigned.split(".");
  const digitsStr = (intPart || "0") + fracPart;
  const digits = BigInt(digitsStr === "" ? "0" : digitsStr);
  return { sign: digits === 0n ? 1 : sign, digits, scale: fracPart.length };
}

/** Formats a sign/digits/scale triple back to a plain decimal string. Inverse of parseDecimal. */
export function formatDecimal(parsed: ParsedDecimal): string {
  const { sign, digits, scale } = parsed;
  const digitsStr = digits.toString();
  if (scale === 0) {
    return (sign < 0 && digits !== 0n ? "-" : "") + digitsStr;
  }
  const padded = digitsStr.padStart(scale + 1, "0");
  const intPart = padded.slice(0, padded.length - scale);
  const fracPart = padded.slice(padded.length - scale);
  return (sign < 0 && digits !== 0n ? "-" : "") + intPart + "." + fracPart;
}

/** Rescales two parsed decimals to a shared scale, returning signed BigInts at that scale. */
function toCommonScale(a: ParsedDecimal, b: ParsedDecimal): { av: bigint; bv: bigint; scale: number } {
  const scale = Math.max(a.scale, b.scale);
  const av = (a.sign < 0 ? -1n : 1n) * a.digits * 10n ** BigInt(scale - a.scale);
  const bv = (b.sign < 0 ? -1n : 1n) * b.digits * 10n ** BigInt(scale - b.scale);
  return { av, bv, scale };
}

function fromSigned(v: bigint, scale: number): ParsedDecimal {
  return { sign: v < 0n ? -1 : 1, digits: v < 0n ? -v : v, scale };
}

/** Exact a + b, as decimal strings. */
export function addDecimal(a: string, b: string): string {
  const { av, bv, scale } = toCommonScale(parseDecimal(a), parseDecimal(b));
  return formatDecimal(fromSigned(av + bv, scale));
}

/** Exact a - b, as decimal strings. */
export function subtractDecimal(a: string, b: string): string {
  const { av, bv, scale } = toCommonScale(parseDecimal(a), parseDecimal(b));
  return formatDecimal(fromSigned(av - bv, scale));
}

/** Exact sum of a list of decimal strings. Empty list sums to "0". */
export function sumDecimal(values: readonly string[]): string {
  return values.reduce((acc, v) => addDecimal(acc, v), "0");
}

/** -1 / 0 / 1 exact comparison, decimal-safe. */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const { av, bv } = toCommonScale(parseDecimal(a), parseDecimal(b));
  if (av < bv) return -1;
  if (av > bv) return 1;
  return 0;
}

export function isZeroDecimal(a: string): boolean {
  return parseDecimal(a).digits === 0n;
}

export function isNegativeDecimal(a: string): boolean {
  const p = parseDecimal(a);
  return p.sign < 0 && p.digits !== 0n;
}

export function negateDecimal(a: string): string {
  const p = parseDecimal(a);
  if (p.digits === 0n) return formatDecimal(p);
  return formatDecimal({ ...p, sign: p.sign < 0 ? 1 : -1 });
}

export function absDecimal(a: string): string {
  const p = parseDecimal(a);
  return formatDecimal({ ...p, sign: 1 });
}

const MAGNITUDE_EXPONENT = {
  ones: 0,
  thousands: 3,
  millions: 6,
  billions: 9,
} as const;

export type MagnitudeName = keyof typeof MAGNITUDE_EXPONENT;

/**
 * Converts a value from its published magnitude (e.g. MTS tables report
 * "millions") to actual whole/fractional dollars, as an exact decimal
 * string — pure decimal-point shifting via BigInt, never a float multiply.
 * This is the ONLY place magnitude conversion happens (CLAUDE.md: convert
 * only at the presentation boundary, never in storage or in a sum).
 */
export function scaleByMagnitude(value: string, magnitude: MagnitudeName): string {
  const exp = MAGNITUDE_EXPONENT[magnitude];
  if (exp === 0) return value;
  const p = parseDecimal(value);
  if (exp >= p.scale) {
    const digits = p.digits * 10n ** BigInt(exp - p.scale);
    return formatDecimal({ sign: p.sign, digits, scale: 0 });
  }
  return formatDecimal({ ...p, scale: p.scale - exp });
}

/**
 * Exact-as-representable decimal division of `value` by a positive integer
 * `count` (a trailing N-month rolling average's sum / N — see
 * layout/averagedHistoryLayout.ts's `rollingAverage`) — BigInt long
 * division, never Number()/parseFloat.
 *
 * A quotient like sum/12 is, in general, a REPEATING decimal (12 = 4*3, and
 * no power of 3 ever divides a power of 10) — it cannot be written as a
 * finite decimal string at all, so SOME rounding is mathematically
 * unavoidable to return one. This function performs exactly that one
 * rounding step, half-up on the magnitude, at `extraScale` digits past
 * `value`'s OWN decimal scale (default 6 — comfortably finer than any
 * number this package ever displays, which rounds to whole dollars at
 * coarsest; see money/format.ts's `formatUsd`). That is deliberately NOT
 * the "display boundary" a caller's own doc comment may refer to: this
 * result still carries several more digits of precision than a reader ever
 * sees, so a caller formatting it for display (via `formatUsd`) is doing
 * the FIRST rounding a human actually notices, not a second one stacked on
 * top of a display-precision value already thrown away here.
 */
export function divideDecimalByInt(value: string, count: number, extraScale: number = 6): string {
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(`divideDecimalByInt: count must be a positive integer, got ${count}`);
  }
  const p = parseDecimal(value);
  const scale = p.scale + extraScale;
  const scaledDigits = p.digits * 10n ** BigInt(extraScale);
  const bigCount = BigInt(count);
  const quotient = scaledDigits / bigCount;
  const remainder = scaledDigits % bigCount;
  // Half-up on the magnitude (matches toWholeDollarsBigInt's own
  // half-away-from-zero convention below) — compare 2x the remainder
  // against the divisor rather than dividing again, so this stays exact
  // BigInt arithmetic throughout.
  const roundedDigits = remainder * 2n >= bigCount ? quotient + 1n : quotient;
  return formatDecimal({ sign: roundedDigits === 0n ? 1 : p.sign, digits: roundedDigits, scale });
}

/** Converts an exact whole-dollar decimal string to a BigInt of whole dollars, rounding the fractional part half-away-from-zero. Never uses Number()/parseFloat. */
export function toWholeDollarsBigInt(value: string): bigint {
  const p = parseDecimal(value);
  if (p.scale === 0) return (p.sign < 0 ? -1n : 1n) * p.digits;
  const digitsStr = p.digits.toString().padStart(p.scale + 1, "0");
  const wholeStr = digitsStr.slice(0, digitsStr.length - p.scale) || "0";
  const fracStr = digitsStr.slice(digitsStr.length - p.scale);
  let whole = BigInt(wholeStr);
  const firstFracDigit = fracStr.charCodeAt(0) - 48;
  if (firstFracDigit >= 5) whole += 1n;
  return (p.sign < 0 ? -1n : 1n) * whole;
}
