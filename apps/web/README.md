# `@penny/web`

The Penny site: Next.js App Router, server components reading directly from
`@penny/db` (PGlite locally, Neon via `DATABASE_URL` in prod). See the repo
root `README.md` and `PLAN.md` for the overall architecture; this file is
about this package specifically.

## Routes

- `/` — front door: framing + the living Sankey (latest month / fiscal
  year to date, toggle) + links out.
- `/now` — debt, TGA balance, fiscal-YTD deficit, interest-expense run-rate
  tiles, each dated and sourced.
- `/data` — the registry rendered as a citation index, with a live
  "latest ingested" column per series.
- `/report/where-the-money-goes` — Chapter 1, rendered from
  `content/chapter-1.mdx` (owned by the narrative agent — see below).

## The core primitive: `RegistryFigure`

`components/registry-figure.tsx` is the only way a number reaches a page.
Its `id` prop is typed as `@penny/registry`'s generated `SeriesId` union, so
passing anything that isn't a real registry series is a TypeScript compile
error everywhere it's used directly in `.tsx`. It fetches its own reading
(an async Server Component), formats it per the series' published
unit/magnitude (`lib/format.ts` — exact decimal-string arithmetic, no float
until the one documented presentation-boundary conversion in
`lib/fiscal-flow-input.ts`/the Sankey), and always shows a source + as-of
caption. No reading yet -> an explicit "No report yet" gap, never a zero.

## Chapter content: what `apps/web/content/*.mdx` may contain

This package doesn't own `content/` (the narrative agent does) but does own
the pipeline that renders it (`lib/chapter/parse.ts`, `components/
chapter-body.tsx`) — a dependency-free tag-tree parser, not a real MDX
compiler (see `parse.ts`'s header comment for why). Supported today, matching
what `content/chapter-1.mdx` actually uses:

- YAML-ish frontmatter (`---\nkey: value\n---`, including a folded `>` block
  scalar) — `title` and `standfirst` are read by the page.
- A `{ /* ... */ }`-style block comment, stripped entirely (never rendered).
- Headings (`##`, `###`), paragraphs, `**bold**`, `*italic*`,
  `[text](url)` links, `> ` blockquotes, `---` section breaks.
- `<Step id="..." stage="...">…</Step>` — a scroll section (deep-linkable by
  `id`). Can nest an `<Aside id="..." title="...">…</Aside>`.
- `<Num seriesId="..." period="..." />` — the only way a number reaches the
  chapter. `seriesId` must be a real `@penny/registry` id or it renders a
  visible error, never a silent number. `period` maps to `observation.
  period_type`.
- `<Term id="...">…</Term>` — a defined-term marker; its tooltip is the
  registry's own `definition` when `id` is a series id, else a generic
  fallback.
- `<Ref id="..." />` — a citation marker.
- `<SankeyStage focus="..." />` — currently a no-op; see "Known gaps" below.

**Known, documented gaps** (not silently assumed away):
- `<SankeyStage>`'s scroll-synced diagram emphasis isn't implemented —
  `@penny/viz`'s `FiscalSankey` has no per-node focus/emphasis prop yet. The
  living Sankey renders once, statically, near the top of the chapter page
  instead of a pinned graphic that changes state per step.
- `<Term>` doesn't yet read `content/definitions.yaml`'s fuller "plain"
  explanations (a YAML file — no parser dependency was available to add
  without running `pnpm install`, which this agent could not do itself).
- `<Ref>` doesn't yet resolve/number against `content/SOURCES.md`'s real
  reference list — it renders the citation id itself as a marker.
- `<Num>`'s `at`, `fiscalYear`, `format`, `of`, and `sign` attributes parse
  but aren't applied yet; only `seriesId` + `period` drive the figure.

## Testing

`pnpm test` (`vitest run`, single-run only per the 8GB-RAM rule) covers pure
formatting/parsing logic with no DB, plus integration tests against a real
in-memory PGlite (seeded per test file in `beforeAll` — see `test/series-
data.test.ts`'s header comment on why state is shared within one file but
not across files). `@penny/viz`'s own `FiscalSankey` rendering is exercised
by that package's test suite, not duplicated here — this package's tests
stop at "does apps/web correctly assemble the props and decide gap-vs-render."

## Local dev

`pnpm seed` (run from the repo root) migrates and seeds the registry catalog
plus any `db/fixtures/observations/*.json` into a local PGlite database.
**As of this build, `pnpm seed` crashes partway through loading real
observation fixtures** — see the WEB agent handoff report for the exact bug
(in `packages/db/src/seed.ts`, not this package) and the workaround used to
verify this package's own build/tests against realistic data in the interim.
