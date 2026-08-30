/**
 * Debt to the Penny — the one FiscalData dataset genuinely reported to the
 * cent, not in millions. https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/debt-to-the-penny
 */
import { z } from "zod";
import { fiscalDataAmountString, fiscalDataResponseSchema } from "./envelope";

export const debtToPennyRecordSchema = z
  .object({
    record_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    debt_held_public_amt: fiscalDataAmountString,
    intragov_hold_amt: fiscalDataAmountString,
    tot_pub_debt_out_amt: fiscalDataAmountString,
    src_line_nbr: z.string().optional(),
    record_fiscal_year: z.string().regex(/^\d{4}$/),
    record_fiscal_quarter: z.string().regex(/^[1-4]$/),
    record_calendar_year: z.string().regex(/^\d{4}$/),
    record_calendar_month: z.string().regex(/^\d{2}$/),
    record_calendar_day: z.string().regex(/^\d{2}$/),
  })
  .passthrough();

export type DebtToPennyRecord = z.infer<typeof debtToPennyRecordSchema>;

export const debtToPennyResponseSchema = fiscalDataResponseSchema(debtToPennyRecordSchema);
export type DebtToPennyResponse = z.infer<typeof debtToPennyResponseSchema>;
