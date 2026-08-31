/**
 * BLS CPI-U, all items (series CUUR0000SA0) — ORCHESTRATION_PROMPT.md Core
 * flow 3. Uses the v1 keyless endpoint by default (fine for this data's
 * volume — one series, monthly); switches to v2 automatically when
 * `BLS_API_KEY` is set (raises the daily query limit — PLAN.md §5), since
 * both versions return the identical response shape (verified live
 * 2026-08-29).
 *
 * publication_time limitation: unlike MTS's record_date, BLS's timeseries
 * response carries no field at all — per series or per data point — that
 * identifies when a figure was released or whether it's a same-day
 * re-fetch of an already-published value. There is no honest per-point
 * proxy the way record_date is for FiscalData. This job therefore takes
 * `fetchedAt` as an explicit parameter (the live wrapper passes the actual
 * current time) rather than inventing a release-schedule date — inventing
 * one would fabricate precision BLS doesn't publish, which is worse than
 * being explicit that this field tracks ingestion time here. Revisions
 * still work correctly regardless: lib/upsert.ts compares the VALUE for a
 * (year, period) pair, per the registry's own guidance for this series,
 * not publication_time.
 */
import { blsResponseSchema, CPI_U_ALL_ITEMS_SERIES_ID, type BlsSeriesDataPoint } from "../bls/cpi";
import { firstDayOfMonth, lastDayOfMonth } from "../lib/period";
import { upsertObservations, type UpsertManySummary } from "../lib/upsert";
import type { RawObservation } from "../lib/types";
import { getDb, type PennyDb } from "@penny/db";

const MONTH_PERIOD_RE = /^M(0[1-9]|1[0-2])$/;

/** A plain decimal string, same shape lib/decimal.ts's DECIMAL_RE accepts — the only form ever safe to hand to Postgres `numeric` or to compare exactly. */
const NUMERIC_VALUE_RE = /^-?\d+(?:\.\d+)?$/;

/** Parse one BLS data point into an observation, or undefined for a period this ingest doesn't cover (e.g. BLS's M13 annual-average row on some series — see bls/cpi.ts's doc comment) or a period BLS published as unavailable. Never calls Number()/parseFloat() on `value`. */
function parseDataPoint(point: BlsSeriesDataPoint, fetchedAt: string): RawObservation | undefined {
  const m = MONTH_PERIOD_RE.exec(point.period);
  if (!m) return undefined;
  if (!NUMERIC_VALUE_RE.test(point.value)) {
    // BLS publishes the literal string "-" (with an explanatory footnote,
    // e.g. "Data unavailable due to the 2025 lapse in appropriations")
    // rather than omitting the data point. Treat it as the gap it is —
    // never pass a non-numeric sentinel through to a `numeric` column, and
    // never coerce it to 0.
    return undefined;
  }
  const month = Number(m[1]);
  const year = Number(point.year);
  return {
    seriesId: "price.cpi_u.all_items",
    periodType: "month",
    periodStart: firstDayOfMonth(year, month),
    periodEnd: lastDayOfMonth(year, month),
    fiscalYear: null, // an index has no fiscal-year semantics — see the registry's series definition.
    value: point.value,
    publicationTime: fetchedAt,
  };
}

export function parseCpi(response: { Results?: { series: Array<{ seriesID: string; data: BlsSeriesDataPoint[] }> } }, fetchedAt: string): RawObservation[] {
  const series = response.Results?.series.find((s) => s.seriesID === CPI_U_ALL_ITEMS_SERIES_ID);
  if (!series) return [];
  const out: RawObservation[] = [];
  for (const point of series.data) {
    const obs = parseDataPoint(point, fetchedAt);
    if (obs) out.push(obs);
  }
  return out;
}

export interface CpiMonthlyJobResult {
  startYear: string;
  endYear: string;
  summary: UpsertManySummary;
}

async function fetchBlsCpi(startYear: string, endYear: string): Promise<unknown> {
  const apiKey = process.env.BLS_API_KEY;
  const url = apiKey
    ? "https://api.bls.gov/publicAPI/v2/timeseries/data/"
    : "https://api.bls.gov/publicAPI/v1/timeseries/data/";
  const body: Record<string, unknown> = { seriesid: [CPI_U_ALL_ITEMS_SERIES_ID], startyear: startYear, endyear: endYear };
  if (apiKey) body.registrationkey = apiKey;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`BLS request failed: ${res.status} ${res.statusText}`);
  return res.json();
}

/** Live job: pulls the last 2 calendar years every run (well past the ~13-month window BLS ever revises), relying on upsertObservation's value-compare to make already-known months a no-op. */
export async function runCpiMonthlyJob(db: PennyDb): Promise<CpiMonthlyJobResult> {
  const now = new Date();
  const endYear = String(now.getUTCFullYear());
  const startYear = String(now.getUTCFullYear() - 1);
  const json = await fetchBlsCpi(startYear, endYear);
  const parsed = blsResponseSchema.parse(json);
  if (parsed.status !== "REQUEST_SUCCEEDED") {
    throw new Error(`BLS request did not succeed: ${JSON.stringify(parsed.message)}`);
  }
  const fetchedAt = now.toISOString();
  const observations = parseCpi(parsed, fetchedAt);
  const summary = await upsertObservations(db, observations);
  return { startYear, endYear, summary };
}

async function main() {
  const db = getDb();
  const result = await runCpiMonthlyJob(db);
  console.log(
    `CPI-U ingest complete for ${result.startYear}-${result.endYear}: +${result.summary.inserted} ~${result.summary.revised} =${result.summary.unchanged}`,
  );
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
