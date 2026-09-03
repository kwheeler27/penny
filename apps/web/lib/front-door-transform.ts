/**
 * Pure transforms behind the front door's ranked bar charts, click-to-expand
 * history panels, deficit history chart, and "for scale" facts. Kept
 * separate from lib/front-door-data.ts's DB orchestration so every rule here
 * is unit-testable against a hand-built fixture, no database involved — the
 * same split lib/fiscal-flow-input.ts already uses for the living Sankey.
 *
 * Every displayed figure here is exact decimal-string arithmetic (via
 * lib/format.ts, which deliberately does NOT import @penny/viz — see that
 * file's own comment on why) — Number()/parseFloat never touches a value
 * that ends up on the page, only ever a COSMETIC pixel proportion (bar
 * widths), matching packages/viz/src/money/decimal.ts's own documented
 * convention.
 */
import { getSeries, type Magnitude, type SeriesId } from "@penny/registry";
import type { CategoryFlow, CategoryHistoryPoint } from "./series-data";
import type { Reading } from "./types";
import {
  absDecimalString as absDecimal,
  compareDecimalStrings as compareDecimal,
  defaultUsdDecimals,
  divideDecimalStrings,
  formatCountScale,
  formatDateShort,
  formatExactUsd,
  formatMonthName,
  formatMonthYear,
  formatMonthYearShort,
  formatSeriesUsd,
  formatSharePercent,
  formatUsdScale,
  isNegativeDecimalString as isNegativeDecimal,
  roundToSignificantFigures,
  shiftDecimalRight,
  subtractDecimalStrings as subtractDecimal,
  sumDecimalStrings,
} from "./format";

// ---------- ranked bar rows (Act I / Act II) ----------

export interface RankedRow {
  id: string;
  label: string;
  /** Exact whole-dollar decimal string, signed, magnitude already applied. */
  valueWhole: string;
  /** Full precision, as-published — the row's hover/tooltip text. */
  exactDisplay: string;
  /** Fixed-billions display, e.g. "$1,384.4B". */
  scaledDisplay: string;
  /** Signed share of the period's net total, e.g. "22.0%" / "−2.2%". */
  shareDisplay: string;
  negative: boolean;
}

export interface RankedPeriod {
  periodLabel: string;
  rows: RankedRow[];
  /** Exact whole-dollar decimal string for the period's published total. */
  totalWhole: string;
  totalDisplay: string;
}

/**
 * Category rows for one MTS period (one side, one period_type), ranked
 * descending by value and formatted for display. A category with no
 * reading this period is dropped entirely — never rendered as a zero bar
 * (CLAUDE.md: missing data is a gap, never a zero). Returns null only when
 * the period's own total is itself a gap (nothing to rank against).
 */
export function buildRankedPeriod(categories: CategoryFlow[], total: Reading | null, periodLabel: string, totalLabel: string): RankedPeriod | null {
  if (!total) return null;
  const totalDef = getSeries(total.seriesId);
  const totalWhole = formatSeriesUsd(total.value, totalDef?.magnitude ?? "ones").exact;

  const rows: RankedRow[] = [];
  for (const cat of categories) {
    if (!cat.reading) continue;
    const def = getSeries(cat.id);
    const { exact: valueWhole, display: exactDisplay } = formatSeriesUsd(cat.reading.value, def?.magnitude ?? "ones");
    rows.push({
      id: cat.id,
      label: cat.label,
      valueWhole,
      exactDisplay,
      scaledDisplay: formatUsdScale(valueWhole, "B", 1),
      shareDisplay: formatSharePercent(valueWhole, totalWhole, 1),
      negative: isNegativeDecimal(valueWhole),
    });
  }
  rows.sort((a, b) => compareDecimal(b.valueWhole, a.valueWhole));

  return {
    periodLabel,
    rows,
    totalWhole,
    totalDisplay: `${totalLabel}, ${periodLabel}: ${formatUsdScale(totalWhole, "B", 1)}`,
  };
}

// ---------- Act I month stepper (beat 1) ----------

export interface MonthStepperData {
  /** The month actually being shown — either the requested one (if valid) or the latest available. */
  currentPeriodEnd: string;
  currentLabel: string;
  /** The period_end to step back to, or null when already at the oldest available month (‹ disabled). */
  prevPeriodEnd: string | null;
  /** The period_end to step forward to, or null when already at the latest available month (› disabled). */
  nextPeriodEnd: string | null;
  /** How many months are steppable today — 46 on this branch's seed, growing toward the full 2015+ backfill with no code change. */
  monthCount: number;
}

/**
 * Picks the stepper's current position from the full list of months that
 * have an outlays.total reading (ascending) and whatever `?spendMonth=`
 * the URL requested. An invalid or missing request (no param, a typo'd
 * date, a month outside the ingested range) falls back to the latest
 * available month — never an error page. Returns null only when the
 * series has no monthly data ingested at all (the whole stepper is a gap).
 */
