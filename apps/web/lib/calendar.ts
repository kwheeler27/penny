/**
 * Pure calendar-date arithmetic on plain YYYY-MM-DD strings — never via the
 * `Date` object (CLAUDE.md: transaction dates are calendar dates, never
 * timezone-shifted through a `Date` round-trip). Every function here parses
 * a date string's digits directly or works on plain year/month integers,
 * matching lib/format.ts's own parseYmd convention.
 */

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Number of calendar days in a given year/month (month is 1-12), leap-year aware. */
export function daysInMonth(year: number, month: number): number {
  return month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1]!;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "YYYY-MM-DD" -> "YYYY-MM" (the calendar-month prefix). */
export function monthPrefixOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/** "YYYY-MM" -> { year, month } as plain integers. */
export function parseMonthPrefix(prefix: string): { year: number; month: number } {
  return { year: Number(prefix.slice(0, 4)), month: Number(prefix.slice(5, 7)) };
}

/**
 * Every calendar day in one year/month, as "YYYY-MM-DD" strings, ascending —
 * the FULL calendar (including weekends and federal holidays), so a caller
 * can render a true gap on exactly the day it falls on rather than only the
 * days a source happened to publish (CLAUDE.md: missing data is a gap,
 * never a zero — and a gap has to occupy the right position to be honest
 * about *when* it is).
 */
export function everyDayInMonth(year: number, month: number): string[] {
  const count = daysInMonth(year, month);
  const days: string[] = [];
  for (let d = 1; d <= count; d++) days.push(`${year}-${pad2(month)}-${pad2(d)}`);
  return days;
}

/**
 * Day of week for a plain YYYY-MM-DD string (0 = Sunday .. 6 = Saturday),
 * via Zeller's congruence — pure calendar math on the string's own
 * year/month/day digits, never a `Date` object (this isn't a moment in
 * time with a timezone to shift; it's the same calendar-arithmetic
 * convention every other function in this file already follows).
 */
export function dayOfWeek(dateStr: string): number {
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7));
  const day = Number(dateStr.slice(8, 10));
  let m = month;
  let y = year;
  if (m < 3) {
    m += 12;
    y -= 1;
  }
  const k = y % 100;
  const j = Math.floor(y / 100);
  // h: 0 = Saturday, 1 = Sunday, ..., 6 = Friday — remapped below to the
  // conventional 0 = Sunday .. 6 = Saturday.
  const h = (day + Math.floor((13 * (m + 1)) / 5) + k + Math.floor(k / 4) + Math.floor(j / 4) + 5 * j) % 7;
  return (h + 6) % 7;
}

/** True for Monday through Friday — the "business day" half of "the Daily
 * Treasury Statement doesn't publish on weekends or federal holidays" (the
 * holiday half isn't derivable from the calendar alone, so callers that need
 * it combine this with actual publication data). */
export function isWeekday(dateStr: string): boolean {
  const dow = dayOfWeek(dateStr);
  return dow !== 0 && dow !== 6;
}
