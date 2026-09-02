/**
 * Front-door (`/`) data orchestration: the one place that calls the DB
 * (lib/series-data.ts) and feeds real readings through the pure transforms
 * in lib/front-door-transform.ts. app/page.tsx calls `getFrontDoorData()`
 * once and hands slices of the result to presentational components — no
 * component below this file touches @penny/db directly, and no component
 * ever receives a bare number that didn't come through this path.
 */
import { getSeries, type SeriesId } from "@penny/registry";
import { getLatestAuctionSummary } from "./auctions-data";
import {
  getCategoryMonthlyHistory,
  getFullMonthlyHistory,
  getLatestReading,
  getMtsFlow,
  getMtsFlowAt,
  getReadingsAt,
  type MtsFlow,
} from "./series-data";
import {
  buildBridge,
  buildCategoryHistoryPanel,
  buildDeficitChart,
  buildDebtPerHouseholdFact,
  buildDebtPerResidentFact,
  buildInterestPerTaxDollarFact,
  buildMonthStepper,
  buildPerHouseholdSpendFact,
  buildRankedPeriod,
  buildToplineCells,
  isFiscalYearEndMonth,
  type BridgeData,
  type CategoryHistoryPanel,
  type DeficitChart,
  type ForScaleFact,
  type MonthStepperData,
  type RankedPeriod,
  type RankedRow,
  type ToplineCell,
} from "./front-door-transform";
import { formatDateShort, formatMonthName, formatMonthYear, formatSeriesUsd, formatUsdScale } from "./format";
import type { Reading } from "./types";

const DEBT_ID = "fiscal.debt.total_public_debt_outstanding" as SeriesId;
const TGA_ID = "fiscal.tga.closing_balance" as SeriesId;
const DEFICIT_ID = "fiscal.mts.deficit.total" as SeriesId;
// fiscal.mts.outlays.total and fiscal.mts.receipts.total share one dataset
// string (MTS Table 1 — Summary of Receipts and Outlays), so one id stands
// in for both when reading that shared table title off the registry.
const OUTLAYS_TOTAL_ID = "fiscal.mts.outlays.total" as SeriesId;
const NET_INTEREST_ID = "fiscal.mts.outlays.category.net_interest" as SeriesId;
const INDIVIDUAL_INCOME_TAX_ID = "fiscal.mts.receipts.category.individual_income_tax" as SeriesId;

// CBO's Feb-2026 baseline (PLAN.md §6: batch-loaded, not a live API) — the
// front door's topline strip pairs each of these against its observed MTS
// sibling above, same fiscal year, never blended (CLAUDE.md).
const OUTLAYS_PROJECTION_ID = "projection.cbo.baseline.outlays" as SeriesId;
const RECEIPTS_PROJECTION_ID = "projection.cbo.baseline.revenues" as SeriesId;
const DEFICIT_PROJECTION_ID = "projection.cbo.baseline.deficit" as SeriesId;

const CENSUS_POPULATION_ID: SeriesId = "census.population.resident_total";
const CENSUS_HOUSEHOLDS_ID: SeriesId = "census.households.total";

export interface HeroCell {
  label: string;
  /** null = a gap (no report ingested yet) — rendered distinctly, never as $0. */
  valueDisplay: string | null;
  sourceLine: string;
  href: string;
}

function datasetShort(dataset: string): string {
  const idx = dataset.indexOf(",");
  return idx === -1 ? dataset : dataset.slice(0, idx);
}

/**
 * The Act I/II/III source-line ingredients, built from the registry's own
 * `agency`/`dataset` fields — never hand-typed table titles, which is
 * exactly how the page previously drifted from what MTS Table 4 and Table 9
 * are actually called. `outlaysDataset`/`receiptsDataset` are read off one
 * representative category series each (every fiscal.mts.outlays.category.*
 * series shares one dataset string — Table 9; every
 * fiscal.mts.receipts.category.* series shares one — Table 4), and
 * `totalsDataset` off the MTS total series (Table 1), matching Act III's
 * "totals" framing.
 */
export interface SourceLines {
  agency: string;
  outlaysDataset: string;
  receiptsDataset: string;
  totalsDataset: string;
}

