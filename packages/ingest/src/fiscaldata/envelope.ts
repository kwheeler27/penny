/**
 * Shared response envelope for every Treasury FiscalData endpoint
 * (`api.fiscaldata.treasury.gov/services/api/fiscal_service/...`). Every
 * dataset wraps its records in the same `{ data, meta, links }` shape;
 * only the record shape differs per dataset (see the sibling files in this
 * directory).
 *
 * FiscalData returns every field as a string, including numeric ones — this
 * is a *feature* for Buck: it means a value never round-trips through a JS
 * float on the way in. Ingest jobs pass these strings straight through to
 * Postgres `numeric` columns; nothing in this package parses them to
 * `number`.
 */
import { z } from "zod";

export const fiscalDataMetaSchema = z
  .object({
    count: z.number(),
    labels: z.record(z.string()),
    dataTypes: z.record(z.string()),
    dataFormats: z.record(z.string()),
    "total-count": z.number().optional(),
    "total-pages": z.number().optional(),
  })
  .passthrough();

export const fiscalDataLinksSchema = z
  .object({
    self: z.string().optional(),
    first: z.string().optional(),
    prev: z.string().nullable().optional(),
    next: z.string().nullable().optional(),
    last: z.string().optional(),
  })
  .partial();

export type FiscalDataMeta = z.infer<typeof fiscalDataMetaSchema>;
export type FiscalDataLinks = z.infer<typeof fiscalDataLinksSchema>;

/** Build a full-response schema for one FiscalData dataset from its record schema. */
export function fiscalDataResponseSchema<T extends z.ZodTypeAny>(recordSchema: T) {
  return z.object({
    data: z.array(recordSchema),
    meta: fiscalDataMetaSchema,
    links: fiscalDataLinksSchema.optional(),
  });
}

/**
 * Every FiscalData record carries this fiscal/calendar metadata block as
 * strings. Common base for every per-dataset record schema below —
 * `.extend()` it, never redeclare these fields.
 *
 * Note record_date is the record's own as-of date; record_fiscal_year is
 * FiscalData's own fiscal-year stamp for the row — ingest should still
 * cross-check it against the observation's computed fiscal year rather than
 * trust it blindly, since it's an ordinary source field like any other and
 * the "fiscal year is never derived ad hoc" hard rule cuts both ways: don't
 * silently recompute it either without reconciling against what the source
 * says.
 */
export const fiscalDataRecordBaseSchema = z.object({
  record_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  record_fiscal_year: z.string().regex(/^\d{4}$/),
  record_fiscal_quarter: z.string().regex(/^[1-4]$/),
  record_calendar_year: z.string().regex(/^\d{4}$/),
  record_calendar_month: z.string().regex(/^\d{2}$/),
  record_calendar_day: z.string().regex(/^\d{2}$/),
});

/**
 * FiscalData's sentinel for "this numeric field doesn't apply to this row"
 * — the literal STRING "null", not a JSON null. Verified live 2026-08-29
 * against multiple datasets (MTS Table 1's fiscal-year header rows,
 * `operating_cash_balance`'s `close_today_bal` on every row of that
 * dataset) — this is a real, current API convention, not a hypothetical.
 * Treat it as "no value published for this field on this row" (a gap),
 * never as zero.
 */
export const FISCAL_DATA_NULL = "null";

/** A FiscalData numeric field: signed decimal delivered as a string, OR the "null" sentinel above. Never call Number()/parseFloat() on the result — pass the string through to Postgres `numeric`, or route it through `parseFiscalDataAmount` first to turn the sentinel into a real null. */
export const fiscalDataAmountString = z.union([z.literal(FISCAL_DATA_NULL), z.string().regex(/^-?\d+(\.\d+)?$/)]);

/** Turn a `fiscalDataAmountString` value into a decimal string or null. Never parses to `number` — the non-null branch is returned unchanged. */
export function parseFiscalDataAmount(raw: string): string | null {
  return raw === FISCAL_DATA_NULL ? null : raw;
}
