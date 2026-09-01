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
  `NewObservation` from `@penny/db` (`seriesId`, `periodType`, `periodStart`,
  `periodEnd`, `fiscalYear`, `value` as a decimal string, `publicationTime`
  as an ISO string). Regenerated from `raw/` by
  `pnpm --filter @penny/ingest run build-fixtures`
  (`packages/ingest/src/build-observation-fixtures.ts`) — re-run that after
  changing any parser in `packages/ingest/src/jobs/*` or refreshing
  `raw/`, never hand-edit these files. `packages/db`'s `pnpm seed` picks up
  every file here automatically via `seedObservationFixtures()`.

  `mts-totals.json` / `mts-receipts-categories.json` /
  `mts-outlays-categories.json` now carry the FULL MTS history (2026-09-01
  backfill): every month from 2015-03 through the latest published report,
  both `month` and `fiscal_ytd` readings — sourced from the full-range raw
  captures below, not the small per-month snapshots. January and February
  2015 are absent everywhere in these three files, deliberately: FiscalData
  has no MTS report at all for those two record_dates (its earliest report
  for any of the three tables is 2015-03-31), so there is no category
  breakdown to reconcile against a total for those months — excluded rather
  than shipped as a total with nothing to check it against. See
  `packages/ingest/src/jobs/mts-backfill.ts`'s module doc comment and
  `packages/ingest/test/reconciliation.test.ts`'s "full-history backfill"
  describe blocks for the full reconciliation story, including the one
  genuine tolerance (not exact-equality) check: FYTD readings vs. the sum of
  that fiscal year's own-report months, which differs by small,
  real Treasury between-report revisions (worst observed: ~$5.09B against a
  ~$1.83T FY2024 deficit reading) — documented and bounded by an explicit
  tolerance there, per CLAUDE.md's reconciliation-report rule, rather than
  asserted as an exact identity it isn't.

  **Previously-documented `pnpm seed` bug (now fixed, this note corrected
  2026-09-01):** this README used to describe a `TypeError:
  value.toISOString is not a function` crash in `seedObservationFixtures()`.
  That fix (`publicationTime: new Date(row.publicationTime)`) is already
  live in `packages/db/src/seed.ts`. A DIFFERENT crash surfaced once the MTS
  backfill above produced `mts-outlays-categories.json`'s 5,206 rows: PGlite's
  wire-protocol layer throws a raw `RangeError: Invalid array length` once a
  single `INSERT`'s bound-parameter count crosses roughly 32,767 (reproduced
  live: a 7-column, 5,206-row insert — 36,442 params — fails; the same shape
  at 4,000 rows/28,000 params succeeds). Also fixed in `seed.ts`:
  `seedObservationFixtures()` now inserts each file in batches of 1,000 rows
  rather than one `INSERT` per file. Both fixes are in `packages/db`, outside
  the ingest backfill's own ownership, but made directly because they
  blocked `pnpm seed` from loading this directory's data — flagged here for
  whoever owns `packages/db` to review.

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