function buildSourceLines(): SourceLines {
  const outlaysDef = getSeries(NET_INTEREST_ID);
  const receiptsDef = getSeries(INDIVIDUAL_INCOME_TAX_ID);
  const totalsDef = getSeries(OUTLAYS_TOTAL_ID);
  return {
    agency: outlaysDef?.agency ?? "U.S. Department of the Treasury, Bureau of the Fiscal Service",
    outlaysDataset: outlaysDef?.dataset ?? "Monthly Treasury Statement, Table 9",
    receiptsDataset: receiptsDef?.dataset ?? "Monthly Treasury Statement, Table 4",
    totalsDataset: totalsDef?.dataset ?? "Monthly Treasury Statement, Table 1",
  };
}

function gapCell(label: string, seriesId: SeriesId, href: string): HeroCell {
  const def = getSeries(seriesId);
  return {
    label,
    valueDisplay: null,
    sourceLine: def ? `${def.agency} — not yet ingested.` : "Not yet ingested.",
    href,
  };
}

/**
 * The secondary slim row beneath the front door's topline strip: debt, TGA,
 * and the latest auction — dated stock/point-in-time figures, visually
 * de-emphasized relative to the three topline flow cells above them (which
 * carry the dek's own promise: spending, revenue, the borrowed gap). The
 * fiscal-year-to-date deficit/surplus itself moved INTO the topline row
 * (see buildToplineCells's buildBorrowedCell) — this function no longer
 * builds a deficit cell at all.
 */
async function buildSecondaryCells(debt: Reading | null, tga: Reading | null, latestAuction: Awaited<ReturnType<typeof getLatestAuctionSummary>>): Promise<HeroCell[]> {
  const debtDef = getSeries(DEBT_ID);
  const tgaDef = getSeries(TGA_ID);

  const debtCell: HeroCell = debt
    ? {
        label: "Total public debt",
        valueDisplay: formatSeriesUsd(debt.value, debtDef?.magnitude ?? "ones").display,
        sourceLine: `Treasury, ${datasetShort(debtDef?.dataset ?? "Debt to the Penny")} · ${formatDateShort(debt.periodEnd)}`,
        href: "/now",
      }
    : gapCell("Total public debt", DEBT_ID, "/now");

  const tgaCell: HeroCell = tga
    ? {
        label: "Treasury cash (TGA)",
        valueDisplay: formatUsdScale(formatSeriesUsd(tga.value, tgaDef?.magnitude ?? "ones").exact, "B", 1),
        sourceLine: `${datasetShort(tgaDef?.dataset ?? "Daily Treasury Statement")} · ${formatDateShort(tga.periodEnd)}`,
        href: "/now",
      }
    : gapCell("Treasury cash (TGA)", TGA_ID, "/now");

  const auctionCell: HeroCell = latestAuction
    ? {
        label: "Latest auction high yield",
        valueDisplay: latestAuction.highYieldDisplay,
        sourceLine: `${latestAuction.datasetLabel} · ${latestAuction.securityLabel} · ${formatDateShort(latestAuction.auctionDate)}`,
        href: "/auctions",
      }
    : { label: "Latest auction high yield", valueDisplay: null, sourceLine: "TreasuryDirect — not yet ingested.", href: "/auctions" };

  return [debtCell, tgaCell, auctionCell];
}

/** FY{fiscalYear}'s own end-of-year calendar date ("2026-09-30" for FY2026,
 * Oct 1–Sep 30) — plain integer-to-string formatting, never a `Date`
 * round-trip, matching packages/ingest/src/lib/period.ts's lastDayOfMonth
 * convention for the exact same fiscal-year-end date. Used to look up a
 * CBO projection.cbo.baseline.* reading for the SAME fiscal year an
 * observed MTS figure covers (period_type "year"). */
function fiscalYearEnd(fiscalYear: number): string {
  return `${fiscalYear}-09-30`;
}

function buildToggleLabels(fytdFlow: MtsFlow, monthFlow: MtsFlow): { fytd: string; month: string } {
  const anchor = fytdFlow.periodEnd ? fytdFlow : monthFlow;
  if (!anchor.periodEnd) return { fytd: "Fiscal year to date", month: "Latest month" };
  const monthName = formatMonthName(anchor.periodEnd);
  const fytdLabel = fytdFlow.fiscalYear != null ? `FY ${fytdFlow.fiscalYear} through ${monthName}` : `Fiscal year to date through ${monthName}`;
  return { fytd: fytdLabel, month: `${monthName} only` };
}

