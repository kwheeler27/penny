/**
 * Beat 5's "The plumbing, breathing — in real data" chart data orchestration
 * — the one place that calls the DB for the TGA<->bank-reserves chart,
 * mirroring lib/cadence-data.ts's own split between DB access (this file)
 * and pure transforms (lib/money-creation-transform.ts).
 *
 * `fiscal.tga.closing_balance` is an existing, always-registered series
 * (live today). `monetary.fed.reserve_balances` (FRED series WRBWFRBL,
 * H.4.1's "Wednesday Level" — not WRESBAL's week average, see
 * packages/ingest/src/fred/wrbwfrbl.ts's header comment — weekly
 * Wednesdays) is landing via a parallel PR against this same branch
 * — referenced here by plain string id (never a `SeriesId` cast, which the
 * generated union doesn't contain until that PR merges), so this file
 * compiles today AND resolves to real data the moment the registry PR
 * lands, with zero code change on this side of that merge. Until then,
 * `getSeries()` returns undefined for it and this chart renders the TGA
 * line alone — the same graceful gap lib/cadence-data.ts already
 * established for the DTS deposits/withdrawals series.
 */
import { getSeries } from "@penny/registry";
import type { SeriesId } from "@penny/registry";
import { buildMoneyCreationLine, clipReservesToTgaWindow, type MoneyCreationLineData } from "./money-creation-transform";
import { getFullDailyHistory } from "./series-data";
import { todayIso } from "./format";

const TGA_ID = "fiscal.tga.closing_balance" as SeriesId;
const RESERVES_ID = "monetary.fed.reserve_balances";

export interface MoneyCreationCitation {
  readonly agency: string;
  readonly dataset: string;
  readonly citation: string;
  readonly datasetUrl: string;
}

export interface MoneyCreationChartData {
  readonly tga: MoneyCreationLineData;
  readonly reserves: MoneyCreationLineData;
  readonly tgaCitation: MoneyCreationCitation;
  /** Null exactly when `monetary.fed.reserve_balances` isn't registered yet — a real gap, never a fabricated citation for a series this build doesn't know about. */
  readonly reservesCitation: MoneyCreationCitation | null;
}

function citationFor(def: { agency: string; dataset: string; citation: string; datasetUrl: string } | undefined): MoneyCreationCitation | null {
  if (!def) return null;
  return { agency: def.agency, dataset: def.dataset, citation: def.citation.replaceAll("{access_date}", todayIso()), datasetUrl: def.datasetUrl };
}

export async function getMoneyCreationChartData(): Promise<MoneyCreationChartData> {
  const tgaDef = getSeries(TGA_ID)!; // fiscal.tga.closing_balance is an existing, always-registered series.
  const reservesDef = getSeries(RESERVES_ID);

  const [tgaReadings, reservesReadingsFull] = await Promise.all([getFullDailyHistory(TGA_ID), reservesDef ? getFullDailyHistory(RESERVES_ID) : Promise.resolve([])]);
  // Reserves (weekly since 2015 via FRED's full WRBWFRBL backfill) is clipped
  // to whatever window the daily TGA series actually covers — see
  // clipReservesToTgaWindow's own doc comment for why this has to run
  // before either line is built, not left to the chart component.
  const reservesReadings = clipReservesToTgaWindow(tgaReadings, reservesReadingsFull);

  return {
    tga: buildMoneyCreationLine(tgaReadings, tgaDef, "Treasury General Account", "most business days (Daily Treasury Statement)"),
    reserves: buildMoneyCreationLine(reservesReadings, reservesDef, "Bank reserves", "weekly, Wednesdays (Fed H.4.1 via FRED)"),
    tgaCitation: citationFor(tgaDef)!,
    reservesCitation: citationFor(reservesDef),
  };
}
