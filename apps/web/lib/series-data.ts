/**
 * Server-only query layer between apps/web and @penny/db. Every function
 * returns Reading/gap shapes from lib/types.ts — never a bare row, never a
 * silently-coerced number. Queries are deliberately simple (this is a
 * read-mostly public site over a modest row count, not the >100-row
 * aggregation case CLAUDE.md's server-side-aggregation rule targets); the
 * one place that fans out to ~30 series at once (getMtsFlow) still does the
 * fan-out as a single `inArray` query, not N+1.
 */
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { observation, type Observation } from "@penny/db";
import { getSeries, SERIES_IDS, type SeriesId } from "@penny/registry";
import { safely } from "./db";
import type { PeriodType, Reading } from "./types";

function toReading(row: Observation): Reading {
  return {
    seriesId: row.seriesId as SeriesId,
    periodType: row.periodType,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    fiscalYear: row.fiscalYear,
    value: row.value,
    publicationTime: row.publicationTime.toISOString(),
    revisionOf: row.revisionOf,
  };
}

/** Among rows for the same (series, period), the latest publicationTime is
 * the current revision — earlier publicationTimes for that exact period are
 * superseded readings, never shown (CLAUDE.md: revisions are new rows, and
 * the site always shows the latest known value for a period, not a stale
 * one). This reduces a raw row list down to one Reading per (seriesId,
 * periodType, periodEnd). */
function latestPerPeriod(rows: Observation[]): Reading[] {
  const byKey = new Map<string, Observation>();
  for (const row of rows) {
    const key = `${row.seriesId}|${row.periodType}|${row.periodEnd}`;
    const existing = byKey.get(key);
    if (!existing || existing.publicationTime.getTime() < row.publicationTime.getTime()) {
      byKey.set(key, row);
    }
  }
  return [...byKey.values()].map(toReading);
}

/**
 * The most recent reading of one series, optionally restricted to one
 * period_type (required for a series like the MTS ones that publish both a
 * `month` and a `fiscal_ytd` reading per period — asking for "the latest"
 * without specifying which would silently mix two accounting periods).
 * Returns null — a gap, not a zero — when nothing has been ingested yet.
 */
export async function getLatestReading(id: SeriesId, periodType?: PeriodType): Promise<Reading | null> {
  const rows = await safely(
    (db) =>
      db
        .select()
        .from(observation)
        .where(periodType ? and(eq(observation.seriesId, id), eq(observation.periodType, periodType)) : eq(observation.seriesId, id))
        .orderBy(desc(observation.periodEnd), desc(observation.publicationTime))
        .limit(1),
    [] as Observation[],
  );
  const row = rows[0];
  return row ? toReading(row) : null;
}

/**
 * The most recent `count` readings of one series with DISTINCT period_ends —
 * one reading per period, the latest publication of each (revisions are new
 * rows sharing a period_end, so a plain LIMIT n would happily return the
 * same period twice). Powers the /now tiles' computed takeaways, which need
 * "latest vs the reading before it". Over-fetches (count * 4 rows) to ride
 * past superseded revisions; a period with more revisions than that headroom
 * would truncate the result — fine for a takeaway, which just falls back to
 * rendering nothing (a takeaway is a claim, and no data means no claim).
 */
export async function getLatestDistinctReadings(id: SeriesId, periodType: PeriodType, count = 2): Promise<Reading[]> {
  const rows = await safely(
    (db) =>
      db
        .select()
        .from(observation)
        .where(and(eq(observation.seriesId, id), eq(observation.periodType, periodType)))
        .orderBy(desc(observation.periodEnd), desc(observation.publicationTime))
        .limit(count * 4),
    [] as Observation[],
  );
  const out: Reading[] = [];
  let lastPeriodEnd: string | null = null;
  for (const row of rows) {
    const reading = toReading(row);
    if (reading.periodEnd === lastPeriodEnd) continue;
    out.push(reading);
    lastPeriodEnd = reading.periodEnd;
    if (out.length === count) break;
  }
  return out;
}

/**
 * One Reading per id in `ids`, keyed by series id, for the single shared
 * `(periodType, periodEnd)` — the shape a Sankey/comparison view needs so
 * every figure it draws is from the same reporting period (never mixing,
 * say, August's receipts against July's outlays). A series with no
 * observation at that exact period is simply absent from the returned map —
 * callers render that as a per-node gap.
 */
