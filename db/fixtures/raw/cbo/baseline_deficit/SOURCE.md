# CBO baseline deficit projection — source and extraction

**Series:** `projection.cbo.baseline.deficit`
**Report:** Congressional Budget Office, *The Budget and Economic Outlook:
2026 to 2036*, published **February 11, 2026**.
**Publication page:** https://www.cbo.gov/publication/61882
**Data file:** https://www.cbo.gov/system/files/2026-02/51118-2026-02-Budget-Projections.xlsx
("Key Budget and Economic Data" workbook accompanying the report — see
https://www.cbo.gov/data/budget-economic-data.)
**Sheet / row:** `Table 1-1`, "CBO's Baseline Budget Projections, by
Category," row "Total deficit (-)", the dollar-amount block (not the
percent-of-GDP block further down the same sheet). Units as published: **$
billions**.

## Extraction

`Table 1-1` reports fiscal years 2025 (labeled "Actual,") through 2036. Only
**2026–2036 (11 fiscal years)** were extracted into `2026-02-baseline-deficit.csv`
— 2025 is CBO's readback of Treasury's own already-realized deficit, not a
projection, and is deliberately excluded so this series stays strictly
"CBO's projection," never blurring into an observed figure that
`fiscal.mts.deficit.total` already covers (see that series'
`not_comparable_with` in the registry).

Values are copied verbatim from the workbook cells (3 decimal places as
published), sign preserved (CBO reports a deficit as negative, matching this
repo's convention).

## Retrieval note (2026-08-29)

`www.cbo.gov` — including its static file host, `www.cbo.gov/system/files/*`
— returns HTTP 403 from this environment's scripted requests, behind a
DataDome bot-protection challenge that a plain `curl`/`fetch` cannot solve.
The workbook above was instead retrieved from the Wayback Machine's mirror
of the exact same URL (snapshot dated 2026-08-22, `web.archive.org/web/20260822030432/`)
— byte-for-byte the same file CBO itself published at that path, just served
without the bot check. This is a real operational constraint worth flagging
for whoever eventually automates the twice-yearly baseline refresh
(PLAN.md §6): a direct `fetch()` from a GitHub Actions runner will very
likely hit the same 403 and need either a Wayback Machine fallback or a
different retrieval method (e.g. a browser-driven fetch) — this loader is
intentionally a manual batch step (see `packages/ingest/src/jobs/cbo-baseline.ts`),
not a cron, for exactly this reason.
