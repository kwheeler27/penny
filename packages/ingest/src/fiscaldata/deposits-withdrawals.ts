/**
 * Daily Treasury Statement — Deposits and Withdrawals of Operating Cash
 * (Table II), source for `fiscal.dts.deposits_operating_excl_debt`,
 * `fiscal.dts.withdrawals_operating_excl_debt`,
 * `fiscal.dts.public_debt_cash_issues`, and
 * `fiscal.dts.public_debt_cash_redemptions`. Endpoint
 * `/v1/accounting/dts/deposits_withdrawals_operating_cash`.
 *
 * Shape verified live 2026-08-29 against 2026-05-01..2026-08-28 (84
 * business days, ~180 rows/day — see
 * db/fixtures/raw/fiscaldata/deposits_withdrawals_operating_cash):
 *
 *  - Every business day carries ~78 itemized `transaction_type: "Deposits"`
 *    rows and ~100 itemized `"Withdrawals"` rows, all under
 *    `account_type: "Treasury General Account (TGA)"`, PLUS exactly two
 *    aggregate rows with their own distinct `account_type` values:
 *    `"Treasury General Account Total Deposits"` and
 *    `"Treasury General Account Total Withdrawals"` (each carrying
 *    `transaction_catg: "null"` — the FISCAL_DATA_NULL sentinel, not
 *    itself a category). These two totals are the published sums this
 *    module reads directly, never re-derived by summing the itemized
 *    rows (see below).
 *  - Among the itemized rows, exactly one Deposits row and one Withdrawals
 *    row per day carry the categories
 *    `transaction_catg: "Public Debt Cash Issues (Table IIIB)"` and
 *    `"Public Debt Cash Redemp. (Table IIIB)"` respectively — the
 *    settlement-day cash flow from Treasury security issuance/redemption.
 *    On a heavy settlement day these can be many multiples of every other
 *    line item combined (verified 2026-08-27: $278.8B of debt issuance vs.
 *    $9.8B of every other deposit combined).
 *  - `transaction_today_amt` is reported as a WHOLE-MILLION integer string
 *    (dataFormats: "$1,000,000", dataType: "CURRENCY0") — no fractional
 *    million appears in the live sample. All four rows this module reads
 *    were positive (never the FISCAL_DATA_NULL sentinel, never negative)
 *    across the full 84-business-day sample, though only the sentinel
 *    case is treated as a gap by the parser — a genuinely negative
 *    published value is passed through unchanged, not asserted against.
 *  - Summing all itemized Deposits (or Withdrawals) rows for a day does
 *    NOT exactly equal the published Total row: each itemized row rounds
 *    independently to the nearest published million, so the sums differ
 *    from the total by a few million dollars on a given day (confirmed:
 *    2026-08-27 itemized deposits summed to $288,579M against a published
 *    total of $288,576M — a $3M rounding artifact, not a data error).
 *    This is exactly why the derived series here subtract the two
 *    published AGGREGATE rows from each other rather than re-summing the
 *    itemized rows — see jobs/dts-cadence-daily.ts.
 */
import { z } from "zod";
import { fiscalDataAmountString, fiscalDataResponseSchema } from "./envelope";

export const dtsDepositsWithdrawalsRecordSchema = z
  .object({
    record_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    account_type: z.string(),
    transaction_type: z.string(),
    transaction_catg: z.string(),
    transaction_catg_desc: z.string().optional(),
    transaction_today_amt: fiscalDataAmountString,
    transaction_mtd_amt: fiscalDataAmountString.optional(),
    transaction_fytd_amt: fiscalDataAmountString.optional(),
    table_nbr: z.string().optional(),
    table_nm: z.string().optional(),
    src_line_nbr: z.string().optional(),
    record_fiscal_year: z.string().regex(/^\d{4}$/),
    record_fiscal_quarter: z.string().regex(/^[1-4]$/),
    record_calendar_year: z.string().regex(/^\d{4}$/),
    record_calendar_quarter: z.string().optional(),
    record_calendar_month: z.string().regex(/^\d{2}$/),
    record_calendar_day: z.string().regex(/^\d{2}$/),
  })
  .passthrough();

export type DtsDepositsWithdrawalsRecord = z.infer<typeof dtsDepositsWithdrawalsRecordSchema>;

export const dtsDepositsWithdrawalsResponseSchema = fiscalDataResponseSchema(dtsDepositsWithdrawalsRecordSchema);
export type DtsDepositsWithdrawalsResponse = z.infer<typeof dtsDepositsWithdrawalsResponseSchema>;

/** The itemized-row account_type — every category-level Deposits/Withdrawals row, including the two public-debt rows, is filed under this label. */
export const DTS_TGA_ACCOUNT_TYPE = "Treasury General Account (TGA)";

/** The published daily total across every Deposits category (including public debt cash issues) — a distinct account_type, not derivable by re-summing the itemized rows without absorbing their independent per-row rounding (see this file's doc comment). */
export const DTS_TOTAL_DEPOSITS_ACCOUNT_TYPE = "Treasury General Account Total Deposits";

/** The published daily total across every Withdrawals category (including public debt cash redemptions) — same caveat as DTS_TOTAL_DEPOSITS_ACCOUNT_TYPE. */
export const DTS_TOTAL_WITHDRAWALS_ACCOUNT_TYPE = "Treasury General Account Total Withdrawals";

/** transaction_catg for the settlement-day cash proceeds of Treasury security issuance — under account_type=DTS_TGA_ACCOUNT_TYPE, transaction_type="Deposits". */
export const DTS_PUBLIC_DEBT_CASH_ISSUES_CATEGORY = "Public Debt Cash Issues (Table IIIB)";

/** transaction_catg for the cash paid to redeem maturing Treasury securities — under account_type=DTS_TGA_ACCOUNT_TYPE, transaction_type="Withdrawals". */
export const DTS_PUBLIC_DEBT_CASH_REDEMPTIONS_CATEGORY = "Public Debt Cash Redemp. (Table IIIB)";
