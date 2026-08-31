# Sources — Chapter 1, "Where the money goes"

Every factual sentence in `chapter-1.mdx` and every definition in
`definitions.yaml` traces to an entry below. The `id` of each entry is what
`<Ref id="…" />` and `source_refs:` point at; the build should fail on a
reference to an id that is not here.

Only agencies of record appear in this list — Treasury's Bureau of the Fiscal
Service, the Government Accountability Office, the Federal Reserve Board, the
Bureau of Labor Statistics, the Congressional Budget Office, and
USASpending.gov. That is the "primary sources only" hard rule in `CLAUDE.md`,
and there are no secondary sources in this chapter.

Every entry below was fetched and read on **2026-08-29**. The "Supports" line
says what the source is actually being used for, so a reviewer can check the
claim against the source rather than against this list.

---

## Treasury — Bureau of the Fiscal Service

### `mts-report`

**Monthly Treasury Statement of Receipts and Outlays of the United States
Government.** U.S. Department of the Treasury, Bureau of the Fiscal Service.

- Landing page: <https://fiscal.treasury.gov/reports-statements/mts/>
- Issue read for this chapter: *For Fiscal Year 2026 Through July 31, 2026, and
  Other Periods* —
  <https://fiscaldata.treasury.gov/static-data/published-reports/mts/MonthlyTreasuryStatement_202607.pdf>

**Supports.** The release schedule ("normally released on the 8th workday of
the month following the reporting month", Introduction, p. 3; the release time
is printed on the Explanatory Notes page of each issue). The modified cash
basis and its rules — receipts on the basis of collections, refunds deducted
from gross receipts, reimbursements and refunds deducted from gross outlays,
interest on the public debt (public issues) recognized on an accrual basis
(Disclosure Statement, p. 3; Explanatory Notes §§2–3). The definition of budget
receipts as governmental receipts including social insurance taxes, court
fines, certain licenses, and deposits of earnings by the Federal Reserve System
(Explanatory Notes §2). Outlays accounted for on the basis of checks issued,
electronic funds transferred, or cash payments made, stated net of offsetting
collections and refunds (Explanatory Notes §3). The four types of receipts
deducted from budget totals as undistributed offsetting receipts (Explanatory
Notes §2). The table structure quoted throughout: Table 1 *Summary of Receipts,
Outlays, and the Deficit/Surplus*; Table 4 *Receipts of the U.S. Government*
(including the Excise Taxes lines for the Highway, Airport and Airway, and
Black Lung Disability Trust Funds, and the Miscellaneous Receipts lines
including *Deposit of Earnings, Federal Reserve System* and the Universal
Service Fund); Table 6 *Means of Financing the Deficit or Disposition of
Surplus*; Table 9 *Summary of Receipts by Source, and Outlays by Function*. The
calendar-shift mechanism, from the July 2026 issue's Highlight: outlays for
military active duty and retirement, veterans benefits, Supplemental Security
Income, and some Medicare payments moved into July because August 1, 2026 fell
on a non-business day; and that July usually has no major corporate or
individual tax due dates.

**Caveats recorded for downstream reviewers.**

- The published statement is in millions of dollars, and Table 9 carries the
  note "Details may not add to totals due to rounding." The FiscalData API
  returns MTS amounts in whole dollars and cents. These are two different
  magnitudes of the same figures. See the handoff notes.
- **Table 5 is *Outlays of the U.S. Government*, by agency and bureau. Outlays
  by budget function are in Table 9.** The registry currently labels the
  outlay-category series as Table 5 "by Function". Flagged, not worked around.

### `mts-dataset`

**Monthly Treasury Statement (MTS) — dataset.** Treasury Fiscal Data.
<https://fiscaldata.treasury.gov/datasets/monthly-treasury-statement/summary-of-receipts-and-outlays-of-the-u-s-government>

Companion dataset pages for the two tables used as series sources:

- Receipts of the U.S. Government —
  <https://fiscaldata.treasury.gov/datasets/monthly-treasury-statement/receipts-of-the-u-s-government>
- Outlays of the U.S. Government —
  <https://fiscaldata.treasury.gov/datasets/monthly-treasury-statement/outlays-of-the-u-s-government>

**Supports.** That the MTS "provides information on the flow of money into and
out of the U.S. Department of the Treasury … includes how deficits are funded,
such as borrowing from the public or reducing operating cash, and how surpluses
are distributed"; the release cadence; and the dataset's own statement that
"All values are reported in millions of U.S. dollars" — which describes the
published report, not the API response. See the magnitude caveat above.

### `debt-to-the-penny`

**Debt to the Penny.** Treasury Fiscal Data.
<https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/debt-to-the-penny>

