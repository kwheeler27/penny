/**
 * Pure transform behind the front door's "Compare the big five" chart (Act
 * I only, spending-history-scrub): the five fixed outlay categories
 * (Medicare, Social Security, Net interest, National defense, Health) plus
 * an "everything else" aggregate — the per-month sum of every OTHER
 * published fiscal.mts.outlays.category.* series, including the negative
 * undistributed_offsetting_receipts (a real published figure, not a
 * different accounting concept — CLAUDE.md's "never mix silently" rule is
 * about concepts like outlays-vs-obligations, not about a category's own
 * sign) — each expressed as a rolling 12-month total, plus the
 * server-computed spike annotation. Kept separate from
 * app/api/category-compare/route.ts's DB orchestration so every rule here
 * is unit-testable against a hand-built fixture, no database involved —
 * the same split lib/front-door-transform.ts already uses.
 *
 * Reuses lib/front-door-transform.ts's buildHistoryLinePoints (the
 * magnitude-aware raw->whole-dollar conversion) and rollingTwelveMonthTotal
 * (the gap-skipping rolling-window rule) rather than re-deriving either —
 * see that file's own doc comments on why those two were extracted.
 *
 * Every whole-dollar sum here is exact decimal-string arithmetic
 * (lib/format.ts, BigInt-backed) — Number()/parseFloat never touches a
 * value that is asserted to be exact, matching this app's whole-repo
 * convention (packages/viz/src/money/decimal.ts's documented exception is
 * for cosmetic pixel geometry only, never a sum like this one).
 */
import type { Magnitude, SeriesId } from "@penny/registry";
import { buildHistoryLinePoints, rollingTwelveMonthTotal, type HistoryLinePoint } from "./front-door-transform";
import {
  compareDecimalStrings as compareDecimal,
  defaultUsdDecimals,
  formatExactUsd,
  formatMonthYearShort,
  formatSharePercent,
  formatUsdScale,
  magnitudePlaces,
  shiftDecimalRight,
  subtractDecimalStrings as subtractDecimal,
  sumDecimalStrings,
} from "./format";
import type { CategoryHistoryPoint } from "./series-data";

/** One category's raw monthly readings, as the route assembles them from
 * getFullCategoryMonthlyHistory + a registry lookup — the input shape both
 * buildCategoryCompareData's `fixed` and `other` arrays share. */
export interface CompareCategoryInput {
  readonly id: SeriesId;
  readonly label: string;
  readonly magnitude: Magnitude;
  readonly rawPoints: readonly CategoryHistoryPoint[];
}

/** One rendered series' worth of output — the shape apps/web maps into
 * @penny/viz's CategoryCompareChart `points` prop (periodEnd/valueWhole/
 * display/scaledDisplay/label, same HistoryChartPoint shape HistoryPanelV2
 * already builds from HistoryLinePoint). Only the rolling 12-month total is
 * exposed — Frame B's whole chart is a 12-month-total comparison, never the
 * raw monthly figures (those stay Frame A's job). */
export interface CompareSeriesResult {
  readonly id: string;
  readonly label: string;
  readonly twelveMonthTotal: readonly HistoryLinePoint[];
}

export interface CompareAnnotation {
  /** The "everything else" 12-month total's peak month — the point
   * @penny/viz's CategoryCompareChart anchors its ring marker/leader line
   * to. */
  readonly anchorPeriodEnd: string;
  readonly title: string;
  readonly body: readonly string[];
  /** A plain-language label for the peak's own 12-month window's calendar
   * span — "2020–21" when the window crosses a year boundary, a bare year
   * ("2021") when it doesn't — computed from `anchorPeriodEnd`, never
   * hardcoded. Exposed separately from `title` (which may or may not use
   * this same wording — see `title`'s own construction) so a caller that
   * wants to name the annotated PERIOD in its own sentence (e.g. the
   * CBO-attribution caption in components/ranked-bar-chart.tsx, which needs
   * to say something more specific than "this period") has an honest,
   * data-derived phrase to use instead of vague deixis. */
  readonly windowLabel: string;
}

export interface CategoryCompareResult {
  /** Exactly `fixed.length + 1` entries, in `fixed`'s own order, with the
   * "everything else" aggregate (REST_SERIES_ID) always last. */
  readonly series: readonly CompareSeriesResult[];
  /** Null whenever there is nothing to annotate — no "everything else" data
   * at all, no reading at the baseline comparison month, or the series
   * never actually exceeds its own baseline month (never a fabricated
   * "spike" story). */
  readonly annotation: CompareAnnotation | null;
}

