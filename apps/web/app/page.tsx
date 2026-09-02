import Link from "next/link";
import HeroStrip from "@/components/hero-strip";
import RankedBarChart from "@/components/ranked-bar-chart";
import ForScaleFactCard from "@/components/for-scale-fact";
import FiscalBridge from "@/components/fiscal-bridge";
import HowBorrowingWorks from "@/components/how-borrowing-works";
import DeficitHistoryChart from "@/components/deficit-history-chart";
import CadenceSection from "@/components/cadence-section";
import { getFrontDoorData } from "@/lib/front-door-data";
import { getCadenceData } from "@/lib/cadence-data";
import { formatDateHuman, todayIso } from "@/lib/format";

// NOTE (beat 1, Act I month stepper): reading `searchParams` below makes
// Next render this route dynamically, per request, on every visit —
// `revalidate` no longer has any effect on `/` (confirmed in the build
// output: "/" is now marked ƒ Dynamic, not ○ Static/ISR, the way it was
// before the stepper). Left in place as a harmless no-op rather than
// removed, since Next accepts the combination without warning, and
// `/now`, `/data`, and `/report/where-the-money-goes` are unaffected —
// none of them read searchParams, so their own ISR windows still apply.
export const revalidate = 900;

interface HomeProps {
  /** `?spendMonth=YYYY-MM-DD` drives the Act I month stepper (beat 1) —
   * server-rendered per request once read, matching every other
   * search-param-driven page in the App Router; an invalid or missing value
   * falls back to the latest available month (see buildMonthStepper). */
  searchParams: Promise<{ spendMonth?: string | string[] }>;
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const spendMonthRaw = Array.isArray(params.spendMonth) ? params.spendMonth[0] : params.spendMonth;
  // Defensive shape check only — buildMonthStepper (lib/front-door-transform.ts)
  // is what actually validates this against the real list of ingested
  // months; this just refuses to pass through something that couldn't
  // possibly be a period_end before it ever reaches the database.
  const spendMonth = spendMonthRaw && /^\d{4}-\d{2}-\d{2}$/.test(spendMonthRaw) ? spendMonthRaw : null;

  const [data, cadenceData] = await Promise.all([getFrontDoorData({ spendMonth }), getCadenceData()]);
  const accessed = formatDateHuman(todayIso());
  const monthPhrase = data.latestMonthName ? `Through ${data.latestMonthName}` : "So far this fiscal year";
  // Lowercase from the start (never `.toLowerCase()` on a phrase that starts
  // with a capitalized month name — that would lowercase the month itself),
  // and carries the year, unlike monthPhrase above — a source line needs an
  // unambiguous "through July 2026", not just "Through July".
  const throughPhrase = data.latestMonthYearLabel ? `through ${data.latestMonthYearLabel}` : "so far this fiscal year";
  const outlaysPeriodPhrase = data.outlays.periods.month?.periodLabel ?? "the latest month";
  const receiptsPeriodPhrase = data.receipts.periods.month?.periodLabel ?? "the latest month";
  const direction = data.bridge?.direction ?? null;
  // The stepper's raw period_end values become real "?spendMonth=" URLs
  // here, at the page/routing layer — components/ranked-bar-chart.tsx and
  // components/month-stepper.tsx stay dumb about the search param's name.
  const spendStepper = data.outlays.stepper
    ? {
        currentPeriodEnd: data.outlays.stepper.currentPeriodEnd,
        prevHref: data.outlays.stepper.prevPeriodEnd ? `/?spendMonth=${data.outlays.stepper.prevPeriodEnd}` : null,
        nextHref: data.outlays.stepper.nextPeriodEnd ? `/?spendMonth=${data.outlays.stepper.nextPeriodEnd}` : null,
      }
    : null;

