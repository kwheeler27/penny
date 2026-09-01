/**
 * Thin fetch helper for TreasuryDirect's Securities Auctions Data API
 * (`www.treasurydirect.gov/TA_WS`). Keyless, no auth (verified live
 * 2026-09-01). Every ingest job goes through this module rather than
 * calling `fetch` directly — same "sequential, polite" rule as
 * lib/fiscaldata-client.ts: no concurrent request fan-out anywhere in this
 * package.
 *
 * `/auctioned` and `/upcoming` return the same 120-field record shape as
 * `/search` (verified live: identical key sets) — see
 * ../treasurydirect/auction.ts for the one shared Zod schema and parser.
 */

const BASE_URL = "https://www.treasurydirect.gov/TA_WS/securities";

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`TreasuryDirect request failed: ${res.status} ${res.statusText} (${url})`);
  }
  return res.json();
}

/**
 * Recently auctioned (resulted) securities. NOTE: verified live 2026-09-01
 * — this endpoint's `days` parameter caps the response at 250 rows no
 * matter how large `days` is set (tested `days=1000` and `days=20000`:
 * identical 250-row responses). Fine for the daily/weekly live job
 * (well under 250 rows for any sane lookback); a full historical backfill
 * must use `fetchAuctionSearch` instead — see jobs/auctions-backfill.ts.
 */
export function auctionedUrl(days: number): string {
  return `${BASE_URL}/auctioned?days=${encodeURIComponent(String(days))}`;
}

export async function fetchAuctioned(days: number): Promise<unknown> {
  return getJson(auctionedUrl(days));
}

/** The published auction calendar — announced auctions not yet resulted, some still TBA (offeringAmount empty) pending their real announcement. */
export function upcomingUrl(): string {
  return `${BASE_URL}/upcoming`;
}

export async function fetchUpcoming(): Promise<unknown> {
  return getJson(upcomingUrl());
}

/**
 * Arbitrary date-range search — NO row cap observed (verified live
 * 2026-09-01 up to 1,111 rows for a 3-year, all-security-types window).
 * This is what the backfill job chunks across for full history.
 */
export function auctionSearchUrl(startDateInclusive: string, endDateInclusive: string): string {
  const params = new URLSearchParams({ startDate: startDateInclusive, endDate: endDateInclusive, format: "json" });
  return `${BASE_URL}/search?${params.toString()}`;
}

export async function fetchAuctionSearch(startDateInclusive: string, endDateInclusive: string): Promise<unknown> {
  return getJson(auctionSearchUrl(startDateInclusive, endDateInclusive));
}

/** Retry a flaky network call with exponential backoff — same shape as lib/fiscaldata-client.ts's `withRetry`, duplicated rather than shared across the two source-specific client modules so each stays a self-contained boundary. */
export async function withTdRetry<T>(fn: () => Promise<T>, options: { attempts?: number; baseDelayMs?: number } = {}): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts) break;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}
