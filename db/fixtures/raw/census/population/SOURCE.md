# Census resident population (Vintage 2025) — source and extraction

**Series:** `census.population.resident_total`
**Program:** U.S. Census Bureau, Population Estimates Program (PEP), Vintage
2025 national and state population estimates.
**Announcement:** Press release **CB26-20**, "U.S. Population Growth Slows
Due to Historic Decline in Net International Migration," **For Immediate
Release: Tuesday, January 27, 2026**.
https://www.census.gov/newsroom/press-releases/2026/population-growth-slows.html
— states the national estimate as "341.8 million" for July 1, 2025 (rounded;
see exact figure below).
**Dataset landing page:**
https://www.census.gov/data/tables/time-series/demo/popest/2020s-national-total.html
("National Population Totals and Components of Change: 2020-2025")
**Data file:**
https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/state/totals/NST-EST2025-ALLDATA.csv
— despite the "state" path segment, this file's first data row (SUMLEV=010,
STATE=00) is the national total; it also carries every state, DC, and the
four Census regions.

## Retrieval (2026-08-31)

Downloaded directly via HTTPS (`curl`), no API key, no auth, no bot
challenge encountered (unlike `db/fixtures/raw/cbo/baseline_deficit/`,
cbo.gov's static file host returns a scripted-request block; Census's
`www2.census.gov` static file host does not). File size 53,555 bytes, 58
rows (header + national + 50 states + DC + Puerto Rico + 4 regions), 106
columns.

## Extraction

`NST-EST2025-ALLDATA-national.csv` in this directory keeps only the
**national row** (`SUMLEV=010, STATE=00, NAME="United States"`) and only the
six annual **`POPESTIMATE20XX`** columns (2020–2025) — the Bureau's
"population as of July 1 of year X" estimate. Values copied verbatim
(whole persons, no rounding) from the downloaded file:

| Column | Value (persons, July 1) |
|---|---|
| POPESTIMATE2020 | 331,578,104 |
| POPESTIMATE2021 | 332,100,166 |
| POPESTIMATE2022 | 333,996,304 |
| POPESTIMATE2023 | 336,755,052 |
| POPESTIMATE2024 | 340,003,797 |
| POPESTIMATE2025 | 341,784,857 |

Dropped: every state/DC/Puerto Rico/region row; `ESTIMATESBASE2020` (the
April 1, 2020 census-day base — a different reference date than the July 1
annual estimates, and not itself a "July 1" reading); and every
components-of-change column (births, deaths, migration, etc. — out of
scope for this registry series, which is the population level itself, not
its drivers).

**Important vintage caveat:** this is the **Vintage 2025** release. Each
new vintage recomputes *every* year's estimate back to the 2020 census
using that vintage's updated methodology and inputs — so the 2020–2024
values in this file are Vintage 2025's *current* estimate for those years,
which can differ from what an earlier vintage (e.g. "Vintage 2024")
published for the same July 1 date. All six rows in the committed fixture
share one `publicationTime` (2026-01-27, the Vintage 2025 release date)
for exactly this reason — see `packages/ingest/src/jobs/census-batch.ts`.
