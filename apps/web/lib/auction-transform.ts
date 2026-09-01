/**
 * Pure business logic for the auction page (beat 4) — no database, no React,
 * every function unit-tested directly against hand-built fixtures (mirrors
 * lib/front-door-transform.ts's own convention: the impure orchestration
 * layer, lib/auctions-data.ts, does nothing but call @penny/db and hand
 * results here). Every dollar/rate figure stays an exact decimal STRING
 * until the final display-string step — never coerced through a JS `number`
 * except where lib/format.ts's own documented cosmetic-pixel exception
 * already applies (a chart's y-position, an axis tick).
 */
import { daysBetween } from "./calendar";
import {
  compareDecimalStrings,
  divideDecimalStrings,
  formatDateHuman,
  formatMonthName,
  formatMonthYear,
  formatSharePercent,
  formatUsdScale,
  roundDecimalString,
  shiftDecimalRight,
  subtractDecimalStrings,
  sumDecimalStrings,
} from "./format";
import { COUPON_SECURITY_TYPES, isReopening, type AuctionRecord } from "./auction-types";

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "2026-08-27" -> "Aug 27" — the no-year compact date these tables use (every row in view is within the same ~30-day window, so a year would be noise). */
export function formatDateShortNoYear(dateStr: string): string {
  const month = MONTH_ABBR[Number(dateStr.slice(5, 7)) - 1] ?? dateStr.slice(5, 7);
  const day = Number(dateStr.slice(8, 10));
  return `${month} ${day}`;
}

/** "7-Year" -> "7-year"; "10-Year" -> "10-year" — lowercases the unit word
 * for mid-sentence prose, keeping the digits untouched. */
function lowercaseTermWord(term: string): string {
  return term.replace(/Years?/g, (m) => m.toLowerCase()).replace(/Months?/g, (m) => m.toLowerCase()).replace(/Weeks?/g, (m) => m.toLowerCase());
}

/** "1-Year 11-Month" -> "1-Yr 11-Mo" — the abbreviated form the recent/
 * upcoming tables use for a reopening's own (remaining) term. */
function abbreviateTerm(term: string): string {
  return term.replace(/\bYears?\b/g, "Yr").replace(/\bMonths?\b/g, "Mo").replace(/\bWeeks?\b/g, "Wk");
}

/** Leading whole-year count parsed from an originalSecurityTerm like
 * "7-Year" or "29-Year 6-Month" -> 7 / 29. Returns 0 for a term with no
 * leading "N-Year" (bills, which never need the Note/Bond distinction). */
function leadingYears(term: string): number {
  const m = /^(\d+)-Year/.exec(term);
  return m ? Number(m[1]) : 0;
}

/** Treasury's own Note/Bond boundary: 2/3/5/7/10-year issues are Notes,
 * 20/30-year issues are Bonds. Used only to give a TIPS or FRN row (whose
 * raw `securityType` isn't literally "Note"/"Bond") the human word a reader
 * expects — e.g. a 30-year TIPS reads as "... Bond (TIPS reopening)", never
 * as "... TIPS" on its own, matching the approved mockup's own convention. */
function noteOrBondWord(originalSecurityTerm: string): "Note" | "Bond" {
  return leadingYears(originalSecurityTerm) > 10 ? "Bond" : "Note";
}

/** The human type word for a row — "Note"/"Bond" pass through unchanged;
 * "TIPS"/"FRN" resolve to Note-or-Bond by term length; anything else (a
 * Bill, a CMB) passes through as published. */
export function humanSecurityTypeWord(a: Pick<AuctionRecord, "securityType" | "originalSecurityTerm">): string {
  if (a.securityType === "Note" || a.securityType === "Bond") return a.securityType;
  if (a.securityType === "TIPS" || a.securityType === "FRN") return noteOrBondWord(a.originalSecurityTerm);
  return a.securityType;
}

