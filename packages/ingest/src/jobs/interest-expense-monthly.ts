/**
 * Interest Expense on the Public Debt Outstanding, monthly. Not one of
 * ORCHESTRATION_PROMPT.md's three numbered "Core flows," but explicitly
 * listed in this package's fixture/ingest scope (interest expense
 * (monthly)) and required for the registry's `fiscal.debt.interest_expense_total`
 * series.
 *
 * See fiscaldata/interest-expense.ts: this dataset has no total row, so the
 * period's value is a COMPUTED sum across every `expense_catg_desc` /
 * `expense_group_desc` / `expense_type_desc` breakdown row for that
 * record_date — a documented aggregation, not a published single figure.
 */
import { parseFiscalDataAmount } from "../fiscaldata/envelope";
import { interestExpenseResponseSchema, type InterestExpenseRecord } from "../fiscaldata/interest-expense";
import { fetchFiscalDataRange, FISCALDATA_PATHS } from "../lib/fiscaldata-client";
import { decimalSum } from "../lib/decimal";
import { upsertObservations, type UpsertManySummary } from "../lib/upsert";
import type { RawObservation } from "../lib/types";
import { getDb, type BuckDb } from "@buck/db";

interface MonthGroup {
  recordDate: string;
  fiscalYear: string;
  calYear: string;
  calMonth: string;
  monthAmounts: string[];
  fytdAmounts: string[];
}

export function parseInterestExpense(response: { data: InterestExpenseRecord[] }): RawObservation[] {
  const groups = new Map<string, MonthGroup>();
  for (const r of response.data) {
    let g = groups.get(r.record_date);
    if (!g) {
      g = {
        recordDate: r.record_date,
        fiscalYear: r.record_fiscal_year,
        calYear: r.record_calendar_year,
        calMonth: r.record_calendar_month,
        monthAmounts: [],
        fytdAmounts: [],
      };
      groups.set(r.record_date, g);
    }
    const monthAmt = parseFiscalDataAmount(r.month_expense_amt);
    if (monthAmt !== null) g.monthAmounts.push(monthAmt);
    const fytdAmt = parseFiscalDataAmount(r.fytd_expense_amt);
    if (fytdAmt !== null) g.fytdAmounts.push(fytdAmt);
  }

  const out: RawObservation[] = [];
  for (const g of groups.values()) {
    const publicationTime = `${g.recordDate}T00:00:00Z`;
    const fiscalYear = Number(g.fiscalYear);
    if (g.monthAmounts.length > 0) {
      out.push({
        seriesId: "fiscal.debt.interest_expense_total",
        periodType: "month",
        periodStart: `${g.calYear}-${g.calMonth}-01`,
        periodEnd: g.recordDate,
        fiscalYear,
        value: decimalSum(g.monthAmounts),
        publicationTime,
      });
    }
    if (g.fytdAmounts.length > 0) {
      out.push({
        seriesId: "fiscal.debt.interest_expense_total",
        periodType: "fiscal_ytd",
        periodStart: `${fiscalYear - 1}-10-01`,
        periodEnd: g.recordDate,
        fiscalYear,
        value: decimalSum(g.fytdAmounts),
        publicationTime,
      });
    }
  }
  return out;
}

export interface InterestExpenseMonthlyJobResult {
  fromDate: string;
  toDate: string;
  summary: UpsertManySummary;
}

/** Live job: last 400 days is enough to always include at least the most recently published month, with margin for the dataset's own lag. */
export async function runInterestExpenseMonthlyJob(db: BuckDb, lookbackDays = 400): Promise<InterestExpenseMonthlyJobResult> {
  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const fromDateStr = iso(fromDate);
  const toDateStr = iso(toDate);

  const json = await fetchFiscalDataRange(FISCALDATA_PATHS.interestExpense, fromDateStr, toDateStr);
  const parsed = interestExpenseResponseSchema.parse(json);
  const observations = parseInterestExpense(parsed);
  const summary = await upsertObservations(db, observations);
  return { fromDate: fromDateStr, toDate: toDateStr, summary };
}

async function main() {
  const db = getDb();
  const result = await runInterestExpenseMonthlyJob(db);
  console.log(
    `Interest expense ingest complete for ${result.fromDate}..${result.toDate}: +${result.summary.inserted} ~${result.summary.revised} =${result.summary.unchanged}`,
  );
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