export function buildMonthStepper(availableMonthsAscending: string[], requestedPeriodEnd: string | null): MonthStepperData | null {
  if (availableMonthsAscending.length === 0) return null;
  const current = requestedPeriodEnd && availableMonthsAscending.includes(requestedPeriodEnd) ? requestedPeriodEnd : availableMonthsAscending[availableMonthsAscending.length - 1]!;
  const index = availableMonthsAscending.indexOf(current);
  return {
    currentPeriodEnd: current,
    currentLabel: formatMonthYear(current),
    prevPeriodEnd: index > 0 ? availableMonthsAscending[index - 1]! : null,
    nextPeriodEnd: index < availableMonthsAscending.length - 1 ? availableMonthsAscending[index + 1]! : null,
    monthCount: availableMonthsAscending.length,
  };
}

// ---------- click-to-expand category history panel ----------

export interface HistoryPoint {
  periodEnd: string;
  monthLabel: string;
  valueWhole: string;
  scaledDisplay: string;
}

export interface HistoryChip {
  kind: "delta" | "anchor";
  label: string;
  display: string;
}

export interface CategoryHistoryPanel {
  points: HistoryPoint[];
  chips: HistoryChip[];
}

/** True when a YYYY-MM-DD period_end falls in September — the U.S. federal
 * fiscal year's last month. Used to decide whether the oldest of a
 * category's 4 history points reads as "prior FY-end" (a real fiscal-
 * calendar fact, not a hardcoded date) rather than a generic month-over-
 * month comparison. Exported so lib/front-door-data.ts can decide, from the
 * same rule, which categories need a real fiscal_ytd lookup for that
 * anchor. */
export function isFiscalYearEndMonth(periodEnd: string): boolean {
  return periodEnd.slice(5, 7) === "09";
}

/** `(to - from) / from * 100`, explicit-signed ("+23.5%" / "−4.1%"). Reuses
 * formatSharePercent's exact BigInt division (delta as a share of `from`)
 * rather than a bespoke calculation. */
function formatSignedPercentChange(fromWhole: string, toWhole: string, decimals = 1): string {
  const delta = subtractDecimal(toWhole, fromWhole);
  const pct = formatSharePercent(delta, fromWhole, decimals);
  return pct.startsWith("−") ? pct : `+${pct}`;
}

/** Percent change when both endpoints are strictly positive (a percent
 * change across a sign flip, or from/to zero, doesn't mean anything);
 * otherwise an explicit-signed absolute dollar delta. Mirrors the approved
 * mockup's chip() rule exactly, on exact decimal strings instead of floats. */
function deltaDisplay(fromWhole: string, toWhole: string): string {
  const fromPositive = compareDecimal(fromWhole, "0") > 0;
  const toPositive = compareDecimal(toWhole, "0") > 0;
  if (fromPositive && toPositive) return formatSignedPercentChange(fromWhole, toWhole, 1);
  const delta = subtractDecimal(toWhole, fromWhole);
  const sign = compareDecimal(delta, "0") >= 0 ? "+" : "";
  return `${sign}${formatUsdScale(delta, "B", 1)}`;
}

/**
 * Builds the click-to-expand history panel for one category from its raw
 * (DB-order, chronological ascending) monthly history points. Returns null
 * when there's nothing to show at all. Every non-current point becomes a
 * vs.-current delta chip, EXCEPT the oldest point when there are exactly 4
 * points and it falls in September — the U.S. fiscal year's last month —
 * which becomes a non-delta anchor chip instead. This generalizes to
 * however many points a category actually has ingested — never assumes a
 * fixed calendar shape.
 *
 * `priorFiscalYearTotal`, when given, is the TRUE fiscal_ytd reading for
 * that same September close (the category's whole-fiscal-year total, not
 * its September MONTH figure) — the anchor chip then reads "FY{year} full
 * year" using that real total. Without it (a gap: no fiscal_ytd reading has
 * been ingested for that date), the anchor chip falls back to the
 * September MONTH figure, but labeled honestly for what it is — never
 * silently presented as a fiscal-year total (CLAUDE.md: accounting
 * concepts — here, a single month vs. the whole fiscal year they both
 * happen to share a period_end with — never mix silently).
 */