/**
 * The display label for one auction row — e.g. "7-Year Note" for an
 * original nominal issuance, "10-Year TIPS" for a new-issue (non-reopened)
 * TIPS, "1-Yr 11-Mo Note (reopening)" for a Note/Bond reopening, "29-Yr 6-Mo
 * Bond (TIPS reopening)" for a TIPS reopening whose own term reads shorter
 * than its family's. Never asserts WHEN it was originally issued — see
 * buildReopeningAnnotation for the richer "(the August 10-year, reopened)"
 * form, which needs the original auction's own record and is used only
 * where that's available.
 *
 * A new-issue TIPS/FRN keeps its own type word rather than the Note/Bond
 * substitution `humanSecurityTypeWord` otherwise applies: a TIPS's "high
 * yield" is a REAL yield and an FRN's is a discount margin, not the nominal
 * yield the "Note"/"Bond" word implies to a reader scanning a table —
 * collapsing it into "10-Year Note" with no marker put a real yield in the
 * same unlabeled column as nominal yields (caught via a real fixture: CUSIP
 * 91282CRE3, a 10-Year TIPS, rendered as "10-Year Note" at 2.438%). The
 * reopening branch already carries an explicit "(TIPS reopening)"/"(FRN
 * reopening)" qualifier for the same reason; this extends that same marker
 * to the non-reopening case rather than leaving it as the one gap.
 *
 * Always uses `securityTerm` (never `originalSecurityTerm`) for the
 * non-reopening case: for Note/Bond/TIPS/FRN the two are identical when not
 * reopened (that equality is exactly what `isReopening` tests), but for a
 * Bill/CMB they can genuinely differ — @penny/db's schema doc comment
 * documents that a Bill's `originalSecurityTerm` is a coarser family bucket
 * ("17-Week" covers 4-Week, 8-Week, AND 17-Week `securityTerm` rows), so
 * using it here mislabeled every bill with its bucket's tenor instead of its
 * own (caught via a real screenshot: two same-day bills both read "17-Week
 * Bill" instead of their actual "4-Week"/"8-Week" tenors).
 */
export function securityLabel(a: Pick<AuctionRecord, "securityType" | "securityTerm" | "originalSecurityTerm">): string {
  const reopen = isReopening(a);
  const termPart = reopen ? abbreviateTerm(a.securityTerm) : a.securityTerm;
  if (!reopen) {
    const isInflationOrFloating = a.securityType === "TIPS" || a.securityType === "FRN";
    return isInflationOrFloating ? `${termPart} ${a.securityType}` : `${termPart} ${humanSecurityTypeWord(a)}`;
  }
  const typeWord = humanSecurityTypeWord(a);
  const qualifier = COUPON_SECURITY_TYPES.includes(a.securityType) ? " (reopening)" : ` (${a.securityType} reopening)`;
  return `${termPart} ${typeWord}${qualifier}`;
}

/** "7-year note(s)" / "bond(s)" — the mid-sentence noun phrase the takeaway
 * generator uses, distinct from securityLabel's title-case table form. */
function securityNounPhrase(a: Pick<AuctionRecord, "securityType" | "originalSecurityTerm">, plural: boolean): string {
  const typeWord = humanSecurityTypeWord(a).toLowerCase();
  const word = plural ? `${typeWord}s` : typeWord;
  return `${lowercaseTermWord(a.originalSecurityTerm)} ${word}`;
}

/** Replaces a trailing "(...)" reopening qualifier with the richer,
 * data-derived "(the {month} {term}, reopened)" annotation — used only by
 * the Coming Up table, and only when the caller actually has the original
 * (non-reopened) auction's own record to derive the month from (CLAUDE.md:
 * never assert a fact the data doesn't support). Returns the plain
 * securityLabel unchanged when `original` is null/undefined or `a` isn't a
 * reopening at all.
 */
export function buildUpcomingSecurityLabel(a: AuctionRecord, original: AuctionRecord | null | undefined): string {
  const base = securityLabel(a);
  if (!isReopening(a) || !original) return base;
  const monthLabel = formatMonthName(original.auctionDate);
  const termLower = lowercaseTermWord(original.originalSecurityTerm);
  const bareLabel = base.replace(/\s*\([^)]*\)\s*$/, "");
  return `${bareLabel} (the ${monthLabel} ${termLower}, reopened)`;
}

// ---------- shared exact-math helpers ----------

/** Exact mean of a list of decimal strings, to 4 places — null for an empty
 * list (never a fabricated average of nothing). Shared by the tile
 * subtitle, the takeaway generator, and the history chart's reference line,
 * so all three agree on the exact same figure. */
export function trailingAverage(values: readonly string[]): string | null {
  if (values.length === 0) return null;
  return divideDecimalStrings(sumDecimalStrings([...values]), String(values.length), 4);
}

