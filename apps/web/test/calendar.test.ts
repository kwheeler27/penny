import { describe, expect, it } from "vitest";
import { dayOfWeek, daysInMonth, everyDayInMonth, isLeapYear, isWeekday, monthPrefixOf, parseMonthPrefix } from "../lib/calendar";

describe("isLeapYear", () => {
  it("follows the standard Gregorian rule", () => {
    expect(isLeapYear(2024)).toBe(true); // divisible by 4
    expect(isLeapYear(2023)).toBe(false);
    expect(isLeapYear(1900)).toBe(false); // divisible by 100, not 400
    expect(isLeapYear(2000)).toBe(true); // divisible by 400
  });
});

describe("daysInMonth", () => {
  it("returns 29 for February in a leap year, 28 otherwise", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
  });

  it("matches the standard 30/31-day pattern for every other month", () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 7)).toBe(31);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe("everyDayInMonth", () => {
  it("returns every calendar day, ascending, including the leap day", () => {
    const days = everyDayInMonth(2024, 2);
    expect(days).toHaveLength(29);
    expect(days[0]).toBe("2024-02-01");
    expect(days[days.length - 1]).toBe("2024-02-29");
  });

  it("returns exactly 31 days for July, correctly zero-padded", () => {
    const days = everyDayInMonth(2026, 7);
    expect(days).toHaveLength(31);
    expect(days).toContain("2026-07-01");
    expect(days).toContain("2026-07-31");
    expect(days[8]).toBe("2026-07-09"); // zero-padded, not "2026-7-9"
  });
});

describe("dayOfWeek / isWeekday", () => {
  it("matches known real-calendar dates (0 = Sunday .. 6 = Saturday)", () => {
    expect(dayOfWeek("2026-01-01")).toBe(4); // Thursday
    expect(dayOfWeek("2026-06-01")).toBe(1); // Monday
    expect(dayOfWeek("2026-06-06")).toBe(6); // Saturday
    expect(dayOfWeek("2026-06-07")).toBe(0); // Sunday
    expect(dayOfWeek("2000-01-01")).toBe(6); // Saturday
    expect(dayOfWeek("2024-02-29")).toBe(4); // Thursday (leap day)
  });

  it("isWeekday is true Monday-Friday, false on the weekend", () => {
    expect(isWeekday("2026-06-01")).toBe(true); // Mon
    expect(isWeekday("2026-06-05")).toBe(true); // Fri
    expect(isWeekday("2026-06-06")).toBe(false); // Sat
    expect(isWeekday("2026-06-07")).toBe(false); // Sun
  });
});

describe("monthPrefixOf / parseMonthPrefix", () => {
  it("round-trips a date string through its month prefix", () => {
    expect(monthPrefixOf("2026-07-31")).toBe("2026-07");
    expect(parseMonthPrefix("2026-07")).toEqual({ year: 2026, month: 7 });
  });
});
