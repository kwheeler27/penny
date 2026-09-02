import { describe, expect, it } from "vitest";
import { addDays, dayOfWeek, daysBetween, daysInMonth, everyDayInMonth, isLeapYear, isWeekday, monthPrefixOf, parseMonthPrefix } from "../lib/calendar";

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

describe("daysBetween", () => {
  it("matches simple within-month and cross-month spans", () => {
    expect(daysBetween("2026-08-01", "2026-08-31")).toBe(30);
    expect(daysBetween("2026-08-27", "2026-08-27")).toBe(0);
    expect(daysBetween("2026-07-29", "2026-08-28")).toBe(30);
  });

  it("counts a leap-day span correctly", () => {
    // 2024 is a leap year: Feb 1 -> Mar 1 spans 29 days, not 28.
    expect(daysBetween("2024-02-01", "2024-03-01")).toBe(29);
    expect(daysBetween("2023-02-01", "2023-03-01")).toBe(28);
  });

  it("counts a full non-leap and a full leap year correctly", () => {
    expect(daysBetween("2025-01-01", "2026-01-01")).toBe(365);
    // 2024 is a leap year, so the span from Mar 1 2023 to Mar 1 2024 crosses
    // Feb 29 2024 and is 366 days, not 365.
    expect(daysBetween("2023-03-01", "2024-03-01")).toBe(366);
    expect(daysBetween("2024-03-01", "2025-03-01")).toBe(365);
  });

  it("is negative when toDate precedes fromDate, and antisymmetric", () => {
    expect(daysBetween("2026-08-27", "2025-07-29")).toBe(-daysBetween("2025-07-29", "2026-08-27"));
  });

  it("matches the real 7-year auction window from the approved mockup (Jul 29 2025 -> Aug 27 2026)", () => {
    expect(daysBetween("2025-07-29", "2026-08-27")).toBe(394);
    expect(daysBetween("2025-07-29", "2026-08-27")).toBeGreaterThanOrEqual(365);
  });
});

describe("addDays", () => {
  it("adds within a month and across a month boundary", () => {
    expect(addDays("2026-08-27", 3)).toBe("2026-08-30");
    expect(addDays("2026-08-27", 5)).toBe("2026-09-01");
  });

  it("subtracts (negative delta) across a month and year boundary", () => {
    expect(addDays("2026-08-27", -30)).toBe("2026-07-28");
    expect(addDays("2026-01-05", -10)).toBe("2025-12-26");
  });

  it("handles a leap-day crossing correctly", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-02-29", 1)).toBe("2024-03-01");
    expect(addDays("2023-02-28", 1)).toBe("2023-03-01"); // no Feb 29 in a non-leap year
  });

  it("round-trips exactly through daysBetween for a range of deltas", () => {
    for (const delta of [-400, -30, -1, 0, 1, 30, 366]) {
      const result = addDays("2026-08-27", delta);
      expect(daysBetween("2026-08-27", result)).toBe(delta);
    }
  });
});

describe("monthPrefixOf / parseMonthPrefix", () => {
  it("round-trips a date string through its month prefix", () => {
    expect(monthPrefixOf("2026-07-31")).toBe("2026-07");
    expect(parseMonthPrefix("2026-07")).toEqual({ year: 2026, month: 7 });
  });
});