/** `value`'s share of `denominator` as a bare percent NUMBER string (no "%"
 * suffix, no sign glyph) — the form `trailingAverage` can sum, unlike
 * lib/format.ts's own `formatSharePercent`, which returns an already-
 * suffixed display string. `denominator` <= 0 returns null (a gap: never a
 * divide-by-zero, and never a fabricated share of nothing). */
function percentValue(value: string, denominator: string, decimals: number): string | null {
  if (compareDecimalStrings(denominator, "0") <= 0) return null;
  return divideDecimalStrings(shiftDecimalRight(value, 2), denominator, decimals);
}

/** Cosmetic-only float share, 0-100, for a CSS/SVG width proportion — never
 * a displayed figure (mirrors apps/web's existing rank-row-bar convention
 * and packages/viz's documented Number()-for-pixels exception). */
function shareWidthPercent(value: string, denominator: string): number {
  if (compareDecimalStrings(denominator, "0") <= 0) return 0;
  return Number(divideDecimalStrings(value, denominator, 4)) * 100;
}

/** Compares two decimal strings AT DISPLAY PRECISION — after rounding both
 * to the same number of decimals a reader actually sees — so an
 * "above"/"below" claim can never contradict two figures that render
 * identically (CLAUDE.md: every sentence must survive being read aloud by
 * any party it describes). Rounding both sides first, rather than comparing
 * the exact underlying values, is what makes "matching" mean what the
 * printed numbers show it means (caught via a real fixture: an exact 2.5007
 * average vs. a latest 2.5000 both display as "$2.50," but the exact
 * comparison called that "below," reading as a contradiction — "$2.50 …
 * below … average of $2.50"). */
function compareAtDisplayPrecision(a: string, b: string, decimals: number): -1 | 0 | 1 {
  return compareDecimalStrings(roundDecimalString(a, decimals), roundDecimalString(b, decimals));
}

/** The Treasury "Subtotal" line: `total_accepted` with any SOMA add-on
 * backed out — competitive + noncompetitive demand only. This is the
 * correct denominator for every buyer-class SHARE: Treasury's own results
 * release computes bid-to-cover against this exact line (footnote 4: "$…
 * /$44,000,115,700 = 2.50", where $44.0B is the Subtotal, not the
 * SOMA-inclusive Total a few lines below it), never against the
 * SOMA-inclusive grand total. SOMA isn't competing demand — it's the Fed
 * rolling maturing holdings into the new security on top of the announced
 * offering — and its size swings auction-to-auction for reasons that have
 * nothing to do with bidders (0%–25% of total_accepted across the seeded
 * 7-year window), so dividing a buyer class's share by a base that moves
 * with SOMA, and then comparing that share against a trailing average of
 * shares with DIFFERENT SOMA bases, can flip the reported direction of a
 * real comparison (caught via a real fixture: the 10-Year Note family reads
 * "61.0%, below their 62.9% average" on the SOMA-inclusive base and "76.4%,
 * above their 70.6% average" on this one — opposite directions, same data).
 * A null SOMA is treated as contributing $0 to this subtraction (a gap, not
 * a displayed "$0 SOMA" claim — mirrors this file's existing convention for
 * summing SOMA into other totals). Null only when `totalAccepted` itself is
 * null. */
export function competitiveSubtotal(totalAccepted: string | null, somaAccepted: string | null): string | null {
  if (totalAccepted == null) return null;
  if (somaAccepted == null) return totalAccepted;
  return subtractDecimalStrings(totalAccepted, somaAccepted);
}

// ---------- buyer mix (the 100% bar) ----------

export interface BuyerMixSegment {
  readonly key: "primary" | "direct" | "indirect" | "noncompetitive" | "soma";
  readonly label: string;
  readonly shareDisplay: string;
  /** 0-100, cosmetic only. */
  readonly widthPercent: number;
  readonly hatch: boolean;
}

export interface BuyerMix {
  readonly segments: readonly BuyerMixSegment[];
  /** The competitive subtotal (total_accepted minus any SOMA add-on) — what
   * the four buyer-class segments' shares are shares OF. Never the
   * SOMA-inclusive grand total (see `competitiveSubtotal`'s own comment). */
  readonly subtotalDisplay: string;
  readonly hasSoma: boolean;
}