export async function getReadingsAt(ids: SeriesId[], periodType: PeriodType, periodEnd: string): Promise<Map<SeriesId, Reading>> {
  if (ids.length === 0) return new Map();
  const rows = await safely(
    (db) =>
      db
        .select()
        .from(observation)
        .where(and(inArray(observation.seriesId, ids), eq(observation.periodType, periodType), eq(observation.periodEnd, periodEnd)))
        .orderBy(observation.publicationTime),
    [] as Observation[],
  );
  const readings = latestPerPeriod(rows);
  return new Map(readings.map((r) => [r.seriesId, r]));
}

/** The most recent period_end this series has any reading for, at the given
 * period_type. Used to pick the anchor date for a multi-series view (e.g.
 * "the latest month with an MTS report") before fetching the rest of that
 * period's series. Null means no data at all yet for this (series,
 * period_type) — a real gap, not "today". */
export async function getLatestPeriodEnd(id: SeriesId, periodType: PeriodType): Promise<string | null> {
  const rows = await safely(
    (db) =>
      db
        .select({ periodEnd: observation.periodEnd })
        .from(observation)
        .where(and(eq(observation.seriesId, id), eq(observation.periodType, periodType)))
        .orderBy(desc(observation.periodEnd))
        .limit(1),
    [] as { periodEnd: string }[],
  );
  return rows[0]?.periodEnd ?? null;
}

// ---------- MTS flow (receipts -> outlays -> deficit), month or FYTD ----------

const RECEIPT_CATEGORY_IDS = SERIES_IDS.filter((id) => id.startsWith("fiscal.mts.receipts.category."));
const OUTLAY_CATEGORY_IDS = SERIES_IDS.filter((id) => id.startsWith("fiscal.mts.outlays.category."));

export interface CategoryFlow {
  id: SeriesId;
  label: string;
  reading: Reading | null;
}

export interface MtsFlow {
  periodType: PeriodType;
  /** Null when no MTS report has been ingested yet for this period_type at all — the whole flow is a gap. */
  periodEnd: string | null;
  fiscalYear: number | null;
  receipts: { total: Reading | null; categories: CategoryFlow[] };
  outlays: { total: Reading | null; categories: CategoryFlow[] };
  deficit: Reading | null;
}

/**
 * Shared body behind getMtsFlow/getMtsFlowAt: the complete receipts ->
 * outlays -> deficit picture for one (period_type, period_end) pair. One
 * function, one anchor date, so a receipts bar and an outlays bar on the
 * same view are never silently from different months.
 */
async function buildMtsFlow(periodType: PeriodType, periodEnd: string): Promise<MtsFlow> {
  const allIds: SeriesId[] = [
    "fiscal.mts.receipts.total" as SeriesId,
    "fiscal.mts.outlays.total" as SeriesId,
    "fiscal.mts.deficit.total" as SeriesId,
    ...RECEIPT_CATEGORY_IDS,
    ...OUTLAY_CATEGORY_IDS,
  ];
  const readings = await getReadingsAt(allIds, periodType, periodEnd);

  const toCategoryFlow = (id: SeriesId): CategoryFlow => ({ id, label: getSeries(id)?.label ?? id, reading: readings.get(id) ?? null });
  const receiptsTotal = readings.get("fiscal.mts.receipts.total" as SeriesId) ?? null;

  return {
    periodType,
    periodEnd,
    fiscalYear: receiptsTotal?.fiscalYear ?? null,
    receipts: {
      total: receiptsTotal,
      categories: RECEIPT_CATEGORY_IDS.map(toCategoryFlow),
    },
    outlays: {
      total: readings.get("fiscal.mts.outlays.total" as SeriesId) ?? null,
      categories: OUTLAY_CATEGORY_IDS.map(toCategoryFlow),
    },
    deficit: readings.get("fiscal.mts.deficit.total" as SeriesId) ?? null,
  };
}

function emptyMtsFlow(periodType: PeriodType): MtsFlow {
  return {
    periodType,
    periodEnd: null,
    fiscalYear: null,
    receipts: { total: null, categories: RECEIPT_CATEGORY_IDS.map((id) => ({ id, label: getSeries(id)?.label ?? id, reading: null })) },
    outlays: { total: null, categories: OUTLAY_CATEGORY_IDS.map((id) => ({ id, label: getSeries(id)?.label ?? id, reading: null })) },
    deficit: null,
  };
}

