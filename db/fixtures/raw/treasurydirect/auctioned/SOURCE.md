# TreasuryDirect auction results — raw fixture

`2023-12-20_to_2026-08-27.json` — captured live 2026-09-01 via:

```
https://www.treasurydirect.gov/TA_WS/securities/search?startDate=2024-01-01&endDate=2026-09-01&format=json
```

(TreasuryDirect trims to the earliest full record on or after `startDate`,
hence the actual first row is `2023-12-20`, not `2024-01-01`.) 1,176 rows, no
`type` filter — every security type appears: Bill, Note, Bond, TIPS, FRN, and
CMB (Cash Management Bill).

Keyless, no auth. Field set (120 keys) is identical across `/auctioned`,
`/upcoming`, and `/search` — one Zod schema
(`packages/ingest/src/treasurydirect/auction.ts`) covers all three.

## Why `/search`, not `/auctioned?days=N`

Verified live 2026-09-01: `/TA_WS/securities/auctioned?days=N` caps at 250
rows no matter how large `N` is (tested `days=1000` and `days=20000` — both
returned the identical 250-row response, earliest row 2025-03-18). `/search`
with explicit `startDate`/`endDate` has no such cap (tested up to 1,111 rows
for a 3-year, all-types window) — it's what `jobs/auctions-backfill.ts` uses,
and this fixture is what its tests slice against.

## Verified facts this fixture is the evidence for

- **`type` vs `securityType`.** `securityType` only takes `Bill`/`Note`/
  `Bond` — it collapses TIPS into Note/Bond and FRN into Note. `type` takes
  `Bill`/`Note`/`Bond`/`TIPS`/`FRN`/`CMB` and is what the `auction` table
  stores as `security_type`. A 2-Day CMB (`type: "CMB"`) is present in this
  file — a real, irregular Cash Management Bill, not a hypothetical.
- **Bill family grouping.** Grouping by `original_security_term` alone mixes
  different bill tenors: the `"17-Week"` original family in this file
  contains 140 rows each of `security_term` `"4-Week"`, `"8-Week"`, and
  `"17-Week"` — three different curve points sharing one lineage. See
  `packages/db/src/schema.ts`'s doc comment on `auction.originalSecurityTerm`
  and `packages/db/src/queries/auctions.ts`'s `auctionFamilyKey`.
- **The FRN/high_yield-null test case.** The 2026-08-26 1-Year-11-Month Note
  (a 2-Year FRN reopening, cusip `91282CRD5`) has `bidToCoverRatio` populated
  but `highYield` empty — FRNs publish `highDiscountMargin` instead. Used as
  a fixture test case per the build brief.
- **`updatedTimestamp` is America/New_York wall-clock, not UTC.** Same-day
  bill results (11:30am ET close) show `updatedTimestamp` values like
  `"...T11:33:19"` — consistent with Eastern local time, not UTC (11:33 UTC
  would be 7:33am ET, before the close). `packages/ingest/src/lib/time.ts`
  converts accordingly.
