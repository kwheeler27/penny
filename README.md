# Penny

**Every last penny.**

Penny is a public instrument that makes the US dollar system legible: where
federal money comes from, where every dollar of spending goes, how the
Treasury's and the Federal Reserve's plumbing actually works, and how all of
it transmits to markets — bonds, stocks, and the rates people pay.

Built entirely on primary sources — Treasury FiscalData, TreasuryDirect, the
Federal Reserve (via FRED), the NY Fed, OFR, BLS, CBO — with every number
traceable to the agency of record. Mechanics are stated as facts with
citations; interpretations are attributed, never asserted in Penny's voice.

**Status: Phase 1 build in progress.** See [`IDEA.md`](IDEA.md) for the
confirmed pitch, [`docs/MISSION.md`](docs/MISSION.md) for the mission, and
[`PLAN.md`](PLAN.md) for the architecture and roadmap.

A sibling of [Basin](https://github.com/kwheeler27/basin), which does the same
job for the Colorado River system.

## Development

Requires Node 22+ and pnpm (`packageManager` in `package.json` pins the
exact version). No credentials are required for local dev — the db factory
falls back to an embedded PGlite Postgres and UI work runs against seeded
fixtures, never live APIs.

```sh
pnpm install     # once
pnpm gen         # generate TS types + citation objects from packages/registry/series/**/*.yaml
pnpm seed        # migrate + load the registry catalog (and any db/fixtures) into local PGlite
pnpm typecheck   # tsc --noEmit, recursively
pnpm test        # vitest run, recursively — never watch mode (8GB dev machine)
```

Layout: `apps/web` (Next.js site), `packages/registry` (the series catalog:
YAML → generated types/citations), `packages/db` (Drizzle schema +
PGlite/Neon factory), `packages/ingest` (source API Zod schemas + jobs),
`packages/viz` (bespoke D3/SVG components), `db/fixtures` (real API
snapshots used as test fixtures and seed data). See `PLAN.md` §4 for the
full architecture and the correctness rules the schema encodes.

Ingest jobs are live for all Phase 1 sources (MTS, Debt to the Penny,
DTS/TGA, interest expense, BLS CPI, CBO baseline), with reconciliation
tests that fail CI if MTS categories don't sum to the published totals
exactly. Every series' `magnitude` is verified against live API samples —
notably, FiscalData's MTS endpoints return whole dollars even where the
printed statement says "$ millions."

## License

Apache-2.0. See [`LICENSE`](LICENSE).