export function buildCategoryHistoryPanel(
  id: SeriesId,
  rawPoints: CategoryHistoryPoint[],
  priorFiscalYearTotal?: Reading | null,
): CategoryHistoryPanel | null {
  if (rawPoints.length === 0) return null;
  const def = getSeries(id);
  const magnitude = def?.magnitude ?? "ones";

  const points: HistoryPoint[] = rawPoints.map((p) => {
    const { exact } = formatSeriesUsd(p.value, magnitude);
    return {
      periodEnd: p.periodEnd,
      monthLabel: formatMonthYear(p.periodEnd),
      valueWhole: exact,
      scaledDisplay: formatUsdScale(exact, "B", 1),
    };
  });

  const current = points[points.length - 1]!;
  const chips: HistoryChip[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i]!;
    if (i === 0 && points.length === 4 && isFiscalYearEndMonth(p.periodEnd)) {
      if (priorFiscalYearTotal) {
        const { exact: fyWhole } = formatSeriesUsd(priorFiscalYearTotal.value, magnitude);
        const fyLabel = priorFiscalYearTotal.fiscalYear ? `FY${priorFiscalYearTotal.fiscalYear} full year` : `full fiscal year ending ${p.monthLabel}`;
        chips.push({ kind: "anchor", label: fyLabel, display: formatUsdScale(fyWhole, "B", 1) });
      } else {
        chips.push({ kind: "anchor", label: `${p.monthLabel} (prior FY's final month)`, display: p.scaledDisplay });
      }
      continue;
    }
    chips.push({ kind: "delta", label: `vs. ${p.monthLabel}`, display: deltaDisplay(p.valueWhole, current.valueWhole) });
  }

  return { points, chips };
}

// ---------- category history line chart (beat 1, "HISTORY PANELS v2") ----------

export interface HistoryLinePoint {
  periodEnd: string;
  monthLabel: string;
  valueWhole: string;
  scaledDisplay: string;
  /** Full-precision, as-published — a hover/tooltip's "exact figure" text.
   * Mirrors RankedRow.exactDisplay (ranked-bar-chart.tsx's own "(exact, as
   * published)" hover) exactly: never the fixed-billions `scaledDisplay`,
   * which a caption promising "the exact figure" would otherwise
   * misrepresent (CLAUDE.md: never make a number wrong to make it
   * friendly). */
  exactDisplay: string;
}

export interface CategoryHistoryLineSeries {
  /** Every ingested month, ascending. */
  monthly: HistoryLinePoint[];
  /** Rolling 12-month total, ascending — only entries where 12 CONSECUTIVE
   * calendar months actually exist land here; a gap in the backfill skips
   * every window that would span it (never fabricated). Can be empty when
   * fewer than 12 months exist yet at all. */
  twelveMonthTotal: HistoryLinePoint[];
}

/** `YYYY-MM-DD` -> `year*12 + month`, a whole-calendar-month index. Reused
 * (not imported) from the same shape components/ranked-bar-chart.tsx's own
 * monthIndex already uses — this file stays dependency-free of any
 * component, per its own module doc. */
function monthIndexOf(periodEnd: string): number {
  return Number(periodEnd.slice(0, 4)) * 12 + Number(periodEnd.slice(5, 7));
}

/**
 * Converts raw registry-magnitude points into HistoryLinePoint form (exact
 * decimal display via formatSeriesUsd + fixed-billions scaledDisplay) —
 * extracted from buildCategoryHistoryLineSeries below (beat 1, "HISTORY
 * PANELS v2") so lib/category-compare-transform.ts's per-category
 * conversion (the "Compare the big five" chart, spending-history-scrub) can
 * share exactly the same rule rather than re-deriving it: every category's
 * monthly figure is stamped through ONE formatSeriesUsd/formatUsdScale call
 * site, magnitude-aware, never assuming "ones" outside the two places that
 * already documented that assumption.
 */
export function buildHistoryLinePoints(rawPoints: readonly CategoryHistoryPoint[], magnitude: Magnitude): HistoryLinePoint[] {
  return rawPoints.map((p) => {
    const { exact, display } = formatSeriesUsd(p.value, magnitude);
    return {
      periodEnd: p.periodEnd,
      monthLabel: formatMonthYearShort(p.periodEnd),
      valueWhole: exact,
      scaledDisplay: formatUsdScale(exact, "B", 1),
      exactDisplay: display,
    };
  });
}

/**
 * Rolling 12-month total over an ascending, already-whole-dollar
 * HistoryLinePoint series (e.g. buildHistoryLinePoints's own output) — only
 * entries where 12 CONSECUTIVE calendar months actually exist land here; a
 * gap in the backfill skips every window that would span it (never
 * fabricated — CLAUDE.md). Extracted from buildCategoryHistoryLineSeries
 * below so lib/category-compare-transform.ts's "everything else" aggregate
 * and its per-contributor deltas (the "Compare the big five" chart) reuse
 * this EXACT gap-skipping rule rather than re-deriving it — the one thing
 * this refactor must never change is buildCategoryHistoryLineSeries's own
 * observable behavior (test/front-door-transform.test.ts's
 * buildCategoryHistoryLineSeries suite is the guard). `decimals` controls
 * exactDisplay's rounding, same as every other exact-figure display in this
 * file — pass the caller's own defaultUsdDecimals(magnitude).
 */