/** The synthetic id/label for the "everything else" aggregate series — not
 * a real @penny/registry series id (it is a sum across many), so it is
 * typed as a plain string everywhere it appears, never cast to SeriesId. */
export const REST_SERIES_ID = "rest";
export const REST_SERIES_LABEL = "Everything else";

/**
 * The annotation's fixed comparison anchor: the 12-month total for the
 * window ending December 2019 — the last full pre-pandemic-relief window,
 * Kevin's approved-mockup framing ("Frame B", rev 2). A deliberate design
 * choice (which baseline month tells this story), not a statistic pulled
 * from the data — every FIGURE the annotation states is still computed
 * from the data below, never hardcoded.
 */
export const COMPARE_BASELINE_PERIOD_END = "2019-12-31";

/** `YYYY-MM-DD` -> `year*12 + month`, a whole-calendar-month index — same
 * shape lib/front-door-transform.ts's own (unexported) monthIndexOf uses;
 * duplicated locally rather than imported, matching that file's own
 * documented convention of keeping this tiny pure helper dependency-free
 * per module rather than sharing one import across unrelated files. */
function monthIndexOf(periodEnd: string): number {
  return Number(periodEnd.slice(0, 4)) * 12 + Number(periodEnd.slice(5, 7));
}

/** The calendar year a whole-calendar-month index falls in (inverse of
 * `monthIndexOf(periodEnd) = year*12 + month`, month in 1..12). */
function yearOfMonthIndex(idx: number): number {
  return Math.floor((idx - 1) / 12);
}

/** Every category's raw points, converted to whole-dollar decimal strings
 * keyed by periodEnd — the magnitude conversion happens here, ONCE, before
 * any cross-category sum (CLAUDE.md: never sum across mixed magnitudes). */
function wholeDollarsByPeriod(input: CompareCategoryInput): Map<string, string> {
  const places = magnitudePlaces(input.magnitude);
  const out = new Map<string, string>();
  for (const p of input.rawPoints) out.set(p.periodEnd, shiftDecimalRight(p.value, places));
  return out;
}

/**
 * The "everything else" monthly aggregate: for every calendar month, the
 * exact sum of every PARTICIPATING `other` category's reading that month —
 * but only when EVERY participating category actually has a reading that
 * month. Two tiers, deliberately different:
 *
 *  - A category with NO observations ingested at all (`rawPoints.length ===
 *    0`) never participates at all — it never blocks a month and never
 *    joins the sum, full stop. This is the ordinary state for most budget
 *    functions until their own backfill lands (the real seeded database
 *    has ~14 "other" categories and only a handful ingested so far), and
 *    CLAUDE.md's "a gap, never blocking" rule is exactly what makes that
 *    safe: if "not yet ingested at all" blocked the whole aggregate, the
 *    chart would show nothing until every last budget function existed in
 *    the database.
 *  - A category that HAS at least one reading somewhere, but is missing a
 *    reading for THIS SPECIFIC month while another participating category
 *    has one, is a genuine gap in ITS OWN backfill (CLAUDE.md: missing data
 *    is a gap, never a zero) — rather than silently omitting just that
 *    category's contribution (which would understate the sum while still
 *    emitting the month as if it were complete), the WHOLE month is
 *    skipped, matching how rollingTwelveMonthTotal (front-door-transform.ts)
 *    already skips any 12-month WINDOW that spans a gap — the same rule,
 *    one level down, applied per month instead of per window.
 *
 * On today's data this changes nothing either way (every seeded
 * fiscal.mts.outlays.category.* series that HAS any data at all shares the
 * identical 137-month period set), but it stops a future partial backfill
 * from silently understating the aggregate without also blocking the whole
 * chart on categories that simply haven't started yet. Ascending by
 * periodEnd (plain YYYY-MM-DD string sort is chronological order for this
 * format).
 */
function buildRestMonthly(other: readonly CompareCategoryInput[]): HistoryLinePoint[] {
  const participating = other.filter((c) => c.rawPoints.length > 0);
  const perCategory = participating.map(wholeDollarsByPeriod);
  const periods = new Set<string>();
  for (const m of perCategory) for (const periodEnd of m.keys()) periods.add(periodEnd);

  const points: HistoryLinePoint[] = [];
  for (const periodEnd of [...periods].sort()) {
    const values = perCategory.map((m) => m.get(periodEnd));
    if (values.some((v) => v === undefined)) continue; // a gap for at least one PARTICIPATING category — skip the whole month, never partially sum it.
    const sum = sumDecimalStrings(values as string[]);
    points.push({
      periodEnd,
      monthLabel: formatMonthYearShort(periodEnd),
      valueWhole: sum,
      scaledDisplay: formatUsdScale(sum, "B", 1),
      // Every outlay category is registered at magnitude "ones" today (a
      // whole-dollar-and-cents figure), so the aggregate is too —
      // defaultUsdDecimals("ones") = 2, matching every other exact-figure
      // display in this app.
      exactDisplay: formatExactUsd(sum, defaultUsdDecimals("ones")),
    });
  }
  return points;
}

