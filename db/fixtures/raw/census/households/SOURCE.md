# Census total households (Table HH-1) — source and extraction

**Series:** `census.households.total`
**Table:** U.S. Census Bureau, Historical Households Tables, **Table HH-1,
"Households by Type: 1940 to Present"** (numbers in thousands), sourced
from the Current Population Survey Annual Social and Economic Supplement
(CPS ASEC).
**Landing page:**
https://www.census.gov/data/tables/time-series/demo/families/households.html
**Data file:**
https://www2.census.gov/programs-surveys/demo/tables/families/time-series/households/hh1.xls
(legacy BIFF/.xls format; document properties record "Last Saved By: Paul
Hemez (CENSUS/SEHSD FED)", last saved 2025-11-18, and the sheet's own
footer states "Internet Release Date: December 2025.")

## Retrieval (2026-08-31)

Downloaded directly via HTTPS, no API key, no auth. Parsed locally with
Python's `xlrd` (the only reader that still handles legacy `.xls`; modern
`openpyxl` does not) to read cell values directly out of the binary
workbook — never OCR'd or manually retyped off a rendering.

## Extraction

`hh1-total-households.csv` in this directory keeps only the **"Total
households"** column (column B of the sheet) for **2020–2025**, from the
sheet's `Year` / `Total households` columns. Values copied verbatim
(thousands, as published):

| Row label in HH-1 | Year (this fixture) | Total households (thousands) |
|---|---|---|
| 2020 | 2020 | 128,451 |
| 2021 | 2021 | 129,931 (superseded — see below) |
| **2021r** | **2021** | **129,224** (used) |
| 2022 | 2022 | 131,202 |
| 2023 | 2023 | 131,434 |
| 2024 | 2024 | 132,216 |
| **2025t** | **2025** | **134,790** (used) |

The sheet carries **two rows for 2021** — a plain `2021` row (129,931) and
a `2021r` row (129,224). Footnote **"r"**, quoted verbatim from the sheet:
*"Revised based on population from the most recent decennial census."* The
`r` row supersedes the plain row for the same year (a real, in-source
example of exactly the "publish a revision as a new row, don't overwrite"
pattern this registry's `revisionOf` chain is built for) — this fixture
uses the `r` value as 2021's current figure and drops the superseded
`2021` row entirely, rather than ingesting a false "revision" our own
`upsertObservation` never actually saw happen live.

The current (most recent) row is labeled **"2025t"**. Footnote **"t"**,
quoted verbatim from the sheet: *"Due to the implementation of the Vintage
2025 population estimates, comparisons of the estimated change in number
of people between 2024 and 2025 reflect both demographic change and
methodological updates."*

Dropped: every other column (Family households / Married couples / Other
family / Nonfamily households breakdowns — out of scope for this series,
which is the total only) and every year before 2020.

## Release-date reasoning (flagged, not Bureau-confirmed to the day)

The sheet itself states only **"Internet Release Date: December 2025"** —
month-level precision, no day. The Bureau's companion press release,
**"For Immediate Release: Tuesday, December 02, 2025"** ("America's
Families and Living Arrangements: 2025",
https://www.census.gov/newsroom/press-releases/2025/families-and-living-arrangements.html),
covers the same CPS ASEC 2025 release and is the most likely concurrent
release date — consistent with the workbook's "last saved" timestamp
(2025-11-18, i.e. finalized ahead of a December public release) — but that
press release's fetched text does not itself cite "Table HH-1" by name, so
this is a reasoned inference, not a confirmed exact-day citation.
`packages/ingest/src/jobs/census-batch.ts` uses **2025-12-02** as
`publicationTime` for every row in this fixture on that basis; if a more
precise, confirmed release day surfaces, update the constant there (one
line) and re-run `pnpm --filter @penny/ingest run ingest:census`.
