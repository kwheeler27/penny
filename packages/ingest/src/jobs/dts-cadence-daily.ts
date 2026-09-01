/**
 * Daily Treasury Statement — Deposits and Withdrawals of Operating Cash.
 * Source for Penny Atlas beat 3 ("When does the money move?"): the daily
 * cadence chart, plus the public-debt cash-issue/redemption series that
 * bridge into borrowing (a later section's story). See
 * fiscaldata/deposits-withdrawals.ts for the verified source shape and
 * exact row selectors this module reads.
 *
 * Derives four observations per business day from four published rows
 * (never by re-summing itemized category rows — see that file's doc
 * comment on rounding):
 *
 *   fiscal.dts.deposits_operating_excl_debt    = TotalDeposits - PublicDebtCashIssues
 *   fiscal.dts.withdrawals_operating_excl_debt = TotalWithdrawals - PublicDebtCashRedemptions
 *   fiscal.dts.public_debt_cash_issues         = PublicDebtCashIssues        (pass-through)
 *   fiscal.dts.public_debt_cash_redemptions    = PublicDebtCashRedemptions   (pass-through)
 *
 * All subtraction goes through lib/decimal.ts's exact BigInt-scaled
 * arithmetic — never Number()/parseFloat().
 */
import {
  dtsDepositsWithdrawalsResponseSchema,
  DTS_TGA_ACCOUNT_TYPE,
  DTS_TOTAL_DEPOSITS_ACCOUNT_TYPE,
  DTS_TOTAL_WITHDRAWALS_ACCOUNT_TYPE,
  DTS_PUBLIC_DEBT_CASH_ISSUES_CATEGORY,
  DTS_PUBLIC_DEBT_CASH_REDEMPTIONS_CATEGORY,
  type DtsDepositsWithdrawalsRecord,
} from "../fiscaldata/deposits-withdrawals";
import { parseFiscalDataAmount } from "../fiscaldata/envelope";
import { fetchFiscalDataRange, withRetry, FISCALDATA_PATHS } from "../lib/fiscaldata-client";
import { firstDayOfMonth, lastDayOfMonth } from "../lib/period";
import { decimalSubtract } from "../lib/decimal";
import { upsertObservations, type UpsertManySummary } from "../lib/upsert";
import type { RawObservation } from "../lib/types";
import { getDb, type PennyDb } from "@penny/db";

/**
 * Pure transform: group the raw rows by record_date and derive the four
 * series for each business day present. Throws if a business day is
 * present in the response but missing one of the four required rows (an
 * assumption break worth failing loudly on, not silently skipping — every
 * one of 84 business days in the live 2026-05..2026-08 sample carried all
 * four). A required row that IS present but carries the FISCAL_DATA_NULL
 * sentinel value is treated as a gap for that day only, mirroring
 * tga-daily.ts's handling of the same sentinel.
 */
export function parseDtsDepositsWithdrawals(response: { data: DtsDepositsWithdrawalsRecord[] }): RawObservation[] {
  const byDate = new Map<string, DtsDepositsWithdrawalsRecord[]>();
  for (const r of response.data) {
    const list = byDate.get(r.record_date);
    if (list) {
      list.push(r);
    } else {
      byDate.set(r.record_date, [r]);
    }
  }

  const out: RawObservation[] = [];
  for (const [recordDate, rows] of byDate) {
    const totalDeposits = rows.find((r) => r.account_type === DTS_TOTAL_DEPOSITS_ACCOUNT_TYPE);
    const totalWithdrawals = rows.find((r) => r.account_type === DTS_TOTAL_WITHDRAWALS_ACCOUNT_TYPE);
    const debtIssues = rows.find(
      (r) => r.account_type === DTS_TGA_ACCOUNT_TYPE && r.transaction_catg === DTS_PUBLIC_DEBT_CASH_ISSUES_CATEGORY,
    );
    const debtRedemptions = rows.find(
      (r) => r.account_type === DTS_TGA_ACCOUNT_TYPE && r.transaction_catg === DTS_PUBLIC_DEBT_CASH_REDEMPTIONS_CATEGORY,
    );

    if (!totalDeposits || !totalWithdrawals || !debtIssues || !debtRedemptions) {
      throw new Error(
        `Deposits and Withdrawals of Operating Cash: ${recordDate} is missing one of the four required rows ` +
          `(totalDeposits=${Boolean(totalDeposits)}, totalWithdrawals=${Boolean(totalWithdrawals)}, ` +
          `debtIssues=${Boolean(debtIssues)}, debtRedemptions=${Boolean(debtRedemptions)}) — every business day in ` +
          `the live 2026-05..2026-08 sample carried all four; re-verify the source hasn't changed shape before ` +
          `trusting a partial day's derivation.`,
      );
    }

    const totalDepositsValue = parseFiscalDataAmount(totalDeposits.transaction_today_amt);
    const totalWithdrawalsValue = parseFiscalDataAmount(totalWithdrawals.transaction_today_amt);
    const debtIssuesValue = parseFiscalDataAmount(debtIssues.transaction_today_amt);
    const debtRedemptionsValue = parseFiscalDataAmount(debtRedemptions.transaction_today_amt);

    // A FISCAL_DATA_NULL sentinel on any of the four required rows for an
    // otherwise-present business day is a genuine gap for that day's
    // derivation — never coerced to zero, never partially emitted.
    if (totalDepositsValue === null || totalWithdrawalsValue === null || debtIssuesValue === null || debtRedemptionsValue === null) {
      continue;
    }

    const fiscalYear = Number(totalDeposits.record_fiscal_year);
    const publicationTime = `${recordDate}T00:00:00Z`;

    out.push({
      seriesId: "fiscal.dts.deposits_operating_excl_debt",
      periodType: "day",
      periodStart: recordDate,
      periodEnd: recordDate,
      fiscalYear,
      value: decimalSubtract(totalDepositsValue, debtIssuesValue),
      publicationTime,
    });
    out.push({
      seriesId: "fiscal.dts.withdrawals_operating_excl_debt",
      periodType: "day",
      periodStart: recordDate,
      periodEnd: recordDate,
      fiscalYear,
      value: decimalSubtract(totalWithdrawalsValue, debtRedemptionsValue),
      publicationTime,
    });
    out.push({
      seriesId: "fiscal.dts.public_debt_cash_issues",
      periodType: "day",
      periodStart: recordDate,
      periodEnd: recordDate,
      fiscalYear,
      value: debtIssuesValue,
      publicationTime,
    });
    out.push({
      seriesId: "fiscal.dts.public_debt_cash_redemptions",
      periodType: "day",
      periodStart: recordDate,
      periodEnd: recordDate,
      fiscalYear,
      value: debtRedemptionsValue,
      publicationTime,
    });
  }

  // Stable, readable ordering — the Map already follows the API's ascending
  // `sort=record_date`, but sort explicitly rather than relying on that.
  out.sort((a, b) => (a.periodEnd === b.periodEnd ? a.seriesId.localeCompare(b.seriesId) : a.periodEnd < b.periodEnd ? -1 : 1));
  return out;
}

