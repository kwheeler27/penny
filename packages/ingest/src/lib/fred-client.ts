/**
 * Thin fetch helper for the real FRED API (`api.stlouisfed.org`) — the
 * production path CLAUDE.md's "Fed Board data via FRED series IDs only"
 * rule requires (the Board's own legacy Data Download Program is being
 * retired; never build against it). Always needs an API key.
 *
 * This is deliberately NOT the same endpoint as the keyless
 * `fredgraph.csv` export `src/fred/wresbal.ts`'s CSV parser reads for the
 * fixture path — that export has no JSON equivalent and no key requirement,
 * but also no SLA and no documented rate limit; it's fine for a one-time
 * fixture snapshot, not for a recurring production cron. The real API
 * (`/fred/series/observations`) is the one CLAUDE.md means by "the proper
 * FRED API," and it always requires `api_key`, keyless or not.
 */

const BASE_URL = "https://api.stlouisfed.org/fred/series/observations";

export interface FetchFredObservationsOptions {
  /** YYYY-MM-DD, inclusive. Omit for FRED's own default (full history). */
  observationStart?: string;
  /** YYYY-MM-DD, inclusive. Omit for FRED's own default (latest available). */
  observationEnd?: string;
}

/**
 * Fetch one series' observations as parsed JSON (still unvalidated — callers
 * run the result through `fredObservationsResponseSchema.parse` from
 * `src/fred/wresbal.ts`). Never logs or throws the full request URL: it
 * contains `api_key`, a secret, and CLAUDE.md's public-repo rule extends to
 * runtime logs, not just committed files.
 */
export async function fetchFredObservations(
  seriesId: string,
  apiKey: string,
  options: FetchFredObservationsOptions = {},
): Promise<unknown> {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: "json",
  });
  if (options.observationStart) params.set("observation_start", options.observationStart);
  if (options.observationEnd) params.set("observation_end", options.observationEnd);

  const res = await fetch(`${BASE_URL}?${params.toString()}`);
  if (!res.ok) {
    // Deliberately omits the request URL/body from the error — both carry api_key.
    throw new Error(`FRED request failed: ${res.status} ${res.statusText} (series_id=${seriesId})`);
  }
  return res.json();
}