/**
 * A note for the receipts chart's month view, shown only when a category
 * actually ran negative that month — never asserted unconditionally.
 * Derived from the same ranked rows the chart itself renders (never a
 * separate, potentially-inconsistent data path).
 */
function buildNegativeMonthNote(monthRows: RankedRow[], fytdRows: RankedRow[], monthLabel: string): string | null {
  const negRow = monthRows.find((r) => r.negative);
  if (!negRow) return null;
  const fytdRow = fytdRows.find((r) => r.id === negRow.id);
  const yearNote = fytdRow && !fytdRow.negative ? " The fiscal-year total remains positive." : "";
  return `${negRow.label} ran negative in ${monthLabel} — money paid back out (refunds, offsets) exceeded what came in that month.${yearNote}`;
}

export interface FrontDoorData {
  /** The fiscal year and bare month name the front door is currently
   * reporting on (from the fiscal-year-to-date flow's own anchor) — for
   * page-level narrative prose ("Through {month}, the government spent
   * ..."). Null only when nothing has been ingested at all. */
  fiscalYear: number | null;
  latestMonthName: string | null;
  /** Month + year ("July 2026") for the same anchor — for a source-line
   * "through {month} {year}" phrase, which (unlike latestMonthName alone)
   * never leaves the year ambiguous in a citation. */
  latestMonthYearLabel: string | null;
  sources: SourceLines;
  /** The three topline cells the dek promises, in order: spending, revenue,
   * borrowed gap — each observed-vs.-CBO-projected, side by side. */
  topline: ToplineCell[];
  /** The slim row beneath the topline strip: debt, TGA, latest auction. */
  secondaryCells: HeroCell[];
  outlays: {
    toggleLabels: { fytd: string; month: string };
    periods: { fytd: RankedPeriod | null; month: RankedPeriod | null };
    histories: Record<string, CategoryHistoryPanel | null>;
    /** The Act I month stepper (beat 1) — null only when outlays.total has no monthly data ingested at all. */
    stepper: MonthStepperData | null;
  };
  receipts: {
    toggleLabels: { fytd: string; month: string };
    periods: { fytd: RankedPeriod | null; month: RankedPeriod | null };
    histories: Record<string, CategoryHistoryPanel | null>;
    monthOnlyNote: string | null;
  };
  bridge: BridgeData | null;
  deficitChart: DeficitChart | null;
  forScale: {
    perHouseholdSpend: ForScaleFact | null;
    interestPerTaxDollar: ForScaleFact | null;
    debtPerHousehold: ForScaleFact | null;
    debtPerResident: ForScaleFact | null;
  };
}

export interface FrontDoorDataOptions {
  /** The Act I month stepper's requested period_end (from the `?spendMonth=` search param) — an invalid or missing value falls back to the latest available month; see buildMonthStepper. */
  spendMonth?: string | null;
}

