import { describe, it, expect } from "vitest";
import { zonedWallClockToUtcIso } from "../src/lib/time";

describe("zonedWallClockToUtcIso — America/New_York wall-clock -> UTC", () => {
  it("converts an EDT (summer) timestamp with the -4h offset", () => {
    // A real TreasuryDirect updatedTimestamp, live-captured 2026-09-01.
    expect(zonedWallClockToUtcIso("2026-08-20T13:03:23")).toBe("2026-08-20T17:03:23.000Z");
  });

  it("converts an EST (winter) timestamp with the -5h offset", () => {
    expect(zonedWallClockToUtcIso("2026-01-15T10:00:00")).toBe("2026-01-15T15:00:00.000Z");
  });

  it("a same-day bill result timestamp lands shortly after the known 11:30am ET competitive close", () => {
    // Live-captured 2026-09-01: a same-day bill auction's updatedTimestamp
    // was "...T11:33:19" — read as UTC that would be 7:33am ET, BEFORE the
    // 11:30am ET close, which is impossible for an already-published
    // result. Read as America/New_York it's ~3 minutes after the close.
    const utc = zonedWallClockToUtcIso("2026-09-01T11:33:19");
    expect(utc).toBe("2026-09-01T15:33:19.000Z");
  });

  it("is correct just before and just after the spring-forward transition (2026-03-08, US)", () => {
    expect(zonedWallClockToUtcIso("2026-03-08T01:59:00")).toBe("2026-03-08T06:59:00.000Z"); // still EST (-5h)
    expect(zonedWallClockToUtcIso("2026-03-08T03:00:00")).toBe("2026-03-08T07:00:00.000Z"); // now EDT (-4h)
  });

  it("is correct just before and just after the fall-back transition (2026-11-01, US)", () => {
    expect(zonedWallClockToUtcIso("2026-10-31T12:00:00")).toBe("2026-10-31T16:00:00.000Z"); // still EDT (-4h)
    expect(zonedWallClockToUtcIso("2026-11-02T12:00:00")).toBe("2026-11-02T17:00:00.000Z"); // now EST (-5h)
  });

  it("throws on a string that isn't a plain YYYY-MM-DDTHH:mm:ss wall clock", () => {
    expect(() => zonedWallClockToUtcIso("2026-08-20T13:03:23Z")).toThrow(/wall-clock/);
    expect(() => zonedWallClockToUtcIso("2026-08-20")).toThrow(/wall-clock/);
  });
});
