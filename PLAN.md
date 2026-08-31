# Penny — Plan

**Date:** 2026-08-29
**Goal:** A public, visually rich instrument that makes the US dollar system
legible — fiscal flows first, then Treasury/Fed plumbing, then transmission to
markets — built on primary sources with every number cited. Sibling of Basin;
pitch and landscape research in `IDEA.md`; mission in `docs/MISSION.md`.

---

## 1. Decisions made (with rationale)

| Decision | Choice | Why |
|---|---|---|
| App stack | **Next.js (App Router) + TypeScript on Vercel** | Standing preference; Basin-proven for a public data instrument; ISR fits data that updates daily/monthly, not per-request. |
| Database | **Neon Postgres + Drizzle ORM** | Standing default backend shape; serverless-friendly; free tier sufficient for series data at this scale. |
| Ingest | **All-TypeScript jobs on scheduled GitHub Actions → Neon** (Kevin's call, 2026-08-29, over Basin-style Python/Dagster) | Penny's sources are clean JSON REST APIs — no geospatial, no simulation model. One language repo-wide; Zod validates every API boundary. |
| Series catalog | **Registry pattern borrowed from Basin, simplified**: YAML catalog → generated TS types + citation objects | The objectivity rule is mechanical, not aspirational: a number can only render through the registry, which forces source/as-of/unit/concept onto every displayed figure. |
| Visualization | **Bespoke D3 + SVG React components** (no heavyweight chart-lib lock-in) | The centerpiece (living Sankey) and instruments are custom forms; D3 gives full control; dataviz discipline applied at build time. |
| Auth / accounts | **None** | Public read-only instrument. Zero-signup infrastructure; nothing personal stored. |
| AI in product | **None in MVP** | Narrative is hand-written under the citation rule; generated prose is a liability where objectivity is load-bearing. |
| Fiscal data spine | **Monthly Treasury Statement (MTS) via FiscalData** as the authoritative receipts/outlays/deficit source; USASpending agency drill-down deferred | MTS is the government's own monthly income statement, revised and audited; USASpending measures obligations (a different accounting concept) and joins later behind a declared bridge. |
| Fed Board data | **Via FRED series IDs only** | The Board is retiring its legacy Data Download Program (verified 2026-08-29). |
| Equity data | **Deferred with a gate**: no stocks chapter ships before a documented exception policy for commercially licensed index data | "Primary sources only" has no clean answer for stock prices; Z.1 (ownership) and Shiller's public dataset cover part of it. |
| Repo | **`kwheeler27/penny`, public, Apache-2.0, `main` protected** | Done 2026-08-29. Openness is load-bearing for a trust-first instrument. |

## 2. Feature spec source

Greenfield — the "incumbent" is the landscape itself (`IDEA.md` §Landscape):
FRED's catalog without narrative, USAFacts' static Sankey, Fed Guy's prose
without data, OFR's data without prose. The de-facto spec is the NPR-reader's
unanswered questions: where does the money go, how is the gap financed, what
happened at the auction, why did my mortgage rate move.

## 3. Product phases

### Phase 1 — MVP: "The Fiscal Machine" (where the money comes from and goes)

- **Data backbone:** registry + ingest + schema for: MTS receipts/outlays by
  category (monthly), Debt to the Penny (daily), Daily Treasury Statement /
  TGA balance (daily), interest expense (monthly), BLS CPI (monthly, for real
  terms), CBO baseline projections (batch CSV, for attributed context).
- **The living Sankey:** receipts → outlays → deficit, current month and
  fiscal-year-to-date, every node clickable to a definition + citation. The
  "USAFacts Sankey, but live" wedge.
- **Follow-the-dollar, Chapter 1:** scrollytelling narrative — where a dollar
  of federal spending comes from and where it goes — with live figures
  embedded, every claim cited.
- **Now page (small):** debt to the penny, TGA balance, fiscal-YTD deficit,
  interest expense run-rate — tiles, each dated and sourced.
- **Data page:** sources and methods; the registry rendered as a citation
  index.
- **Distribution:** Vercel URL; every view deep-linkable.

### Phase 2 — "Financing the Gap" (plumbing)

- TreasuryDirect auction ingest + the **weekly auction monitor** — "what
  happened at this week's auction and why it matters." The site's recurring
  pulse and the clearest unserved niche found in research.
- Debt composition instrument (bills/notes/bonds/TIPS; holders incl. SOMA);
  yield curve from FRED/Treasury par yields.
- Fed chapters: the balance sheet (H.4.1), how reserves/RRP/TGA move when the
  government spends and borrows, how money is created — NY Fed Markets API +
  FRED.
- First transmission piece: yields → mortgage rates, card APRs, savings
  yields (FRED consumer-rate series).

### Phase 3 — "Markets" (transmission completed; stocks as subject)

- Equity chapters: how prices form, who owns the market (Z.1), how stocks
  compete with bonds, valuation mechanics — **gated on the equity-data
  exception policy**.
- Z.1 flow-of-funds explorer; deeper plumbing instruments.
- Explicitly not yet: any what-if model. Reduced-form macro is contested in a
  way hydrology isn't; mechanical chapters come first, and a model would be a
  separate brief traced to the mission.

## 4. Architecture

```
apps/web           — Next.js site: / (front door), /now, /report/*, /explore/*, /data
packages/registry  — series & source catalog: YAML → generated TS types + citation objects (pnpm gen)
packages/db        — Drizzle schema + migrations (Neon)
packages/ingest    — TS ingest jobs per source (FiscalData, TreasuryDirect, FRED, NY Fed, BLS, CBO batch)
db/fixtures        — real API response snapshots used as test fixtures and seeds
.github/workflows  — scheduled ingest crons (daily/monthly per source cadence) + CI
```

**Core schema:**

- `series` — id (e.g. `fiscal.mts.outlays.total`), source agency, dataset,
  unit + magnitude (dollars vs millions — stored as published, never silently
  converted), accounting concept (outlay / receipt / obligation / debt /
  balance), cadence, citation fields (dataset URL, agency name).
- `observation` — series_id, period (calendar date or fiscal period —
  fiscal year Oct–Sep is an explicit dimension, never derived ad hoc),
  value (`numeric`, never float), publication_time, `revision_of`
  (revisions are new rows, never updates), ingested_at.
- `ingest_run` — provenance: job, started/finished, source URL hit, row
  counts, outcome.

**Key behaviors (the correctness rules):**

1. A number can only reach the page through the registry — which means it
   arrives with source, as-of date, unit, and accounting concept attached.
2. Revisions are new rows; the site can always show what was known when.
3. Missing data renders as a gap, never a zero.
4. Accounting concepts never mix silently (outlays vs obligations; deficit vs
   debt; fiscal vs calendar year) — declared bridges or side-by-side only.
5. Ingest is idempotent: re-running a job on the same source data changes
   nothing; changed source data creates revisions.
6. Reconciliation is a test, not a hope: ingested MTS components must sum to
   the published totals to the dollar, or CI fails.

## 5. Costs & prerequisites

| Item | Cost |
|---|---|
| All data sources (FiscalData, TreasuryDirect, NY Fed, OFR, FRED, BLS, CBO) | $0 — keyless or instant self-service keys; no approval gates (verified 2026-08-29) |
| FRED API key, BLS v2 key | Free, instant; store in GitHub Actions secrets + `.env` |
| Neon Postgres | Free tier (existing account) |
| Vercel hosting | Hobby tier (Basin precedent); custom domain later, optional |

## 6. Risks / open items

- **FiscalData rate limit** verified only secondhand (~1,000 req/hr default);
  re-verify with real requests before writing backfill loops.
- **MTS granularity vs the Sankey's ambition** — how deep the
  category tree goes (function vs agency vs program) determines the visual;
  resolve in the first ingest spike before the Sankey design is locked.
- **Objectivity discipline is a review gate, not a vibe:** every narrative PR
  gets checked against the neutral-register and citation hard rules before
  merge; interpretation without attribution is a blocking finding.
- **Equity data licensing** — Phase 3 gate, documented in §1.
- **CBO has no API** — batch CSV ingestion with a manual refresh cadence
  (twice-yearly baseline updates); treat staleness as a displayed fact.
- **Common-infra extraction** — Kevin plans a separate effort to pull
  reusable pieces (registry codegen, rigor-contract schema) out of
  Basin/Penny; Penny borrows doctrine now and refactors onto shared infra
  later rather than blocking on it.
