/**
 * Drizzle schema (PLAN.md §4). Neon-compatible SQL only — this file is run
 * against both PGlite (dev/test/seed) and Neon Postgres via the db factory
 * in ./client.ts behind one interface.
 *
 * Correctness rules this schema exists to enforce (CLAUDE.md hard rules):
 *  - A number reaches the app only via `series` (joined through
 *    @penny/registry's generated SERIES map for the rest of its metadata) —
 *    never a bare literal.
 *  - Revisions are new `observation` rows (`revision_of`), never in-place
 *    updates. `publication_time` and `ingested_at` stay distinct from the
 *    period the value describes.
 *  - `value` is `numeric` (arbitrary precision, returned as a string by the
 *    driver) — never `real`/`double precision`. Do not cast it through a JS
 *    `number` on the way to or from Postgres.
 *  - `fiscal_year` is stored explicitly, never derived ad hoc from a date in
 *    a query (Oct 1–Sep 30 fiscal year). It is nullable because it is
 *    meaningless for some series (e.g. a price index) — a null here is a
 *    deliberate "not applicable," not a missing value.
 */
import { relations } from "drizzle-orm";
import {
  pgEnum,
  pgTable,
  integer,
  text,
  numeric,
  date,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ---------- enums (mirror @penny/registry's generated unions) ----------

/** Unit of a series' value, as published. Kept in sync by hand with @penny/registry's `Unit` type — see test/schema-registry-parity.test.ts. */
export const unitEnum = pgEnum("unit", ["usd", "index_point", "persons", "households"]);

/** Scale of a series' value, exactly as published. Never converted at ingest. */
export const magnitudeEnum = pgEnum("magnitude", ["ones", "thousands", "millions", "billions"]);

/** Accounting semantics. Series differing here are never summed/compared without a declared bridge. */
export const accountingConceptEnum = pgEnum("accounting_concept", [
  "receipt",
  "outlay",
  "deficit",
  "debt",
  "balance",
  "interest",
  "price_index",
  "projection",
  "population",
  "households",
  "cash_deposit",
  "cash_withdrawal",
]);

export const cadenceEnum = pgEnum("cadence", ["daily", "monthly", "annual"]);

/**
 * The granularity/kind of one observation's period, independent of the
 * series' cadence: an MTS series is cadence=monthly but publishes both a
 * `month` reading and a cumulative `fiscal_ytd` reading each time — those
 * are two observation rows with the same series_id and period_end,
 * distinguished by period_type.
 */
export const periodTypeEnum = pgEnum("period_type", ["day", "month", "fiscal_ytd", "year"]);

export const ingestOutcomeEnum = pgEnum("ingest_outcome", ["success", "partial", "failure"]);

// ---------- series ----------

/**
 * Denormalized mirror of @penny/registry's generated SERIES map, upserted by
 * `pnpm seed` / the ingest jobs from the YAML-derived source of truth. Kept
 * in the DB (rather than requiring every query site to import the registry
 * package) so `observation.series_id` has real referential integrity and so
 * SQL-level queries can filter on accounting_concept/cadence directly.
 *
 * The registry YAML remains authoritative for semantics — never hand-edit a
 * row here independent of its YAML file.
 */
export const series = pgTable("series", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  definition: text("definition").notNull(),
  agency: text("agency").notNull(),
  dataset: text("dataset").notNull(),
  datasetUrl: text("dataset_url").notNull(),
  citation: text("citation").notNull(),
  unit: unitEnum("unit").notNull(),
  magnitude: magnitudeEnum("magnitude").notNull(),
  accountingConcept: accountingConceptEnum("accounting_concept").notNull(),
  cadence: cadenceEnum("cadence").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- observation ----------

export const observation = pgTable(
  "observation",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    seriesId: text("series_id")
      .notNull()
      .references(() => series.id),

    periodType: periodTypeEnum("period_type").notNull(),
    /** Period start date. For period_type='day' equal to periodEnd. For 'fiscal_ytd' the fiscal year's Oct 1 start. */
    periodStart: date("period_start").notNull(),
    /** The anchor/as-of date identifying which reading this is: the calendar day, the month's last day, the FYTD-through date, or the fiscal year's Sep 30. This + periodType + seriesId is the period identity. */
    periodEnd: date("period_end").notNull(),
    /**
     * Explicit fiscal year (e.g. 2026 for FY2026 = Oct 1 2025–Sep 30 2026),
     * stamped by the ingest job — never derived ad hoc from periodEnd in a
     * query. Null when the series has no fiscal-year semantics (e.g. a
     * price index): that null is deliberate, not a gap.
     */
    fiscalYear: integer("fiscal_year"),

    /** Arbitrary-precision decimal string — drizzle's `numeric` column is always string-typed (never a JS `number`), which is exactly the point: this value must never round-trip through float arithmetic. Unit/magnitude live on `series`, not here — never convert here. */
    value: numeric("value", { precision: 20, scale: 4 }).notNull(),

    /** When the source published this value — distinct from the period it describes and from ingestedAt. */
    publicationTime: timestamp("publication_time", { withTimezone: true }).notNull(),

    /**
     * Self-reference: when a source republishes a changed value for the
     * same period, ingest inserts a NEW row pointing revisionOf at the
     * prior row's id. The prior row is never updated or deleted. Query the
     * latest reading per period via `revisionOf IS NULL` XOR "not referenced
     * by any other row's revisionOf" — see @penny/db's query helpers once
     * ingest lands.
     */
    revisionOf: integer("revision_of"),

    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Idempotency: re-ingesting the exact same (series, period, publication)
    // is a no-op via ON CONFLICT DO NOTHING against this key. A genuinely
    // revised value carries a new publicationTime, so it inserts as a new
    // row instead of colliding here — see the module doc above.
    uniqueIndex("observation_identity").on(t.seriesId, t.periodType, t.periodEnd, t.publicationTime),
    index("observation_series_period_idx").on(t.seriesId, t.periodType, t.periodEnd),
    index("observation_revision_of_idx").on(t.revisionOf),
  ],
);

export const observationRelations = relations(observation, ({ one }) => ({
  series: one(series, { fields: [observation.seriesId], references: [series.id] }),
  revisionOfObservation: one(observation, {
    fields: [observation.revisionOf],
    references: [observation.id],
  }),
}));

export const seriesRelations = relations(series, ({ many }) => ({
  observations: many(observation),
}));

// ---------- ingest_run ----------

export const ingestRun = pgTable("ingest_run", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  /** Job name, e.g. "mts-monthly", "debt-to-penny-daily", "bls-cpi-monthly". Free text, not FK'd to a single series — one run can touch many. */
  job: text("job").notNull(),
  sourceUrl: text("source_url").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  rowCount: integer("row_count"),
  outcome: ingestOutcomeEnum("outcome"),
  errorMessage: text("error_message"),
});

export type Series = typeof series.$inferSelect;
export type NewSeries = typeof series.$inferInsert;
export type Observation = typeof observation.$inferSelect;
export type NewObservation = typeof observation.$inferInsert;
export type IngestRun = typeof ingestRun.$inferSelect;
export type NewIngestRun = typeof ingestRun.$inferInsert;