**Supports.** That total public debt outstanding "is made up of
intragovernmental holdings and debt held by the public"; the data dictionary's
definitions of Debt Held by the Public (federal debt held by individuals,
corporations, state or local governments, Federal Reserve Banks, foreign
governments and other entities outside the United States Government, less
Federal Financing Bank securities), Intragovernmental Holdings (Government
Account Series securities held by government trust, revolving and special
funds, and FFB securities), and Total Public Debt Outstanding (the total of the
two); and that "Debt to the Penny is updated at the end of each business day
with data from the previous business day" — the basis for treating weekends and
holidays as gaps.

### `dts-operating-cash`

**Daily Treasury Statement (DTS) — Operating Cash Balance.** Treasury Fiscal
Data.
<https://fiscaldata.treasury.gov/datasets/daily-treasury-statement/operating-cash-balance>

**Supports.** That the DTS "contains a series of tables showing the daily cash
and debt operations of the U.S. Treasury", including the operating cash
balance, deposits and withdrawals of operating cash, and public debt
transactions; that "All figures are rounded to the nearest million"; and that
the deposits and withdrawals table carries *Public Debt Cash Issues* as a
deposit and *Public Debt Cash Redemptions* as a withdrawal — the basis for
saying the cash proceeds of debt issues are deposited into the account and
redemptions are paid out of it.

**Note for the ingest workstream.** The `account_type` value to filter on is
exactly `Treasury General Account (TGA) Closing Balance`. The registry entry
says "Federal Reserve Account", which is the pre-2022 label. Verified against a
live API response on 2026-08-29.

### `interest-expense`

**Interest Expense on the Public Debt Outstanding.** Treasury Fiscal Data.
<https://fiscaldata.treasury.gov/datasets/interest-expense-debt-outstanding/interest-expense-on-the-public-debt-outstanding>

**Supports.** That the dataset "provides monthly and fiscal year-to-date values
for interest expenses on federal government debt, that is, the cost to the U.S.
for borrowing money (calculated at a specified rate and period of time)", and
that "how much the government pays in interest depends on both the total
federal debt and the interest rate investors charged when they loaned the
money."

**Note.** The registry's `dataset_url` for
`fiscal.debt.interest_expense_total` returns HTTP 404. The working path is the
one above (`interest-expense-debt-outstanding`, not
`interest-expense-on-the-public-debt-outstanding`, as the first path segment).

---

## Government Accountability Office

### `gao-glossary`

**A Glossary of Terms Used in the Federal Budget Process.** U.S. Government
Accountability Office, GAO-05-734SP, September 2005. Developed in cooperation
with the Secretary of the Treasury and the Directors of OMB and CBO.

- Landing page: <https://www.gao.gov/products/gao-05-734sp>
- Full text read for this chapter:
  <https://www.govinfo.gov/content/pkg/GAOREPORTS-GAO-05-734SP/html/GAOREPORTS-GAO-05-734SP.htm>

**Supports.** The definitions of *Fiscal Year* (begins October 1, ends
September 30, designated by the calendar year in which it ends, with the
fiscal-1990 worked example); *Governmental Receipts*; *Outlay*; *Obligation*;
*Budget Authority*; *Deficit* and *Budget Deficit*; *Surplus*; *Debt, Federal*,
*Debt Held by the Public*, *Gross Federal Debt* and *Debt Held by Government
Accounts*; *Means of Financing*; *Offsetting Collections* and *Offsetting
Receipts*; *Undistributed Offsetting Receipts*; *Trust Fund Accounts*
(including that, except in rare circumstances, a trust fund account "imposes no
fiduciary responsibility on the federal government"); *Off-Budget* (the two
Social Security trust funds and the Postal Service); *Unified Budget*;
*Functional Classification*; and *Allowance*.

Appendix IV, *Budget Functional Classification*, supports the statement that
national needs are grouped in seventeen broad areas, with Net Interest,
Allowances and Undistributed Offsetting Receipts as three further categories
that cover the rest of the budget; that each federal activity is placed in a
single functional classification so that the sum of the functions equals the
budget totals; and the individual function descriptions used in
`definitions.yaml` — 050 National Defense, 150 International Affairs, 250
General Science, Space, and Technology, 270 Energy, 300 Natural Resources and
Environment, 350 Agriculture, 370 Commerce and Housing Credit, 400
Transportation, 450 Community and Regional Development (subfunctions 451–453,
including disaster relief and insurance), 500 Education, Training, Employment,
and Social Services, 550 Health, 570 Medicare, 600 Income Security, 650 Social
Security, 700 Veterans Benefits and Services, 750 Administration of Justice,
800 General Government, 900 Net Interest, 950 Undistributed Offsetting
Receipts.

