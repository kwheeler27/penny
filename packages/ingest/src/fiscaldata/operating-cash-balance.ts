/**
 * Daily Treasury Statement — Operating Cash Balance, source for
 * `fiscal.tga.closing_balance`. Endpoint
 * `/v1/accounting/dts/operating_cash_balance`.
 *
 * TWO corrections versus what the contracts scaffold assumed, both verified
 * live 2026-08-29:
 *
 *  1. `account_type` is **"Treasury General Account (TGA) Closing
 *     Balance"**, not "Federal Reserve Account" (Treasury's modern DTS
 *     presentation uses "TGA" rather than the older "Federal Reserve
 *     Account" label the registry YAML's note guessed). This dataset
 *     returns exactly 4 rows per business day: TGA Opening Balance, Total
 *     TGA Deposits (Table II), Total TGA Withdrawals (Table II) (-), TGA
 *     Closing Balance. Filter on the Closing Balance row specifically.
 *  2. `close_today_bal` is the FISCAL_DATA_NULL sentinel on every row of
 *     this dataset (confirmed across a 90-day live sample) — Treasury does
 *     not populate it here despite the name. The actual balance value for
 *     each row (including the Closing Balance row) is carried in
 *     `open_today_bal` (also duplicated into `open_month_bal` and
 *     `open_fiscal_year_bal`). This is a genuine, reproducible quirk of
 *     this specific dataset's current data, not a misread — see
 *     db/fixtures/raw/fiscaldata/operating_cash_balance for the evidence.
 *     The ingest job asserts `close_today_bal === FISCAL_DATA_NULL` and
 *     fails loudly if a future API response ever populates it, rather than
 *     silently trusting whichever field happens to be non-null.
 */
import { z } from "zod";
import { fiscalDataAmountString, fiscalDataResponseSchema } from "./envelope";

export const operatingCashBalanceRecordSchema = z
  .object({
    record_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    account_type: z.string(),
    close_today_bal: fiscalDataAmountString,
    open_today_bal: fiscalDataAmountString,
    open_month_bal: fiscalDataAmountString.optional(),
    open_fiscal_year_bal: fiscalDataAmountString.optional(),
    table_nbr: z.string().optional(),
    table_nm: z.string().optional(),
    sub_table_name: z.string().optional(),
    src_line_nbr: z.string().optional(),
    record_fiscal_year: z.string().regex(/^\d{4}$/),
    record_fiscal_quarter: z.string().regex(/^[1-4]$/),
    record_calendar_year: z.string().regex(/^\d{4}$/),
    record_calendar_month: z.string().regex(/^\d{2}$/),
    record_calendar_day: z.string().regex(/^\d{2}$/),
  })
  .passthrough();

export type OperatingCashBalanceRecord = z.infer<typeof operatingCashBalanceRecordSchema>;

export const operatingCashBalanceResponseSchema = fiscalDataResponseSchema(operatingCashBalanceRecordSchema);
export type OperatingCashBalanceResponse = z.infer<typeof operatingCashBalanceResponseSchema>;

/** The exact account_type label for the TGA closing-balance row — verified live 2026-08-29. */
export const TGA_CLOSING_BALANCE_ACCOUNT_TYPE = "Treasury General Account (TGA) Closing Balance";
