/**
 * FRED series WRBWFRBL — "Reserve Balances with Federal Reserve Banks:
 * Wednesday Level," the H.4.1 weekly bank-reserves balance behind registry
 * id `monetary.fed.reserve_balances`. Two distinct fetches feed the SAME
 * pure transform at the bottom of this file:
 *
 *  - Fixture/dev path: FRED's keyless CSV export
 *    (`https://fred.stlouisfed.org/graph/fredgraph.csv?id=WRBWFRBL`) — no
 *    key, used ONLY to build the committed `db/fixtures/raw/fred/wrbwfrbl`
 *    snapshot (see `build-observation-fixtures.ts`). Never used by the live
 *    job below.
 *  - Production path: the real FRED API (`lib/fred-client.ts`,
 *    `api.stlouisfed.org`), which needs `FRED_API_KEY` — `jobs/
 *    reserves-weekly.ts` skips loudly (exit 0) rather than call this when
 *    the key is unset, since the key doesn't exist yet.
 *
 * Both sources reduce to the same logical (date, value) pairs — CSV columns
 * `observation_date`/`WRBWFRBL`; JSON `observations[].date`/`.value` — so
 * the CSV and JSON paths share one tested `parseWrbwfrblObservations`.
 *
 * WRBWFRBL, not WRESBAL (corrected after review, 2026-09-02): H.4.1
 * publishes two distinct reserve-balance series. WRESBAL ("...Week
 * Average") is the average of the daily levels across the week ending that
 * Wednesday — NOT a point-in-time balance. WRBWFRBL ("...Wednesday Level")
 * is the genuine as-of-Wednesday balance, the same kind of figure as
 * `fiscal.tga.closing_balance`'s daily reading. This file originally read
 * WRESBAL while every reader-facing claim (registry notes, this page's
 * chart tooltip) described each reading as "the balance as of that
 * Wednesday" — verified live to differ from the real Wednesday level by
 * tens of billions of dollars in a volatile week (see
 * `db/fixtures/raw/fred/wrbwfrbl/SOURCE.md` for the exact comparison).
 * WRBWFRBL is the series every one of those claims is actually true of.
 *
 * publicationTime: FRED's JSON API carries a genuine per-observation
 * `realtime_start`/`realtime_end` (the ALFRED vintage window — literally
 * the date range during which a given reading WAS the current published
 * value, which moves forward on a real revision). The keyless CSV export
 * used for the committed fixture carries no such field at all, so deriving
 * publicationTime from realtime_start on the JSON path but not the CSV path
 * would make the two paths disagree about what "published" means for the
 * identical series — worse than being uniformly explicit. Same call BLS's
 * CPI-U ingest already made for an analogous gap (see
 * `jobs/cpi-monthly.ts`'s doc comment): every row's publicationTime is the
 * caller-supplied `asOf` (ingest time), not an invented per-point release
 * date. Revisions still work correctly regardless — `lib/upsert.ts`
 * compares the VALUE for a (series, period) pair, never publicationTime.
 */
import { z } from "zod";
import type { RawObservation } from "../lib/types";

export const WRBWFRBL_SERIES_ID = "WRBWFRBL";

/** FRED's own missing-value sentinel — the literal string ".", in both the keyless CSV export and the JSON API's `value` field. Never a JSON null, never zero. */
export const FRED_MISSING_SENTINEL = ".";

const FRED_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A plain decimal string — the same shape lib/decimal.ts's DECIMAL_RE accepts. FRED's `value` is either this or FRED_MISSING_SENTINEL; never call Number()/parseFloat() on it. */
const FRED_NUMERIC_RE = /^-?\d+(?:\.\d+)?$/;

const fredValueSchema = z.union([z.literal(FRED_MISSING_SENTINEL), z.string().regex(FRED_NUMERIC_RE)]);

/** One (as-of date, published value) pair, already normalized from either the CSV or JSON source shape — the shared unit `parseWrbwfrblObservations` consumes. */
export const fredObservationRowSchema = z.object({
  date: z.string().regex(FRED_DATE_RE),
  value: fredValueSchema,
});
export type FredObservationRow = z.infer<typeof fredObservationRowSchema>;

