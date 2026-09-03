# WRBWFRBL raw snapshot

Real, unedited response from FRED's keyless CSV export — not the production
JSON API (`api.stlouisfed.org`, which needs `FRED_API_KEY`); this snapshot
exists only to seed local dev/tests, per `db/fixtures/README.md`'s "no
credentials needed for local dev" rule.

**Series choice, corrected after review (2026-09-02):** H.4.1 publishes TWO
distinct reserve-balance series. `WRESBAL` ("Reserve Balances with Federal
Reserve Banks: **Week Average**") is the average of the daily levels across
the week ending that Wednesday. `WRBWFRBL` ("...: **Wednesday Level**") is
the actual as-of-Wednesday balance — a genuine point-in-time stock, the same
kind of figure as `fiscal.tga.closing_balance`'s daily reading. This branch
originally used WRESBAL while describing it, and charting it against the
TGA, as if it were a Wednesday close-of-business balance — verified live to
be wrong: on 2026-06-17, WRESBAL read 3,033,444 while the genuine Wednesday
level (WRBWFRBL) read 2,936,355, a $97.1B gap. Switched to WRBWFRBL so every
claim on the money-creation page (each reading dated to and describing "that
Wednesday's balance") is actually true of the series being read.

- **Request**: `GET https://fred.stlouisfed.org/graph/fredgraph.csv?id=WRBWFRBL`
  (no API key, no auth header — keyless CSV export of a public FRED graph).
- **Retrieved**: 2026-09-02.
- **Full source history** starts 2002-12-18 (FRED's earliest WRBWFRBL
  observation, same start date as WRESBAL) and runs to whatever the latest
  published Wednesday is at fetch time. This file is trimmed to
  `2015-01-07` through `2026-08-26` — the same 2015-forward window every
  other Penny Atlas history backfill uses (see `db/fixtures/README.md`'s MTS
  full-history note) — via `awk -F, 'NR==1 || $1 >= "2015-01-01"'` on the
  full export. 608 data rows + 1 header row (identical row count and date
  range to the WRESBAL fixture this replaces — both series publish on the
  same weekly-Wednesday cadence).
- **Verified live 2026-09-02**: every one of the full (untrimmed,
  1,237-row) export's dates falls on a Wednesday; zero rows carry FRED's
  "." missing-value sentinel in this particular pull (the parser still
  treats "." as a gap defensively — see
  `packages/ingest/src/fred/wrbwfrbl.ts` and its test's synthetic
  missing-value case, since a future re-fetch or the live production job
  could hit one).
- **Known-value spot check** (hand-verified against this file, used in
  `packages/ingest/test/reserves.test.ts`): `2026-08-26,2916824` — at the
  registry's declared magnitude "millions," $2,916,824,000,000 ($2.92
  trillion), the right order of magnitude for total bank reserves at the
  Fed. A second spot check at the window's start: `2015-01-07,2710273`.
- Fetched directly via `curl` — no scraping, no third-party aggregator; FRED
  is the Federal Reserve Bank of St. Louis' own data service, mirroring the
  Federal Reserve Board's own H.4.1 release (CLAUDE.md: "Fed Board data via
  FRED series IDs only").