export function rollingTwelveMonthTotal(monthly: readonly HistoryLinePoint[], decimals: number): HistoryLinePoint[] {
  const twelveMonthTotal: HistoryLinePoint[] = [];
  for (let i = 11; i < monthly.length; i++) {
    const windowStart = monthly[i - 11]!;
    const windowEnd = monthly[i]!;
    // A gap in the backfill spans this window — skip it rather than summing
    // across months that don't actually exist (CLAUDE.md: never fabricate).
    if (monthIndexOf(windowEnd.periodEnd) - monthIndexOf(windowStart.periodEnd) !== 11) continue;
    const totalWhole = sumDecimalStrings(monthly.slice(i - 11, i + 1).map((m) => m.valueWhole));
    twelveMonthTotal.push({
      periodEnd: windowEnd.periodEnd,
      monthLabel: windowEnd.monthLabel,
      valueWhole: totalWhole,
      scaledDisplay: formatUsdScale(totalWhole, "B", 1),
      exactDisplay: formatExactUsd(totalWhole, decimals),
    });
  }
  return twelveMonthTotal;
}

/**
 * The full-history line-chart form of a category's monthly figures (beat 1,
 * "HISTORY PANELS v2"): every ingested month, plus a 12-month rolling total
 * that only starts once 12 consecutive calendar months actually exist.
 * Returns null when there are 4 or fewer points — the existing four-period
 * dot plot (components/ranked-bar-chart.tsx's HistoryPanel) handles that
 * case instead, and the caller (lib/front-door-data.ts) decides which form
 * to render from this null-ness, never both. This is exactly what makes the
 * page render correctly on today's 4-period-per-category seed AND on the
 * full MTS backfill without any code change: the moment a category's
 * ingested history grows past 4 months, this function stops returning null.
 */
export function buildCategoryHistoryLineSeries(id: SeriesId, rawPoints: CategoryHistoryPoint[]): CategoryHistoryLineSeries | null {
  if (rawPoints.length <= 4) return null;
  const def = getSeries(id);
  const magnitude = def?.magnitude ?? "ones";

  const monthly = buildHistoryLinePoints(rawPoints, magnitude);
  const twelveMonthTotal = rollingTwelveMonthTotal(monthly, defaultUsdDecimals(magnitude));

  return { monthly, twelveMonthTotal };
}

// ---------- deficit history chart (Act III, 46 months) ----------

export interface DeficitColumn {
  periodEnd: string;
  monthLabel: string;
  valueWhole: string;
  /** Unsigned "$X.XB" — the tooltip already says "deficit"/"surplus" as the direction word. */
  scaledDisplay: string;
  isDeficit: boolean;
}

export interface DeficitChart {
  columns: DeficitColumn[];
  axisLabels: string[];
  monthCount: number;
  /** A plain-language sentence naming which calendar months actually ran a
   * surplus in this window, and how many times each — computed from the
   * columns themselves, never a hardcoded seasonal claim (which calendar
   * month "reliably" runs a surplus is a real, checkable question, and the
   * checked answer changes as more months get backfilled). */
  surplusCaption: string;
}

/** Joins a list of strings as an English list: "A", "A and B", or
 * "A, B, and C" — used only for the deficit chart's data-derived caption. */
function joinWithAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/** Builds the deficit chart's seasonal caption strictly from the columns
 * actually rendered — counts how many times each calendar month ran a
 * surplus in this window and lists them, most-frequent first. Never asserts
 * which month "reliably" does anything: the sentence is just what the
 * window contains. */
function buildSurplusCaption(columns: DeficitColumn[]): string {
  const surplusColumns = columns.filter((c) => !c.isDeficit);
  if (surplusColumns.length === 0) {
    return `None of the ${columns.length} months shown ran a surplus.`;
  }
  const counts = new Map<string, number>();
  for (const c of surplusColumns) {
    const name = formatMonthName(c.periodEnd);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => `${name} (${count})`);
  return `Of the ${columns.length} months shown, ${surplusColumns.length} ran a surplus: ${joinWithAnd(parts)}.`;
}

/** Picks up to 5 roughly-evenly-spaced axis tick labels from a full ordered
 * label list — never hardcodes which months those land on, so the axis
 * self-adjusts as more months are backfilled. */
function pickAxisLabels(labels: string[]): string[] {
  if (labels.length <= 5) return labels;
  const lastIdx = labels.length - 1;
  const idxs = [0, Math.round(lastIdx * 0.25), Math.round(lastIdx * 0.5), Math.round(lastIdx * 0.75), lastIdx];
  const seen = new Set<number>();
  const result: string[] = [];
  for (const i of idxs) {
    if (seen.has(i)) continue;
    seen.add(i);
    result.push(labels[i]!);
  }
  return result;
}

