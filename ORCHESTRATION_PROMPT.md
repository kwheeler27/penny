# Build Prompt — Buck (Phase 1: "The Fiscal Machine")

This document is self-contained: agents reading it have no access to the
planning conversation. Read the reference material before designing anything.

## Mission

Ship the MVP of **Buck** (`kwheeler27/buck`, public repo at
`/Users/kevinwheeler/projects/buck`): a public web instrument showing where US
federal money comes from and where it goes, on live primary data, with every
number cited. Usable means: a reader lands on the site, sees the current
fiscal picture (receipts → outlays → deficit) as a living flow visualization,
reads a plain-language chapter that explains it, and can trace any displayed
number to the agency of record with an as-of date.

## Reference material (read before designing)

- `/Users/kevinwheeler/projects/buck/CLAUDE.md` — **hard rules; violations
  are bugs.** Objectivity/citation rules, unit-magnitude rules, revision
  rules, accounting-concept rules, 8GB-RAM constraints.
- `/Users/kevinwheeler/projects/buck/PLAN.md` — decisions, phases, schema
  outline. Do not relitigate §1 decisions.
- `/Users/kevinwheeler/projects/buck/docs/MISSION.md` — register and values
  for all narrative copy.
- `/Users/kevinwheeler/projects/buck/IDEA.md` — pitch + verified data-source
  table (access modes, gotchas).
- `/Users/kevinwheeler/projects/basin/docs/DESIGN_PRINCIPLES.md` and
  `/Users/kevinwheeler/projects/basin/packages/registry/` — sibling project's
  doctrine and registry-codegen pattern. Borrow the pattern, not the code;
  Buck's registry is simpler (no basins, no rulebooks).

## Stack (fixed — do not substitute)

- TypeScript everywhere. **No Python anywhere in this repo.**
- pnpm workspace monorepo; layout exactly as PLAN.md §4.
- Next.js (App Router, current stable) on Vercel; Neon Postgres + Drizzle;
  Zod at every external API boundary; bespoke D3 + SVG React components for
  visualization (no chart-library lock-in).
- Ingest = TS jobs run by scheduled GitHub Actions. No Dagster, no queues.
- Dev machine has 8GB RAM: `vitest run` only, no watch modes, no long-lived
  dev servers; UI work runs against seeded fixtures (`pnpm seed`), never live
  APIs.

## Data model (minimum)

Per PLAN.md §4: `series` (id, agency, dataset, unit **and magnitude as
published**, accounting_concept, cadence, citation fields), `observation`
(series_id, period with explicit fiscal-year dimension, `numeric` value —
never float — publication_time, revision_of, ingested_at), `ingest_run`
(provenance). Registry YAML is the single source of truth for series
semantics; TS types and citation objects are generated (`pnpm gen`); CI fails
on drift. Excluded from this phase: auctions, Fed balance sheet, yields,
anything equity.

## Core flows & acceptance criteria

1. **MTS ingest (FiscalData, monthly):** fetch Monthly Treasury Statement
   receipts and outlays by category + totals → validate with Zod → upsert as
   observations. *Accepted when:* component categories sum to the published
   totals **to the dollar** for every ingested month (CI-enforced
   reconciliation); re-running the job is a no-op; a changed published value
   creates a revision row, never an update.
2. **Daily ingest (FiscalData):** Debt to the Penny + Daily Treasury
   Statement TGA closing balance. *Accepted when:* latest business day
   present, weekends/holidays render as gaps (not zeros, not carried
   forward), each value carries publication_time distinct from period.
3. **CPI ingest (BLS v2) + CBO baseline (batch CSV in `db/fixtures`):**
   *Accepted when:* CPI monthly series loads with citations; CBO figures load
   flagged `projection` (an accounting-concept-like class that can never be
   summed or charted with observed data without explicit distinction).
4. **The living Sankey (`/` and `/now`):** receipts → outlays → deficit for
   latest month and fiscal-YTD, driven entirely by the database. *Accepted
   when:* rendered totals tie to MTS observations exactly; every node opens a
   definition + citation (agency, dataset, as-of date); layout works at
   mobile and desktop widths; deficit is visually distinct as a *balancing
   flow*, not a spending category.
5. **Chapter 1 narrative (`/report/where-the-money-goes`):** scrollytelling
   page, hand-written copy per MISSION.md register. *Accepted when:* every
   factual sentence carries a citation; every interpretation is attributed to
   a named source; live figures in the prose come from the registry (no
   hardcoded numbers); copy survives the read-aloud test.
6. **Now tiles + Data page:** debt, TGA, fiscal-YTD deficit, interest-expense
   run-rate tiles, each dated + sourced; `/data` renders the registry as a
   citation index. *Accepted when:* no number on any page lacks source +
   as-of date.

## Quality bar

- Real API response snapshots in `db/fixtures` are the test fixtures; unit
  tests assert known values (e.g. a specific month's total outlays), row
  counts, and reconciliation sums.
- Reconciliation checks are tests that fail CI, with zero tolerance for MTS
  component-vs-total mismatch.
- `pnpm seed` loads fixtures so UI development needs no credentials.
- `pnpm test` (vitest run), `pnpm typecheck`, `pnpm gen` all green; CI runs
  all three plus registry-drift check.
- Adversarial review before merge for: unit/magnitude mixing (millions vs
  dollars), fiscal-vs-calendar-year confusion, float contamination of
  `numeric` values, revisions overwriting rows, zeros where gaps belong,
  uncited numbers or unattributed interpretation in copy.

## Deliverables & environment notes

- Repo at `/Users/kevinwheeler/projects/buck`. `.env.example` documents
  `DATABASE_URL`, `FRED_API_KEY`, `BLS_API_KEY`. README updated with setup,
  run, test, limitations.
- `main` is branch-protected: all work on `feat/*` branches → PRs. The
  bootstrap build works on `feat/prototype` and opens the first PR; Kevin
  merges.
- Prototype may run on PGlite locally with a Neon-compatible schema if that
  unblocks work before Neon credentials exist; document the swap.
- **Do NOT build:** auctions/yield/Fed ingest (Phase 2 — but keep `series`
  generic enough to hold them), any equity data (Phase 3, gated), any
  forecasting/what-if model, auth, comments, AI-generated narrative.

## Suggested agent decomposition

1. **Contracts first (blocking):** registry YAML format + codegen, Drizzle
   schema, Zod source-response schemas, shared types. Everything else codes
   against these and must not modify them.
2. **Parallel workstream — ingest:** FiscalData MTS + daily jobs, BLS, CBO
   batch loader, GitHub Actions crons, reconciliation tests. (`data-engineer`)
3. **Parallel workstream — web app:** Next.js shell, /now tiles, /data
   citation index, registry-driven number components. (`fullstack-engineer`)
4. **Parallel workstream — visualization:** the living Sankey + scrollytelling
   scaffolding as isolated components against fixtures. (`ui-engineer`)
5. **Integration pass:** wire, seed, run everything, fix.
6. **Adversarial review pass:** the bug classes in Quality bar, plus
   citation/attribution audit of all copy.
7. **Final E2E** against fixtures; PR from `feat/prototype` with what-was-
   tested notes.
