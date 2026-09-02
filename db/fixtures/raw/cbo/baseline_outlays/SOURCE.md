# CBO baseline outlays projection — source and extraction

**Series:** `projection.cbo.baseline.outlays`
**Report:** Congressional Budget Office, *The Budget and Economic Outlook:
2026 to 2036*, published **February 11, 2026**.
**Publication page:** https://www.cbo.gov/publication/61882
**Data file:** https://www.cbo.gov/system/files/2026-02/51118-2026-02-Budget-Projections.xlsx
("Key Budget and Economic Data" workbook accompanying the report — see
https://www.cbo.gov/data/budget-economic-data.)
**Sheet / row:** `Table 1-1`, "CBO's Baseline Budget Projections, by
Category," row "Total" under the "Outlays" block, the dollar-amount block
(not the percent-of-GDP block further down the same sheet). Units as
published: **$ billions**. Same sheet, same workbook as
`../baseline_deficit/2026-02-baseline-deficit.csv` and
`../baseline_revenues/2026-02-baseline-revenues.csv` — all three series are
extracted from one download so they can never silently drift apart.

## Extraction

Same convention as `../baseline_deficit/SOURCE.md`: `Table 1-1` reports
fiscal years 2025 ("Actual,") through 2036; only **2026–2036 (11 fiscal
years)** were extracted, excluding 2025 (Treasury's realized figure, not a
CBO projection — already covered by `fiscal.mts.outlays.total`). Values are
copied verbatim from the workbook cells (3 decimal places as published,
except 2032's "9569.1" which the workbook itself publishes with only 1
decimal place — padded to "9569.100" here for a consistent column width;
the value is unchanged), sign preserved (outlays are always positive in
this baseline).

## Reconciliation check (required by the task that added this file)

For every fiscal year 2026–2036, `total_revenues_usd_billions -
total_outlays_usd_billions` (this file's sibling minus this file) equals
`../baseline_deficit/2026-02-baseline-deficit.csv`'s `total_deficit_usd_billions`
for that year, to the workbook's own 3-decimal-place precision — verified
by hand against all 11 rows when this file was added (e.g. FY2026:
5595.916 − 7448.619 = −1852.703, matching the existing deficit fixture
exactly). `packages/registry/test/registry.test.ts` and
`packages/ingest/test/jobs.test.ts` assert the known-value spot checks;
no automated test currently re-derives the full identity across all 11
years (a manual check at extraction time, same as the deficit series'
own original SOURCE.md note).

## Retrieval note (2026-09-01)

Same constraint as `../baseline_deficit/SOURCE.md`: `www.cbo.gov` blocks
scripted requests behind DataDome. The workbook was retrieved from the
Wayback Machine's mirror of the exact same URL
(`web.archive.org/web/20260822030432/`, the same snapshot the deficit
series used) — byte-for-byte the same file CBO published at that path.
