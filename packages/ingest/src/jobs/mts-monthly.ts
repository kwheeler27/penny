/**
 * Monthly Treasury Statement ingest — ORCHESTRATION_PROMPT.md Core flow 1.
 * Pulls Table 1 (totals), Table 4 (receipts by category), and Table 9
 * (outlays by budget function) for one MTS report and turns them into
 * `RawObservation`s. Parsing is pure (no I/O, no db) so every reconciliation
 * test in test/reconciliation.test.ts runs against real captured fixture
 * JSON without a network call; `runMtsMonthlyJob` is the thin live wrapper
 * a cron actually invokes.
 */
import { parseFiscalDataAmount } from "../fiscaldata/envelope";
import { mtsSummaryResponseSchema, type MtsSummaryRecord } from "../fiscaldata/mts-summary";
import { mtsReceiptsResponseSchema, type MtsReceiptsRecord } from "../fiscaldata/mts-receipts";
import { mtsOutlaysByFunctionResponseSchema, type MtsOutlaysByFunctionRecord } from "../fiscaldata/mts-outlays";
import { fetchFiscalDataForDate, fetchLatestRecordDate, FISCALDATA_PATHS } from "../lib/fiscaldata-client";
import { fiscalMonthToCalendar, fiscalYearStart, firstDayOfMonth, lastDayOfMonth, monthNumberFromName } from "../lib/period";
import { decimalEquals, decimalSubtract, decimalSum } from "../lib/decimal";
import { upsertObservations, type UpsertManySummary } from "../lib/upsert";
import type { RawObservation } from "../lib/types";
import type { SeriesId } from "@penny/registry";
import { getDb, type PennyDb } from "@penny/db";

// ---------------------------------------------------------------------------
// Category label maps — exact classification_desc strings verified live
// 2026-08-29. See mts-receipts.ts / mts-outlays.ts doc comments for why
// these specific strings (and not e.g. a bare category name) are required.
// ---------------------------------------------------------------------------

interface ReceiptsCategoryRule {
  label: string;
  dataTypeCd: string;
  seriesId: SeriesId;
}

export const RECEIPTS_CATEGORY_RULES: readonly ReceiptsCategoryRule[] = [
  { label: "Total -- Individual Income Taxes", dataTypeCd: "T", seriesId: "fiscal.mts.receipts.category.individual_income_tax" },
  { label: "Corporation Income Taxes", dataTypeCd: "D", seriesId: "fiscal.mts.receipts.category.corporation_income_tax" },
  {
    label: "Total -- Social Insurance and Retirement Receipts",
    dataTypeCd: "T",
    seriesId: "fiscal.mts.receipts.category.social_insurance_retirement",
  },
  { label: "Total -- Excise Taxes", dataTypeCd: "T", seriesId: "fiscal.mts.receipts.category.excise_taxes" },
  { label: "Estate and Gift Taxes", dataTypeCd: "D", seriesId: "fiscal.mts.receipts.category.estate_and_gift_taxes" },
  { label: "Customs Duties", dataTypeCd: "D", seriesId: "fiscal.mts.receipts.category.customs_duties" },
  { label: "Total -- Miscellaneous Receipts", dataTypeCd: "T", seriesId: "fiscal.mts.receipts.category.miscellaneous_receipts" },
];

/** OMB budget-function label -> registry series id. Table 9's "F" rows use exactly these strings; "Allowances" legitimately doesn't appear in months where it's zero (see that series' registry definition). */
export const OUTLAYS_BY_FUNCTION_LABELS: Readonly<Record<string, SeriesId>> = {
  "National Defense": "fiscal.mts.outlays.category.national_defense",
  "International Affairs": "fiscal.mts.outlays.category.international_affairs",
  "General Science, Space, and Technology": "fiscal.mts.outlays.category.general_science_space_technology",
  Energy: "fiscal.mts.outlays.category.energy",
  "Natural Resources and Environment": "fiscal.mts.outlays.category.natural_resources_and_environment",
  Agriculture: "fiscal.mts.outlays.category.agriculture",
  "Commerce and Housing Credit": "fiscal.mts.outlays.category.commerce_and_housing_credit",
  Transportation: "fiscal.mts.outlays.category.transportation",
  "Community and Regional Development": "fiscal.mts.outlays.category.community_and_regional_development",
  "Education, Training, Employment, and Social Services": "fiscal.mts.outlays.category.education_training_employment_social_services",
  Health: "fiscal.mts.outlays.category.health",
  Medicare: "fiscal.mts.outlays.category.medicare",
  "Income Security": "fiscal.mts.outlays.category.income_security",
  "Social Security": "fiscal.mts.outlays.category.social_security",
  "Veterans Benefits and Services": "fiscal.mts.outlays.category.veterans_benefits_and_services",
  "Administration of Justice": "fiscal.mts.outlays.category.administration_of_justice",
  "General Government": "fiscal.mts.outlays.category.general_government",
  "Net Interest": "fiscal.mts.outlays.category.net_interest",
  Allowances: "fiscal.mts.outlays.category.allowances",
  "Undistributed Offsetting Receipts": "fiscal.mts.outlays.category.undistributed_offsetting_receipts",
};