/**
 * The complete receipts -> outlays -> deficit picture for one period_type
 * ("month" = latest calendar month reported; "fiscal_ytd" = cumulative fiscal
 * year to date), anchored to the single latest period_end that has a total
 * receipts figure. This is what both the front-door Sankey (or its
 * fallback) and any narrative embed of "the living flow" read from.
 */
export async function getMtsFlow(periodType: PeriodType): Promise<MtsFlow> {
  const periodEnd = (await getLatestPeriodEnd("fiscal.mts.receipts.total" as SeriesId, periodType)) ?? (await getLatestPeriodEnd("fiscal.mts.outlays.total" as SeriesId, periodType));
  if (!periodEnd) return emptyMtsFlow(periodType);
  return buildMtsFlow(periodType, periodEnd);
}

/**
 * The same receipts -> outlays -> deficit picture, but pinned to a SPECIFIC
 * period_end rather than discovering "the latest" — what the Act I month
 * stepper (beat 1) uses to browse any month that has data, server-driven via
 * a URL search param. Never validates that `periodEnd` is one of "the
 * months that actually have data" — that's the caller's job (see
 * lib/front-door-data.ts, which only ever calls this with a periodEnd drawn
 * from getFullMonthlyHistory's own list); an arbitrary periodEnd with no
 * report simply resolves to the same all-gap shape getMtsFlow would return.
 */
export async function getMtsFlowAt(periodType: PeriodType, periodEnd: string): Promise<MtsFlow> {
  return buildMtsFlow(periodType, periodEnd);
}

// ---------- monthly history (front-door category history panel + deficit chart) ----------

/** Every "month"-period reading for the given ids, collapsed to the latest
 * revision per (series, period) — shared by both history queries below so
 * neither hand-rolls its own revision-collapsing. One batched `inArray`
 * query, not one per id. */
async function queryMonthlyReadings(ids: SeriesId[]): Promise<Reading[]> {
  if (ids.length === 0) return [];
  const rows = await safely(
    (db) =>
      db
        .select()
        .from(observation)
        .where(and(inArray(observation.seriesId, ids), eq(observation.periodType, "month")))
        .orderBy(observation.publicationTime),
    [] as Observation[],
  );
  return latestPerPeriod(rows);
}

export interface CategoryHistoryPoint {
  periodEnd: string;
  value: string;
  fiscalYear: number | null;
}

/**
 * Up to the latest `limit` distinct "month" periods for each of `ids`,
 * oldest first — the fixed handful of comparison points a single MTS
 * release actually publishes per category (fiscal.mts.* CLAUDE.md/
 * ORCHESTRATION_PROMPT.md front-door history panel: "one MTS report
 * publishes only four periods per category"). Never hardcodes which
 * calendar months those are — whatever's actually been ingested for a
 * series is what comes back, so this generalizes automatically as more
 * months are backfilled. A series with fewer than `limit` months ingested
 * simply returns fewer points (a real gap, not padded with anything).
 */
export async function getCategoryMonthlyHistory(ids: SeriesId[], limit = 4): Promise<Map<SeriesId, CategoryHistoryPoint[]>> {
  const readings = await queryMonthlyReadings(ids);
  const bySeries = new Map<SeriesId, Reading[]>();
  for (const r of readings) {
    const list = bySeries.get(r.seriesId);
    if (list) list.push(r);
    else bySeries.set(r.seriesId, [r]);
  }
  const result = new Map<SeriesId, CategoryHistoryPoint[]>();
  for (const [id, list] of bySeries) {
    // periodEnd is a plain YYYY-MM-DD string — lexical order is chronological
    // order for it, so this never round-trips a date through `Date`.
    const descending = [...list].sort((a, b) => (a.periodEnd > b.periodEnd ? -1 : a.periodEnd < b.periodEnd ? 1 : 0));
    const latestAscending = descending.slice(0, limit).reverse();
    result.set(
      id,
      latestAscending.map((r) => ({ periodEnd: r.periodEnd, value: r.value, fiscalYear: r.fiscalYear })),
    );
  }
  return result;
}

/**
 * Every "month" reading of one series, oldest first — the full monthly time
 * series a chart (the front door's 46-month deficit history) needs, as
 * opposed to getCategoryMonthlyHistory's fixed-N comparison panel.
 */
