/**
 * Pure transform behind beat 5's "The plumbing, breathing — in real data"
 * chart: turning a plain list of Readings (already the latest revision per
 * period, per lib/series-data.ts) into the exact shape
 * @penny/viz's DualCadenceHistoryChart wants — one point per reading, each
 * carrying its own exact ("as published") and rounded display strings.
 * Kept separate from lib/money-creation-data.ts's DB orchestration, matching
 * lib/cadence-transform.ts's own split, so this is unit-testable against a
 * hand-built Reading[] fixture, no database involved.
 */
import type { SeriesDef } from "@penny/registry";
import type { DualCadenceSeriesPoint } from "@penny/viz";
import type { Reading } from "./types";
import { formatDateShort, formatSeriesUsd, formatUsdScale } from "./format";

export interface MoneyCreationLineData {
  readonly points: readonly DualCadenceSeriesPoint[];
  readonly label: string;
  readonly cadenceLabel: string;
}

/**
 * Maps a series' readings onto the chart's point shape. `def` is `undefined`
 * exactly when the series isn't registered yet (lib/money-creation-data.ts's
 * not-yet-registered-series accommodation for `monetary.fed.reserve_balances`,
 * matching lib/cadence-data.ts's own pattern for the DTS series) — that
 * returns zero points, the same graceful gap DualCadenceHistoryChart already
 * renders for an empty line, never a crash from formatting against a
 * magnitude/unit that doesn't exist. Every value is scaled through `def`'s
 * OWN registered magnitude (CLAUDE.md: values keep their published unit and
 * precision; convert only at the presentation boundary) — never a hardcoded
 * "millions" assumption, even though both of this chart's series happen to
 * publish at that magnitude today.
 */
/**
 * Clips the reserves series' full history down to whatever window the TGA
 * series actually covers — never the other way around. `monetary.fed.
 * reserve_balances` carries FRED's full WRBWFRBL backfill (2015 to present);
 * `fiscal.tga.closing_balance` currently carries only the daily ingest's own
 * (much shorter) window. Plotting both unclipped would put ~11 years of
 * weekly reserves points on the same shared x-axis as a few months of daily
 * TGA points — real, but visually useless: the TGA line would compress to
 * an invisible sliver at the axis's right edge, defeating the whole point
 * of "watch them move opposite each other." TGA — the daily, most-current
 * line — sets the visible window; reserves is clipped to start no earlier
 * than TGA's own earliest reading (its upper end is left alone, since
 * reserves' own latest Wednesday can legitimately land after TGA's most
 * recent ingested day). When TGA has no readings at all yet, reserves is
 * returned unclipped — a real, if less ideal, chart beats an empty one.
 */
export function clipReservesToTgaWindow(tgaReadings: readonly Reading[], reservesReadings: readonly Reading[]): readonly Reading[] {
  const earliestTga = tgaReadings[0]?.periodEnd; // tgaReadings is ascending, per lib/series-data.ts's getFullDailyHistory contract.
  if (!earliestTga) return reservesReadings;
  return reservesReadings.filter((r) => r.periodEnd >= earliestTga);
}

export function buildMoneyCreationLine(readings: readonly Reading[], def: SeriesDef | undefined, label: string, cadenceLabel: string): MoneyCreationLineData {
  if (!def) return { points: [], label, cadenceLabel };
  const points: DualCadenceSeriesPoint[] = readings.map((r) => {
    const { display, exact } = formatSeriesUsd(r.value, def.magnitude);
    return {
      date: r.periodEnd,
      valueWhole: exact,
      display,
      // A fixed trillions scale, 2 decimals — both this chart's series are
      // large-money stocks that span into the trillions (see
      // packages/viz/src/layout/dualCadenceHistoryLayout.ts's own doc
      // comment on why this chart departs from apps/web's usual
      // fixed-billions axis convention); still a FIXED scale per series,
      // never auto-switching between T/B per point.
      scaledDisplay: formatUsdScale(exact, "T", 2),
      label: formatDateShort(r.periodEnd),
    };
  });
  return { points, label, cadenceLabel };
}
