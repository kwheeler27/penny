# Buck — the idea

**Date:** 2026-08-29
**Status:** Phase 0 pitch, confirmed by Kevin 2026-08-29. `PLAN.md` follows via PR.

## Pitch

**A public instrument that makes the US dollar system legible: where federal
money comes from, where every dollar of spending goes, how the Treasury's and
the Federal Reserve's plumbing actually works, and how all of it transmits to
markets — bonds, stocks, and the rates people pay.**

The record is public but illegible: FRED assumes you already know which series
to ask for, USASpending stops at outlays, the Fed's releases are written for
professionals, and journalism asserts the chain (*deficits → yields → your
mortgage*) without ever showing the machine.

The spine is **"Follow the dollar"** — one continuous narrative built on live
primary data: a dollar is spent (the complete outlay picture — a living
receipts→outlays→deficit flow) → the deficit is financed → **this week's
Treasury auction, explained** (the site's recurring pulse; an unserved niche) →
who bought and how the plumbing settled it (dealers, money funds, the Fed,
reserves, RRP, TGA) → how yields propagate to mortgages, credit, and the stock
market — with the stock market treated as a full subject in its own right (how
prices form, who owns it, how it competes with bonds), not a ticker app.

## Confirmed decisions

- **Name: Buck.** The dollar, colloquially — and "the buck stops here,"
  Truman's line about federal accountability, doubles as the thesis: follow
  the buck.
- **Public instrument, public repo from day one.** Apache-2.0. Openness is
  load-bearing for trust: readers should be able to verify us, not believe us.
- **Build order: fiscal → plumbing → transmission.** Start with the complete
  government spending/receipts picture, then how the gap is financed and the
  monetary plumbing, then transmission to markets and consumer rates.
- **Stocks are a subject, not just an endpoint** — but a later chapter, after
  the fiscal and plumbing chapters exist.
- **Objectivity is a founding constraint** (Kevin, 2026-08-29): every claim
  and statement properly cited and referenced. Mechanics are facts with
  primary-source citations; interpretations are attributed to named people or
  schools of thought, never asserted in Buck's voice.
- **Separate repo from Basin; borrowed doctrine, no shared code.** Same
  mission-document structure, rigor contract (every number carries source /
  as-of date / unit / concept), neutral register, plain language,
  primary-sources-only rule, and monitor/report/instruments information
  architecture. Kevin plans a separate effort to extract cross-repo common
  infrastructure later.
- **Explicitly deferred:** deep plumbing instruments (repo/RRP/reserve
  explorers, Z.1 flow-of-funds explorer), stocks-as-subject chapters, and any
  what-if model — the last deliberately, because reduced-form macro models are
  contested in a way hydrology isn't, and none should exist before the
  mechanical chapters do.

## The two hard parts, named now

1. **Contested interpretation.** Whether $40T of federal debt is
   "unsustainable" has schools of thought, not an answer. The solve is Basin's
   neutral register: mechanics are facts, interpretations are attributed.
2. **Equity data sourcing.** Government primary sources cover fiscal and Fed
   data beautifully, but stock *prices* are commercial — S&P index data is
   licensed. "Primary sources only" needs a thought-through exception policy
   for the stocks-as-subject chapters (Z.1 ownership data and Shiller's public
   dataset get partway). Phase 1 due-diligence item.

## Landscape (researched 2026-08-29)

Data access is a non-issue — every core source is free with no approval gates
(verified 2026-08-29):

| Source | What | Access |
|---|---|---|
| Treasury FiscalData (`fiscaldata.treasury.gov`) | Debt to the penny, TGA/Daily Treasury Statement, auctions, interest expense — 80+ datasets | No auth for GET; optional api.data.gov key |
| TreasuryDirect | Auction results by CUSIP/date | Keyless |
| NY Fed Markets API (`markets.newyorkfed.org`) | SOMA holdings, repo/RRP ops, primary dealer stats, reference rates | Keyless, no registration |
| OFR Short-Term Funding Monitor (`data.financialresearch.gov/v1`) | Repo market rates/volumes | Keyless; 1–2 day lag |
| FRED | Everything, incl. H.4.1/H.15/Z.1 mirrors | Free key, instant; 120 req/min |
| BLS v2 | CPI | Free key; 500 queries/day |
| CBO | Budget/economic projections | **No API** — CSV/Excel batch ingestion |

Gotchas: the Fed Board is retiring its legacy Data Download Program — build
pipelines against FRED series IDs, not DDP URLs. FiscalData's exact rate limit
was verified only secondhand; re-check once real requests flow.

The gap is synthesis, not data. Neighbors each prove a piece of the demand:
USAFacts' budget Sankey (design-award-winning, but annual/lagged, stops at
spending); Fed Guy / Joseph Wang (the respected plain-language plumbing
explainer — text-only, partly paywalled, no live data); Apricitas (tens of
thousands follow chart-heavy macro weekly); OFR (best-in-class live repo data,
zero narrative). Nobody chains deficit → auction → Fed balance sheet → your
mortgage rate with live primary data and plain narrative in one place. The two
sharpest unserved wedges: a live, plain-language "what happened at this week's
Treasury auction and why it matters," and anything linking Fed operations to
consumer-facing rates.
