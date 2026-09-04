# Design principles — Penny

Seeded 2026-09-04 from `~/projects/DESIGN_PRINCIPLES.md` (the cross-project
doctrine distilled from Basin, whose `docs/DESIGN_PRINCIPLES.md` remains the
reference implementation), then **bound to the dollar system**. Rule of use:
this doc may specialize and extend the shared file; it may not contradict it.
A lesson that generalizes gets proposed upstream (show Kevin the edit), never
forked locally.

Two failure modes to design against everywhere. **Distortion**: making a
number intuitive by making it wrong. **Paralysis**: hedging so thoroughly the
reader learns nothing.

## 1. Headings lead with the finding, not the label

Every heading over a chart, tile, or section states the observation, computed
from the data beneath it, and written to self-retract when the data stops
supporting it. One finding per heading; cover the figures and the headings
alone retell the page's argument.

**Penny binding.** The reference implementations already shipped:

- The front door's Act IV heading is computed three ways — "Spending exceeded
  revenue. The difference is borrowed." / "Revenue exceeded spending…" /
  "Spending matched revenue…" — from the actual FYTD sign.
- Auction takeaway sentences compare only against the same security family's
  trailing window, and the banned-adjective list (weak/strong/solid/soft/
  robust/tepid) is enforced by test, not by review.
- "Spike" may only be said when the series has actually receded ≥10% from its
  peak (`hasReceededFromPeak`); otherwise the copy retracts to "highest
  12-month total."

Requirement going forward: a new chart or tile ships with a computed heading
or takeaway, or with an explicit reason it can't have one. Static category
labels ("Trends", "Breakdown") are bugs.

## 2. Plain language, no prior knowledge assumed

Money Stuff register. First use of a term of art teaches it, inline or via a
hover card from a single glossary layer — one definition per concept, written
once, surfaced everywhere, never forked into a second wording in page copy.

**Penny binding — the glossary layer.** Two sources, one layer:

- Series concepts already live in the registry (`definition` on every series
  YAML), surfaced by `RegistryFigure`'s "What is this?" expander. That is the
  canonical wording for anything that is a series.
- Fiscal jargon that isn't a series — TGA, continuing resolution, marketable
  vs. nonmarketable debt, primary dealer, SOMA, noncompetitive bid, debt
  limit, unified budget — gets one definition each in a glossary content
  file, rendered as hover cards (the term-underline affordance, §9) wherever
  the term appears, and collected on a `/glossary` page. Page copy never
  paraphrases a glossary definition; it links it.

**Human anchors.** Big numbers carry per-household and per-U.S.-resident
anchors (the existing `ForScaleFactCard`s) where the arithmetic is honest: a
national total divided by a cited Census denominator, both sourced, labeled
as arithmetic rather than incidence. "Per taxpayer" is **not used** until an
honest denominator is chosen and documented (returns filed? filers with
positive liability? — these differ by tens of millions); until then it would
be a number made friendly by being made wrong.

## 3. Neutral register — counts double here

No editorial color, no imputed motive; characterizations are attributed or
self-descriptions; the facts carry the argument.

**Penny binding.** Fiscal copy is read by people who vote, tax, spend, and
get taxed. The test is doubled: every sentence must survive being read aloud
by any party it describes — either party's leadership, Treasury or Fed or CBO
staff, and the reader whose paycheck the numbers describe. Mechanics are
facts; what mechanics *imply* is a debate with names attached (the Bank of
England bulletin vs. Friedman–Schwartz precedent on the money-creation page:
"Penny doesn't referee. The ledgers are the facts; the fights are cited.").

## 4. Every number carries its provenance

Source, vintage/as-of, unit, and accounting concept travel with every
displayed number — in captions and detail cards, not an about page.