/**
 * Builds the buyer-mix bar's segments. The four competitive buyer classes
 * (primary/direct/indirect/noncompetitive) each get their share of the
 * competitive SUBTOTAL (`competitiveSubtotal` — total_accepted with any SOMA
 * add-on backed out), matching Treasury's own bid-to-cover convention. SOMA
 * is kept a separate add-on, its own share stated as a percent of the
 * announced OFFERING (never the subtotal or the SOMA-inclusive total) —
 * CLAUDE.md: accounting concepts never mix silently, so a genuinely
 * different kind of quantity (an add-on beyond the offering, not a
 * competing bid) gets its own base. Segment WIDTHS stay proportional to
 * total_accepted (cosmetic pixel proportions only, per `shareWidthPercent`'s
 * own contract — never a displayed figure), preserving the approved
 * mockup's visual bar composition unchanged.
 *
 * Each buyer class is its OWN gap: a null reading for one class simply
 * omits that segment (never a false zero-width bar) rather than failing the
 * whole mix. Returns null when there's no positive total_accepted, or no
 * positive competitive subtotal, to divide by — a whole-card gap, not a
 * per-segment one.
 */
export function buildBuyerMix(a: AuctionRecord): BuyerMix | null {
  const totalAccepted = a.totalAccepted;
  if (totalAccepted == null || compareDecimalStrings(totalAccepted, "0") <= 0) return null;

  const subtotal = competitiveSubtotal(totalAccepted, a.somaAccepted);
  if (subtotal == null || compareDecimalStrings(subtotal, "0") <= 0) return null;

  const rows: { key: BuyerMixSegment["key"]; label: string; value: string | null }[] = [
    { key: "primary", label: "Primary dealers", value: a.primaryDealerAccepted },
    { key: "direct", label: "Direct bidders", value: a.directBidderAccepted },
    { key: "indirect", label: "Indirect bidders", value: a.indirectBidderAccepted },
    { key: "noncompetitive", label: "Noncompetitive", value: a.noncompetitiveAccepted },
  ];

  const segments: BuyerMixSegment[] = [];
  for (const row of rows) {
    if (row.value == null) continue;
    segments.push({
      key: row.key,
      label: row.label,
      shareDisplay: formatSharePercent(row.value, subtotal, 1),
      widthPercent: shareWidthPercent(row.value, totalAccepted),
      hatch: false,
    });
  }

  const hasSoma = a.somaAccepted != null && compareDecimalStrings(a.somaAccepted, "0") > 0;
  if (hasSoma) {
    const somaBase = a.offeringAmount ?? subtotal;
    segments.push({
      key: "soma",
      label: "SOMA add-on",
      shareDisplay: formatSharePercent(a.somaAccepted!, somaBase, 1),
      widthPercent: shareWidthPercent(a.somaAccepted!, totalAccepted),
      hatch: true,
    });
  }

  return { segments, subtotalDisplay: formatUsdScale(subtotal, "B", 1), hasSoma };
}

// ---------- the three stat tiles ----------

export interface LatestAuctionTiles {
  readonly soldDisplay: string | null;
  readonly soldSubtitle: string;
  readonly highYieldDisplay: string | null;
  readonly bidToCoverDisplay: string | null;
  readonly bidToCoverSubtitle: string;
}

export const HIGH_YIELD_SUBTITLE = "what the last accepted bidder demanded — every winner gets it";

/** Builds the three stat-tile values/subtitles. `priorFamilyBidToCover` is
 * every OTHER auction in the family's trailing window that published a
 * bid-to-cover (ascending or any order — only its length and values
 * matter), used to build the "N-auction average" subtitle inclusive of the
 * latest reading itself. */
