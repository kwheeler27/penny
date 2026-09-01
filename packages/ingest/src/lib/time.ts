/**
 * America/New_York wall-clock -> UTC conversion, via `Intl.DateTimeFormat`
 * (Node ships full ICU by default, so this needs no timezone-data
 * dependency and correctly follows the real historical/future US DST
 * transition dates rather than a hand-rolled approximation of them).
 *
 * Exists for one caller: TreasuryDirect's `updatedTimestamp` field
 * (`"2026-08-20T13:03:23"`) carries no UTC offset, and is verified LIVE
 * (2026-09-01) to be Eastern local time, not UTC — same-day bill results
 * (bills close for competitive bidding at 11:30am ET) show
 * `updatedTimestamp` values like `"...T11:33:19"`; read as UTC that would
 * be 7:33am ET, before the close, which is impossible for a
 * results-are-already-published timestamp. Read as America/New_York it is
 * ~3 minutes after the close, which is exactly right.
 */

/** UTC instant (ms since epoch) for a given UTC-labeled Date, re-expressed as if that same wall-clock reading were `timeZone`'s local time — i.e. `timeZone`'s current offset from UTC, in minutes (positive west of UTC, matching `Date.prototype.getTimezoneOffset`'s sign convention). */
function tzOffsetMinutes(utcInstant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(utcInstant)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (asUtc - utcInstant.getTime()) / 60_000;
}

/**
 * Interpret `wallClock` (a naive `"YYYY-MM-DDTHH:mm:ss"` string, no offset)
 * as local time in `timeZone`, and return the equivalent UTC instant as an
 * ISO 8601 string (`...Z`). Converges in at most 2 iterations in practice
 * (DST offset changes are always whole hours, so one correction is always
 * enough; a second pass just confirms it near a transition boundary).
 */
export function zonedWallClockToUtcIso(wallClock: string, timeZone = "America/New_York"): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(wallClock.trim());
  if (!m) throw new Error(`not a plain "YYYY-MM-DDTHH:mm:ss" wall-clock string: ${JSON.stringify(wallClock)}`);
  const [, y, mo, d, hh, mm, ss] = m as unknown as [string, string, string, string, string, string, string];
  const naiveUtcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss));

  let guessMs = naiveUtcMs;
  for (let i = 0; i < 2; i++) {
    const offset = tzOffsetMinutes(new Date(guessMs), timeZone);
    guessMs = naiveUtcMs - offset * 60_000;
  }
  return new Date(guessMs).toISOString();
}