// ---------------------------------------------------------------------------
// Production JSON API (api.stlouisfed.org/fred/series/observations)
// ---------------------------------------------------------------------------

const fredJsonObservationSchema = z.object({
  realtime_start: z.string().regex(FRED_DATE_RE).optional(),
  realtime_end: z.string().regex(FRED_DATE_RE).optional(),
  date: z.string().regex(FRED_DATE_RE),
  value: fredValueSchema,
});

export const fredObservationsResponseSchema = z
  .object({
    observation_start: z.string().optional(),
    observation_end: z.string().optional(),
    units: z.string().optional(),
    count: z.number().optional(),
    observations: z.array(fredJsonObservationSchema),
  })
  .passthrough();
export type FredObservationsResponse = z.infer<typeof fredObservationsResponseSchema>;

/** Strip the JSON API's realtime_start/realtime_end down to the shared (date, value) shape — see this file's doc comment on why realtime_start is deliberately not used as publicationTime. */
export function rowsFromFredJson(response: FredObservationsResponse): FredObservationRow[] {
  return response.observations.map((o) => ({ date: o.date, value: o.value }));
}

// ---------------------------------------------------------------------------
// Keyless CSV export (fredgraph.csv?id=WRBWFRBL) — fixture path only
// ---------------------------------------------------------------------------

const CSV_HEADER = "observation_date,WRBWFRBL";

/**
 * Parse the keyless CSV export. A real fetched response (unlike CBO's
 * hand-authored CSV — see `cbo/baseline-deficit.ts`), but still exactly two
 * plain columns with no quoting/escaping to worry about, so a small strict
 * parser is more legible and trustworthy here than pulling in a general CSV
 * dependency for two columns.
 */
export function parseWrbwfrblCsv(csv: string): FredObservationRow[] {
  const lines = csv
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
  const [header, ...rows] = lines;
  if (header !== CSV_HEADER) {
    throw new Error(`unexpected WRBWFRBL CSV header: ${JSON.stringify(header)}, expected ${JSON.stringify(CSV_HEADER)}`);
  }
  return rows.map((line, i) => {
    const parts = line.split(",");
    if (parts.length !== 2) {
      throw new Error(`WRBWFRBL CSV row ${i + 2} has ${parts.length} columns, expected 2: ${JSON.stringify(line)}`);
    }
    const [date, value] = parts as [string, string];
    return fredObservationRowSchema.parse({ date, value });
  });
}

// ---------------------------------------------------------------------------
// Shared transform
// ---------------------------------------------------------------------------

/**
 * Pure transform: `FredObservationRow[]` -> `RawObservation[]`, skipping
 * FRED's "." missing-value sentinel as a genuine gap (never coerced to
 * zero — the same rule FiscalData's own "null" sentinel gets in
 * `fiscaldata/envelope.ts`).
 *
 * `periodType: "day"`: WRBWFRBL is a genuine as-of-Wednesday balance (a
 * stock, like `fiscal.tga.closing_balance`'s daily reading), not a period
 * accumulation or an average — periodStart === periodEnd === that
 * Wednesday's date. (WRESBAL, the OTHER H.4.1 reserve-balance series, is a
 * week-average and would NOT make this claim true — see this file's header
 * comment on why WRBWFRBL is the one used here.)
 *
 * `fiscalYear: null`: a Federal Reserve balance-sheet figure with no
 * Treasury/US-government fiscal-year semantics published anywhere in the
 * source — same reasoning `price.cpi_u.all_items` uses for an index (see
 * `jobs/cpi-monthly.ts`).
 */
export function parseWrbwfrblObservations(rows: readonly FredObservationRow[], asOf: string): RawObservation[] {
  const out: RawObservation[] = [];
  for (const row of rows) {
    if (row.value === FRED_MISSING_SENTINEL) continue; // a gap in the source itself — never zero.
    out.push({
      seriesId: "monetary.fed.reserve_balances",
      periodType: "day",
      periodStart: row.date,
      periodEnd: row.date,
      fiscalYear: null,
      value: row.value,
      publicationTime: asOf,
    });
  }
  return out;
}