export function buildLatestAuctionTiles(a: AuctionRecord, priorFamilyBidToCover: readonly string[]): LatestAuctionTiles {
  // "Sold" = the announced/competitive amount (`offering_amount`), NOT
  // `total_accepted` — total_accepted already INCLUDES the SOMA add-on
  // (verified live 2026-09-01: total_accepted ≈ offering_amount +
  // soma_accepted across real Note/Bond rows), so using it here would
  // double-count SOMA against the separately-stated add-on subtitle below.
  const soldDisplay = a.offeringAmount != null ? formatUsdScale(a.offeringAmount, "B", 1) : null;
  const hasSoma = a.somaAccepted != null && compareDecimalStrings(a.somaAccepted, "0") > 0;
  const soldSubtitle = hasSoma ? `announced offering · +${formatUsdScale(a.somaAccepted!, "B", 1)} SOMA add-on` : "announced offering";

  const highYieldDisplay = a.highYield != null ? `${roundDecimalString(a.highYield, 3)}%` : null;

  let bidToCoverDisplay: string | null = null;
  let bidToCoverSubtitle = "";
  if (a.bidToCover != null) {
    bidToCoverDisplay = `${roundDecimalString(a.bidToCover, 2)}×`;
    const n = priorFamilyBidToCover.length + 1;
    const avg = trailingAverage([...priorFamilyBidToCover, a.bidToCover]);
    bidToCoverSubtitle =
      avg != null
        ? `$${roundDecimalString(a.bidToCover, 2)} of bids per $1 accepted · ${n}-auction average: ${roundDecimalString(avg, 2)}×`
        : `$${roundDecimalString(a.bidToCover, 2)} of bids per $1 accepted`;
  }

  return { soldDisplay, soldSubtitle, highYieldDisplay, bidToCoverDisplay, bidToCoverSubtitle };
}

// ---------- the takeaway generator ----------

const HALF_YEAR_MARGIN_DAYS = 365;

/**
 * Composes the auction page's one narrative sentence group entirely from
 * data — never an adjective (CLAUDE.md/ORCHESTRATION_PROMPT.md doctrine: the
 * mechanism is comparison against the SAME security family's own trailing
 * history, never a word like "weak"/"strong"; see
 * test/auction-transform.test.ts's explicit banned-word sweep). `priorFamily`
 * is every OTHER auction in the family's trailing window, sorted ascending
 * by auctionDate (oldest first) — this function never re-sorts its input.
 *
 * Each clause is independently omitted when its own inputs are gaps: a
 * reopening with no published high_yield drops the yield clause (and the
 * whole first sentence, if there's also no sold figure) rather than
 * asserting a number that doesn't exist.
 */