  return (
    <div className="page">
      <div className="prose-width hero-lede">
        <h1>Every last penny.</h1>
        <p className="page-lede">
          Penny shows where federal money goes, where it comes from, and how the difference is borrowed — every
          number from the agency of record, updated as the record updates.
        </p>
      </div>

      <HeroStrip topline={data.topline} secondary={data.secondaryCells} />

      <section className="act">
        <div className="prose-width">
          <div className="act-kicker act-kicker--spend">Act I · Spending</div>
          <h2>What the government spent</h2>
          <p className="act-lede">
            The story opens at the government&rsquo;s actual pace: one month at a time. Step back through months
            with the ‹ › control below and watch the ranking shift. Click any bar to see how that category has
            moved over time.
          </p>
        </div>
        <div className="act-wide">
          <RankedBarChart
            idPrefix="spend"
            colorVar="--series-outlays"
            toggleLabels={data.outlays.toggleLabels}
            periods={data.outlays.periods}
            histories={data.outlays.histories}
            defaultPeriod="month"
            stepper={spendStepper}
            stageVerb="spent"
            footNote="Percentages are each category’s share of the period’s net total. Rows below the zero line are net offsets — money that flowed back to the government — so their shares are negative. Chart labels are rounded to $0.1 billion; hover any bar for the exact published figure."
          />
          <div className="for-scale-grid">
            <ForScaleFactCard fact={data.forScale.perHouseholdSpend} gapDescription="spent per U.S. household so far this fiscal year" />
            <ForScaleFactCard fact={data.forScale.interestPerTaxDollar} gapDescription="of individual income tax receipts went to interest on the debt" />
          </div>
          <p className="src">
            Source: {data.sources.agency}, {data.sources.outlaysDataset} ({outlaysPeriodPhrase} in the month view;
            fiscal-year-to-date {throughPhrase} in the fiscal-year view, whichever month is stepped to); individual
            income taxes (used above) from {data.sources.receiptsDataset}, {throughPhrase}. Accessed {accessed}.{" "}
            <a href="https://www.fiscal.treasury.gov/reports-statements/mts/current.html" target="_blank" rel="noopener noreferrer">
              The Monthly Treasury Statement publishes on the eighth business day after each month ends
            </a>
            {" "}— until a given month&rsquo;s statement is out, the newest month a reader can step to is the one
            before it. Figures are shown as originally published in that month&rsquo;s statement; Treasury sometimes
            revises a month&rsquo;s total by a small amount in a later report.
          </p>
        </div>
      </section>

      <section className="act">
        <div className="prose-width">
          <div className="act-kicker act-kicker--rev">Act II · Revenue</div>
          <h2>Where the money came from</h2>
          <p className="act-lede">
            Receipts by source. Taxes on individuals — income tax plus the payroll taxes that fund Social Security
            and Medicare — carry most of the load.
          </p>
        </div>
        <div className="act-wide">
          <RankedBarChart
            idPrefix="rev"
            colorVar="--series-receipts"
            toggleLabels={data.receipts.toggleLabels}
            periods={data.receipts.periods}
            histories={data.receipts.histories}
            monthOnlyNote={data.receipts.monthOnlyNote}
          />
          <p className="src">
            Source: {data.sources.agency}, {data.sources.receiptsDataset}, {receiptsPeriodPhrase}. Accessed {accessed}.
          </p>
        </div>
      </section>

      <section className="act" id="cadence">
        <div className="prose-width">
          <div className="act-kicker act-kicker--cadence">Act III · Cadence</div>
          <h2>When does the money move?</h2>
          <p className="act-lede">
            Money does not move through the government in a smooth stream — it arrives and leaves in bursts against
            a steady drip. Coming in, payroll tax withholding lands in a small amount on nearly every business day,
            and{" "}
            <a href="https://www.irs.gov/faqs/estimated-tax/individuals/individuals-2" target="_blank" rel="noopener noreferrer">
              four times a year — mid-April, mid-June, mid-September, and mid-January — a flood of quarterly
              estimated tax payments arrives at once
            </a>
            . Going out,{" "}
            <a href="https://www.ssa.gov/manage-benefits/view-benefit-payment-schedule" target="_blank" rel="noopener noreferrer">
              Social Security is paid mostly on Wednesdays, by birth date, with beneficiaries who started collecting
              before May 1997 paid on the 3rd of the month instead
            </a>
            . The two rhythms rarely land on the same day. The Treasury General Account, charted below, is what
            absorbs that day-to-day mismatch. Treasury also borrows on a weekly schedule, largely because a similar
            volume of short-term bills matures and has to be rolled over each week — not only because of the
            year&rsquo;s deficit.
          </p>
        </div>
        <div className="act-wide">
          <CadenceSection data={cadenceData} />
        </div>
      </section>

      <section className="act">
        <div className="prose-width">
          <div className="act-kicker act-kicker--gap">Act IV · The gap</div>
          <h2>
            {direction === "surplus"
              ? "Revenue exceeded spending. The surplus is left over."
              : direction === "balanced"
                ? "Spending matched revenue. Nothing was borrowed."
                : "Spending exceeded revenue. The difference is borrowed."}
          </h2>
          {data.bridge ? (
            <p className="act-lede">
              {monthPhrase}, the government spent {data.bridge.outlaysDisplay} and collected{" "}
              {data.bridge.receiptsDisplay}.{" "}
              {direction === "surplus"
                ? `The ${data.bridge.gapDisplay} left over isn’t a spending category — it’s the surplus, and it reduces how much the government needs to borrow to cover the rest of the year.`
                : direction === "balanced"
                  ? "Receipts and outlays matched almost exactly — no borrowing was needed to cover this period."
                  : `The ${data.bridge.gapDisplay} between them isn’t a spending category — it’s the deficit, financed by selling Treasury securities: bills, notes, and bonds. Each sale adds to the total public debt.`}
            </p>
          ) : (
            <p className="act-lede">No fiscal-year-to-date report has been ingested yet.</p>
          )}
        </div>
        <div className="act-wide">
          <FiscalBridge bridge={data.bridge} />
          <HowBorrowingWorks />
          <DeficitHistoryChart chart={data.deficitChart} />
          <div className="for-scale-grid">
            <ForScaleFactCard fact={data.forScale.debtPerHousehold} gapDescription="of federal debt per U.S. household" />
            <ForScaleFactCard fact={data.forScale.debtPerResident} gapDescription="of federal debt per U.S. resident" />
          </div>
          <p className="src">
            Sources: {data.sources.agency}, {data.sources.totalsDataset} (totals, {throughPhrase}); Debt to the
            Penny{data.bridge ? ` (${data.bridge.debtAsOfDisplay})` : ""}. Accessed {accessed}.
          </p>
        </div>
      </section>

      <div className="section tile-grid">
        <Link href="/report/where-the-money-goes" className="tile">
          <span className="tile-label">Read</span>
          <p>Chapter 1: Where the money goes — the fiscal machine, in plain language, with the full receipts-to-outlays flow.</p>
        </Link>
        <Link href="/data" className="tile">
          <span className="tile-label">Verify</span>
          <p>Data &amp; sources — every series Penny uses: the agency, the dataset, the unit, the definition.</p>
        </Link>
      </div>
    </div>
  );
}