**Penny binding.** `RegistryFigure` is the enforcement mechanism, not a
convention: every number renders through a typed registry id, and the
registry carries agency, dataset, unit, magnitude, accounting concept, and
citation. Epistemic classes: observed values are solid; CBO baseline figures
are **projections, labeled as CBO's, shown beside observed FYTD, never
summed or averaged with it**; administrative values (the debt limit, when it
appears) are reference lines, never data series. Daily Treasury data is
revisable and says so (§9's provisional badge).

## 5. Never mix accountings without a declared bridge

**Penny binding — the non-summable pairs, by name.** These pairs describe
"the same money" and must never share an axis, a sum, or an implied
comparison without a declared bridge:

- **Deficit (flow) vs. debt (stock).** A year's deficit is not the change in
  that year's debt — financing items (TGA swings, student-loan re-estimates,
  premiums/discounts) sit between them. Any surface showing both either
  separates them visibly or computes the bridge.
- **Fiscal year vs. calendar year.** Never mixed on one axis; every YTD
  comparison is same-span vs. the same span of the prior year, never
  same-vs-whole.
- **On-budget vs. unified.** MTS headline totals are unified (they include
  off-budget Social Security and USPS). Any on-budget or off-budget figure
  is labeled as such next to the number.
- **Nominal vs. inflation-adjusted.** A real series names its deflator and
  base period in the caption; a real number never sits beside a nominal one
  without both being labeled.
