/**
 * BLS Public Data API v2 — timeseries response, used for CPI-U all items
 * (series id CUUR0000SA0). POST https://api.bls.gov/publicAPI/v2/timeseries/data/
 * https://www.bls.gov/developers/api_signature_v2.htm
 *
 * Unlike FiscalData, BLS's `value` field is a plain numeric string with no
 * fixed format guarantee beyond "a number as text" — still never call
 * Number()/parseFloat() on it; pass it straight through to Postgres
 * `numeric`.
 */
import { z } from "zod";

export const blsFootnoteSchema = z
  .object({
    code: z.string().optional(),
    text: z.string().optional(),
  })
  .partial();

export const blsSeriesDataPointSchema = z.object({
  year: z.string().regex(/^\d{4}$/),
  /** M01-M12 for monthly periods; BLS uses M13 for an annual average row on some series — ingest should skip non-M01..M12 periods for CPI-U's monthly cadence rather than special-case M13. */
  period: z.string().regex(/^M\d{2}$/),
  periodName: z.string(),
  value: z.string(),
  footnotes: z.array(blsFootnoteSchema).default([]),
  latest: z.string().optional(),
});

export const blsSeriesSchema = z.object({
  seriesID: z.string(),
  data: z.array(blsSeriesDataPointSchema),
});

export const blsResponseSchema = z.object({
  status: z.enum(["REQUEST_SUCCEEDED", "REQUEST_NOT_PROCESSED"]),
  responseTime: z.number(),
  message: z.array(z.string()),
  Results: z
    .object({
      series: z.array(blsSeriesSchema),
    })
    .optional(),
});

export type BlsSeriesDataPoint = z.infer<typeof blsSeriesDataPointSchema>;
export type BlsSeries = z.infer<typeof blsSeriesSchema>;
export type BlsResponse = z.infer<typeof blsResponseSchema>;

/** The CPI-U, U.S. city average, all items, not seasonally adjusted series id — the one price.cpi_u.all_items ingests. */
export const CPI_U_ALL_ITEMS_SERIES_ID = "CUUR0000SA0";
