# `db/fixtures`

Real API response snapshots, used both as test fixtures and as what `pnpm
seed` loads for local dev/UI work (ORCHESTRATION_PROMPT.md: "UI work runs
against seeded fixtures, never live APIs"). Populated by the ingest
workstream 2026-08-29 — see `packages/ingest/README.md` for how each file
was produced and what it covers.

## Layout

- `raw/<source>/<dataset>/<record_date-or-range>.json` — actual captured
  API responses, real (not trimmed/edited) except where noted in a
  sibling `SOURCE.md`. Validated by `packages/ingest/test/*.test.ts` against
  the Zod schemas in `packages/ingest/src/fiscaldata/*.ts`,
  `src/bls/*.ts`, and `src/cbo/*.ts`, and used as the reconciliation
  fixtures (MTS category-sums-to-total, FYTD identity, known-value spot
  checks). `raw/cbo/baseline_deficit/` holds a hand-extracted CSV instead of
  a captured JSON response — CBO has no API (PLAN.md §6) — with its
  `SOURCE.md` documenting the exact workbook, sheet, row, and retrieval
  method (cbo.gov's own site blocks scripted requests; see that file).
- `observations/*.json` — pre-transformed rows ready to insert into the
  `observation` table, one JSON array per file, each element shaped like
  `NewObservation` from `@buck/db` (`seriesId`, `periodType`, `periodStart`,
  `periodEnd`, `fiscalYear`, `value` as a decimal string, `publicationTime`
  as an ISO string). Regenerated from `raw/` by
  `pnpm --filter @buck/ingest run build-fixtures`
  (`packages/ingest/src/build-observation-fixtures.ts`) — re-run that after
  changing any parser in `packages/ingest/src/jobs/*` or refreshing
  `raw/`, never hand-edit these files. `packages/db`'s `pnpm seed` picks up
  every file here automatically via `seedObservationFixtures()`.

  **Known bug blocking `pnpm seed` with this data, flagged for whoever owns
  `packages/db` (out of this package's ownership, so not fixed here):**
  `packages/db/src/seed.ts`'s `seedObservationFixtures()` passes each row's
  `publicationTime` straight through as the JSON string this directory
  documents, but Drizzle's `timestamp` column mapper calls
  `.toISOString()` on the value at insert time — which a plain string
  doesn't have — so `pnpm seed` throws
  `TypeError: value.toISOString is not a function` the moment an
  `observations/*.json` file is non-empty (its own test suite only ever
  exercised the empty-directory case, so this never surfaced before real
  data existed here). One-line fix: map
  `publicationTime: new Date(row.publicationTime)` for each row before
  `.values(rows)` in `seedObservationFixtures()`. This package's own
  `runMigrations`/`upsertObservation` path is unaffected — the bug is
  specific to `seed.ts`'s generic JSON loader.

## Rules

- Snapshots are real responses (or a trimmed subset of one), not
  hand-invented data — PLAN.md's "primary sources only" rule extends to
  what stands in for a primary source in tests. The one documented
  exception is `test/reconciliation.test.ts`'s revision-creation test,
  which mutates a copy of a real value in-memory (never in a committed
  fixture) specifically to exercise the revision code path.
- No secrets: FiscalData and BLS are keyless/free-key GET endpoints, so a
  captured response never contains credentials. Still worth a glance before
  committing anything scraped from a request that carried a key in a header.