/** date arithmetic only (never through JS `Date`) — split at "2026-05" style boundaries. */
function splitDateKey(iso: string): { year: number; month: number } {
  const [year, month] = iso.split("-").map(Number);
  if (year === undefined || month === undefined) throw new Error(`not a YYYY-MM-DD date: ${iso}`);
  return { year, month };
}

/**
 * Split [fromDateInclusive, toDateInclusive] into calendar-month-aligned
 * chunks. This table publishes ~180 rows/business-day (~4,000-4,300 per
 * full calendar month) — comfortably under FiscalData's page[size] ceiling
 * per chunk, so a month-aligned split keeps every request well clear of
 * the 10,000-row politeness ceiling regardless of how large a range a
 * caller (e.g. a one-time historical backfill) requests, without needing
 * true cursor pagination.
 */
export function splitIntoMonthChunks(fromDateInclusive: string, toDateInclusive: string): Array<{ from: string; to: string }> {
  const from = splitDateKey(fromDateInclusive);
  const to = splitDateKey(toDateInclusive);
  const chunks: Array<{ from: string; to: string }> = [];
  let { year, month } = from;
  let isFirst = true;
  while (year < to.year || (year === to.year && month <= to.month)) {
    const isLast = year === to.year && month === to.month;
    chunks.push({
      from: isFirst ? fromDateInclusive : firstDayOfMonth(year, month),
      to: isLast ? toDateInclusive : lastDayOfMonth(year, month),
    });
    isFirst = false;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return chunks;
}

/** Fetch a (possibly multi-month) date range as one concatenated, schema-validated row list — chunked by calendar month, sequential, retried with backoff per chunk (lib/fiscaldata-client.ts's shared `withRetry`). */
async function fetchDepositsWithdrawalsRange(fromDateInclusive: string, toDateInclusive: string): Promise<DtsDepositsWithdrawalsRecord[]> {
  const chunks = splitIntoMonthChunks(fromDateInclusive, toDateInclusive);
  const all: DtsDepositsWithdrawalsRecord[] = [];
  for (const chunk of chunks) {
    const json = await withRetry(() =>
      fetchFiscalDataRange(FISCALDATA_PATHS.depositsWithdrawalsOperatingCash, chunk.from, chunk.to, 8000),
    );
    const parsed = dtsDepositsWithdrawalsResponseSchema.parse(json);
    all.push(...parsed.data);
  }
  return all;
}

export interface DtsCadenceDailyJobResult {
  fromDate: string;
  toDate: string;
  summary: UpsertManySummary;
}

export async function runDtsCadenceDailyJob(db: PennyDb, lookbackDays = 14): Promise<DtsCadenceDailyJobResult> {
  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const fromDateStr = iso(fromDate);
  const toDateStr = iso(toDate);

  const records = await fetchDepositsWithdrawalsRange(fromDateStr, toDateStr);
  const observations = parseDtsDepositsWithdrawals({ data: records });
  const summary = await upsertObservations(db, observations);
  return { fromDate: fromDateStr, toDate: toDateStr, summary };
}

async function main() {
  const db = getDb();
  const result = await runDtsCadenceDailyJob(db);
  console.log(
    `DTS deposits/withdrawals ingest complete for ${result.fromDate}..${result.toDate}: +${result.summary.inserted} ~${result.summary.revised} =${result.summary.unchanged}`,
  );
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