export function buildDeficitChart(readings: Reading[]): DeficitChart | null {
  if (readings.length === 0) return null;
  const def = getSeries("fiscal.mts.deficit.total" as SeriesId);
  const magnitude = def?.magnitude ?? "ones";
  const columns: DeficitColumn[] = readings.map((r) => {
    const { exact } = formatSeriesUsd(r.value, magnitude);
    return {
      periodEnd: r.periodEnd,
      monthLabel: formatMonthYearShort(r.periodEnd),
      valueWhole: exact,
      scaledDisplay: formatUsdScale(absDecimal(exact), "B", 1),
      isDeficit: compareDecimal(exact, "0") < 0,
    };
  });
  return {
    columns,
    axisLabels: pickAxisLabels(columns.map((c) => c.monthLabel)),
    monthCount: columns.length,
    surplusCaption: buildSurplusCaption(columns),
  };
}

// ---------- Act III bridge (outlays / receipts / borrowing) ----------

export interface BridgeData {
  outlaysWhole: string;
  receiptsWhole: string;
  /** Signed exact decimal: outlays minus receipts. Positive = a deficit
   * (outlays exceeded receipts, financed by borrowing); negative = a
   * surplus (receipts exceeded outlays); "0" = balanced. Never assumed
   * positive — a fiscal-year-to-date period can run either way. */
  gapWhole: string;
  outlaysDisplay: string;
  receiptsDisplay: string;
  /** Unsigned "$X.XB" — the gap's magnitude; `direction` says which way. */
  gapDisplay: string;
  direction: "deficit" | "surplus" | "balanced";
  /** Cosmetic pixel-proportion only (0-100), never a displayed figure: the
   * smaller of outlays/receipts, as a share of the larger of the two —
   * always in [0, 100], whichever direction the gap runs. */
  smallerPercentOfLarger: number;
  /** Cosmetic pixel-proportion only (0-100), never a displayed figure: the
   * gap itself, as a share of the larger of outlays/receipts — always in
   * [0, 100] (never negative, unlike a naive receipts/outlays ratio would
   * produce for a surplus period). */
  gapPercentOfLarger: number;
  debtTrillionsDisplay: string;
  /** The debt reading's own as-of date — CLAUDE.md: every displayed number
   * carries source, as-of date, and unit; the debt figure here is a stock
   * measured on a specific day, not the same as-of date as the FYTD
   * outlays/receipts flow figures beside it. */
  debtAsOfDisplay: string;
}

/**
 * Builds the Act III bridge (outlays vs. receipts vs. the deficit/surplus
 * gap). `outlays`/`receipts` are the fiscal-year-to-date totals — the
 * bridge is always FYTD, regardless of which period the ranked charts above
 * are currently toggled to (matches the approved mockup's narrative:
 * "Through July, the government spent $X and collected $Y"). Returns null
 * when either total, or the debt reading, is a gap.
 *
 * Never assumes outlays > receipts: `direction` is derived from the sign of
 * the gap the same way the topline strip's own borrowed/surplus cell is
 * (see buildBorrowedCell below), and the two cosmetic
 * percentages are built from Math.abs/Math.min/Math.max so they are always
 * in [0, 100] — a receipts-exceeded-outlays period never produces a
 * negative CSS width.
 */
export function buildBridge(outlaysTotal: Reading | null, receiptsTotal: Reading | null, debt: Reading | null): BridgeData | null {
  if (!outlaysTotal || !receiptsTotal || !debt) return null;
  const outlaysDef = getSeries(outlaysTotal.seriesId);
  const receiptsDef = getSeries(receiptsTotal.seriesId);
  const debtDef = getSeries(debt.seriesId);
  const outlaysWhole = formatSeriesUsd(outlaysTotal.value, outlaysDef?.magnitude ?? "ones").exact;
  const receiptsWhole = formatSeriesUsd(receiptsTotal.value, receiptsDef?.magnitude ?? "ones").exact;
  const debtWhole = formatSeriesUsd(debt.value, debtDef?.magnitude ?? "ones").exact;
  const gapWhole = subtractDecimal(outlaysWhole, receiptsWhole);
  const direction: BridgeData["direction"] = isNegativeDecimal(gapWhole) ? "surplus" : compareDecimal(gapWhole, "0") > 0 ? "deficit" : "balanced";

  // Cosmetic layout only — Number() on already-exact whole-dollar strings,
  // per packages/viz/src/money/decimal.ts's documented exception. Built from
  // abs/min/max, not a fixed outlays-is-the-denominator ratio, so this never
  // goes negative regardless of which of outlays/receipts is larger.
  const outlaysN = Number(outlaysWhole);
  const receiptsN = Number(receiptsWhole);
  const largerN = Math.max(outlaysN, receiptsN);
  const smallerPercentOfLarger = largerN === 0 ? 0 : (Math.min(outlaysN, receiptsN) / largerN) * 100;
  const gapPercentOfLarger = largerN === 0 ? 0 : (Math.abs(Number(gapWhole)) / largerN) * 100;

  const trillions = formatUsdScale(debtWhole, "T", 2).replace(/T$/, " trillion");

  return {
    outlaysWhole,
    receiptsWhole,
    gapWhole,
    outlaysDisplay: formatUsdScale(outlaysWhole, "B", 1),
    receiptsDisplay: formatUsdScale(receiptsWhole, "B", 1),
    gapDisplay: formatUsdScale(absDecimal(gapWhole), "B", 1),
    direction,
    smallerPercentOfLarger,
    gapPercentOfLarger,
    debtTrillionsDisplay: trillions,
    debtAsOfDisplay: formatDateShort(debt.periodEnd),
  };
}