export function buildTakeawaySentence(latest: AuctionRecord, priorFamily: readonly AuctionRecord[]): string {
  const sentences: string[] = [];

  // Sentence 1: sold amount + high yield (+ its "highest/lowest in at least
  // the past year" comparison, only when the window's actual date span
  // proves it). "Sold" is offering_amount, not total_accepted — see
  // buildLatestAuctionTiles's own comment on why total_accepted already
  // includes the SOMA add-on stated separately in sentence 4.
  const soldDisplay = latest.offeringAmount != null ? formatUsdScale(latest.offeringAmount, "B", 1) : null;
  if (soldDisplay != null) {
    if (latest.highYield != null) {
      const yieldPct = `${roundDecimalString(latest.highYield, 3)}%`;
      const priorWithYield = priorFamily.filter((p) => p.highYield != null);
      let comparisonClause = "";
      if (priorWithYield.length > 0) {
        const spanDays = daysBetween(priorWithYield[0]!.auctionDate, latest.auctionDate);
        const coversYear = spanDays >= HALF_YEAR_MARGIN_DAYS;
        if (coversYear) {
          const maxOther = priorWithYield.reduce((m, p) => (compareDecimalStrings(p.highYield!, m.highYield!) > 0 ? p : m));
          const minOther = priorWithYield.reduce((m, p) => (compareDecimalStrings(p.highYield!, m.highYield!) < 0 ? p : m));
          if (compareDecimalStrings(latest.highYield, maxOther.highYield!) > 0) {
            comparisonClause = ` — the highest for this security in at least the past year (${formatMonthYear(maxOther.auctionDate)}: ${roundDecimalString(maxOther.highYield!, 3)}%)`;
          } else if (compareDecimalStrings(latest.highYield, minOther.highYield!) < 0) {
            comparisonClause = ` — the lowest for this security in at least the past year (${formatMonthYear(minOther.auctionDate)}: ${roundDecimalString(minOther.highYield!, 3)}%)`;
          }
        }
      }
      sentences.push(`The Treasury sold ${soldDisplay} of ${securityNounPhrase(latest, true)} at a high yield of ${yieldPct}${comparisonClause}.`);
    } else {
      sentences.push(`The Treasury sold ${soldDisplay} of ${securityNounPhrase(latest, true)}.`);
    }
  }

  // Sentence 2: bid-to-cover vs. the trailing average, both numbers stated.
  // Compared AT DISPLAY PRECISION (2 decimals) so "above"/"below" can never
  // contradict two figures that render as the same number (see
  // compareAtDisplayPrecision's own comment).
  if (latest.bidToCover != null) {
    const btcDisplay = `$${roundDecimalString(latest.bidToCover, 2)}`;
    const priorWithBtc = priorFamily.filter((p) => p.bidToCover != null).map((p) => p.bidToCover!);
    if (priorWithBtc.length > 0) {
      const avg = trailingAverage([...priorWithBtc, latest.bidToCover])!;
      const avgDisplay = `$${roundDecimalString(avg, 2)}`;
      const cmp = compareAtDisplayPrecision(latest.bidToCover, avg, 2);
      const n = priorWithBtc.length + 1;
      const relPhrase = cmp > 0 ? "above" : cmp < 0 ? "below" : "matching";
      sentences.push(`Bidders offered ${btcDisplay} for every $1 accepted — ${relPhrase} this security's average of ${avgDisplay} across its last ${n} auctions.`);
    } else {
      sentences.push(`Bidders offered ${btcDisplay} for every $1 accepted.`);
    }
  }

  // Sentence 3: indirect-bidder share vs. its trailing average. The
  // denominator is the competitive SUBTOTAL (total_accepted with any SOMA
  // add-on backed out), for both the latest reading and every prior
  // reading — never the SOMA-inclusive total_accepted directly, whose
  // varying SOMA share can flip the reported direction of this exact
  // comparison (see competitiveSubtotal's own comment for the real-fixture
  // reversal this fixes). Compared AT DISPLAY PRECISION (1 decimal, matching
  // avgDisplay's own rounding) for the same reason sentence 2 is.
  const subtotal = competitiveSubtotal(latest.totalAccepted, latest.somaAccepted);
  if (latest.indirectBidderAccepted != null && subtotal != null && compareDecimalStrings(subtotal, "0") > 0) {
    const shareDisplay = formatSharePercent(latest.indirectBidderAccepted, subtotal, 1);
    const priorPercents: string[] = [];
    for (const p of priorFamily) {
      const pSubtotal = competitiveSubtotal(p.totalAccepted, p.somaAccepted);
      if (p.indirectBidderAccepted == null || pSubtotal == null) continue;
      const pct = percentValue(p.indirectBidderAccepted, pSubtotal, 4);
      if (pct != null) priorPercents.push(pct);
    }
    const latestPercent = percentValue(latest.indirectBidderAccepted, subtotal, 4);
    if (priorPercents.length > 0 && latestPercent != null) {
      const avgPercent = trailingAverage([...priorPercents, latestPercent])!;
      const avgDisplay = `${roundDecimalString(avgPercent, 1)}%`;
      const cmp = compareAtDisplayPrecision(latestPercent, avgPercent, 1);
      const n = priorPercents.length + 1;
      const relPhrase = cmp > 0 ? "above" : cmp < 0 ? "below" : "matching";
      sentences.push(`Indirect bidders took ${shareDisplay} of the amount accepted competitively, ${relPhrase} their ${n}-auction average share of ${avgDisplay}.`);
    } else {
      sentences.push(`Indirect bidders took ${shareDisplay} of the amount accepted competitively.`);
    }
  }

  // Sentence 4: the SOMA add-on — omitted for both a gap (null) AND a
  // genuine zero (no add-on that round carries no narrative weight here).
  if (latest.somaAccepted != null && compareDecimalStrings(latest.somaAccepted, "0") > 0) {
    const somaDisplay = formatUsdScale(latest.somaAccepted, "B", 1);
    const typeWord = humanSecurityTypeWord(latest).toLowerCase();
    sentences.push(`The Fed's SOMA rolled ${somaDisplay} of maturing holdings into the new ${typeWord} as an add-on.`);
  }

  return sentences.join(" ");
}

// ---------- history-section charts (bid-to-cover dots, high-yield line) ----------

export interface AuctionChartPoint {
  readonly date: string;
  readonly valueWhole: string;
  readonly display: string;
  readonly label: string;
  readonly isLatest: boolean;
}

/** Ascending-by-date points for the bid-to-cover dot chart, dropping any
 * auction in the family with no published bid-to-cover (a real gap, not a
 * zero dot). `family` must already be sorted ascending by auctionDate. */