export async function getFullMonthlyHistory(id: SeriesId): Promise<Reading[]> {
  const readings = await queryMonthlyReadings([id]);
  return readings.sort((a, b) => (a.periodEnd < b.periodEnd ? -1 : a.periodEnd > b.periodEnd ? 1 : 0));
}

/**
 * Every ingested "month" period for each of `ids`, unbounded, oldest first —
 * the full backfill history a v2 line chart (beat 1, "HISTORY PANELS v2")
 * needs, as opposed to getCategoryMonthlyHistory's fixed-4-period comparison
 * panel. A thin wrapper (not a new query shape) so the existing 4-point call
 * sites and their tests are completely unaffected.
 */
export async function getFullCategoryMonthlyHistory(ids: SeriesId[]): Promise<Map<SeriesId, CategoryHistoryPoint[]>> {
  return getCategoryMonthlyHistory(ids, Number.MAX_SAFE_INTEGER);
}

// ---------- daily series (TGA, and the DTS deposits/withdrawals a parallel
// registry PR is landing) — beat 3, "When does the money move?" ----------

/**
 * Ascending distinct "YYYY-MM" calendar-month prefixes for every `day`-type
 * reading of one series. `id` is a plain string (not `SeriesId`) so this
 * compiles and simply returns an empty list for a series id that hasn't
 * been registered yet (the DTS deposits/withdrawals series are landing via
 * a parallel PR against this same branch) — no code change needed here once
 * that PR merges and the id starts resolving to real rows.
 */
export async function getDistinctDayMonths(id: string): Promise<string[]> {
  const rows = await safely(
    (db) =>
      db
        .select({ periodEnd: observation.periodEnd })
        .from(observation)
        .where(and(eq(observation.seriesId, id), eq(observation.periodType, "day")))
        .orderBy(observation.periodEnd),
    [] as { periodEnd: string }[],
  );
  const prefixes = new Set<string>();
  for (const r of rows) prefixes.add(r.periodEnd.slice(0, 7));
  return [...prefixes].sort();
}

/**
 * Every `day`-type reading of one series within [startDate, endDate]
 * inclusive (plain YYYY-MM-DD strings — lexical order is chronological
 * order for this format, matching this file's existing convention), latest
 * revision per period, ascending. `id` is a plain string for the same
 * not-yet-registered-series reason as getDistinctDayMonths above.
 */
export async function getDailyReadingsInRange(id: string, startDate: string, endDate: string): Promise<Reading[]> {
  const rows = await safely(
    (db) =>
      db
        .select()
        .from(observation)
        .where(and(eq(observation.seriesId, id), eq(observation.periodType, "day"), gte(observation.periodEnd, startDate), lte(observation.periodEnd, endDate)))
        .orderBy(observation.publicationTime),
    [] as Observation[],
  );
  return latestPerPeriod(rows).sort((a, b) => (a.periodEnd < b.periodEnd ? -1 : a.periodEnd > b.periodEnd ? 1 : 0));
}

/**
 * Every `day`-type reading of one series, UNBOUNDED (the whole ingested
 * history), latest revision per period, ascending — the daily counterpart to
 * getFullMonthlyHistory above, for a chart that wants "everything backfilled
 * so far" rather than one caller-chosen date window. Used by beat 5's
 * TGA<->reserves chart (lib/money-creation-data.ts), which needs the TGA's
 * complete history and, once it exists, the Fed's reserve-balances series'
 * complete history, side by side. `id` is a plain string (not `SeriesId`) —
 * the same not-yet-registered-series accommodation as
 * getDistinctDayMonths/getDailyReadingsInRange above: a series id with
 * nothing ingested (or not yet registered at all) simply returns `[]`, the
 * same shape as "registered but empty," never a thrown error.
 */
export async function getFullDailyHistory(id: string): Promise<Reading[]> {
  const rows = await safely(
    (db) => db.select().from(observation).where(and(eq(observation.seriesId, id), eq(observation.periodType, "day"))).orderBy(observation.publicationTime),
    [] as Observation[],
  );
  return latestPerPeriod(rows).sort((a, b) => (a.periodEnd < b.periodEnd ? -1 : a.periodEnd > b.periodEnd ? 1 : 0));
}