const FY_HEADER_RE = /^FY (\d{4})$/;

/** publication_time limitation, documented once here and referenced from every parser below: FiscalData's MTS endpoints expose no field distinct from record_date that represents when the figure was actually released (Treasury typically publishes an MTS ~3 weeks after the covered month closes). record_date is the best available proxy — it identifies which report a value came from, which is exactly what matters for this package's revision logic (lib/upsert.ts compares VALUES, not publication_time, to decide whether a later report's re-statement is a no-op or a revision). Never treated as the period the value describes — that's periodEnd. */
function publicationTimeFor(recordDate: string): string {
  return `${recordDate}T00:00:00Z`;
}

// ---------------------------------------------------------------------------
// Table 1 — totals
// ---------------------------------------------------------------------------

interface FyGroup {
  fiscalYear: number;
}

function buildFiscalYearHeaderMap(records: readonly MtsSummaryRecord[]): Map<string, FyGroup> {
  const map = new Map<string, FyGroup>();
  for (const r of records) {
    if (r.record_type_cd === "SL" && r.data_type_cd === "S" && r.parent_id === "null") {
      const m = FY_HEADER_RE.exec(r.classification_desc);
      if (m?.[1]) {
        map.set(r.classification_id, { fiscalYear: Number(m[1]) });
      }
    }
  }
  return map;
}

/**
 * Each FY group's Year-to-Date row must be stamped with the period THAT
 * GROUP actually covers (its own latest reported month), never with the
 * report's own record_calendar_month — Table 1 carries a second, COMPLETED
 * comparable-prior-year FY group alongside the current one, and that group's
 * "Year-to-Date" row is really its full-year total (through September), not
 * a YTD-through-the-current-report-month figure. Returns the latest
 * (year, month) reported for each group's parent_id, derived purely from
 * that group's own MTH rows.
 */
function latestMonthByGroup(records: readonly MtsSummaryRecord[], headerMap: Map<string, FyGroup>): Map<string, { year: number; month: number }> {
  const latest = new Map<string, { year: number; month: number }>();
  for (const r of records) {
    if (r.record_type_cd !== "MTH" || r.data_type_cd !== "D") continue;
    const group = headerMap.get(r.parent_id);
    if (!group) continue;
    const monthNum = monthNumberFromName(r.classification_desc);
    if (!monthNum) continue;
    const calendar = fiscalMonthToCalendar(monthNum, group.fiscalYear);
    const existing = latest.get(r.parent_id);
    // Compare by absolute calendar order (year, then month) so this is
    // correct regardless of the rows' order in the API response.
    if (!existing || calendar.year > existing.year || (calendar.year === existing.year && calendar.month > existing.month)) {
      latest.set(r.parent_id, calendar);
    }
  }
  return latest;
}

