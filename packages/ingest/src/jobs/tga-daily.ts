/**
 * Daily Treasury Statement — TGA closing balance. ORCHESTRATION_PROMPT.md
 * Core flow 2. See fiscaldata/operating-cash-balance.ts's doc comment for
 * the two live-verified corrections this depends on (account_type label,
 * and the close_today_bal/open_today_bal field swap).
 */
import { parseFiscalDataAmount, FISCAL_DATA_NULL } from "../fiscaldata/envelope";
import {
  operatingCashBalanceResponseSchema,
  TGA_CLOSING_BALANCE_ACCOUNT_TYPE,
  type OperatingCashBalanceRecord,
} from "../fiscaldata/operating-cash-balance";
import { fetchFiscalDataRange, FISCALDATA_PATHS } from "../lib/fiscaldata-client";
import { upsertObservations, type UpsertManySummary } from "../lib/upsert";
import type { RawObservation } from "../lib/types";
import { getDb, type BuckDb } from "@buck/db";

export function parseTgaClosingBalance(response: { data: OperatingCashBalanceRecord[] }): RawObservation[] {
  const out: RawObservation[] = [];
  for (const r of response.data) {
    if (r.account_type !== TGA_CLOSING_BALANCE_ACCOUNT_TYPE) continue;

    if (r.close_today_bal !== FISCAL_DATA_NULL) {
      // The documented quirk (see operating-cash-balance.ts) stopped holding — fail loudly rather than silently keep reading the wrong field.
      throw new Error(
        `Operating Cash Balance: expected close_today_bal to be the "${FISCAL_DATA_NULL}" sentinel for account_type=${JSON.stringify(
          r.account_type,
        )} on ${r.record_date}, got ${JSON.stringify(r.close_today_bal)} — the source may have started populating it; re-verify which field is authoritative before trusting open_today_bal blindly.`,
      );
    }

    const value = parseFiscalDataAmount(r.open_today_bal);
    if (value === null) continue; // weekend/holiday gap in the source itself.

    out.push({
      seriesId: "fiscal.tga.closing_balance",
      periodType: "day",
      periodStart: r.record_date,
      periodEnd: r.record_date,
      fiscalYear: Number(r.record_fiscal_year),
      value,
      publicationTime: `${r.record_date}T00:00:00Z`,
    });
  }
  return out;
}

export interface TgaDailyJobResult {
  fromDate: string;
  toDate: string;
  summary: UpsertManySummary;
}

export async function runTgaDailyJob(db: BuckDb, lookbackDays = 14): Promise<TgaDailyJobResult> {
  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const fromDateStr = iso(fromDate);
  const toDateStr = iso(toDate);

  const json = await fetchFiscalDataRange(FISCALDATA_PATHS.operatingCashBalance, fromDateStr, toDateStr);
  const parsed = operatingCashBalanceResponseSchema.parse(json);
  const observations = parseTgaClosingBalance(parsed);
  const summary = await upsertObservations(db, observations);
  return { fromDate: fromDateStr, toDate: toDateStr, summary };
}

async function main() {
  const db = getDb();
  const result = await runTgaDailyJob(db);
  console.log(
    `TGA closing balance ingest complete for ${result.fromDate}..${result.toDate}: +${result.summary.inserted} ~${result.summary.revised} =${result.summary.unchanged}`,
  );
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