// ---------- front-door topline strip (spending / revenue / borrowed) ----------
// The dek promises "where federal money goes, where it comes from, and how
// the difference is borrowed" — these three cells answer exactly that, in
// exactly that order, each pairing Treasury's OBSERVED fiscal-year-to-date
// figure with CBO's PROJECTED full-year figure, side by side, never blended
// (CLAUDE.md: accounting concepts never mix silently — observed vs.
// projection is always a labeled pairing here, never a single number).

export interface ToplineCell {
  /** e.g. "Spending, FY 2026" — never asserts a direction the observed
   * reading doesn't actually have (see buildBorrowedCell). */
  label: string;
  /** e.g. "$6,284.2B so far" — null is a real gap (no MTS report ingested
   * yet for this fiscal year), never a "$0". */
  observedDisplay: string | null;
  /** e.g. "Monthly Treasury Statement · through July" — always present,
   * even for a gap (then it names what's missing instead). */
  observedSourceLine: string;
  /** e.g. "CBO projected $7,448.6B for the full year (Feb 2026 baseline)" —
   * carries the projection's own vintage inline, per CLAUDE.md's "every
   * displayed number carries source, as-of date, and unit." Null is a real
   * gap (the projection series has no reading in the DB yet) — the caller
   * renders a graceful fallback line, never a fabricated figure. */
  projectedLine: string | null;
  href: string;
}

const TOPLINE_HREF = "/now";

/** The vintage a CBO projection reading carries — "Feb 2026", read from the
 * reading's own publicationTime (CBO's real release date, not today).
 * publicationTime is already a fixed ISO string (lib/types.ts) — slicing its
 * own digits is not a `Date` round-trip, just reading the calendar date it
 * already encodes. */
function projectionVintageLabel(reading: Reading): string {
  return formatMonthYearShort(reading.publicationTime.slice(0, 10));
}

/** A CBO projection reading -> its whole-dollar exact decimal string, at
 * its own registry-declared magnitude (billions) — never assumed, always
 * read off getSeries so a magnitude typo in the registry would break this
 * loudly rather than silently mis-scale the figure. */
function projectionWhole(reading: Reading): string {
  const def = getSeries(reading.seriesId);
  return formatSeriesUsd(reading.value, def?.magnitude ?? "billions").exact;
}

function gapToplineCell(label: string): ToplineCell {
  return {
    label,
    observedDisplay: null,
    observedSourceLine: "Monthly Treasury Statement — not yet ingested.",
    projectedLine: null,
    href: TOPLINE_HREF,
  };
}

/** "Spending, FY 2026" — FYTD outlays vs. CBO's projected full-year outlays. */
function buildSpendingCell(outlaysFytd: Reading | null, outlaysProjection: Reading | null): ToplineCell {
  if (!outlaysFytd) return gapToplineCell("Spending, fiscal year to date");
  const def = getSeries(outlaysFytd.seriesId);
  const whole = formatSeriesUsd(outlaysFytd.value, def?.magnitude ?? "ones").exact;
  return {
    label: `Spending, FY ${outlaysFytd.fiscalYear ?? ""}`,
    observedDisplay: `${formatUsdScale(whole, "B", 1)} so far`,
    observedSourceLine: `Monthly Treasury Statement · through ${formatMonthName(outlaysFytd.periodEnd)}`,
    projectedLine: outlaysProjection
      ? `CBO projected ${formatUsdScale(projectionWhole(outlaysProjection), "B", 1)} for the full year (${projectionVintageLabel(outlaysProjection)} baseline)`
      : null,
    href: TOPLINE_HREF,
  };
}

/** "Revenue, FY 2026" — FYTD receipts vs. CBO's projected full-year revenues. */
function buildRevenueCell(receiptsFytd: Reading | null, receiptsProjection: Reading | null): ToplineCell {
  if (!receiptsFytd) return gapToplineCell("Revenue, fiscal year to date");
  const def = getSeries(receiptsFytd.seriesId);
  const whole = formatSeriesUsd(receiptsFytd.value, def?.magnitude ?? "ones").exact;
  return {
    label: `Revenue, FY ${receiptsFytd.fiscalYear ?? ""}`,
    observedDisplay: `${formatUsdScale(whole, "B", 1)} so far`,
    observedSourceLine: `Monthly Treasury Statement · through ${formatMonthName(receiptsFytd.periodEnd)}`,
    projectedLine: receiptsProjection
      ? `CBO projected ${formatUsdScale(projectionWhole(receiptsProjection), "B", 1)} for the full year (${projectionVintageLabel(receiptsProjection)} baseline)`
      : null,
    href: TOPLINE_HREF,
  };
}

