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
 *  - History that arrives AFTER later data (a backfill run once the live
 *    cron has already stored a newer report, a fixture seeded late) is kept
 *    as history: it never displaces the current reading and never counts
 *    as a revision of it.
 *
 * "Current" for a (series, periodType, periodEnd) means the row with the
 * LATEST publicationTime (ties broken by highest id) — the same definition
 * apps/web/lib/series-data.ts uses to pick what readers see. It is
 * deliberately NOT "highest id": ids only follow publication order when
 * rows arrive in publication order, and the 2026-09-01 production backfill
 * proved they don't have to. With highest-id semantics that backfill left
 * an older report's figure as the "current" row for 141 periods, so the
 * next live run treated the newer report's figure as a revision, tried to
 * insert a row that already existed, and the monthly cron died on the
 * identity index for six days straight.
 *
 * This can NOT be delegated to `observation`'s DB-level unique index alone
 * (`series_id, period_type, period_end, publication_time`). MTS is
 * re-published every month and each release re-states many already-known
 * months verbatim with a NEW `record_date` (and therefore, under this
 * package's best-available publication_time proxy — see mts-monthly.ts's
 * doc comment — a new `publication_time`). Keying idempotency on that tuple
 * would insert a spurious duplicate row every month for every unchanged
 * historical figure. Instead this module compares against the current
 * VALUE for the period (decimal-exact, via lib/decimal.ts — never a float
 * compare) and only inserts when it actually changed.
 */
import { and, desc, eq } from "drizzle-orm";
import { observation, type PennyDb, type Observation } from "@penny/db";
import { decimalEquals } from "./decimal";
import type { PeriodType, RawObservation } from "./types";

export type UpsertOutcome = "inserted" | "revised" | "unchanged" | "backfilled";

export interface UpsertResult {
  outcome: UpsertOutcome;
  /**
   * The row this observation now corresponds to: the new row for
   * "inserted"/"revised"/"backfilled", the already-present row for
   * "unchanged". For "backfilled" and for an "unchanged" replay of an older
   * publication this is a history row, not the period's current reading.
   */
  id: number;
}

/**
 * The period's current reading: the row with the latest publicationTime
 * (highest id on a tie). Undefined when the period has never been ingested.
 */
async function currentObservation(
  db: PennyDb,
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
    .orderBy(desc(observation.publicationTime), desc(observation.id))
    .limit(1);
  return rows[0];
}

/** The row already on file for this exact identity (series, period, publicationTime), if any. */
async function observationAt(
  db: PennyDb,
  seriesId: string,
  periodType: PeriodType,
  periodEnd: string,
  publicationTime: Date,
): Promise<Observation | undefined> {
  const rows = await db
    .select()
    .from(observation)
    .where(
      and(
        eq(observation.seriesId, seriesId),
        eq(observation.periodType, periodType),
        eq(observation.periodEnd, periodEnd),
        eq(observation.publicationTime, publicationTime),
      ),
    )
    .limit(1);
  return rows[0];
}

function samePublicationDifferentValue(raw: RawObservation, onFile: Observation): Error {
  return new Error(
    `observation ${raw.seriesId} ${raw.periodType} ${raw.periodEnd} published ${raw.publicationTime} is already on file (id ${onFile.id}) with value ${onFile.value}, but the source now reports ${raw.value} under the SAME publication time. One publication cannot carry two values — either the source republished a corrected file under its old date (then the job's publicationTime proxy needs to distinguish the two) or a fixture disagrees with the live feed. Refusing to guess.`,
  );
}

/**
 * Idempotently apply one parsed observation. Safe to call repeatedly with
 * the same input (outcome "unchanged" after the first call), safe to call
 * with a later, changed value for the same period (outcome "revised",
 * chained via revisionOf — the earlier row is left exactly as it was), and
 * safe to call with an OLDER publication than what is already current
 * (outcome "backfilled": stored as history, current reading untouched).
 */
export async function upsertObservation(db: PennyDb, raw: RawObservation): Promise<UpsertResult> {
  const publicationTime = new Date(raw.publicationTime);
  const current = await currentObservation(db, raw.seriesId, raw.periodType, raw.periodEnd);

  const insert = async (revisionOf: number | null): Promise<number> => {
    const [row] = await db
      .insert(observation)
      .values({
        seriesId: raw.seriesId,
        periodType: raw.periodType,
        periodStart: raw.periodStart,
        periodEnd: raw.periodEnd,
        fiscalYear: raw.fiscalYear,
        value: raw.value,
        publicationTime,
        ...(revisionOf === null ? {} : { revisionOf }),
      })
      .returning();
    if (!row) throw new Error("insert returned no row");
    return row.id;
  };

  if (!current) {
    return { outcome: "inserted", id: await insert(null) };
  }

  const incomingTime = publicationTime.getTime();
  const currentTime = current.publicationTime.getTime();

  if (incomingTime === currentTime) {
    // The same report, re-run.
    if (decimalEquals(current.value, raw.value)) return { outcome: "unchanged", id: current.id };
    throw samePublicationDifferentValue(raw, current);
  }

  if (incomingTime > currentTime) {
    // A newer report: a restatement of the same figure is a no-op, a
    // changed figure is a revision chained to what it revises.
    if (decimalEquals(current.value, raw.value)) return { outcome: "unchanged", id: current.id };
    return { outcome: "revised", id: await insert(current.id) };
  }

  // An older report than the current reading — history arriving late.
  const onFile = await observationAt(db, raw.seriesId, raw.periodType, raw.periodEnd, publicationTime);
  if (onFile) {
    if (decimalEquals(onFile.value, raw.value)) return { outcome: "unchanged", id: onFile.id };
    throw samePublicationDifferentValue(raw, onFile);
  }
  return { outcome: "backfilled", id: await insert(null) };
}

export interface UpsertManySummary {
  inserted: number;
  revised: number;
  unchanged: number;
  backfilled: number;
  results: UpsertResult[];
}

/** Apply a batch of parsed observations sequentially (not Promise.all — keeps writes ordered and easy to reason about for a batch this small; ingest jobs run per-source, not at request volume). */
export async function upsertObservations(db: PennyDb, raws: readonly RawObservation[]): Promise<UpsertManySummary> {
  const results: UpsertResult[] = [];
  for (const raw of raws) {
    results.push(await upsertObservation(db, raw));
  }
  return {
    inserted: results.filter((r) => r.outcome === "inserted").length,
    revised: results.filter((r) => r.outcome === "revised").length,
    unchanged: results.filter((r) => r.outcome === "unchanged").length,
    backfilled: results.filter((r) => r.outcome === "backfilled").length,
    results,
  };
}
