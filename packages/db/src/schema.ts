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

// ---------- auction (Phase 2 — TreasuryDirect) ----------

/**
 * A row's lifecycle: TreasuryDirect's `/securities/upcoming` publishes an
 * announced auction with its terms and (once announced) offering size but no
 * results; `/securities/auctioned` (or `/securities/search`) later publishes
 * the same (cusip, auction_date) with results filled in. This is a status
 * TRANSITION on the SAME row (upsert, via lib/upsert-auctions.ts in
 * @penny/ingest) — deliberately NOT the `observation` table's
 * insert-new-revision-row model. An auction is one real-world event known
 * incompletely and then completely, not a republished/restated value; there
 * is nothing to preserve a "prior version" of.
 */
export const auctionStatusEnum = pgEnum("auction_status", ["announced", "resulted"]);

/**
 * TreasuryDirect's OWN fine-grained discriminator — the API's `type` field,
 * deliberately NOT its coarser `securityType` field. Verified live
 * 2026-09-01 against 2.7 years of real auction results
 * (2023-12-20..2026-08-27, 1,176 rows): `securityType` takes only
 * Bill/Note/Bond and would silently collapse a 10-Year TIPS into the same
 * bucket as a 10-Year nominal Note, and a 2-Year FRN into the same bucket as
 * a 2-Year nominal Note — a real, present-in-the-data collision, not a
 * hypothetical. `type` instead takes exactly these six values and keeps
 * every one of those apart. `CMB` = Cash Management Bill, an
 * irregular/opportunistic short bill (a 2-Day CMB appears in the same live
 * sample) — real, must not be dropped, but rarely meaningful to compare
 * against a "family" history the way a regular bill/note/bond is.
 */
export const auctionSecurityTypeEnum = pgEnum("auction_security_type", ["Bill", "Note", "Bond", "TIPS", "FRN", "CMB"]);

/**
 * One row per auction event, keyed (cusip, auction_date) — see the unique
 * index below, which is both the referential identity TreasuryDirect itself
 * uses and this table's idempotency key (upsert target).
 *
 * `original_security_term` groups a reopening into its issuing family
 * ("family" = the same security re-auctioned) EXCEPT for Bills, where it
 * silently mixes genuinely different tenors: verified live 2026-09-01, a
 * "17-Week" original-term family contains 4-Week, 8-Week, AND 17-Week
 * securityTerm rows in roughly equal numbers (140/140/140 across the same
 * 2.7-year sample) — three different points on the bill curve, not the same
 * instrument aging. The correct "this security's own trailing auctions"
 * comparison key is therefore security-type-dependent:
 *   - Bill (and CMB): group by `security_term` (the actual current tenor).
 *   - Note/Bond/TIPS/FRN: group by `original_security_term` (the issuing
 *     family) — this IS the same security across reopenings for these types.
 * See `auctionFamilyKey()` / `getAuctionFamilyHistory()` in
 * `./queries/auctions.ts`, which encode this rule rather than leaving every
 * caller to rediscover it.
 *
 * Nullable numerics: a row starts as `status: "announced"` with every result
 * column null (genuinely unknown yet, never a placeholder zero), then an
 * upsert from the resulted endpoint fills them in. Even once resulted, only
 * ONE of high_yield / high_discount_rate / high_discount_margin is ever
 * populated on a given row — which one depends on security_type (Bills:
 * high_discount_rate; Notes/Bonds/TIPS: high_yield; FRNs:
 * high_discount_margin) — never derived from another; store exactly what
 * TreasuryDirect published for that row and leave the other two null.
 */
export const auction = pgTable(
  "auction",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),

    cusip: text("cusip").notNull(),
    securityType: auctionSecurityTypeEnum("security_type").notNull(),
    /** Current tenor exactly as published, e.g. "4-Week", "9-Year 11-Month". */
    securityTerm: text("security_term").notNull(),
    /** The issuing family's original tenor, e.g. "17-Week", "10-Year" — see the table doc comment on why this alone is not a safe Bill grouping key. */
    originalSecurityTerm: text("original_security_term").notNull(),

    auctionDate: date("auction_date").notNull(),
    issueDate: date("issue_date").notNull(),
    /** Populated even before the real announcement (TreasuryDirect projects it from the standing calendar) — verified live on /securities/upcoming rows still showing offering_amount TBA. Never null. */
    announcementDate: date("announcement_date").notNull(),

    /** Null until announced (TBA). */
    offeringAmount: numeric("offering_amount", { precision: 20, scale: 2 }),
    /** Null until resulted. */
    totalAccepted: numeric("total_accepted", { precision: 20, scale: 2 }),
    bidToCover: numeric("bid_to_cover", { precision: 12, scale: 6 }),
    highYield: numeric("high_yield", { precision: 12, scale: 6 }),
    highDiscountRate: numeric("high_discount_rate", { precision: 12, scale: 6 }),
    highDiscountMargin: numeric("high_discount_margin", { precision: 12, scale: 6 }),
    primaryDealerAccepted: numeric("primary_dealer_accepted", { precision: 20, scale: 2 }),
    directBidderAccepted: numeric("direct_bidder_accepted", { precision: 20, scale: 2 }),
    indirectBidderAccepted: numeric("indirect_bidder_accepted", { precision: 20, scale: 2 }),
    noncompetitiveAccepted: numeric("noncompetitive_accepted", { precision: 20, scale: 2 }),
    /** The Fed's SOMA add-on, accepted on top of the announced offering — genuinely 0 on many auctions (not a gap; verified live), null only pre-results. */
    somaAccepted: numeric("soma_accepted", { precision: 20, scale: 2 }),

    status: auctionStatusEnum("status").notNull(),
    /** The exact TA_WS request URL this row's CURRENT data came from — updated on every substantive change, per lib/upsert-auctions.ts. */
    sourceUrl: text("source_url").notNull(),
    /**
     * When TreasuryDirect published the data THIS ROW CURRENTLY HOLDS —
     * derived from the API's own `updatedTimestamp` field (a wall-clock
     * time with no explicit UTC offset), converted from America/New_York
     * local time via lib/time.ts's DST-aware helper. NOT bumped by a
     * re-ingest that changes nothing (see lib/upsert-auctions.ts) — this is
     * "as of when the data changed," not "as of when we last checked."
     */
    publicationTime: timestamp("publication_time", { withTimezone: true }).notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Idempotency + referential identity: TreasuryDirect itself identifies
    // one auction event by (cusip, auction_date). The announced->resulted
    // transition upserts THIS row (see lib/upsert-auctions.ts) rather than
    // ever inserting a second row for the same event.
    uniqueIndex("auction_identity").on(t.cusip, t.auctionDate),
    // Family-history query (the site's core "compare against this
    // security's own trailing auctions" chart) — see the table doc comment
    // for why callers must pick security_term vs original_security_term by
    // security_type rather than always using one or the other.
    index("auction_family_term_idx").on(t.securityType, t.originalSecurityTerm, t.auctionDate),
    index("auction_family_security_term_idx").on(t.securityType, t.securityTerm, t.auctionDate),
    // "Coming up" / "last month of auctions" queries, both ordered by date within a status.
    index("auction_status_date_idx").on(t.status, t.auctionDate),
  ],
);

export type Auction = typeof auction.$inferSelect;
export type NewAuction = typeof auction.$inferInsert;
export type AuctionStatus = (typeof auctionStatusEnum.enumValues)[number];
export type AuctionSecurityType = (typeof auctionSecurityTypeEnum.enumValues)[number];