/**
 * "Borrowed to cover the gap, FY 2026" — FYTD deficit vs. CBO's projected
 * full-year deficit, sign-neutral (the same direction-aware wording the
 * standalone deficit hero cell already learned: never call a surplus period
 * "borrowed"). The observed and projected directions are derived
 * independently from their OWN reading's sign — never one assumed from the
 * other, since they are different accounting concepts (CLAUDE.md).
 */
function buildBorrowedCell(deficitFytd: Reading | null, deficitProjection: Reading | null): ToplineCell {
  if (!deficitFytd) return gapToplineCell("Borrowed to cover the gap, fiscal year to date");
  const def = getSeries(deficitFytd.seriesId);
  const whole = formatSeriesUsd(deficitFytd.value, def?.magnitude ?? "ones").exact;
  const fy = deficitFytd.fiscalYear ?? "";
  const isDeficit = isNegativeDecimal(whole);
  const isSurplus = !isDeficit && compareDecimal(whole, "0") > 0;
  const label = isDeficit ? `Borrowed to cover the gap, FY ${fy}` : isSurplus ? `Surplus, FY ${fy} so far` : `Balanced, FY ${fy} so far`;
  const observedDisplay = isDeficit
    ? `${formatUsdScale(absDecimal(whole), "B", 1)} borrowed so far`
    : isSurplus
      ? `${formatUsdScale(absDecimal(whole), "B", 1)} left over so far`
      : "Nothing borrowed so far";
  const projectedLine = deficitProjection
    ? (() => {
        const projWhole = projectionWhole(deficitProjection);
        const projDeficit = isNegativeDecimal(projWhole);
        const verb = projDeficit ? "borrowed" : "left over";
        return `CBO projected ${formatUsdScale(absDecimal(projWhole), "B", 1)} ${verb} for the full year (${projectionVintageLabel(deficitProjection)} baseline)`;
      })()
    : null;
  return {
    label,
    observedDisplay,
    observedSourceLine: `Monthly Treasury Statement · through ${formatMonthName(deficitFytd.periodEnd)}`,
    projectedLine,
    href: TOPLINE_HREF,
  };
}

/**
 * The front door's three topline cells, in the dek's own order: spending,
 * revenue, then the borrowed gap. Each `*Projection` reading is the SAME
 * fiscal year as its observed sibling (the caller looks it up by that exact
 * fiscal year — see lib/front-door-data.ts) — never just "whatever CBO
 * fiscal year happens to be latest," which would silently pair this year's
 * observed figure against a different year's projection.
 */
export function buildToplineCells(
  outlaysFytd: Reading | null,
  outlaysProjection: Reading | null,
  receiptsFytd: Reading | null,
  receiptsProjection: Reading | null,
  deficitFytd: Reading | null,
  deficitProjection: Reading | null,
): ToplineCell[] {
  return [
    buildSpendingCell(outlaysFytd, outlaysProjection),
    buildRevenueCell(receiptsFytd, receiptsProjection),
    buildBorrowedCell(deficitFytd, deficitProjection),
  ];
}

// ---------- "for scale" facts ----------

export interface ForScaleFact {
  valueDisplay: string;
  label: string;
  sourceLine: string;
}

/** A census reading, reduced to its whole-unit exact decimal string (magnitude
 * already applied) — or null when the series doesn't exist yet in the
 * registry, or exists but has no observation ingested yet. Both cases are
 * the same "gap" from a caller's point of view. */
function censusWhole(reading: Reading | null): string | null {
  if (!reading) return null;
  const def = getSeries(reading.seriesId);
  return formatSeriesUsd(reading.value, def?.magnitude ?? "ones").exact;
}

/** A census reading's own as-of date, in the shape the reading's period_type
 * actually carries — the full day for a Vintage population estimate
 * (period_type "day"), just the year for an annual households estimate
 * (period_type "year"). Every reader-facing use of a census "for scale"
 * fact must name this vintage (per the registry's own note on both census
 * series) — never present it as an exact, undated enumeration. */
function censusAsOf(reading: Reading): string {
  return reading.periodType === "day" ? formatDateShort(reading.periodEnd) : reading.periodEnd.slice(0, 4);
}

/** An MTS reading's own as-of phrase — "FY{year} through {month}" for a
 * fiscal_ytd reading, the bare month+year for a month reading. Shared by
 * every "for scale" fact below so an MTS-derived figure never appears
 * without naming which period it covers (CLAUDE.md: every displayed number
 * carries source, as-of date, and unit). */
