/**
 * "When does the money move?" (beat 3) data orchestration — the one place
 * that calls the DB for the daily cadence chart and the TGA-through-the-
 * month chart, mirroring lib/front-door-data.ts's split between DB access
 * (this file) and pure transforms (lib/cadence-transform.ts).
 *
 * The two DTS series this section needs — deposits and withdrawals,
 * excluding debt rollovers — are landing via a parallel PR against this
 * same branch (this agent's own handoff notes them as
 * `fiscal.dts.deposits_operating_excl_debt` /
 * `fiscal.dts.withdrawals_operating_excl_debt`). Referencing them by plain
 * string id (never a `SeriesId` cast, which the generated union doesn't
 * contain until that PR merges) means this file compiles today AND resolves
 * to real data the moment the registry PR lands — zero code change either
 * side of that merge. Until then, `getSeries()` returns undefined for both
 * and this section renders as the same graceful gap a reader sees for any
 * other not-yet-ingested series.
 */
import { getSeries } from "@penny/registry";
import type { SeriesId } from "@penny/registry";
import {
  buildDailyCadenceData,
  buildTgaMonthData,
  isMonthWeekdayComplete,
  pickLatestCompleteMonthPrefix,
  type DailyCadenceData,
  type TgaMonthData,
} from "./cadence-transform";
import { everyDayInMonth, parseMonthPrefix } from "./calendar";
import { formatMonthYear, todayIso } from "./format";
import { getDailyReadingsInRange, getDistinctDayMonths } from "./series-data";

const DEPOSITS_ID = "fiscal.dts.deposits_operating_excl_debt";
const WITHDRAWALS_ID = "fiscal.dts.withdrawals_operating_excl_debt";
const TGA_ID = "fiscal.tga.closing_balance" as SeriesId;

export interface CadenceCitation {
  readonly agency: string;
  readonly dataset: string;
  readonly citation: string;
  readonly datasetUrl: string;
}

export interface CadenceData {
  /** "July 2026" — the complete calendar month being shown, or null when no complete month of DTS data exists yet (either the series isn't registered yet, or fewer than 2 distinct months have been ingested). */
  readonly monthLabel: string | null;
  readonly cadence: DailyCadenceData | null;
  readonly tga: TgaMonthData | null;
  readonly depositsCitation: CadenceCitation | null;
  readonly withdrawalsCitation: CadenceCitation | null;
  readonly tgaCitation: CadenceCitation;
}

function citationFor(def: { agency: string; dataset: string; citation: string; datasetUrl: string } | undefined): CadenceCitation | null {
  if (!def) return null;
  return { agency: def.agency, dataset: def.dataset, citation: def.citation.replaceAll("{access_date}", todayIso()), datasetUrl: def.datasetUrl };
}

const GAP: CadenceData = { monthLabel: null, cadence: null, tga: null, depositsCitation: null, withdrawalsCitation: null, tgaCitation: { agency: "", dataset: "", citation: "", datasetUrl: "" } };

export async function getCadenceData(): Promise<CadenceData> {
  const depositsDef = getSeries(DEPOSITS_ID);
  const withdrawalsDef = getSeries(WITHDRAWALS_ID);
  const tgaDef = getSeries(TGA_ID)!; // fiscal.tga.closing_balance is an existing, always-registered series.
  const tgaCitation = citationFor(tgaDef)!;

  // The DTS series haven't been registered yet — render exactly the same
  // gap a reader would see once they exist but simply have no observations.
  if (!depositsDef || !withdrawalsDef) {
    return { ...GAP, tgaCitation };
  }

  const [depositMonths, withdrawalMonths] = await Promise.all([getDistinctDayMonths(DEPOSITS_ID), getDistinctDayMonths(WITHDRAWALS_ID)]);
  // Only a month BOTH series actually cover counts — the mirrored chart needs both sides present.
  const withdrawalMonthSet = new Set(withdrawalMonths);
  const bothMonths = depositMonths.filter((m) => withdrawalMonthSet.has(m));
  const completeMonthPrefix = pickLatestCompleteMonthPrefix(bothMonths);
  if (!completeMonthPrefix) {
    return { ...GAP, tgaCitation, depositsCitation: citationFor(depositsDef), withdrawalsCitation: citationFor(withdrawalsDef) };
  }

  const { year, month } = parseMonthPrefix(completeMonthPrefix);
  const allDays = everyDayInMonth(year, month);
  const startDate = allDays[0]!;
  const endDate = allDays[allDays.length - 1]!;

  const [depositReadings, withdrawalReadings, tgaReadings] = await Promise.all([
    getDailyReadingsInRange(DEPOSITS_ID, startDate, endDate),
    getDailyReadingsInRange(WITHDRAWALS_ID, startDate, endDate),
    getDailyReadingsInRange(TGA_ID, startDate, endDate),
  ]);

  // pickLatestCompleteMonthPrefix above only proves publication continued
  // PAST this month — never that ingestion actually covered every business
  // day INSIDE it (an outage mid-month would slip through that check). This
  // is the day-level guard: every weekday in the month must actually have
  // both a deposit and a withdrawal reading, or the caption's "gaps are
  // weekends and federal holidays" promise would be false for a reader
  // looking at a mislabeled outage gap. A month that fails this is treated
  // exactly like "no complete month yet" — a real, disclosed gap, never a
  // mislabeled one.
  const presentDates = new Set(
    depositReadings.map((r) => r.periodEnd).filter((date) => withdrawalReadings.some((w) => w.periodEnd === date)),
  );
  if (!isMonthWeekdayComplete(allDays, presentDates)) {
    return { ...GAP, tgaCitation, depositsCitation: citationFor(depositsDef), withdrawalsCitation: citationFor(withdrawalsDef) };
  }

  const cadence = buildDailyCadenceData(allDays, depositReadings, withdrawalReadings, depositsDef, withdrawalsDef);
  const tga = buildTgaMonthData(allDays, tgaReadings, tgaDef);

  return {
    monthLabel: formatMonthYear(endDate),
    cadence,
    tga,
    depositsCitation: citationFor(depositsDef),
    withdrawalsCitation: citationFor(withdrawalsDef),
    tgaCitation,
  };
}
