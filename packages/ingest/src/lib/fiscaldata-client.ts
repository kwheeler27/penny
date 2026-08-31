/**
 * Thin fetch helper for Treasury FiscalData's REST API. Keyless for GET
 * (PLAN.md §5); every ingest job goes through this module rather than
 * calling `fetch` directly so the "sequential requests, respect rate
 * limits" rule (ORCHESTRATION_PROMPT.md) is enforced in one place — no
 * concurrent request fan-out anywhere in this package.
 */

const BASE_URL = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service";

/** Curl's `-g`/URL-globbing problem has a fetch() equivalent: FiscalData's own `[` `]` in query params (e.g. `page[size]`) must reach the server literally, so this constructs the query string by hand rather than via `URLSearchParams` (which would percent-encode the brackets — FiscalData accepts either, but leaving them literal matches every example in its own docs and is easier to eyeball in logs). */
function buildUrl(path: string, params: Record<string, string>): string {
  const query = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return `${BASE_URL}${path}${query ? `?${query}` : ""}`;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`FiscalData request failed: ${res.status} ${res.statusText} (${url})`);
  }
  return res.json();
}

/** Fetch every row for one exact record_date (a single MTS report, a single day). */
export async function fetchFiscalDataForDate(path: string, recordDate: string, pageSize = 500): Promise<unknown> {
  const url = buildUrl(path, { filter: `record_date:eq:${recordDate}`, "page[size]": String(pageSize) });
  return getJson(url);
}

/** Fetch rows across a [gte, lte] record_date range, sorted ascending, in one page (fine at this data's volume — a 90-day daily series or a 24-month monthly one is at most a few hundred rows). */
export async function fetchFiscalDataRange(
  path: string,
  fromDateInclusive: string,
  toDateInclusive: string,
  pageSize = 5000,
): Promise<unknown> {
  const url = buildUrl(path, {
    filter: `record_date:gte:${fromDateInclusive},record_date:lte:${toDateInclusive}`,
    sort: "record_date",
    "page[size]": String(pageSize),
  });
  return getJson(url);
}

/** The most recent record_date present in a dataset — one small request, used to then fetch that date's full row set via fetchFiscalDataForDate. */
export async function fetchLatestRecordDate(path: string): Promise<string> {
  const url = buildUrl(path, { sort: "-record_date", "page[size]": "1" });
  const json = (await getJson(url)) as { data?: Array<{ record_date?: unknown }> };
  const recordDate = json.data?.[0]?.record_date;
  if (typeof recordDate !== "string") {
    throw new Error(`could not determine latest record_date from ${url}`);
  }
  return recordDate;
}

export const FISCALDATA_PATHS = {
  mtsTable1: "/v1/accounting/mts/mts_table_1",
  mtsTable4: "/v1/accounting/mts/mts_table_4",
  mtsTable9: "/v1/accounting/mts/mts_table_9",
  debtToPenny: "/v2/accounting/od/debt_to_penny",
  operatingCashBalance: "/v1/accounting/dts/operating_cash_balance",
  interestExpense: "/v2/accounting/od/interest_expense",
} as const;