export function buildBidToCoverPoints(family: readonly AuctionRecord[], latestAuctionDate: string): AuctionChartPoint[] {
  return family
    .filter((a) => a.bidToCover != null)
    .map((a) => ({
      date: a.auctionDate,
      valueWhole: a.bidToCover!,
      display: `${roundDecimalString(a.bidToCover!, 2)}×`,
      label: formatDateHuman(a.auctionDate),
      isLatest: a.auctionDate === latestAuctionDate,
    }));
}

/** Ascending-by-date points for the high-yield line chart, dropping any
 * auction in the family with no published high yield. `family` must already
 * be sorted ascending by auctionDate. */
export function buildHighYieldPoints(family: readonly AuctionRecord[], latestAuctionDate: string): AuctionChartPoint[] {
  return family
    .filter((a) => a.highYield != null)
    .map((a) => ({
      date: a.auctionDate,
      valueWhole: a.highYield!,
      display: `${roundDecimalString(a.highYield!, 3)}%`,
      label: formatDateHuman(a.auctionDate),
      isLatest: a.auctionDate === latestAuctionDate,
    }));
}

/** A neutral, factual caption for the bid-to-cover chart — the chronological
 * start/end of the window shown and its trailing average, never an
 * "outlier"/"weak"/"strong" characterization of any single point. */
export function buildBidToCoverCaption(points: readonly AuctionChartPoint[], averageDisplay: string | null): string {
  if (points.length === 0) return "";
  const n = points.length;
  const start = formatMonthYear(points[0]!.date);
  const end = formatMonthYear(points[n - 1]!.date);
  const avgClause = averageDisplay ? ` The trailing average across these ${n} auctions is ${averageDisplay}.` : "";
  return `Each dot is one auction; the latest is emphasized. Hover or focus any dot for its date and figure. ${n} auctions shown, ${start} → ${end}.${avgClause}`;
}

/** A neutral, factual caption for the high-yield chart — states the
 * chronological first-to-last reading, never a min/max characterization
 * (the first point in the window isn't necessarily the lowest, and framing
 * it that way would misstate a fact the data doesn't establish). */
export function buildHighYieldCaption(points: readonly AuctionChartPoint[]): string {
  if (points.length === 0) return "";
  const n = points.length;
  const first = points[0]!;
  const last = points[n - 1]!;
  return `Each point is one auction's high yield; the latest is emphasized. Hover or focus any point for its date and figure. From ${first.display} in ${formatMonthYear(first.date)} to ${last.display} in ${formatMonthYear(last.date)}.`;
}

/** "7-year" from originalSecurityTerm "7-Year" — the lowercased family noun
 * used in section subtitles/captions, deliberately without the Note/Bond
 * word (matching the approved mockup's own "Fourteen 7-year auctions..."
 * phrasing, which never repeats "note" once the section header already
 * named the security). */
export function familyTermLower(a: Pick<AuctionRecord, "originalSecurityTerm">): string {
  return lowercaseTermWord(a.originalSecurityTerm);
}

/** The family's plain, title-case label — ALWAYS the non-reopened form
 * (e.g. "7-Year Note"), even when `a` itself happens to be a reopening.
 * For contexts that name the family as a whole rather than one specific
 * auction's own row — e.g. the history section's citation line, which
 * shouldn't read "1-Yr 11-Mo Note (reopening) auctions of ..." just because
 * the most recent auction in the family happened to be a reopening. */
export function familyLabel(a: Pick<AuctionRecord, "securityType" | "originalSecurityTerm">): string {
  return `${a.originalSecurityTerm} ${humanSecurityTypeWord(a)}`;
}

/** The "This security's own history" section's subtitle — how many
 * auctions are shown and the real chronological window they span, entirely
 * derived from `family` (ascending by auctionDate, latest last). Empty
 * string for an empty family (the caller renders its own gap state). The
 * general "only fair comparison" framing is static page copy (app/
 * auctions/page.tsx's own <p className="sub">) — this string is only the
 * data-derived second half, never repeated here. */
export function buildHistorySubtitle(family: readonly AuctionRecord[]): string {
  if (family.length === 0) return "";
  const n = family.length;
  const start = formatMonthYear(family[0]!.auctionDate);
  const end = formatMonthYear(family[n - 1]!.auctionDate);
  return `${n} ${familyTermLower(family[n - 1]!)} auctions, ${start} → ${end} — all real results.`;
}

// ---------- recent coupon auctions table ----------