function buildFixedSeries(fixed: readonly CompareCategoryInput[]): CompareSeriesResult[] {
  return fixed.map((c) => {
    const monthly = buildHistoryLinePoints(c.rawPoints, c.magnitude);
    const twelveMonthTotal = rollingTwelveMonthTotal(monthly, defaultUsdDecimals(c.magnitude));
    return { id: c.id, label: c.label, twelveMonthTotal };
  });
}

function buildOtherSeries(other: readonly CompareCategoryInput[]): CompareSeriesResult[] {
  return other.map((c) => {
    const monthly = buildHistoryLinePoints(c.rawPoints, c.magnitude);
    const twelveMonthTotal = rollingTwelveMonthTotal(monthly, defaultUsdDecimals(c.magnitude));
    return { id: c.id, label: c.label, twelveMonthTotal };
  });
}

/**
 * Whether `restTotal` has come back down MATERIALLY since its own peak — the
 * dividing line between a genuine "spike" (a hump the series has since
 * receded from) and a series whose peak is simply its own latest, still-
 * rising reading. A monotonically climbing series (nominal federal spending
 * trends up over the long run) always has its peak at the newest point —
 * calling that a "spike" would assert a shape the line itself doesn't show
 * (CLAUDE.md: neutral register, no editorial color; a claim like this must
 * be true of the data, not just a superlative applied to whatever happens
 * to be the maximum). "Materially" is a real decline of at least 10% off
 * the peak, by the series' own latest reading — an arbitrary but STATED
 * threshold, never a hidden one. Exact decimal-string arithmetic
 * throughout, matching every other decision in this file: `decline * 10 >=
 * peak` is the same comparison as `decline / peak >= 0.10` without ever
 * dividing.
 */
function hasReceededFromPeak(peak: HistoryLinePoint, restTotal: readonly HistoryLinePoint[]): boolean {
  const latest = restTotal[restTotal.length - 1]!;
  if (latest.periodEnd === peak.periodEnd) return false; // the peak IS the latest reading — still climbing (or flat), not a spike that has receded.
  if (compareDecimal(peak.valueWhole, "0") <= 0) return false;
  const decline = subtractDecimal(peak.valueWhole, latest.valueWhole);
  if (compareDecimal(decline, "0") <= 0) return false; // never actually declined
  return compareDecimal(shiftDecimalRight(decline, 1), peak.valueWhole) >= 0;
}

/**
 * The on-chart annotation: the "everything else" 12-month total's own
 * global PEAK, its delta against the COMPARE_BASELINE_PERIOD_END window,
 * and the top two `other` categories by (their own 12-month total at the
 * peak month minus at the baseline month) — the functions that contributed
 * most to the increase. Every figure is computed from `restTotal`/
 * `otherSeries` — nothing here is a literal statistic. Returns null when
 * there is nothing honest to say: no baseline reading, or the peak never
 * actually exceeds the baseline (never a fabricated "spike").
 */
