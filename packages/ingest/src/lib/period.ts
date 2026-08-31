/**
 * Fiscal-year (Oct 1–Sep 30, named for its ending year) and calendar-date
 * helpers shared by the MTS ingest jobs. Every date this module produces is
 * a plain `YYYY-MM-DD` string built from integer arithmetic — never through
 * a JS `Date` round-trip, per the "transaction dates are calendar dates,
 * never timezone-shifted through Date round-trips" house rule.
 */

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

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** True for a Gregorian leap year — needed only for February's day count. */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Last calendar day of a given (year, 1-indexed month). */
export function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  const d = DAYS_IN_MONTH[month - 1];
  if (d === undefined) throw new Error(`invalid month: ${month}`);
  return d;
}

export function firstDayOfMonth(year: number, month: number): string {
  return `${year}-${pad2(month)}-01`;
}

export function lastDayOfMonth(year: number, month: number): string {
  return `${year}-${pad2(month)}-${pad2(daysInMonth(year, month))}`;
}

/** The first day of a fiscal year, e.g. fiscalYear=2026 -> "2025-10-01". */
export function fiscalYearStart(fiscalYear: number): string {
  return `${fiscalYear - 1}-10-01`;
}

/** Full month name for a 1-indexed calendar month, e.g. 7 -> "July". */
export function monthName(month: number): string {
  const name = MONTH_NAMES[month - 1];
  if (name === undefined) throw new Error(`invalid month: ${month}`);
  return name;
}

/** 1-indexed calendar month for a full month name ("July" -> 7), or undefined if not a recognized month name (e.g. MTS's non-month rows like "Year-to-Date"). */
export function monthNumberFromName(name: string): number | undefined {
  const idx = MONTH_NAMES.indexOf(name as (typeof MONTH_NAMES)[number]);
  return idx === -1 ? undefined : idx + 1;
}

/**
 * A fiscal year's Oct/Nov/Dec fall in the PRIOR calendar year; Jan–Sep fall
 * in the fiscal year's own number. E.g. FY2026 "October" is calendar
 * 2025-10; FY2026 "July" is calendar 2026-07.
 */
export function fiscalMonthToCalendar(monthNum: number, fiscalYear: number): { year: number; month: number } {
  return monthNum >= 10 ? { year: fiscalYear - 1, month: monthNum } : { year: fiscalYear, month: monthNum };
}

/** Which fiscal year a calendar (year, month) falls in — Oct–Dec belong to the FOLLOWING fiscal year. */
export function fiscalYearOf(year: number, month: number): number {
  return month >= 10 ? year + 1 : year;
}
