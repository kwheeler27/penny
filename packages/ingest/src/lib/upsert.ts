/**
 * The one place ingest jobs write to `observation`. Implements the
 * idempotency/revision contract from ORCHESTRATION_PROMPT.md Core flow 1-2
 * and CLAUDE.md's hard rules:
 *
 *  - Re-running a job on identical source data is a no-op: no new row, no
 *    touched row.
 *  - A changed published value for an already-known period inserts a NEW
 *    row with `revisionOf` set to the prior row's id — the prior row is
 *    never updated or deleted.
 *
 * This can NOT be delegated to `observation`'s DB-level unique index alone
 * (`series_id, period_type, period_end, publication_time`). MTS is
 * re-published every month and each release re-states many already-known
 * months verbatim with a NEW `record_date` (and therefore, under this
 * package's best-available publication_time proxy — see mts-summary.ts's
 * doc comment — a new `publication_time`). Keying idempotency on that tuple
 * would insert a spurious duplicate row every month for every unchanged
 * historical figure. Instead this module compares against the latest known
 * VALUE for the period (decimal-exact, via lib/decimal.ts — never a float
 * compare) and only inserts when it actually changed.
 */
import { and, desc, eq } from "drizzle-orm";
import { observation, type BuckDb, type Observation } from "@buck/db";
import { decimalEquals } from "./decimal";
import type { PeriodType, RawObservation } from "./types";

export type UpsertOutcome = "inserted" | "revised" | "unchanged";

export interface UpsertResult {
  outcome: UpsertOutcome;
  /** The id of the row now current for this (series, period) — the new row for "inserted"/"revised", the existing row for "unchanged". */
  id: number;
}

/**
 * The most recent row known for a (series, periodType, periodEnd) triple —
 * "most recent" meaning highest id, which is always the current end of that
 * period's revision chain since every revision insert happens strictly
 * after the row it revises. Returns undefined when the period has never
 * been ingested.
 */
async function latestObservation(
  db: BuckDb,
  seriesId: string,
  periodType: PeriodType,
  periodEnd: string,
): Promise<Observation | undefined> {
  const rows = await db
    .select()
    .from(observation)
    .where(
      and(eq(observation.seriesId, seriesId), eq(observation.periodType, periodType), eq(observation.periodEnd, periodEnd)),
    )
    .orderBy(desc(observation.id))
    .limit(1);
  return rows[0];
}

/**
 * Idempotently apply one parsed observation. Safe to call repeatedly with
 * the same input (outcome "unchanged" after the first call) and safe to
 * call with a later, changed value for the same period (outcome "revised",
 * chained via revisionOf — the earlier row is left exactly as it was).
 */
export async function upsertObservation(db: BuckDb, raw: RawObservation): Promise<UpsertResult> {
  const existing = await latestObservation(db, raw.seriesId, raw.periodType, raw.periodEnd);

  if (!existing) {
    const [row] = await db
      .insert(observation)
      .values({
        seriesId: raw.seriesId,
        periodType: raw.periodType,
        periodStart: raw.periodStart,
        periodEnd: raw.periodEnd,
        fiscalYear: raw.fiscalYear,
        value: raw.value,
        publicationTime: new Date(raw.publicationTime),
      })
      .returning();
    if (!row) throw new Error("insert returned no row");
    return { outcome: "inserted", id: row.id };
  }

  if (decimalEquals(existing.value, raw.value)) {
    return { outcome: "unchanged", id: existing.id };
  }

  const [row] = await db
    .insert(observation)
    .values({
      seriesId: raw.seriesId,
      periodType: raw.periodType,
      periodStart: raw.periodStart,
      periodEnd: raw.periodEnd,
      fiscalYear: raw.fiscalYear,
      value: raw.value,
      publicationTime: new Date(raw.publicationTime),
      revisionOf: existing.id,
    })
    .returning();
  if (!row) throw new Error("revision insert returned no row");
  return { outcome: "revised", id: row.id };
}

export interface UpsertManySummary {
  inserted: number;
  revised: number;
  unchanged: number;
  results: UpsertResult[];
}

/** Apply a batch of parsed observations sequentially (not Promise.all — keeps writes ordered and easy to reason about for a batch this small; ingest jobs run per-source, not at request volume). */
export async function upsertObservations(db: BuckDb, raws: readonly RawObservation[]): Promise<UpsertManySummary> {
  const results: UpsertResult[] = [];
  for (const raw of raws) {
    results.push(await upsertObservation(db, raw));
  }
  return {
    inserted: results.filter((r) => r.outcome === "inserted").length,
    revised: results.filter((r) => r.outcome === "revised").length,
    unchanged: results.filter((r) => r.outcome === "unchanged").length,
    results,
  };
}
