# CLAUDE.md

**Buck** — a public instrument that makes the US dollar system legible: where
federal money comes from, where every dollar of spending goes, how the
Treasury's and the Fed's plumbing works, and how it transmits to markets and
the rates people pay. Product context: `IDEA.md` (confirmed pitch);
`docs/MISSION.md` (mission/values — briefs trace to it); `PLAN.md`
(decisions, phases, schema); build spec: `ORCHESTRATION_PROMPT.md`.

## Source of truth & change flow

- **GitHub (`kwheeler27/buck`, PUBLIC) is the source of truth.** The repo is
  public and Apache-2.0 licensed: never commit secrets, credentials, or
  tokens — not in code, fixtures, snapshots, or history. `.env` is gitignored;
  `.env.example` documents required vars.
- **Never commit directly to `main`** (branch-protected). For any change:
  feature branch (`feat/...`, `fix/...`) → push → `gh pr create` → Kevin
  reviews and merges.
- **Small PRs, merged same-day.** Keep PRs focused; state what was tested in
  the description.
- **Brief before build** (per `~/projects/CLAUDE.md`): features start with
  what/why/use-cases/solution, traced to the mission, reviewed before build
  time.

## Hard rules (violations are bugs)

- **Objectivity is load-bearing.** Every factual claim carries a citation to a
  primary source (the agency of record). Every displayed number carries
  source, as-of date, and unit. Interpretations — "unsustainable," "crowding
  out," what a market move "means" — are attributed to named people or schools
  of thought, never asserted in Buck's voice. Test: every sentence survives
  being read aloud by any party it describes.
- **Neutral register in all narrative copy.** No editorial color, no imputed
  motives, no villains. Mechanics are facts; opinions are attributions.
- **Plain language everywhere** — the Money Stuff register. Short declarative
  sentences, plain words wherever precision survives, load-bearing terms
  defined inline. Never make a number wrong to make it friendly.
- **Primary sources only.** Data comes directly from the agency of record
  (Treasury FiscalData, TreasuryDirect, Federal Reserve Board via FRED, NY Fed
  Markets API, OFR, BLS, CBO) — never through third-party aggregators or
  repackagers. Known open item: equity index data is commercially licensed and
  needs an explicit, documented exception policy before any stocks chapter
  ships. Anything new that isn't agency-of-record needs Kevin's explicit
  sign-off.
- **Do not build pipelines against the Fed Board's legacy Data Download
  Program** (being retired) — use FRED series IDs for Board data (H.4.1,
  H.15, Z.1).
- **Values keep their published unit and precision.** Federal data arrives in
  mixed magnitudes (dollars, millions, billions); store values with the unit
  recorded, convert only at the presentation boundary, never silently mix
  magnitudes in a sum or a chart.
- **Missing data renders as a gap, never as zero.** Provisional says
  provisional; revised data gets new rows, never in-place updates —
  publication time and valid time stay distinct.
- **Accounting concepts never mix silently** (outlays vs. obligations vs.
  budget authority; deficit vs. debt; par vs. market value; fiscal year vs.
  calendar year). Side-by-side display or a declared bridge, never a silent
  sum or comparison.
- The dev machine has **8GB RAM**: no simulators, no watch-mode runners, no
  long-lived dev servers unless asked; tests run single-run.

## Commands

- None yet — docs-only repo. `PLAN.md` will establish the stack; commands land
  here with the first code PR.
