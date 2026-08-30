/**
 * Outlays by OMB budget function, for the `fiscal.mts.outlays.category.*`
 * registry series — sourced from Monthly Treasury Statement **Table 9**,
 * "Summary of Receipts and Outlays of the U.S. Government by Fund Group and
 * by Function and Subfunction," endpoint `/v1/accounting/mts/mts_table_9`.
 *
 * CORRECTION (verified live 2026-08-29): the contracts scaffold assumed
 * Table 5 carried the budget-function breakdown ("Table 5, budget function
 * 750 'Administration of justice'" — see the registry YAML citations). A
 * live sample shows Table 5 is actually "Outlays of the U.S. Government by
 * AGENCY" (`classification_desc` values like "Department of the Army",
 * "Legislative Branch:") — a different, agency-based classification with
 * no budget-function dimension at all. Table 9 is the correct source: its
 * `record_type_cd: "F"` rows are exactly the 20 OMB budget functions
 * (National Defense, Social Security, Medicare, ... — "Allowances" simply
 * doesn't appear as a row in months where it's zero, matching that
 * category's own definition), each already a leaf-level total (no further
 * nesting to worry about, unlike Table 4's receipts side). Table 9's own
 * "Total" row for this section reconciles exactly to MTS Table 1's
 * `current_month_gross_outly_amt` for the same month (verified:
 * 766317750177.27 for 2026-07 in both).
 *
 * The registry YAML citations still say "Table 5" — flagged in the ingest
 * handoff report as a registry correction needed before this ships;
 * packages/registry is out of this package's ownership, so this file
 * documents the correction and ingests against the right table rather than
 * a wrong one, per ORCHESTRATION_PROMPT.md's "work around it minimally and
 * flag it loudly" guidance for a genuinely broken frozen contract.
 *
 * Field shape: one row per function already carries this month's AND this
 * fiscal year's figures (`current_month_rcpt_outly_amt`,
 * `current_fytd_rcpt_outly_amt`, `prior_fytd_rcpt_outly_amt` — the name is
 * shared with the table's Receipts section, which uses the same columns
 * under a different `parent_id`; ingest job filters on
 * `record_type_cd === "F"` to select only the outlay-by-function rows).
 */
import { z } from "zod";
import { fiscalDataAmountString, fiscalDataResponseSchema } from "./envelope";

export const mtsOutlaysByFunctionRecordSchema = z
  .object({
    record_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    parent_id: z.string(),
    classification_id: z.string(),
    classification_desc: z.string(),
    current_month_rcpt_outly_amt: fiscalDataAmountString,
    current_fytd_rcpt_outly_amt: fiscalDataAmountString,
    prior_fytd_rcpt_outly_amt: fiscalDataAmountString,
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

export type MtsOutlaysByFunctionRecord = z.infer<typeof mtsOutlaysByFunctionRecordSchema>;

export const mtsOutlaysByFunctionResponseSchema = fiscalDataResponseSchema(mtsOutlaysByFunctionRecordSchema);
export type MtsOutlaysByFunctionResponse = z.infer<typeof mtsOutlaysByFunctionResponseSchema>;