export interface RecentAuctionRow {
  readonly auctionDate: string;
  readonly dateDisplay: string;
  readonly securityLabel: string;
  readonly highYieldDisplay: string;
  readonly bidToCoverDisplay: string;
  readonly indirectShareDisplay: string;
  /** 0-100, cosmetic only; 0 when there's no indirect-share reading to show. */
  readonly indirectShareWidthPercent: number;
}

export function buildRecentAuctionRow(a: AuctionRecord): RecentAuctionRow {
  const highYieldDisplay = a.highYield != null ? `${roundDecimalString(a.highYield, 3)}%` : "—";
  const bidToCoverDisplay = a.bidToCover != null ? `${roundDecimalString(a.bidToCover, 2)}×` : "—";
  let indirectShareDisplay = "—";
  let indirectShareWidthPercent = 0;
  // The competitive subtotal (total_accepted with any SOMA add-on backed
  // out) — matches buildBuyerMix's and the takeaway sentence's own
  // convention, never the SOMA-inclusive total_accepted (see
  // competitiveSubtotal's own comment).
  const denom = competitiveSubtotal(a.totalAccepted, a.somaAccepted);
  if (a.indirectBidderAccepted != null && denom != null && compareDecimalStrings(denom, "0") > 0) {
    indirectShareDisplay = formatSharePercent(a.indirectBidderAccepted, denom, 1);
    indirectShareWidthPercent = shareWidthPercent(a.indirectBidderAccepted, denom);
  }
  return {
    auctionDate: a.auctionDate,
    dateDisplay: formatDateShortNoYear(a.auctionDate),
    securityLabel: securityLabel(a),
    highYieldDisplay,
    bidToCoverDisplay,
    indirectShareDisplay,
    indirectShareWidthPercent,
  };
}

/** Builds the recent-auctions table, most recent first. `auctions` need not
 * be pre-sorted — this sorts descending by auctionDate itself so the caller
 * (lib/auctions-data.ts) only has to fetch, not order, the window. */
export function buildRecentAuctionRows(auctions: readonly AuctionRecord[]): RecentAuctionRow[] {
  return [...auctions].sort((a, b) => (a.auctionDate < b.auctionDate ? 1 : a.auctionDate > b.auctionDate ? -1 : 0)).map(buildRecentAuctionRow);
}

// ---------- coming up table ----------

export interface UpcomingAuctionGroup {
  readonly auctionDate: string;
  readonly dateDisplay: string;
  readonly securitiesLabel: string;
  readonly sizeDisplay: string;
}

/** The family-lookup key an upcoming reopening's annotation is resolved
 * against — pairs original_security_term with security_type, since a TIPS
 * and a plain Note can otherwise share the same term text (e.g. a 10-Year
 * Note and a 10-Year TIPS are different families). */
export function reopeningFamilyKey(a: Pick<AuctionRecord, "originalSecurityTerm" | "securityType">): string {
  return `${a.originalSecurityTerm}|${a.securityType}`;
}

/**
 * Groups upcoming (announced) auctions by auction date and builds one
 * "Coming up" row per date. `originalAuctionByFamily` supplies, for each
 * reopeningFamilyKey a reopening in `auctions` actually needs, the family's
 * original (non-reopened) auction record — or null/absent when it isn't
 * derivable from what's been fetched, in which case that row's label falls
 * back to the plain "(reopening)" qualifier rather than inventing a month.
 */
export function buildUpcomingGroups(auctions: readonly AuctionRecord[], originalAuctionByFamily: ReadonlyMap<string, AuctionRecord | null>): UpcomingAuctionGroup[] {
  const byDate = new Map<string, AuctionRecord[]>();
  for (const a of auctions) {
    const list = byDate.get(a.auctionDate);
    if (list) list.push(a);
    else byDate.set(a.auctionDate, [a]);
  }
  const dates = [...byDate.keys()].sort();
  return dates.map((date) => {
    const list = byDate.get(date)!;
    const labels = list.map((a) => buildUpcomingSecurityLabel(a, originalAuctionByFamily.get(reopeningFamilyKey(a))));
    const sizes = list.map((a) => (a.offeringAmount != null ? formatUsdScale(a.offeringAmount, "B", 0) : "TBA"));
    const allTba = sizes.every((s) => s === "TBA");
    return {
      auctionDate: date,
      dateDisplay: formatDateShortNoYear(date),
      securitiesLabel: labels.join(" · "),
      sizeDisplay: allTba ? "TBA" : sizes.join(" · "),
    };
  });
}
