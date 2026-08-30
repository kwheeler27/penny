/**
 * Monthly Treasury Statement — Table 4, "Receipts of the U.S. Government."
 * https://fiscaldata.treasury.gov/datasets/monthly-treasury-statement/receipts-of-the-u-s-government
 * Endpoint: `/v1/accounting/mts/mts_table_4`.
 *
 * Field names below are verified against a LIVE response (2026-08-29,
 * record_date=2026-07-31) — the contracts scaffold's original guess
 * (`current_month_rcpt_amt`, no gross/net split) did not match the real
 * API; see db/fixtures/raw/fiscaldata/mts_table_4/README or the ingest
 * handoff report for the diff. Real shape:
 *
 *  - One row per line item, `classification_desc` naming it. Rows nest:
 *    some categories are a single leaf row (e.g. "Corporation Income
 *    Taxes", `parent_id` "null"); others are a subtotal ("Total -- Excise
 *    Taxes", `data_type_cd` "T") whose children roll up to it. The 7
 *    `fiscal.mts.receipts.category.*` registry series each map to exactly
 *    one specific `classification_desc` string at the correct nesting
 *    level — see `packages/ingest/src/jobs/mts-monthly.ts`'s
 *    `RECEIPTS_CATEGORY_LABELS` map. Do not match on category names alone
 *    without that map: several sub-subtotals share family-resembling names
 *    (e.g. "Total -- Unemployment Insurance" feeds "Total -- Social
 *    Insurance and Retirement Receipts" and must NOT also be counted at
 *    the top level).
 *  - `current_month_gross_rcpt_amt` / `_refund_amt` / `_net_rcpt_amt`
 *    (net = gross − refunds) and the `current_fytd_*` / `prior_fytd_*`
 *    equivalents. The registry's category and total series both store the
 *    NET figure — `Total -- Receipts`'s `current_month_net_rcpt_amt` ties
 *    exactly to MTS Table 1's `current_month_gross_rcpt_amt` for the same
 *    month (verified: both 334009875555.79 for 2026-07), despite Table 1's
 *    confusingly-named field.
 *  - Unlike Table 1, one row already carries this month's AND this fiscal
 *    year's figures together (`record_date`/`record_fiscal_year` describe
 *    this row's own period directly — no fiscal-year-header lookup needed
 *    here, unlike mts-summary.ts).
 *  - Any amount field can carry the `FISCAL_DATA_NULL` sentinel — route
 *    through `parseFiscalDataAmount`, never treat as zero.
 */
import { z } from "zod";
import { fiscalDataAmountString, fiscalDataResponseSchema } from "./envelope";

export const mtsReceiptsRecordSchema = z
  .object({
    record_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    parent_id: z.string(),
    classification_id: z.string(),
    classification_desc: z.string(),
    current_month_gross_rcpt_amt: fiscalDataAmountString,
    current_month_refund_amt: fiscalDataAmountString,
    current_month_net_rcpt_amt: fiscalDataAmountString,
    current_fytd_gross_rcpt_amt: fiscalDataAmountString,
    current_fytd_refund_amt: fiscalDataAmountString,
    current_fytd_net_rcpt_amt: fiscalDataAmountString,
    prior_fytd_gross_rcpt_amt: fiscalDataAmountString,
    prior_fytd_refund_amt: fiscalDataAmountString,
    prior_fytd_net_rcpt_amt: fiscalDataAmountString,
    data_type_cd: z.string(),
    record_type_cd: z.string(),
    src_line_nbr: z.string().optional(),
    record_fiscal_year: z.string().regex(/^\d{4}$/),
    record_fiscal_quarter: z.string().regex(/^[1-4]$/),
    record_calendar_year: z.string().regex(/^\d{4}$/),
    record_calendar_month: z.string().regex(/^\d{2}$/),
    record_calendar_day: z.string().regex(/^\d{2}$/),
  })
  .passthrough();

export type MtsReceiptsRecord = z.infer<typeof mtsReceiptsRecordSchema>;

export const mtsReceiptsResponseSchema = fiscalDataResponseSchema(mtsReceiptsRecordSchema);
export type MtsReceiptsResponse = z.infer<typeof mtsReceiptsResponseSchema>;
