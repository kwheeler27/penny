/**
 * Pure transforms behind the front door's "When does the money move?"
 * section (beat 3): which calendar month is safe to call "complete," and
 * mapping sparse daily readings (Daily Treasury Statement deposits/
 * withdrawals, and the TGA closing balance) onto a full calendar month so a
 * weekend/holiday renders as a true gap at the right day, never a zero.
 * Kept separate from lib/cadence-data.ts's DB orchestration, matching
 * lib/front-door-transform.ts's own split, so every rule here is
 * unit-testable against a hand-built fixture, no database involved.
 */
import type { SeriesDef } from "@penny/registry";
import type { Reading } from "./types";
import { defaultUsdDecimals, formatExactUsd, formatMonthYear, formatSeriesUsd, formatUsdScale, sumDecimalStrings } from "./format";
import { isWeekday } from "./calendar";

/**
 * Picks the latest calendar month ("YYYY-MM") that can honestly be called
 * complete from an ascending, deduplicated list of month prefixes that
 * actually have data. Deliberately conservative: a month counts as complete
 * only once a LATER month has at least one observation — proof publication
 * continued past it. With fewer than 2 distinct months present, nothing can
 * be certified complete yet (a real gap, not a guess) — CLAUDE.md: never
 * fabricate. This may delay showing a just-finished month by a few days
 * (until the new month's first business day is ingested), which is the
 * accepted, documented trade-off for never claiming "complete" on a month
 * that might still be in progress.
 */
export function pickLatestCompleteMonthPrefix(monthPrefixesAscending: readonly string[]): string | null {
  if (monthPrefixesAscending.length < 2) return null;
  return monthPrefixesAscending[monthPrefixesAscending.length - 2]!;
}

/**
 * True only when EVERY weekday (Mon-Fri) in `allDays` (one calendar month,
 * from lib/calendar.ts's everyDayInMonth) has a reading in `presentDates`.
 * This is the day-level check `pickLatestCompleteMonthPrefix` above cannot
 * make on its own — that function only ever sees "this month has at least
 * one reading," which proves publication continued past the month but NOT
 * that ingestion covered every business day inside it. Without this check,
 * an ingestion outage spanning part of a month (e.g. the daily cron stalling
 * for a couple of weeks) would still get certified "complete" the moment any
 * later month published, and the missing weekdays would render as bar-less
 * gap columns indistinguishable from the true weekend/holiday gaps the
 * chart's caption promises ("Gaps are weekends and federal holidays"). The
 * caller (lib/cadence-data.ts) treats a false result the same as "no
 * complete month yet" — a real gap, never a mislabeled one.
 */
export function isMonthWeekdayComplete(allDays: readonly string[], presentDates: ReadonlySet<string>): boolean {
  return allDays.every((date) => !isWeekday(date) || presentDates.has(date));
}

function dayOfMonthOf(dateStr: string): number {
  return Number(dateStr.slice(8, 10));
}

export interface CadenceDayPoint {
  readonly date: string;
  readonly dayOfMonth: number;
  readonly depositWhole: string | null;
  readonly depositDisplay: string | null;
  readonly withdrawalWhole: string | null;
  readonly withdrawalDisplay: string | null;
}

export interface DailyCadenceData {
  readonly monthLabel: string;
  readonly days: readonly CadenceDayPoint[];
  readonly totalDepositsDisplay: string;
  readonly totalWithdrawalsDisplay: string;
}

/**
 * Maps sparse deposit/withdrawal daily readings onto every calendar day of
 * the month — a day with no reading (weekend, federal holiday) becomes an
 * explicit gap (`depositWhole`/`withdrawalWhole` null), never a zero.
 * `allDays` must be every calendar day of one month, ascending
 * (lib/calendar.ts's everyDayInMonth).
 */
export function buildDailyCadenceData(
  allDays: readonly string[],
  depositReadings: readonly Reading[],
  withdrawalReadings: readonly Reading[],
  depositsDef: SeriesDef,
  withdrawalsDef: SeriesDef,
): DailyCadenceData {
  const depositsByDate = new Map(depositReadings.map((r) => [r.periodEnd, r]));
  const withdrawalsByDate = new Map(withdrawalReadings.map((r) => [r.periodEnd, r]));

  // Hover titles must show the EXACT published figure (cadence-section.tsx's
  // caption promises "that day's exact figure") — formatSeriesUsd's own
  // `display` (rounded only to the source's own published precision, e.g.
  // whole dollars for a "millions"-magnitude DTS series), never
  // formatUsdScale's fixed-billions rounding, which would silently drop
  // real published precision (CLAUDE.md: never make a number wrong to make
  // it friendly). Mirrors ranked-bar-chart.tsx's row.exactDisplay pattern.
  const depositDecimals = defaultUsdDecimals(depositsDef.magnitude);
  const withdrawalDecimals = defaultUsdDecimals(withdrawalsDef.magnitude);
  const days: CadenceDayPoint[] = allDays.map((date) => {
    const dep = depositsByDate.get(date);
    const wd = withdrawalsByDate.get(date);
    const depExact = dep ? formatSeriesUsd(dep.value, depositsDef.magnitude).exact : null;
    const wdExact = wd ? formatSeriesUsd(wd.value, withdrawalsDef.magnitude).exact : null;
    return {
      date,
      dayOfMonth: dayOfMonthOf(date),
      depositWhole: depExact,
      depositDisplay: depExact !== null ? formatExactUsd(depExact, depositDecimals) : null,
      withdrawalWhole: wdExact,
      withdrawalDisplay: wdExact !== null ? formatExactUsd(wdExact, withdrawalDecimals) : null,
    };
  });

  const totalDeposits = sumDecimalStrings(days.filter((d) => d.depositWhole !== null).map((d) => d.depositWhole!));
  const totalWithdrawals = sumDecimalStrings(days.filter((d) => d.withdrawalWhole !== null).map((d) => d.withdrawalWhole!));

  return {
    monthLabel: formatMonthYear(allDays[allDays.length - 1] ?? allDays[0] ?? ""),
    days,
    totalDepositsDisplay: formatUsdScale(totalDeposits, "B", 1),
    totalWithdrawalsDisplay: formatUsdScale(totalWithdrawals, "B", 1),
  };
}

export interface TgaDayPoint {
  readonly date: string;
  readonly dayOfMonth: number;
  readonly valueWhole: string | null;
  readonly display: string | null;
}

export interface TgaMonthData {
  readonly monthLabel: string;
  readonly days: readonly TgaDayPoint[];
}

/** Maps sparse TGA closing-balance readings onto every calendar day of the
 * month — a weekend/holiday (no publication) becomes an explicit gap, never
 * a zero or a carried-forward prior value (fiscal.tga.closing_balance's own
 * registry notes). */
export function buildTgaMonthData(allDays: readonly string[], tgaReadings: readonly Reading[], tgaDef: SeriesDef): TgaMonthData {
  const byDate = new Map(tgaReadings.map((r) => [r.periodEnd, r]));
  const days: TgaDayPoint[] = allDays.map((date) => {
    const r = byDate.get(date);
    const exact = r ? formatSeriesUsd(r.value, tgaDef.magnitude).exact : null;
    return { date, dayOfMonth: dayOfMonthOf(date), valueWhole: exact, display: exact !== null ? formatUsdScale(exact, "B", 1) : null };
  });
  return { monthLabel: formatMonthYear(allDays[allDays.length - 1] ?? allDays[0] ?? ""), days };
}