- **Monthly Treasury Statement vs. Daily Treasury Statement.** Different
  accounting systems: MTS is the month's books; DTS is operating cash moving
  through accounts. The cadence section's existing caption is the precedent
  ("a different accounting concept from operating cash actually moving in or
  out — see each source series' own definition"). DTS numbers never
  reconcile to MTS numbers by addition, and no surface may imply they do.

**Requirement:** wherever two views show the same books at different grains,
the caption *computes* the reconciliation rather than asserting it. Shipped
precedents: the averaged panel's end label ("$94B/mo avg" over "$1,127.9B
past 12 mo" — ×12 recovers the total); the compare chart's annotation
decomposition (+$1,459.9B + $762.7B = 83% of the computed increase). A
reader must be able to recompute any number that appears in two places from
what the captions say.

## 6. Missing data renders as a gap, never as a guess

**Penny binding.** Shipped mechanics, now doctrine:

- `RegistryFigure` renders "No report yet" with the source named — never a
  zero, never a stale value passed off as current.
- A summed series with one missing member is a **gap, not a smaller
  number**: "Everything else" skips a month entirely when a
  reporting category is missing it (a category with zero ingested history
  simply doesn't participate; a category with partial history makes the
  missing month a hole). This distinction came out of adversarial review —
  keep it.
- Weekends and holidays in daily series are true gaps, not interpolations.
- Empty states name what's missing and how it fills ("this chart fills in
  automatically once it has been ingested"), never hide the absence.

## 7. Chart mechanics and the entity hue registry

An entity keeps its hue on every chart in the product; a series never
changes color because the view changed. Hues live once in CSS
(`apps/web/app/globals.css`) with deliberate dark-mode variants.

**Penny binding — the hue registry.** All values CVD-validated (six-check
palette validator) in both modes against the panel surfaces:

| Entity | Token | Light | Dark | Notes |
|---|---|---|---|---|
| Outlays / spending | `--series-outlays` | `#d4653e` | `#d17a52` | |
| Receipts / revenue | `--series-receipts` | `#3d6fb4` | `#5b8cc9` | |
| Borrowing / deficit financing | `--series-borrowing` | `#0d8f6b` | `#2aa18a` | |
| Treasury General Account | `--series-tga` | `#8a4f9e` | `#a678b8` | ships with the recolor PR; see reuse rule |
| Bank reserves | `--series-reserves` | `#a07d1f` | `#ab8a35` | ships with the recolor PR; see reuse rule |
| Total public debt (stock) | *reserved* | — | — | no line chart exists yet; the token is minted and validated with its first chart |
| Medicare | `--cat-medicare` | `#d4653e` | `#d17a52` | category five (PR #15) |
| Social Security | `--cat-social-security` | `#3d6fb4` | `#5b8cc9` | |
| Net interest | `--cat-net-interest` | `#0d8f6b` | `#2aa18a` | |
| National defense | `--cat-national-defense` | `#8a4f9e` | `#a678b8` | |
| Health | `--cat-health` | `#a07d1f` | `#ab8a35` | |
| Aggregates ("Everything else") | muted gray | — | — | always **dashed**; an aggregate never dresses as a category |

**Deficit-direction charts** (the gap month-by-month, the fiscal bridge)
wear the hue of the side that exceeded: deficit months are outlays-orange,
surplus months receipts-blue, and the borrowed gap is borrowing-green. This
is polarity expressed through the entity hues, bound here deliberately — not
a violation of hue identity.

**Reuse rule.** The hue space is finite. A hue may be shared by two entities
only when they can never appear on the same surface (TGA ↔ National defense;
bank reserves ↔ Health). Any pair that *does* share a chart must pass the
CVD validator in both modes, with the run recorded in the PR. When in doubt,
don't mint a ninth hue — fold into an aggregate, facet, or reuse under this
rule.

**Two registries, kept distinct.** The money-creation page's ledger boxes
are *box identities* (You muted, Your bank orange, The Treasury TGA-purple,
The Fed green), not series hues; the chart lines below them are series and
follow the table above. A box color and a series color may rhyme (Treasury
box ↔ TGA line); they are still two registries and this doc names both.

**Tests** (from the shared doctrine, all three enforced here): recolor-proof
(cover the legend — end labels still identify every line), gap-proof (delete
a period — the chart shows a hole and the caption explains it),
reconciliation-proof (any number appearing in two places can be recomputed
from the caption).

## 8. Information architecture

**Penny binding — every surface declares its kind:**

- `/` (the front door) **owns the argument** — the story from spending to
  revenue to the borrowed gap. No other surface may claim that job.
- `/now` — operations: the system's state right now, dated and sourced.
- `/report/*` — evidence: chapters and deep dives (`where-the-money-goes`,
  `where-dollars-come-from`).
- `/auctions` — operations for the borrowing beat: the latest results and
  what's scheduled, with evidence links into the report pages.
- `/data` — audit: every series, agency, dataset, and citation.

Route names are officially TBD (the naming pass waits on the narrative
settling); **URLs are commitments** — a rename ships a 308 redirect, never a
broken link. After any restructure, grep for stale positional copy
("below", "this page", old surface names).

## 9. One visual grammar per product

Line style carries meaning: solid = observed; **dashed = aggregate,
projection, or reference** — never decoration. Hatch = negative/offsetting
rows (the ranked chart's undistributed offsetting receipts). Uppercase +
letterspacing is structure; bold ink is emphasis. Text wears text colors —
series-colored text only for direct end labels and hover values, haloed
over busy ground. Both themes are designed, never inverted.

**Penny binding — the closed sets.**

Teaching affordances (exactly three; a fourth needs a principle here first):

1. **"What is this?" expander** on every figure (`rf-details`) — the
   registry definition, citation, and source link.
2. **Source line** under every chart (`.src`) — agency, dataset, linked ↗,
   accessed date.
3. **Term hover card** (term-underline) — the glossary layer's surfacing
   (§2); sanctioned now, ships with the glossary.

Badges and state markers (the closed set):

1. **Gap** — "No report yet" / broken line + caption naming why (shipped).
2. **Pending** — the chart-height loading placeholder; a loading state never
   wears a different chart (shipped; learned the hard way).
3. **Provisional** — daily Treasury data that will be revised (sanctioned,
   not yet shipped; ships with the first surface that needs it).
4. **Revised** — an MTS figure restated by a later publication; revisions
   are new rows, and a revised reading says so (sanctioned, not yet
   shipped).

A new kind of badge or affordance needs a principle added to this doc before
it gets a style.

## 10. The product never claims more authority than it has

**Penny binding.** Penny is independent and not affiliated with any agency —
said in the footer on every page, and restated on any surface where a reader
could mistake it. CBO projections are CBO's, labeled with their vintage.
Interpretive debates get named positions with citations; Penny doesn't
referee. When a Penny-computed figure differs from a published headline
(vintage, rounding, or concept), the surface shows and explains the
difference rather than smoothing it.
