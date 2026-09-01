import Link from "next/link";
import HeroStrip from "@/components/hero-strip";
import RankedBarChart from "@/components/ranked-bar-chart";
import ForScaleFactCard from "@/components/for-scale-fact";
import FiscalBridge from "@/components/fiscal-bridge";
import HowBorrowingWorks from "@/components/how-borrowing-works";
import DeficitHistoryChart from "@/components/deficit-history-chart";
import { getFrontDoorData } from "@/lib/front-door-data";
import { formatDateHuman, todayIso } from "@/lib/format";

export const revalidate = 900;

export default async function Home() {
  const data = await getFrontDoorData();
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

  return (
    <div className="page">
      <div className="prose-width hero-lede">
        <h1>Every last penny.</h1>
        <p className="page-lede">
          Penny shows where federal money goes, where it comes from, and how the difference is borrowed — every
          number from the agency of record, updated as the record updates.
        </p>
      </div>

      <HeroStrip cells={data.heroCells} />

      <section className="act">
        <div className="prose-width">
          <div className="act-kicker act-kicker--spend">Act I · Spending</div>
          <h2>What the government spent</h2>
          <p className="act-lede">
            Outlays — money actually paid out, by budget function. Click any bar to see how that category has moved.
          </p>
        </div>
        <div className="act-wide">
          <RankedBarChart
            idPrefix="spend"
            colorVar="--series-outlays"
            toggleLabels={data.outlays.toggleLabels}
            periods={data.outlays.periods}
            histories={data.outlays.histories}
            footNote="Percentages are each category’s share of the period’s net total. Rows below the zero line are net offsets — money that flowed back to the government — so their shares are negative. Chart labels are rounded to $0.1 billion; hover any bar for the exact published figure."
          />
          <div className="for-scale-grid">
            <ForScaleFactCard fact={data.forScale.perHouseholdSpend} gapDescription="spent per U.S. household so far this fiscal year" />
            <ForScaleFactCard fact={data.forScale.interestPerTaxDollar} gapDescription="of individual income tax receipts went to interest on the debt" />
          </div>
          <p className="src">
            Source: {data.sources.agency}, {data.sources.outlaysDataset}, {outlaysPeriodPhrase}; individual income
            taxes (used above) from {data.sources.receiptsDataset}, {receiptsPeriodPhrase}. Accessed {accessed}.
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

      <section className="act">
        <div className="prose-width">
          <div className="act-kicker act-kicker--gap">Act III · The gap</div>
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
