/**
 * Computed takeaway headings for the /now tiles (docs/DESIGN_PRINCIPLES.md
 * §1: headings lead with the finding, computed from the data beneath them,
 * written to self-retract when the data stops supporting them).
 *
 * Pure functions over the two latest distinct readings of a series — every
 * word here is derived: the direction from an exact decimal comparison, the
 * amount from the exact delta, the period phrase from the readings' own
 * dates. Returns null whenever an honest claim can't be computed (fewer than
 * two readings, or a fiscal-YTD pair straddling a fiscal-year rollover —
 * comparing FYTD October to FYTD September of the PRIOR year would be a
 * same-vs-whole comparison in disguise, §5/§7's same-span rule), and the
 * tile then renders without a takeaway rather than with a guess (§6).
 *
 * Register: neutral (§3). "Up/Down/The gap grew/shrank" state arithmetic,
 * not judgment — no banned adjectives, no imputed meaning.
 */
import type { Magnitude } from "@penny/registry";
import type { Reading } from "@/lib/types";
import {
  absDecimalString,
  compareDecimalStrings,
  formatDateShort,
  formatMonthName,
  formatMonthYearShort,
  formatUsdScale,
  isNegativeDecimalString,
  magnitudePlaces,
  shiftDecimalRight,
  subtractDecimalStrings,
  type FixedScale,
} from "@/lib/format";

/** Whole calendar-month index from a YYYY-MM-DD string — exact integer
 * arithmetic on the digits, never a Date (same convention as
 * ranked-bar-chart.tsx's monthIndex). */
function monthIndex(periodEnd: string): number {
  return Number(periodEnd.slice(0, 4)) * 12 + Number(periodEnd.slice(5, 7));
}

/**
 * A delta reads at chart scale ("$9.3B"), never at the tile value's full
 * published precision — the takeaway is a magnitude claim, and the exact
 * figures it derives from sit right below it with their provenance. Scale
 * picked by the delta's own size (T/B/M), floor M.
 */
function deltaDisplay(delta: string, magnitude: Magnitude): string {
  const whole = shiftDecimalRight(absDecimalString(delta), magnitudePlaces(magnitude));
  const intDigits = (whole.split(".")[0] ?? "").replace(/^0+/, "").length;
  const scale: FixedScale = intDigits > 12 ? "T" : intDigits > 9 ? "B" : "M";
  return formatUsdScale(whole, scale, 1);
}

/**
 * A daily stock (debt, TGA): latest close vs the previous ingested close.
 * "Up $9.3B from the previous close (Aug 26)". The previous close is named
 * by date, so a weekend/holiday gap stays honest — the claim says exactly
 * which reading it compares against.
 */
function dayTakeaway(latest: Reading, prev: Reading, magnitude: Magnitude): string {
  const delta = subtractDecimalStrings(latest.value, prev.value);
  const when = `the previous close (${formatDateShort(prev.periodEnd)})`;
  const cmp = compareDecimalStrings(delta, "0");
  if (cmp === 0) return `Unchanged from ${when}`;
  return `${cmp > 0 ? "Up" : "Down"} ${deltaDisplay(delta, magnitude)} from ${when}`;
}

/**
 * A monthly flow (interest expense): latest month vs the previous ingested
 * month, which is always named — "Up $4.2B vs Jun 2026" — so an ingestion
 * gap (July vs May) reads as exactly what it is.
 */
function monthTakeaway(latest: Reading, prev: Reading, magnitude: Magnitude): string {
  const delta = subtractDecimalStrings(latest.value, prev.value);
  const when = `vs ${formatMonthYearShort(prev.periodEnd)}`;
  const cmp = compareDecimalStrings(delta, "0");
  if (cmp === 0) return `Unchanged ${when}`;
  return `${cmp > 0 ? "Up" : "Down"} ${deltaDisplay(delta, magnitude)} ${when}`;
}

/**
 * The FYTD deficit/surplus (registry sign convention: negative = deficit).
 * The month-over-month change in the FYTD reading IS the month's own
 * contribution, phrased in the front door's Act IV vocabulary ("the gap").
 * Sign crossings self-retract to a swing sentence instead of a grew/shrank
 * claim that would be wrong on both sides.
 */
function fiscalYtdTakeaway(latest: Reading, prev: Reading, magnitude: Magnitude): string | null {
  if (latest.fiscalYear === null || prev.fiscalYear === null || latest.fiscalYear !== prev.fiscalYear) return null;

  // "in July" only when prev is the immediately preceding month; otherwise
  // the span is named so the claim can't silently cover more months than
  // the reader assumes.
  const adjacent = monthIndex(latest.periodEnd) - monthIndex(prev.periodEnd) === 1;
  const when = adjacent ? `in ${formatMonthName(latest.periodEnd)}` : `since ${formatMonthYearShort(prev.periodEnd)}`;

  const latestNegative = isNegativeDecimalString(latest.value);
  const prevNegative = isNegativeDecimalString(prev.value);
  if (latestNegative !== prevNegative) {
    return latestNegative ? `Swung to a deficit ${when}` : `Swung to a surplus ${when}`;
  }

  const noun = latestNegative ? "gap" : "surplus";
  const sizeDelta = subtractDecimalStrings(absDecimalString(latest.value), absDecimalString(prev.value));
  const cmp = compareDecimalStrings(sizeDelta, "0");
  if (cmp === 0) return `The ${noun} was unchanged ${when}`;
  return `The ${noun} ${cmp > 0 ? "grew" : "shrank"} ${deltaDisplay(sizeDelta, magnitude)} ${when}`;
}

/**
 * The tile takeaway, or null when no honest one can be computed. `readings`
 * is the output of getLatestDistinctReadings (latest first, distinct
 * period_ends, latest publication per period).
 */
export function buildNowTakeaway(readings: Reading[], magnitude: Magnitude): string | null {
  if (readings.length < 2) return null;
  const [latest, prev] = readings as [Reading, Reading];
  switch (latest.periodType) {
    case "day":
      return dayTakeaway(latest, prev, magnitude);
    case "month":
      return monthTakeaway(latest, prev, magnitude);
    case "fiscal_ytd":
      return fiscalYtdTakeaway(latest, prev, magnitude);
    default:
      return null;
  }
}