**Caveat.** GAO-05-734SP is dated 2005 and its Appendix IV reproduces the
functional structure as it stood in the fiscal 2006 budget. GAO notes the
structure is "relatively stable" but changed from time to time after OMB
consults the Appropriations and Budget Committees. The function names Penny uses
match the lines Treasury publishes today; the descriptive text should be
re-checked against a current OMB Circular A-11 or Analytical Perspectives
before Chapter 1 leaves draft.

---

## Federal Reserve Board

### `frb-liabilities`

**Credit and Liquidity Programs and the Balance Sheet — Federal Reserve
liabilities.** Board of Governors of the Federal Reserve System.
<https://www.federalreserve.gov/monetarypolicy/bst_frliabilities.htm>

**Supports.** That the Federal Reserve is "the fiscal agent of the U.S.
Treasury" and holds the Treasury's general account; that "when the Treasury
makes a payment from its general account, funds flow from that account into the
account of a depository institution"; and that "funds that flow into the
Treasury's account, such as from a tax payment, drain balances from the
deposits of depository institutions."

---

## Bureau of Labor Statistics

### `bls-cpi`

**Consumer Price Index — CPI Databases.** U.S. Bureau of Labor Statistics.
<https://www.bls.gov/cpi/data.htm>

Series used: **CUUR0000SA0** — CPI-U, U.S. city average, all items, not
seasonally adjusted. Public API v2:
<https://api.bls.gov/publicAPI/v2/timeseries/data/>

**Supports.** The identity, cadence and shape of the CPI-U all-items series
Penny stores.

**Caveat.** `bls.gov` blocks automated retrieval (it returns an "Access Denied"
bot notice to non-browser clients), so the descriptive pages were not fetched
programmatically on 2026-08-29. The series identity and its monthly index
values were verified directly against the BLS public API, which is the agency
of record. Any sentence about CPI methodology beyond what is written here needs
a BLS Handbook of Methods citation read by a human first — this is why the
chapter makes no methodological claim about CPI.

---

## Congressional Budget Office

### `cbo-baseline`

**Budget and Economic Outlook and Updates** (recurring publication) and
**Budget and Economic Data**. Congressional Budget Office.

- <https://www.cbo.gov/recurring-publication/55126>
- <https://www.cbo.gov/about/products/budget-economic-data>

### `cbo-how-baseline`

**CBO Explains How It Develops the Budget Baseline.** Congressional Budget
Office, publication 59085. <https://www.cbo.gov/publication/59085>

**Supports (both).** That CBO's baseline is a set of projections of federal
spending, revenues, deficits or surpluses and debt, developed under the
assumption that current laws governing taxes and spending generally remain in
place; and that the projections are published in the recurring *Budget and
Economic Outlook* and its updates.

**Caveat.** `cbo.gov` returns HTTP 403 to non-browser clients, so these pages
were verified through search-result metadata rather than a direct fetch on
2026-08-29. The chapter's only CBO sentence is a description of what CBO
publishes and on what assumption, attributed to CBO by name. Before the CBO
baseline series is loaded and rendered, a human should open both pages and
confirm the wording, and record the specific *Budget and Economic Outlook*
edition the loaded figures come from.

---

## USASpending.gov

### `usaspending-glossary`

**USASpending.gov glossary.** Bureau of the Fiscal Service.

- Glossary API: <https://api.usaspending.gov/api/v2/references/glossary/>
- Site: <https://www.usaspending.gov/>

**Supports.** That USASpending reports obligations — "a legally binding
agreement that will result in outlays, immediately or in the future" — and
budget authority, which is why its totals are not comparable to the Monthly
Treasury Statement's outlays without a declared bridge.

---

## Reference-list conventions

- **Access date.** Every entry was read on 2026-08-29. A citation rendered in
  the UI substitutes `{access_date}` from the registry's `citation` string; the
  date above is the date the *prose* was checked against the source, which is a
  different fact and is stated separately for that reason.
- **Versioned documents.** Where a source is a dated issue rather than a live
  page — the Monthly Treasury Statement, a CBO outlook — the specific issue is
  named. A later issue may change the wording; the claim is what the named
  issue says.
- **What is not cited here.** No claim in this chapter rests on a news
  organization, a think tank, a data aggregator, or an encyclopedia. If a future
  edit needs one, `CLAUDE.md` requires Kevin's explicit sign-off before it goes
  in.
- **Interpretations.** There are none in Chapter 1. The chapter closes by
  naming the disagreement about the fiscal path as something that exists and
  saying it is not on this page. Any future sentence that characterizes the
  numbers rather than describing them takes a named holder and a citable
  source, per `docs/MISSION.md`.
