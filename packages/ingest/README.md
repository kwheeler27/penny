# `@penny/ingest`

TypeScript ingest jobs for every Phase 1 data source (PLAN.md §3), run by
scheduled GitHub Actions (`.github/workflows/ingest-*.yml`) or by hand via
`tsx`. See ORCHESTRATION_PROMPT.md Core flows 1-3 for the acceptance
criteria this package is built against, and the ingest handoff report (in
the PR description) for a full account of what was found and fixed.

## Layout

- `src/fiscaldata/*.ts`, `src/bls/*.ts`, `src/cbo/*.ts` — Zod response
  schemas, one per source dataset. Every FiscalData amount field accepts
  either a decimal string or the literal `"null"` sentinel FiscalData
  itself returns for an inapplicable field (`envelope.ts`) — route it
  through `parseFiscalDataAmount` before use, never treat it as zero.
- `src/lib/decimal.ts` — exact decimal-string arithmetic (compare, sum,
  subtract) via scaled `BigInt`. No file in this package calls
  `Number()`/`parseFloat()` on a source amount, per the "no float
  arithmetic on dollar values" hard rule.
- `src/lib/period.ts` — fiscal-year (Oct 1–Sep 30, named for its ending
  year) and calendar-date helpers, built from integer arithmetic, never a
  `Date` round-trip.
- `src/lib/upsert.ts` — the idempotency/revision contract: re-ingesting
  identical source data is a no-op; a changed value inserts a new row via
  `revisionOf`, comparing against the latest known VALUE per period rather
  than relying on the `observation` table's unique index alone (see that
  file's doc comment for why — MTS republishes past months verbatim every
  release, with a new "as of" date each time).
- `src/jobs/*.ts` — one file per source: a pure parser (`parseXxx`, no I/O,
  fully covered by fixture-driven tests) plus a live wrapper
  (`runXxxJob`) a cron or `tsx src/jobs/xxx.ts` actually invokes.
