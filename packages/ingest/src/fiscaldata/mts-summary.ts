/**
 * Monthly Treasury Statement — Table 1, "Summary of Receipts and Outlays of
 * the U.S. Government." Endpoint `/v1/accounting/mts/mts_table_1`. Source
 * for the three `fiscal.mts.*.total` registry series
 * (receipts/outlays/deficit) — the reconciliation TARGET that every
 * category series (Table 4 receipts, Table 9 outlays) must sum to exactly.
 *
 * This table's structure is genuinely different from Table 4/5/9's "one row
 * = one period" shape, verified live 2026-08-29:
 *
 *  - Every response row's `record_date` / `record_fiscal_year` /
 *    `record_calendar_*` describe the REPORT's own as-of date (e.g. every
 *    row in the response for `record_date=2026-07-31` carries
 *    `record_fiscal_year: "2026"`, `record_calendar_month: "07"` — even a
 *    row whose `classification_desc` is "May" and which belongs to the
 *    COMPARABLE PRIOR YEAR group). None of those fields identify the
 *    period a given row's amount describes. Do not use them for that.
 *  - Each report contains two "FY XXXX" header rows (`record_type_cd:
 *    "SL"`, `data_type_cd: "S"`, `parent_id: "null"`) — the current fiscal
 *    year and the comparable prior fiscal year. Every data row's
 *    `parent_id` points at one header's `classification_id`; that header's
 *    `classification_desc` ("FY 2026") is the ONLY reliable source for
 *    which fiscal year a row belongs to.
 *  - Under each header, twelve rows (`record_type_cd: "MTH"`,
 *    `data_type_cd: "D"`) are named by month (`classification_desc`:
 *    "October".."September") and one more (`record_type_cd: "SL"`,
 *    `data_type_cd: "T"`, `classification_desc: "Year-to-Date"`) is the
 *    fiscal-year-to-date reading through the report's own as-of month.
 *  - All three amounts share one row: `current_month_gross_rcpt_amt`,
 *    `current_month_gross_outly_amt`, `current_month_dfct_sur_amt` — used
 *    for BOTH the month rows and the Year-to-Date row (there is no
 *    separate `*_fytd_*` field on this table, unlike Table 4/9).
 *
 * See `packages/ingest/src/jobs/mts-monthly.ts` for the parser that turns
 * this structure into dated observations, and its doc comment for how
 * `publication_time` is derived (this dataset has no field distinct from
 * `record_date` to use for it — a documented limitation, not an oversight).
 */
import { z } from "zod";
import { fiscalDataAmountString, fiscalDataResponseSchema } from "./envelope";

export const mtsSummaryRecordSchema = z
  .object({
    record_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    parent_id: z.string(),
    classification_id: z.string(),
    classification_desc: z.string(),
    current_month_gross_rcpt_amt: fiscalDataAmountString,
    current_month_gross_outly_amt: fiscalDataAmountString,
    current_month_dfct_sur_amt: fiscalDataAmountString,
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

export type MtsSummaryRecord = z.infer<typeof mtsSummaryRecordSchema>;

export const mtsSummaryResponseSchema = fiscalDataResponseSchema(mtsSummaryRecordSchema);
export type MtsSummaryResponse = z.infer<typeof mtsSummaryResponseSchema>;