function buildAnnotation(restTotal: readonly HistoryLinePoint[], otherSeries: readonly CompareSeriesResult[]): CompareAnnotation | null {
  if (restTotal.length === 0) return null;
  const baseline = restTotal.find((p) => p.periodEnd === COMPARE_BASELINE_PERIOD_END);
  if (!baseline) return null;

  let peak = restTotal[0]!;
  for (const p of restTotal) {
    if (compareDecimal(p.valueWhole, peak.valueWhole) > 0) peak = p;
  }
  if (compareDecimal(peak.valueWhole, baseline.valueWhole) <= 0) return null;

  const delta = subtractDecimal(peak.valueWhole, baseline.valueWhole);

  const contributors = otherSeries
    .map((s) => {
      const atPeak = s.twelveMonthTotal.find((p) => p.periodEnd === peak.periodEnd);
      const atBaseline = s.twelveMonthTotal.find((p) => p.periodEnd === baseline.periodEnd);
      // A category missing its own 12-month total at either month (too
      // little backfill for a rolling window there) is left OUT of the
      // ranking entirely — never treated as a zero delta.
      if (!atPeak || !atBaseline) return null;
      return { label: s.label, delta: subtractDecimal(atPeak.valueWhole, atBaseline.valueWhole) };
    })
    .filter((c): c is { label: string; delta: string } => c !== null && compareDecimal(c.delta, "0") > 0)
    .sort((a, b) => -compareDecimal(a.delta, b.delta))
    .slice(0, 2);

  // The peak's own 12-month WINDOW spans the peak month and the 11 before
  // it — deriving "2020–21"-style copy from those two calendar years (never
  // a hardcoded year) is what lets `windowLabel`/`title` read like the
  // approved mockup's without literally hardcoding which years it names.
  const startYear = yearOfMonthIndex(monthIndexOf(peak.periodEnd) - 11);
  const endYear = yearOfMonthIndex(monthIndexOf(peak.periodEnd));
  const windowLabel = startYear === endYear ? String(endYear) : `${startYear}–${String(endYear).slice(-2)}`;

  // "Spike" is only ever said when the data has actually come back down
  // from the peak (see hasReceededFromPeak's own doc comment) — otherwise
  // this states the one thing that's always true of `peak` by construction
  // (it IS the series' own highest reading), never an unverified shape
  // claim.
  const title = hasReceededFromPeak(peak, restTotal)
    ? `The ${windowLabel} spike — ${peak.monthLabel} peak: ${peak.scaledDisplay}`
    : `Highest 12-month total: ${peak.monthLabel}, ${peak.scaledDisplay}`;

  // One contributor per body LINE, plus its own closing line — never all of
  // them joined into a single sentence. @penny/viz's CategoryCompareChart
  // renders each body line at a fixed anchor, right-aligned, growing purely
  // LEFTWARD (see its own doc comment: "already composed by the caller");
  // a real-browser measurement (getBBox()) against the actual anchor
  // position (the peak month, which can land close to the chart's own left
  // edge) showed the joined one-line form ("Income security (+$1,459.9B)
  // and Commerce and housing credit (+$762.7B) accounted for most of the
  // increase.") running off the chart's left edge entirely — visibly
  // clipped in a real screenshot. The approved mockup's own hand-written
  // copy already split this same content across several short lines for
  // exactly this reason; this mirrors that budget generically, for however
  // many (0, 1, or 2) contributors real data produces, rather than
  // hardcoding the mockup's own literal line breaks.
  const body: string[] = [`Up ${formatUsdScale(delta, "B", 1)} vs the 12 months ending ${baseline.monthLabel}.`];
  contributors.forEach((c, i) => {
    const suffix = i < contributors.length - 1 ? " and" : "";
    body.push(`${c.label} (+${formatUsdScale(c.delta, "B", 1)})${suffix}`);
  });
  // The closing line states the top contributors' own computed SHARE of
  // the increase, exactly, rather than an adjective ("accounted for most
  // of the increase") that nothing here actually verified — CLAUDE.md:
  // every factual claim carries a citation to a primary source, and every
  // sentence survives being read aloud by any party it describes. A
  // spread-out increase (no two categories anywhere near a majority) now
  // reads as a true, if less dramatic, number instead of an overstatement.
  if (contributors.length > 0) {
    const contributorSum = sumDecimalStrings(contributors.map((c) => c.delta));
    const share = formatSharePercent(contributorSum, delta, 0);
    body.push(contributors.length === 1 ? `${share} of the increase.` : `Together, ${share} of the increase.`);
  }

  return { anchorPeriodEnd: peak.periodEnd, title, body, windowLabel };
}

/**
 * Assembles the full "Compare the big five" payload from the raw monthly
 * readings of the five fixed categories plus every OTHER outlay category
 * (the caller's job to draw that split — see app/api/category-compare/
 * route.ts). `fixed`'s own order is preserved in the output's `series`
 * array, with the "everything else" aggregate always appended last.
 */
export function buildCategoryCompareData(fixed: readonly CompareCategoryInput[], other: readonly CompareCategoryInput[]): CategoryCompareResult {
  const fixedSeries = buildFixedSeries(fixed);
  const restMonthly = buildRestMonthly(other);
  const restTwelveMonthTotal = rollingTwelveMonthTotal(restMonthly, defaultUsdDecimals("ones"));
  const otherSeries = buildOtherSeries(other);
  const annotation = buildAnnotation(restTwelveMonthTotal, otherSeries);

  return {
    series: [...fixedSeries, { id: REST_SERIES_ID, label: REST_SERIES_LABEL, twelveMonthTotal: restTwelveMonthTotal }],
    annotation,
  };
}