function mtsAsOf(reading: Reading): string {
  return reading.periodType === "fiscal_ytd" ? `FY${reading.fiscalYear ?? ""} through ${formatMonthName(reading.periodEnd)}` : formatMonthYear(reading.periodEnd);
}

/** "≈ $47,500 spent per U.S. household so far this fiscal year." */
export function buildPerHouseholdSpendFact(outlaysFytd: Reading | null, households: Reading | null): ForScaleFact | null {
  if (!outlaysFytd || !households) return null;
  const householdsWhole = censusWhole(households);
  if (householdsWhole === null) return null;
  const outlaysDef = getSeries(outlaysFytd.seriesId);
  const outlaysWhole = formatSeriesUsd(outlaysFytd.value, outlaysDef?.magnitude ?? "ones").exact;
  const rounded = roundToSignificantFigures(divideDecimalStrings(outlaysWhole, householdsWhole, 0), 3);
  return {
    valueDisplay: `≈ ${formatExactUsd(rounded, 0)}`,
    label: "spent per U.S. household so far this fiscal year",
    sourceLine: `${formatUsdScale(outlaysWhole, "B", 1)}, ${mtsAsOf(outlaysFytd)} ÷ ${formatCountScale(householdsWhole, "M", 1)} households (Census Bureau, ${censusAsOf(households)} estimate)`,
  };
}

/** "39¢ per $1 of individual income tax receipts went to interest on the
 * debt." Never depends on Census — both series are MTS categories. Both
 * readings are the same (period_type, period_end) — the front door always
 * calls this with the fiscal-year-to-date pair — so mtsAsOf(netInterest)
 * describes both. */
export function buildInterestPerTaxDollarFact(netInterest: Reading | null, individualIncomeTax: Reading | null): ForScaleFact | null {
  if (!netInterest || !individualIncomeTax) return null;
  const interestDef = getSeries(netInterest.seriesId);
  const taxDef = getSeries(individualIncomeTax.seriesId);
  const interestWhole = formatSeriesUsd(netInterest.value, interestDef?.magnitude ?? "ones").exact;
  const taxWhole = formatSeriesUsd(individualIncomeTax.value, taxDef?.magnitude ?? "ones").exact;
  // cents per dollar = (interest / tax) * 100 = shiftDecimalRight(interest, 2) / tax,
  // rounded to the nearest whole cent — exact throughout, no float.
  const cents = divideDecimalStrings(shiftDecimalRight(interestWhole, 2), taxWhole, 0);
  return {
    valueDisplay: `${cents}¢ per $1`,
    label: "of individual income tax receipts went to interest on the debt",
    sourceLine: `Net interest ${formatUsdScale(interestWhole, "B", 1)} ÷ individual income taxes ${formatUsdScale(taxWhole, "B", 1)}, ${mtsAsOf(netInterest)} (MTS)`,
  };
}

/** "≈ $303,000 of federal debt per U.S. household." */
export function buildDebtPerHouseholdFact(debt: Reading | null, households: Reading | null): ForScaleFact | null {
  if (!debt || !households) return null;
  const householdsWhole = censusWhole(households);
  if (householdsWhole === null) return null;
  const debtDef = getSeries(debt.seriesId);
  const debtWhole = formatSeriesUsd(debt.value, debtDef?.magnitude ?? "ones").exact;
  const rounded = roundToSignificantFigures(divideDecimalStrings(debtWhole, householdsWhole, 0), 3);
  return {
    valueDisplay: `≈ ${formatExactUsd(rounded, 0)}`,
    label: "of federal debt per U.S. household",
    sourceLine: `${formatUsdScale(debtWhole, "T", 2)} (${formatDateShort(debt.periodEnd)}) ÷ ${formatCountScale(householdsWhole, "M", 1)} households (Census Bureau, ${censusAsOf(households)} estimate)`,
  };
}

/** "≈ $117,000 of federal debt per U.S. resident." */
export function buildDebtPerResidentFact(debt: Reading | null, population: Reading | null): ForScaleFact | null {
  if (!debt || !population) return null;
  const populationWhole = censusWhole(population);
  if (populationWhole === null) return null;
  const debtDef = getSeries(debt.seriesId);
  const debtWhole = formatSeriesUsd(debt.value, debtDef?.magnitude ?? "ones").exact;
  const rounded = roundToSignificantFigures(divideDecimalStrings(debtWhole, populationWhole, 0), 3);
  return {
    valueDisplay: `≈ ${formatExactUsd(rounded, 0)}`,
    label: "of federal debt per U.S. resident",
    sourceLine: `${formatUsdScale(debtWhole, "T", 2)} (${formatDateShort(debt.periodEnd)}) ÷ ${formatCountScale(populationWhole, "M", 1)} people (Census Bureau, ${censusAsOf(population)} estimate)`,
  };
}
