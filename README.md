# Buck

**The buck stops here.**

Buck is a public instrument that makes the US dollar system legible: where
federal money comes from, where every dollar of spending goes, how the
Treasury's and the Federal Reserve's plumbing actually works, and how all of
it transmits to markets — bonds, stocks, and the rates people pay.

Built entirely on primary sources — Treasury FiscalData, TreasuryDirect, the
Federal Reserve (via FRED), the NY Fed, OFR, BLS, CBO — with every number
traceable to the agency of record. Mechanics are stated as facts with
citations; interpretations are attributed, never asserted in Buck's voice.

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

**Known gaps as of the contracts scaffold:** `packages/ingest` has response
schemas for MTS receipts/outlays, Debt to the Penny, and the Daily Treasury
Statement operating cash balance, plus BLS CPI — no jobs yet, and no schema
yet for interest expense or the CBO baseline CSV. Every series' `magnitude`
(dollars vs. millions vs. billions, as published) is a best-effort reading
of documented source conventions and needs verifying against a live API
sample before any ingest job goes live — see the `notes` field in the
relevant `packages/registry/series/**/*.yaml` files.

## License

Apache-2.0. See [`LICENSE`](LICENSE).
