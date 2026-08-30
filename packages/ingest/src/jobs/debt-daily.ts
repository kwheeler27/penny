/**
 * Debt to the Penny — ORCHESTRATION_PROMPT.md Core flow 2. Daily, final on
 * publication (no revisions in practice — Treasury does not restate a past
 * day's debt figure), reported to the exact cent (magnitude "ones", unlike
 * almost every other series here). Absent on weekends/federal holidays —
 * that absence is never backfilled with a zero or a carried-forward value;
 * it is simply not ingested, which is what "renders as a gap" means at the
 * storage layer (no row for that date, not a row with value 0).
 */
import { parseFiscalDataAmount } from "../fiscaldata/envelope";
import { debtToPennyResponseSchema, type DebtToPennyRecord } from "../fiscaldata/debt-to-penny";
import { fetchFiscalDataRange, FISCALDATA_PATHS } from "../lib/fiscaldata-client";
import { upsertObservations, type UpsertManySummary } from "../lib/upsert";
import type { RawObservation } from "../lib/types";
import { getDb, type BuckDb } from "@buck/db";

/**
 * publication_time: Debt to the Penny publishes once per business day and
 * is not subsequently revised (registry: `revisionStatus: "final"`) — using
 * the record_date itself as publication_time is exact here, not a proxy,
 * since the value genuinely becomes known/published on that date.
 */
export function parseDebtToPenny(response: { data: DebtToPennyRecord[] }): RawObservation[] {
  const out: RawObservation[] = [];
  for (const r of response.data) {
    const value = parseFiscalDataAmount(r.tot_pub_debt_out_amt);
    if (value === null) continue; // a gap in the source itself — never treat as zero.
    out.push({
      seriesId: "fiscal.debt.total_public_debt_outstanding",
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

export interface DebtDailyJobResult {
  fromDate: string;
  toDate: string;
  summary: UpsertManySummary;
}

/** Live job: pulls the last 14 days every run (cheap, and self-healing if a run was ever missed) rather than just "today", then relies on lib/upsert.ts's value-compare idempotency so re-covering already-ingested days is a no-op. */
export async function runDebtDailyJob(db: BuckDb, lookbackDays = 14): Promise<DebtDailyJobResult> {
  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const fromDateStr = iso(fromDate);
  const toDateStr = iso(toDate);

  const json = await fetchFiscalDataRange(FISCALDATA_PATHS.debtToPenny, fromDateStr, toDateStr);
  const parsed = debtToPennyResponseSchema.parse(json);
  const observations = parseDebtToPenny(parsed);
  const summary = await upsertObservations(db, observations);
  return { fromDate: fromDateStr, toDate: toDateStr, summary };
}

async function main() {
  const db = getDb();
  const result = await runDebtDailyJob(db);
  console.log(
    `Debt to the Penny ingest complete for ${result.fromDate}..${result.toDate}: +${result.summary.inserted} ~${result.summary.revised} =${result.summary.unchanged}`,
  );
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
