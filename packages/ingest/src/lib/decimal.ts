/**
 * Exact decimal-string arithmetic — no `Number()`/`parseFloat()` anywhere in
 * this module. Every FiscalData/BLS amount arrives as a string specifically
 * so it never round-trips through a JS float; this module lets ingest code
 * compare and sum those strings (for reconciliation checks and idempotency
 * comparisons) while keeping that guarantee. Internally it scales to
 * arbitrary-precision integers via `BigInt` (the moral equivalent of
 * "convert to cents"), never `number`.
 */

export interface ParsedDecimal {
  negative: boolean;
  intPart: string;
  fracPart: string;
}

const DECIMAL_RE = /^(-)?(\d+)(?:\.(\d+))?$/;

/** Parse a plain decimal string ("-123.4500", "0", "700123") into sign + digit parts. Throws on anything else (scientific notation, commas, currency symbols) — callers should already have validated via a Zod amount schema before this ever runs. */
export function parseDecimal(raw: string): ParsedDecimal {
  const m = DECIMAL_RE.exec(raw.trim());
  if (!m) {
    throw new Error(`not a plain decimal string: ${JSON.stringify(raw)}`);
  }
  const negative = m[1] === "-";
  const intPart = m[2] ?? "0";
  const fracPart = m[3] ?? "";
  return { negative, intPart, fracPart };
}

/** Canonical form: no leading zeros in the integer part, no trailing zeros in the fraction, and "-0"/"-0.00" normalized to non-negative zero. */
function normalize(raw: string): ParsedDecimal {
  const p = parseDecimal(raw);
  const intPart = p.intPart.replace(/^0+(?=\d)/, "");
  const fracPart = p.fracPart.replace(/0+$/, "");
  const isZero = intPart === "0" && fracPart === "";
  return { negative: isZero ? false : p.negative, intPart, fracPart };
}

/** True when two decimal strings represent the same value, regardless of formatting (trailing/leading zeros, "-0" vs "0"). Never compares as floats. */
export function decimalEquals(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  return na.negative === nb.negative && na.intPart === nb.intPart && na.fracPart === nb.fracPart;
}

/** Scale a parsed decimal to `scale` fractional digits and return its signed BigInt magnitude (e.g. "12.5" at scale 2 -> 1250n). */
function toScaledBigInt(p: ParsedDecimal, scale: number): bigint {
  const fracPadded = p.fracPart.padEnd(scale, "0");
  const magnitude = BigInt(p.intPart + fracPadded || "0");
  return p.negative ? -magnitude : magnitude;
}

function fromScaledBigInt(value: bigint, scale: number): string {
  const negative = value < 0n;
  const abs = (negative ? -value : value).toString().padStart(scale + 1, "0");
  const intPart = abs.slice(0, abs.length - scale) || "0";
  const fracPart = scale > 0 ? abs.slice(abs.length - scale) : "";
  const isZero = intPart === "0" && /^0*$/.test(fracPart);
  const sign = negative && !isZero ? "-" : "";
  return fracPart ? `${sign}${intPart}.${fracPart}` : `${sign}${intPart}`;
}

/** Exact sum of any number of decimal strings, via scaled BigInt (never float addition). Result uses the widest scale among the inputs. */
export function decimalSum(values: readonly string[]): string {
  if (values.length === 0) return "0";
  const parsed = values.map(parseDecimal);
  const scale = Math.max(...parsed.map((p) => p.fracPart.length));
  const total = parsed.reduce((acc, p) => acc + toScaledBigInt(p, scale), 0n);
  return fromScaledBigInt(total, scale);
}

/** a - b, exact. */
export function decimalSubtract(a: string, b: string): string {
  const pa = parseDecimal(a);
  const pb = parseDecimal(b);
  const scale = Math.max(pa.fracPart.length, pb.fracPart.length);
  return fromScaledBigInt(toScaledBigInt(pa, scale) - toScaledBigInt(pb, scale), scale);
}