- `src/fred/wrbwfrbl.ts` — FRED series WRBWFRBL, the "Wednesday Level"
  reserve-balance series (H.4.1, registry id
  `monetary.fed.reserve_balances`) — deliberately NOT WRESBAL, H.4.1's
  other reserve-balance series, which is a week AVERAGE, not a
  point-in-time balance (see this file's own header comment): Zod schemas
  for both the keyless CSV export (fixture path) and the real JSON API
  (production path), plus the one shared `parseWrbwfrblObservations`
  transform both feed.
- `src/lib/fred-client.ts` — thin fetch wrapper for the real FRED API
  (`api.stlouisfed.org`), always keyed. Never logs the request URL (it
  carries `api_key`).
- `src/treasurydirect/auction.ts` — TreasuryDirect's shared 120-field record
  schema (one Zod schema covers `/auctioned`, `/upcoming`, and `/search`
  identically — verified live) and the pure `RawAuction` mapper.
- `src/lib/treasurydirect-client.ts` — TreasuryDirect fetch client (keyless).
- `src/lib/upsert-auctions.ts` — the `auction` table's idempotency contract:
  UPDATE the existing (cusip, auction_date) row, never insert a second one —
  deliberately NOT `lib/upsert.ts`'s insert-a-revision-row model, because an
  auction is one event known incompletely then completely, not a republished
  value. See that file's doc comment.
- `src/lib/time.ts` — America/New_York wall-clock -> UTC conversion (DST-
  aware, via `Intl.DateTimeFormat`), for TreasuryDirect's offset-less
  `updatedTimestamp`.
- `src/build-observation-fixtures.ts` — regenerates
  `db/fixtures/observations/*.json` from `db/fixtures/raw/*` (run after
  touching a parser or refreshing a raw fixture).

## Commands

```sh
pnpm --filter @penny/ingest run typecheck
pnpm --filter @penny/ingest run test              # vitest run — schemas, decimal math, parsers, reconciliation, idempotency
pnpm --filter @penny/ingest run build-fixtures     # regenerate db/fixtures/observations/*.json
pnpm --filter @penny/ingest run backfill:mts       # live: FULL MTS history, chunked + resumable (see below)
pnpm --filter @penny/ingest run ingest:mts         # live: MTS receipts/outlays/deficit (latest month only)
pnpm --filter @penny/ingest run ingest:debt        # live: Debt to the Penny
pnpm --filter @penny/ingest run ingest:tga         # live: TGA closing balance
pnpm --filter @penny/ingest run ingest:interest    # live: interest expense
pnpm --filter @penny/ingest run ingest:cpi         # live: BLS CPI-U
pnpm --filter @penny/ingest run ingest:cbo         # batch: CBO baseline deficit (from the committed CSV, not live)
pnpm --filter @penny/ingest run ingest:cbo-outlays   # batch: CBO baseline outlays (from the committed CSV, not live)
pnpm --filter @penny/ingest run ingest:cbo-revenues  # batch: CBO baseline revenues (from the committed CSV, not live)
pnpm --filter @penny/ingest run ingest:auctions-resulted  # live: recent resulted TreasuryDirect auctions (last 14 days)
pnpm --filter @penny/ingest run ingest:auctions-upcoming  # live: the published auction calendar
pnpm --filter @penny/ingest run backfill:auctions         # live: FULL auction history, chunked + resumable (see below)
pnpm --filter @penny/ingest run ingest:reserves    # live: reserve balances at the Fed (H.4.1/WRBWFRBL), needs FRED_API_KEY
```

Every `ingest:*` live command needs `DATABASE_URL` set (Neon) — with it
unset they write to the local file-backed PGlite at `.pglite/penny`, same as
`pnpm seed`.

## Live-verified corrections vs. the original registry/schema assumptions

Three real, load-bearing mismatches were found by fetching live API
responses (2026-08-29) and are documented at the point of use — flagged
here because they affect data most people would assume is "obviously
right":

1. **Outlays-by-function is Table 9, not Table 5.** FiscalData's
   `mts_table_5` is actually "Outlays of the U.S. Government by Agency," an
   agency-based classification with no budget-function dimension.
   `mts_table_9` ("Summary of Receipts and Outlays ... by Fund Group and by
   Function and Subfunction") is where the 20 OMB budget-function
   categories the registry expects actually live. See
   `src/fiscaldata/mts-outlays.ts`.
2. **TGA closing balance's account_type and field are both different than
   assumed.** The row is labeled `"Treasury General Account (TGA) Closing
   Balance"`, not `"Federal Reserve Account"`; and its `close_today_bal`
   field is the `"null"` sentinel on every row of this dataset — the actual
   value is in `open_today_bal`. See
   `src/fiscaldata/operating-cash-balance.ts`.
3. **MTS Table 1's deficit/surplus field has the opposite sign convention
   from the registry's documented one.** Treasury's
   `current_month_dfct_sur_amt` is `outlays − receipts` (positive =
   deficit); the registry's own definition for
   `fiscal.mts.deficit.total` promises readers the opposite (`receipts −
   outlays`, negative = deficit). The ingest job negates it (exact decimal
   negation) so the stored value matches what the registry tells readers
   to expect, and then verifies the identity holds via
   `reconcileDeficitIdentity`. See `src/jobs/mts-monthly.ts`.

## MTS full-history backfill (`src/jobs/mts-backfill.ts`)

Penny Atlas beat 1 (the front door's ‹ › month stepper + per-category
history lines) needs every published MTS month, not just the latest.
`pnpm --filter @penny/ingest run backfill:mts` fetches Table 1/4/9 for the
full available history and upserts it through the SAME idempotent,
revision-aware path (`lib/upsert.ts`) `ingest:mts` uses for the latest
month — this is a wider sweep of the identical pipeline, chunked
(`chunkMonths`, default 24) and checkpointed
(`.backfill-state/mts-backfill-progress.json`, gitignored) so a killed run
resumes rather than restarting; simply re-running the whole thing from
scratch is also always safe (`upsertObservations`' own idempotency).

Three load-bearing findings from actually running this against live data
(2026-09-01), each documented at the point of use and re-verified by
`test/reconciliation.test.ts`'s "full-history backfill" describe blocks:

1. **FiscalData's earliest MTS report, for all three tables, is
   record_date=2015-03-31 — there is no report at all for January or
   February 2015.** Table 1 alone can reach those two months' TOTALS via
   the March 2015 report's own multi-year recap, but Table 4/9 never carry
   a month other than a report's own, so there is no category breakdown for
   either month, ever. Both months are excluded from the backfilled
   fixtures entirely (never a total with nothing to reconcile it against) —
   the same "never guess a mapping, exclude and document" rule CLAUDE.md
   states for a renamed category label, generalized to a genuine
   source-coverage gap.
2. **A month's total figure must come from THAT month's own report, never
   a later restatement, or category-sum-to-total reconciliation silently
   breaks.** Verified live: 99 of 154 distinct historical months carry a
   value that differs across two or more of the ~24 subsequent reports that
   re-state it (small outlay/deficit corrections — receipts drifts too,
   just by less). Table 4/9's category breakdown is NEVER restated, so it
   only ever matches that SAME report's own current-month total —
   `extractOwnPeriodMtsTotals` (in `mts-monthly.ts`) is that exact
   restriction, generalized from what the live per-report job already did
   via `thisMonthTotals`. With it: zero reconciliation exceptions across
   all 137 real months. Without it (i.e. deduping a multi-report Table 1
   blob and taking whichever value is "latest"): silent, real dollar
   mismatches.
3. **FYTD readings vs. sum-of-that-fiscal-year's-own-months is a tolerance
   check, not an exact identity** — a consequence of finding 2: Treasury's
   own published FYTD aggregate is computed from its latest internal
   ledger, which can already differ from a month's OWN frozen
   first-published figure by the very next report (verified: October
   2015's own report published outlays of $347,578,330,203.66; November
   2015's report, one month later, already shows $347,595,667,058.01 for
   that same October). Worst gap found across the full history: ~$5.09B
   against a ~$1.83T FY2024 deficit reading (0.43%) — bounded by an
   explicit $10B tolerance in the test, per CLAUDE.md's reconciliation-report
   rule, rather than asserted as an exact match it genuinely isn't. FY2015
   is excluded from even that tolerance check (see finding 1: 5 of its 12
   months have no own-report figure at all, so the gap there is structural,
   not a small revision — pinned as its own, much-larger-than-$10B case).

Also fixed in `packages/db/src/seed.ts` (outside this package's ownership,
but blocking `pnpm seed` from loading this backfill's output so fixed
directly and flagged loudly): `seedObservationFixtures()` inserted each
`db/fixtures/observations/*.json` file in one `INSERT`, which throws a raw
`RangeError: Invalid array length` from PGlite once a single query's
bound-parameter count crosses ~32,767 — `mts-outlays-categories.json`'s
5,206 rows (36,442 params at 7 columns/row) is the first fixture ever large
enough to hit it. Now batched at 1,000 rows/insert.

Also: the registry's `magnitude: "millions"` on every `fiscal.mts.*` series
(all 3 totals + all 27 categories) and on `fiscal.debt.interest_expense_total`
does not match live data — FiscalData returns actual whole-dollar amounts
(with cents) for all of these, not millions (e.g. July 2026 total receipts
is `334009875555.79` — $334 billion; at the declared "millions" magnitude
that would read as $334 *quadrillion*). `fiscal.tga.closing_balance` was
checked too and its "millions" declaration is correct (its raw value,
`950804`, is exactly the right order of magnitude for hundreds of billions
of dollars). `packages/registry` is outside this package's ownership, so
it isn't corrected here; every observation this package writes stores the
value exactly as published (whole dollars for MTS/interest-expense,
millions for TGA), so no data is wrong in the database, but the `series`
table's `magnitude` column will misdescribe the MTS/interest-expense
families until the registry YAML is fixed. **Flagged as the top blocking
finding in the ingest handoff report** — this is exactly the silent-unit-
mixing bug CLAUDE.md's hard rules exist to prevent, and needs a decision
before any UI trusts `series.magnitude` to scale a displayed number.

## Reserve balances at the Fed (`monetary.fed.reserve_balances`, FRED WRBWFRBL)

`src/fred/wrbwfrbl.ts` + `src/jobs/reserves-weekly.ts` + `src/lib/fred-client.ts`.
Same `observation` table / registry-series model as every fiscal.* series
above, via the SAME `lib/upsert.ts` idempotent, revision-aware path — not a
new mechanism.

0. **WRBWFRBL, not WRESBAL — corrected after review (2026-09-02).** H.4.1
   publishes two distinct reserve-balance series. WRESBAL ("...Week
   Average") is the average of the daily levels across the week ending
   that Wednesday — NOT a point-in-time balance, despite what its name
   suggests. WRBWFRBL ("...Wednesday Level," used here) is the genuine
   as-of-Wednesday balance — the same kind of figure as
   `fiscal.tga.closing_balance`'s daily reading, and the one every
   reader-facing claim on the money-creation page actually needs. Verified
   live the two differ by tens of billions of dollars in a volatile week
   (2026-06-17: WRESBAL 3,033,444 vs. WRBWFRBL 2,936,355 — see
   `db/fixtures/raw/fred/wrbwfrbl/SOURCE.md` for the full comparison).
1. **`FRED_API_KEY` doesn't exist yet.** `runReservesWeeklyJob` logs
   `"FRED_API_KEY not set — skipping reserves ingest"` and returns
   `{ skipped: true }` (exit 0) rather than throwing, so
   `.github/workflows/ingest-weekly.yml` is a harmless no-op run until the
   key is provisioned — same pattern CLAUDE.md's "gaps never zeros" spirit
   suggests for a missing credential, not just missing data.
2. **Two fetch paths, one shared transform.** The committed fixture
   (`db/fixtures/raw/fred/wrbwfrbl/`) comes from FRED's KEYLESS CSV export
   (`fredgraph.csv?id=WRBWFRBL`) — fine for a one-time snapshot, but not
   what the live job uses. The live job hits the real, keyed FRED API
   (`api.stlouisfed.org/fred/series/observations`) — the one CLAUDE.md
   means by "the proper FRED API." Both reduce to the same (date, value)
   pairs before `parseWrbwfrblObservations` runs, so the parsing/gap-handling
   logic is tested once and shared, not duplicated per path.
3. **The registry's `cadence` enum needed a new value (`weekly`) that
   didn't exist.** Added to `packages/registry/schema/series.schema.json`
   and `packages/registry/codegen/generate.ts`'s `Series` type (both inside
   this workstream's own ownership). This is NOT a "weekly cadence ⇒
   period_type='day'" leap of its own invention — it mirrors exactly how a
   `daily`-cadence series like `fiscal.tga.closing_balance` already stores
   its own as-of-day balance as `period_type='day'`; `cadence` only says how
   often a new reading appears, never the shape of the reading itself.
4. **`packages/db`'s `cadenceEnum` (Postgres enum + a generated migration,
   `drizzle/0004_unique_tag.sql`: `ALTER TYPE "cadence" ADD VALUE
   'weekly'`) needed the same value, and packages/db is OUTSIDE this
   workstream's ownership** (`packages/registry`, `packages/ingest`,
   `db/fixtures`, `.github/workflows`). Made directly anyway, flagged
   loudly here, because `seedSeriesCatalog()` inserts every registry series
   in one batch — without this, `pnpm seed` (and every ingest test that
   calls `seedSeriesCatalog`, not just this series' own) would fail with a
   Postgres enum-violation the moment the `weekly`-cadence YAML existed.
   Verified: full `packages/db` test suite (34 tests) and full
   `packages/ingest` test suite (175 tests) both green after the change;
   `pnpm seed` end-to-end reconciles exactly (608 rows, 2015-01-07 through
   2026-08-26, `series.cadence = 'weekly'`, values round-trip through
   Postgres `numeric` as exact strings). Same "small, necessary,
   loudly-flagged fix outside declared ownership" pattern the WEB agent
   used for `migrate.ts`'s import-path fix (see that file's doc comment) —
   whoever owns `packages/db` should still review it.
5. **Magnitude verified live, not assumed.** Latest fetched value
   (2026-08-26): `2916824` at declared `magnitude: "millions"` =
   $2.92 trillion — the right order of magnitude for total bank reserves,
   and matches the number this workstream's task brief cited as the
   already-verified current figure.
6. **`fiscalYear: null`** — same call `price.cpi_u.all_items` makes for an
   index: WRBWFRBL is a Federal Reserve balance-sheet figure with no
   Treasury/US-government fiscal-year semantics published by the source,
   so a fiscal year is never derived ad hoc for it.

## TreasuryDirect auctions (Phase 2)

`src/treasurydirect/auction.ts` + `src/jobs/auctions-{resulted,upcoming,backfill}.ts`
+ `src/lib/upsert-auctions.ts` write to the `auction` table (`@penny/db`) —
NOT the `series`/`observation` model: one auction event is many columns, not
one value per period, and an announced auction and its later results are the
SAME row (upserted), never a revision-appended one.

Load-bearing findings from fetching live data (2026-09-01), each documented
at the point of use and covered by `test/treasurydirect-auction.test.ts` /
`test/auction.test.ts` (in `@penny/db`):

1. **`type`, not `securityType`, is the real security-type discriminator.**
   TreasuryDirect's `securityType` field only takes `Bill`/`Note`/`Bond` —
   it silently collapses a 10-Year TIPS into the same bucket as a 10-Year
   nominal Note, and a 2-Year FRN into the same bucket as a 2-Year nominal
   Note. The finer `type` field (`Bill`/`Note`/`Bond`/`TIPS`/`FRN`/`CMB`) is
   what `auction.security_type` stores. `CMB` (Cash Management Bill) is a
   sixth real value not in the original five-value assumption — found only
   because the fixture was fetched over a wide-enough window (2.7 years,
   1,176 rows) to catch an irregular security type; a narrower sample
   (430 days) missed it entirely. See `db/fixtures/raw/treasurydirect/auctioned/SOURCE.md`.
2. **`original_security_term` alone is not a safe "same security" grouping
   key for Bills.** A `"17-Week"` original-term family contains `4-Week`,
   `8-Week`, AND `17-Week` `security_term` rows in roughly equal numbers
   (140/140/140 across the live sample) — three different points on the
   bill curve sharing one CUSIP-reopening lineage, not the same instrument
   aging. Notes/Bonds/TIPS/FRNs don't have this problem (a reopening's
   `security_term` genuinely is the same security, just shorter). See
   `packages/db/src/schema.ts`'s doc comment on `auction.originalSecurityTerm`
   and `packages/db/src/queries/auctions.ts`'s `auctionFamilyKey` — this is
   THE finding most likely to bite a page built against this table without
   reading that function first.
3. **`updatedTimestamp` is America/New_York wall-clock, not UTC.** Same-day
   bill results (11:30am ET competitive close) show values like
   `"...T11:33:19"`; read as UTC that's 7:33am ET — before the close,
   impossible for an already-published result. `src/lib/time.ts` converts
   correctly (DST-aware, via `Intl.DateTimeFormat`, not a hand-rolled
   offset table).
4. **`/securities/auctioned?days=N` caps at 250 rows no matter how large
   `N` is** (tested `days=1000` and `days=20000`: identical 250-row
   responses). Fine for the daily cron; the backfill job
   (`jobs/auctions-backfill.ts`) uses `/securities/search?startDate=...
   &endDate=...` instead, which showed no such cap up to 1,111 rows in
   testing.
5. **`announcement_date`/`issue_date` are populated even before the real
   announcement** — TreasuryDirect projects them from the standing auction
   calendar on `/upcoming` rows that are still TBA (`offering_amount`
   empty). This is why those two columns are `NOT NULL` on `auction` while
   every result column is nullable.

**Backfill checkpoint caution — same shape as `jobs/mts-backfill.ts`'s:**
`.backfill-state/auctions-backfill-progress.json` (gitignored) records which
date range is done, but not WHICH DATABASE it was done against. Point
`backfill:auctions` at a different `DATABASE_URL` without deleting that file
first, and it will skip years as "already done" that the new target has
never actually received — a silent gap, not a loud failure. Delete (or
move) the checkpoint file any time the target database changes. (This same
target-blindness applies to `mts-backfill.ts`'s own checkpoint file, though
it isn't spelled out in that file's doc comment today — worth the same
one-line warning there next time that file is touched.)
