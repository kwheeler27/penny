/**
 * Interest Expense on the Public Debt Outstanding — source for
 * `fiscal.debt.interest_expense_total`. Endpoint
 * `/v2/accounting/od/interest_expense`. Verified live 2026-08-29.
 *
 * This dataset has NO total row: it is a fully itemized breakdown by
 * `expense_catg_desc` (e.g. "INTEREST EXPENSE ON PUBLIC ISSUES", "INTEREST
 * EXPENSE ON GOVT ACCOUNT SERIES") × `expense_group_desc` ×
 * `expense_type_desc` (Treasury Notes, Bills, Bonds, TIPS, savings bonds,
 * ...) — roughly three dozen rows per `record_date`. The registry's
 * `fiscal.debt.interest_expense_total` series (gross interest expense on
 * the debt, for a period) is therefore a COMPUTED aggregate — the sum of
 * every row's `month_expense_amt` (or `fytd_expense_amt`) for that
 * record_date — not a single published figure. This is a genuine
 * limitation of the source, not an ad-hoc derivation: flagged here and in
 * the ingest handoff report so it's never mistaken for a value Treasury
 * publishes directly.
 */
import { z } from "zod";
import { fiscalDataRecordBaseSchema, fiscalDataAmountString, fiscalDataResponseSchema } from "./envelope";

export const interestExpenseRecordSchema = fiscalDataRecordBaseSchema
  .extend({
    expense_catg_desc: z.string(),
    expense_group_desc: z.string(),
    expense_type_desc: z.string(),
    month_expense_amt: fiscalDataAmountString,
    fytd_expense_amt: fiscalDataAmountString,
    src_line_nbr: z.string().optional(),
  })
  .passthrough();

export type InterestExpenseRecord = z.infer<typeof interestExpenseRecordSchema>;

export const interestExpenseResponseSchema = fiscalDataResponseSchema(interestExpenseRecordSchema);
export type InterestExpenseResponse = z.infer<typeof interestExpenseResponseSchema>;