/** Parse one MTS Table 1 report (already Zod-validated) into total observations (receipts, outlays, deficit) for both its month rows and its Year-to-Date row, across both the current and comparable-prior-year fiscal-year groups. */
export function parseMtsSummary(response: { data: MtsSummaryRecord[] }): RawObservation[] {
  const headerMap = buildFiscalYearHeaderMap(response.data);
  const latestMonth = latestMonthByGroup(response.data, headerMap);
  const out: RawObservation[] = [];

  for (const r of response.data) {
    const isMonthRow = r.record_type_cd === "MTH" && r.data_type_cd === "D";
    const isYtdRow = r.record_type_cd === "SL" && r.data_type_cd === "T" && r.classification_desc === "Year-to-Date";
    if (!isMonthRow && !isYtdRow) continue;

    const group = headerMap.get(r.parent_id);
    if (!group) {
      throw new Error(
        `MTS Table 1 row "${r.classification_desc}" (record_date=${r.record_date}) references unknown fiscal-year group parent_id=${r.parent_id}`,
      );
    }

    let periodStart: string;
    let periodEnd: string;
    const periodType = isYtdRow ? "fiscal_ytd" : "month";

    if (isYtdRow) {
      const groupLatestMonth = latestMonth.get(r.parent_id);
      if (!groupLatestMonth) {
        throw new Error(
          `MTS Table 1 Year-to-Date row (record_date=${r.record_date}) references FY group parent_id=${r.parent_id} with no month rows to derive its period from`,
        );
      }
      periodStart = fiscalYearStart(group.fiscalYear);
      periodEnd = lastDayOfMonth(groupLatestMonth.year, groupLatestMonth.month);
    } else {
      const monthNum = monthNumberFromName(r.classification_desc);
      if (!monthNum) {
        throw new Error(`MTS Table 1 month row has unrecognized classification_desc: ${JSON.stringify(r.classification_desc)}`);
      }
      const { year, month } = fiscalMonthToCalendar(monthNum, group.fiscalYear);
      periodStart = firstDayOfMonth(year, month);
      periodEnd = lastDayOfMonth(year, month);
    }

    const publicationTime = publicationTimeFor(r.record_date);
    const base = { periodType, periodStart, periodEnd, fiscalYear: group.fiscalYear, publicationTime } as const;

    const rcpt = parseFiscalDataAmount(r.current_month_gross_rcpt_amt);
    const outly = parseFiscalDataAmount(r.current_month_gross_outly_amt);
    const dfctRaw = parseFiscalDataAmount(r.current_month_dfct_sur_amt);

    if (rcpt !== null) out.push({ ...base, seriesId: "fiscal.mts.receipts.total", value: rcpt });
    if (outly !== null) out.push({ ...base, seriesId: "fiscal.mts.outlays.total", value: outly });
    if (dfctRaw !== null) {
      // SIGN CORRECTION (verified live 2026-08-29 against multiple months,
      // both surplus and deficit): Treasury's raw current_month_dfct_sur_amt
      // is (outlays - receipts) — positive means deficit. The registry's own
      // definition for fiscal.mts.deficit.total promises the opposite
      // convention to readers ("A negative number is a deficit; a positive
      // number is a surplus" — receipts minus outlays). Storing Treasury's
      // raw sign here would make every observation contradict the series'
      // documented meaning. Negate it (exact decimal negation, never a
      // float) so the stored value matches receipts-total minus
      // outlays-total, which reconcileDeficitIdentity below then verifies
      // holds exactly rather than trusting either figure blind.
      out.push({ ...base, seriesId: "fiscal.mts.deficit.total", value: decimalSubtract("0", dfctRaw) });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Table 4 — receipts by category
// ---------------------------------------------------------------------------

export function parseMtsReceipts(response: { data: MtsReceiptsRecord[] }): RawObservation[] {
  const out: RawObservation[] = [];
  for (const r of response.data) {
    const rule = RECEIPTS_CATEGORY_RULES.find((c) => c.label === r.classification_desc && c.dataTypeCd === r.data_type_cd);
    if (!rule) continue;

    const fiscalYear = Number(r.record_fiscal_year);
    const calYear = Number(r.record_calendar_year);
    const calMonth = Number(r.record_calendar_month);
    const publicationTime = publicationTimeFor(r.record_date);

    const monthAmt = parseFiscalDataAmount(r.current_month_net_rcpt_amt);
    if (monthAmt !== null) {
      out.push({
        seriesId: rule.seriesId,
        periodType: "month",
        periodStart: firstDayOfMonth(calYear, calMonth),
        periodEnd: lastDayOfMonth(calYear, calMonth),
        fiscalYear,
        value: monthAmt,
        publicationTime,
      });
    }

    const fytdAmt = parseFiscalDataAmount(r.current_fytd_net_rcpt_amt);
    if (fytdAmt !== null) {
      out.push({
        seriesId: rule.seriesId,
        periodType: "fiscal_ytd",
        periodStart: fiscalYearStart(fiscalYear),
        periodEnd: lastDayOfMonth(calYear, calMonth),
        fiscalYear,
        value: fytdAmt,
        publicationTime,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Table 9 — outlays by budget function
// ---------------------------------------------------------------------------

export function parseMtsOutlaysByFunction(response: { data: MtsOutlaysByFunctionRecord[] }): RawObservation[] {
  const out: RawObservation[] = [];
  for (const r of response.data) {
    if (r.record_type_cd !== "F" || r.data_type_cd !== "D") continue;
    const seriesId = OUTLAYS_BY_FUNCTION_LABELS[r.classification_desc];
    if (!seriesId) continue;

    const fiscalYear = Number(r.record_fiscal_year);
    const calYear = Number(r.record_calendar_year);
    const calMonth = Number(r.record_calendar_month);
    const publicationTime = publicationTimeFor(r.record_date);

    const monthAmt = parseFiscalDataAmount(r.current_month_rcpt_outly_amt);
    if (monthAmt !== null) {
      out.push({
        seriesId,
        periodType: "month",
        periodStart: firstDayOfMonth(calYear, calMonth),
        periodEnd: lastDayOfMonth(calYear, calMonth),
        fiscalYear,
        value: monthAmt,
        publicationTime,
      });
    }

    const fytdAmt = parseFiscalDataAmount(r.current_fytd_rcpt_outly_amt);
    if (fytdAmt !== null) {
      out.push({
        seriesId,
        periodType: "fiscal_ytd",
        periodStart: fiscalYearStart(fiscalYear),
        periodEnd: lastDayOfMonth(calYear, calMonth),
        fiscalYear,
        value: fytdAmt,
        publicationTime,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reconciliation — CLAUDE.md: "component categories sum EXACTLY to
// published totals ... to the dollar." Exported so both the live job and
// test/reconciliation.test.ts share one implementation.
// ---------------------------------------------------------------------------

export interface ReconciliationCheck {
  periodType: RawObservation["periodType"];
  periodEnd: string;
  publishedTotal: string;
  sumOfCategories: string;
  difference: string;
  ok: boolean;
}

/** Sum every category observation for a given (periodType, periodEnd) and compare, exactly, to the matching total observation. Throws (rather than returning ok:false) when a total exists with no category observations at all for that period — that's a structural gap, not a rounding question. */
export function reconcileCategoriesToTotal(
  categoryObservations: readonly RawObservation[],
  totalObservations: readonly RawObservation[],
): ReconciliationCheck[] {
  const checks: ReconciliationCheck[] = [];
  for (const total of totalObservations) {
    const matches = categoryObservations.filter(
      (c) => c.periodType === total.periodType && c.periodEnd === total.periodEnd,
    );
    if (matches.length === 0) {
      throw new Error(`no category observations found for ${total.seriesId} ${total.periodType} ${total.periodEnd}`);
    }
    const sumOfCategories = decimalSum(matches.map((m) => m.value));
    const difference = decimalSubtract(total.value, sumOfCategories);
    checks.push({
      periodType: total.periodType,
      periodEnd: total.periodEnd,
      publishedTotal: total.value,
      sumOfCategories,
      difference,
      ok: decimalEquals(total.value, sumOfCategories),
    });
  }
  return checks;
}

/** fiscal.mts.deficit.total = fiscal.mts.receipts.total - fiscal.mts.outlays.total, exactly, for every matching period — the registry's own documented cross-check (see that series' YAML notes), enforced here rather than taken on faith. */
export function reconcileDeficitIdentity(totals: readonly RawObservation[]): ReconciliationCheck[] {
  const byKey = new Map<string, { rcpt?: string; outly?: string; dfct?: string }>();
  for (const t of totals) {
    const key = `${t.periodType}|${t.periodEnd}`;
    const entry = byKey.get(key) ?? {};
    if (t.seriesId === "fiscal.mts.receipts.total") entry.rcpt = t.value;
    if (t.seriesId === "fiscal.mts.outlays.total") entry.outly = t.value;
    if (t.seriesId === "fiscal.mts.deficit.total") entry.dfct = t.value;
    byKey.set(key, entry);
  }
  const checks: ReconciliationCheck[] = [];
  for (const [key, entry] of byKey) {
    if (entry.rcpt === undefined || entry.outly === undefined || entry.dfct === undefined) continue;
    const [periodType, periodEnd] = key.split("|") as [RawObservation["periodType"], string];
    const computed = decimalSubtract(entry.rcpt, entry.outly);
    checks.push({
      periodType,
      periodEnd,
      publishedTotal: entry.dfct,
      sumOfCategories: computed,
      difference: decimalSubtract(entry.dfct, computed),
      ok: decimalEquals(entry.dfct, computed),
    });
  }
  return checks;
}

// ---------------------------------------------------------------------------
// Live job
// ---------------------------------------------------------------------------

export interface MtsMonthlyJobResult {
  recordDate: string;
  summary: UpsertManySummary;
  receipts: UpsertManySummary;
  outlays: UpsertManySummary;
  reconciliation: { receipts: ReconciliationCheck[]; outlays: ReconciliationCheck[]; deficitIdentity: ReconciliationCheck[] };
}

/** Fetch the latest MTS report (Tables 1, 4, 9) and upsert every observation. Requests run sequentially, not in parallel, per the "respect rate limits" rule. Throws if any reconciliation check fails — a component/total mismatch is a data-integrity bug, not a warning. */
export async function runMtsMonthlyJob(db: PennyDb): Promise<MtsMonthlyJobResult> {
  const recordDate = await fetchLatestRecordDate(FISCALDATA_PATHS.mtsTable1);

  const table1Json = await fetchFiscalDataForDate(FISCALDATA_PATHS.mtsTable1, recordDate);
  const table1 = mtsSummaryResponseSchema.parse(table1Json);

  const table4Json = await fetchFiscalDataForDate(FISCALDATA_PATHS.mtsTable4, recordDate);
  const table4 = mtsReceiptsResponseSchema.parse(table4Json);

  const table9Json = await fetchFiscalDataForDate(FISCALDATA_PATHS.mtsTable9, recordDate);
  const table9 = mtsOutlaysByFunctionResponseSchema.parse(table9Json);

  const totals = parseMtsSummary(table1);
  const receipts = parseMtsReceipts(table4);
  const outlays = parseMtsOutlaysByFunction(table9);

  // Table 1 carries a full fiscal year (and its comparable prior year) of
  // month + Year-to-Date rows per report, but Table 4/9 (receipts/outlays by
  // category) only ever carry the CURRENT report's own month and its
  // fiscal-year-to-date figure. `publicationTime` is constant across every
  // row of one report (see publicationTimeFor's doc comment) so it can never
  // discriminate "this report's own period" from history — every row shares
  // it. `periodEnd` does discriminate: the current month's row (and, after
  // the fix above, the current FY's own Year-to-Date row) both land on the
  // report's own record_date; every historical month and the comparable
  // prior year's now-correctly-dated Year-to-Date row do not.
  const thisMonthTotals = totals.filter((t) => t.periodEnd === recordDate);
  const receiptsTotals = thisMonthTotals.filter((t) => t.seriesId === "fiscal.mts.receipts.total");
  const outlaysTotals = thisMonthTotals.filter((t) => t.seriesId === "fiscal.mts.outlays.total");

  const receiptsCheck = reconcileCategoriesToTotal(receipts, receiptsTotals);
  const outlaysCheck = reconcileCategoriesToTotal(outlays, outlaysTotals);
  const deficitCheck = reconcileDeficitIdentity(thisMonthTotals);

  const failed = [...receiptsCheck, ...outlaysCheck, ...deficitCheck].filter((c) => !c.ok);
  if (failed.length > 0) {
    throw new Error(`MTS reconciliation failed for record_date=${recordDate}: ${JSON.stringify(failed, null, 2)}`);
  }

  const summaryResult = await upsertObservations(db, totals);
  const receiptsResult = await upsertObservations(db, receipts);
  const outlaysResult = await upsertObservations(db, outlays);

  return {
    recordDate,
    summary: summaryResult,
    receipts: receiptsResult,
    outlays: outlaysResult,
    reconciliation: { receipts: receiptsCheck, outlays: outlaysCheck, deficitIdentity: deficitCheck },
  };
}

async function main() {
  const db = getDb();
  const result = await runMtsMonthlyJob(db);
  console.log(`MTS monthly ingest complete for record_date=${result.recordDate}`);
  console.log(`  totals: +${result.summary.inserted} ~${result.summary.revised} =${result.summary.unchanged}`);
  console.log(`  receipts categories: +${result.receipts.inserted} ~${result.receipts.revised} =${result.receipts.unchanged}`);
  console.log(`  outlay categories: +${result.outlays.inserted} ~${result.outlays.revised} =${result.outlays.unchanged}`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