export async function getFrontDoorData(options: FrontDoorDataOptions = {}): Promise<FrontDoorData> {
  const [fytdFlow, monthFlow, debt, tga, deficitFytd, deficitMonthlyHistory, population, households, outlaysTotalHistory, latestAuction] = await Promise.all([
    getMtsFlow("fiscal_ytd"),
    getMtsFlow("month"),
    getLatestReading(DEBT_ID, "day"),
    getLatestReading(TGA_ID, "day"),
    getLatestReading(DEFICIT_ID, "fiscal_ytd"),
    getFullMonthlyHistory(DEFICIT_ID),
    getLatestReading(CENSUS_POPULATION_ID),
    getLatestReading(CENSUS_HOUSEHOLDS_ID),
    getFullMonthlyHistory(OUTLAYS_TOTAL_ID),
    getLatestAuctionSummary(),
  ]);

  // CBO's projection.cbo.baseline.* readings for the SAME fiscal year the
  // observed FYTD figures above cover — period_type "year", looked up by
  // that exact fiscal year's end date, never "whichever CBO year is
  // latest" (the baseline spans 11 future fiscal years; only one of them
  // is THIS year). A gap (no MTS report ingested at all yet) means there's
  // no fiscal year to look a projection up against either.
  const projectionIds: SeriesId[] = [OUTLAYS_PROJECTION_ID, RECEIPTS_PROJECTION_ID, DEFICIT_PROJECTION_ID];
  const projections = fytdFlow.fiscalYear != null ? await getReadingsAt(projectionIds, "year", fiscalYearEnd(fytdFlow.fiscalYear)) : new Map<SeriesId, Reading>();

  const topline = buildToplineCells(
    fytdFlow.outlays.total,
    projections.get(OUTLAYS_PROJECTION_ID) ?? null,
    fytdFlow.receipts.total,
    projections.get(RECEIPTS_PROJECTION_ID) ?? null,
    deficitFytd,
    projections.get(DEFICIT_PROJECTION_ID) ?? null,
  );
  const secondaryCells = await buildSecondaryCells(debt, tga, latestAuction);
  const toggle = { outlays: buildToggleLabels(fytdFlow, monthFlow), receipts: buildToggleLabels(fytdFlow, monthFlow) };
  // Act I's month tab is now a browsable stepper, not just "the latest
  // month" — its tab label stays generic (the stepper pill itself shows
  // which month is current) rather than the dynamic "{month} only" text
  // Act II's unchanged toggle still uses.
  const outlaysToggleLabels = { fytd: toggle.outlays.fytd, month: "By month" };

  // Every month that has an outlays.total reading — the full range the Act
  // I stepper can browse. Today (before the MTS backfill) this is already
  // 46 months (the totals series was backfilled first); per-category
  // breakdowns below still only cover whichever months the category-level
  // backfill has reached, which is why a stepped-to month with no category
  // data renders an empty-but-honest ranked list (see buildRankedPeriod:
  // a category with no reading is dropped, never a zero bar) rather than
  // an error.
  const availableOutlaysMonths = outlaysTotalHistory.map((r) => r.periodEnd);
  const stepper = buildMonthStepper(availableOutlaysMonths, options.spendMonth ?? null);
  // Reuse the already-fetched `monthFlow` when the stepper lands on the
  // same (latest) month it always defaults to — the common case, and the
  // only one that doesn't need a second query.
  const outlaysStepFlow = stepper && stepper.currentPeriodEnd !== monthFlow.periodEnd ? await getMtsFlowAt("month", stepper.currentPeriodEnd) : monthFlow;

  const outlaysFytdPeriod = buildRankedPeriod(fytdFlow.outlays.categories, fytdFlow.outlays.total, toggle.outlays.fytd, "Total outlays");
  const outlaysMonthPeriod = buildRankedPeriod(
    outlaysStepFlow.outlays.categories,
    outlaysStepFlow.outlays.total,
    stepper?.currentLabel ?? (monthFlow.periodEnd ? formatMonthYear(monthFlow.periodEnd) : "the latest month"),
    "Total outlays",
  );
  const receiptsFytdPeriod = buildRankedPeriod(fytdFlow.receipts.categories, fytdFlow.receipts.total, toggle.receipts.fytd, "Total receipts");
  const receiptsMonthPeriod = buildRankedPeriod(
    monthFlow.receipts.categories,
    monthFlow.receipts.total,
    monthFlow.periodEnd ? formatMonthYear(monthFlow.periodEnd) : "the latest month",
    "Total receipts",
  );

  const allCategoryIds: SeriesId[] = [...fytdFlow.outlays.categories.map((c) => c.id), ...fytdFlow.receipts.categories.map((c) => c.id)];
  const historyRaw = await getCategoryMonthlyHistory(allCategoryIds, 4);

  // The oldest of a category's 4 monthly points becomes a "prior FY-end"
  // anchor chip only when it actually falls in September — and even then,
  // that anchor must show the TRUE fiscal-year total (period_type
  // fiscal_ytd), never the September MONTH figure standing in for it
  // (CLAUDE.md: accounting concepts never mix silently). Look up that real
  // total at the exact same period_end, grouped by period_end since a
  // category that hasn't been backfilled as far shares no batch with one
  // that has — never assumes every category's oldest point lands on the
  // same date.
  const priorFyGroups = new Map<string, SeriesId[]>();
  for (const id of allCategoryIds) {
    const points = historyRaw.get(id);
    const oldest = points?.[0];
    if (points && points.length === 4 && oldest && isFiscalYearEndMonth(oldest.periodEnd)) {
      const group = priorFyGroups.get(oldest.periodEnd) ?? [];
      group.push(id);
      priorFyGroups.set(oldest.periodEnd, group);
    }
  }
  const priorFyTotals = new Map<SeriesId, Reading>();
  for (const [periodEnd, ids] of priorFyGroups) {
    const readings = await getReadingsAt(ids, "fiscal_ytd", periodEnd);
    for (const [id, r] of readings) priorFyTotals.set(id, r);
  }

  const histories: Record<string, CategoryHistoryPanel | null> = {};
  for (const id of allCategoryIds) {
    histories[id] = buildCategoryHistoryPanel(id, historyRaw.get(id) ?? [], priorFyTotals.get(id) ?? null);
  }
  const outlayIds = new Set(fytdFlow.outlays.categories.map((c) => c.id as string));
  const outlaysHistories: Record<string, CategoryHistoryPanel | null> = {};
  const receiptsHistories: Record<string, CategoryHistoryPanel | null> = {};
  for (const [id, panel] of Object.entries(histories)) {
    if (outlayIds.has(id)) outlaysHistories[id] = panel;
    else receiptsHistories[id] = panel;
  }

  // The v2 line-chart form (beat 1, "HISTORY PANELS v2") is fetched
  // per-category, on demand, by GET /api/category-history when a reader
  // actually clicks a row open (components/ranked-bar-chart.tsx) — never
  // inlined here for all ~27 categories on every page load regardless of
  // which one (if any) a visitor expands. That used to be a SEPARATE,
  // unbounded getFullCategoryMonthlyHistory(allCategoryIds) fetch right
  // here, inflating every "/" response by roughly a megabyte of RSC
  // payload; see the API route's own doc comment.

  const monthOnlyNote = receiptsMonthPeriod
    ? buildNegativeMonthNote(receiptsMonthPeriod.rows, receiptsFytdPeriod?.rows ?? [], monthFlow.periodEnd ? formatMonthName(monthFlow.periodEnd) : "the latest month")
    : null;

  const bridge = buildBridge(fytdFlow.outlays.total, fytdFlow.receipts.total, debt);
  const deficitChart = buildDeficitChart(deficitMonthlyHistory);

  const netInterestFytd = fytdFlow.outlays.categories.find((c) => c.id === NET_INTEREST_ID)?.reading ?? null;
  const individualIncomeTaxFytd = fytdFlow.receipts.categories.find((c) => c.id === INDIVIDUAL_INCOME_TAX_ID)?.reading ?? null;

  const anchorPeriodEnd = fytdFlow.periodEnd ?? monthFlow.periodEnd;

  return {
    fiscalYear: fytdFlow.fiscalYear,
    latestMonthName: anchorPeriodEnd ? formatMonthName(anchorPeriodEnd) : null,
    latestMonthYearLabel: anchorPeriodEnd ? formatMonthYear(anchorPeriodEnd) : null,
    sources: buildSourceLines(),
    topline,
    secondaryCells,
    outlays: {
      toggleLabels: outlaysToggleLabels,
      periods: { fytd: outlaysFytdPeriod, month: outlaysMonthPeriod },
      histories: outlaysHistories,
      stepper,
    },
    receipts: {
      toggleLabels: toggle.receipts,
      periods: { fytd: receiptsFytdPeriod, month: receiptsMonthPeriod },
      histories: receiptsHistories,
      monthOnlyNote,
    },
    bridge,
    deficitChart,
    forScale: {
      perHouseholdSpend: buildPerHouseholdSpendFact(fytdFlow.outlays.total, households),
      interestPerTaxDollar: buildInterestPerTaxDollarFact(netInterestFytd, individualIncomeTaxFytd),
      debtPerHousehold: buildDebtPerHouseholdFact(debt, households),
      debtPerResident: buildDebtPerResidentFact(debt, population),
    },
  };
}
