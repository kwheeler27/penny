# `@buck/ingest`

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
- `src/build-observation-fixtures.ts` — regenerates
  `db/fixtures/observations/*.json` from `db/fixtures/raw/*` (run after
  touching a parser or refreshing a raw fixture).

## Commands

```sh
pnpm --filter @buck/ingest run typecheck
pnpm --filter @buck/ingest run test              # vitest run — schemas, decimal math, parsers, reconciliation, idempotency
pnpm --filter @buck/ingest run build-fixtures     # regenerate db/fixtures/observations/*.json
pnpm --filter @buck/ingest run ingest:mts         # live: MTS receipts/outlays/deficit
pnpm --filter @buck/ingest run ingest:debt        # live: Debt to the Penny
pnpm --filter @buck/ingest run ingest:tga         # live: TGA closing balance
pnpm --filter @buck/ingest run ingest:interest    # live: interest expense
pnpm --filter @buck/ingest run ingest:cpi         # live: BLS CPI-U
pnpm --filter @buck/ingest run ingest:cbo         # batch: CBO baseline deficit (from the committed CSV, not live)
```

Every `ingest:*` live command needs `DATABASE_URL` set (Neon) — with it
unset they write to the local file-backed PGlite at `.pglite/buck`, same as
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
