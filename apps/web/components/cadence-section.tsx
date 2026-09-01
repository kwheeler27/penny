import { DailyCadenceChartClient, TgaMonthChartClient } from "./cadence-charts-client";
import type { CadenceData } from "@/lib/cadence-data";
import { formatDateHuman, todayIso } from "@/lib/format";

/** "31" -> "31st", "22" -> "22nd", "13" -> "13th" — plain-English ordinal
 * suffix for an axis label naming the month's last day, which varies
 * (28-31) with no fixed correct suffix. */
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * "When does the money move?" (beat 3) — the daily cadence chart (deposits
 * up, withdrawals down, across the latest complete calendar month) and the
 * TGA-through-the-month line beneath it. All data comes from
 * lib/cadence-data.ts; this component only lays out markup and captions.
 * Renders the graceful gap state whenever no complete month of DTS data
 * exists yet — including today, before the DTS deposits/withdrawals series
 * has been registered at all — so this section needs no code change once
 * that data lands.
 */
export default function CadenceSection({ data }: { data: CadenceData }) {
  if (!data.cadence || !data.tga || !data.monthLabel) {
    return (
      <div className="cadence-empty">
        No complete calendar month of Daily Treasury Statement deposit and withdrawal data has been ingested yet —
        this section fills in automatically once it has.
      </div>
    );
  }

  const { cadence, tga, monthLabel } = data;
  const lastDay = ordinal(cadence.days.length);

  return (
    <>
      <div className="cadence-chart">
        <div className="cadence-chart-title">Daily deposits and withdrawals, {monthLabel}</div>
        <DailyCadenceChartClient days={cadence.days} depositColor="var(--series-receipts)" withdrawalColor="var(--series-outlays)" />
        <div className="cadence-axis">
          <span>1st</span>
          <span>15th</span>
          <span>{lastDay}</span>
        </div>
        <div className="cadence-cap">
          Blue columns rise for deposits (money coming in); orange columns fall for withdrawals (money going out).
          Hover any column for that day&rsquo;s exact figure. Gaps are weekends and federal holidays — the Daily
          Treasury Statement doesn&rsquo;t publish on either. These figures exclude the securities side of
          Treasury&rsquo;s debt operations — new issuance settling into deposits, maturing debt paid out of
          withdrawals — a different accounting concept from operating cash actually moving in or out; see each
          source series&rsquo; own definition, linked below.
        </div>
      </div>

      <div className="cadence-chart">
        <div className="cadence-chart-title">The Treasury General Account through {monthLabel}</div>
        <TgaMonthChartClient days={tga.days} color="var(--series-borrowing)" />
        <div className="cadence-axis">
          <span>1st</span>
          <span>15th</span>
          <span>{lastDay}</span>
        </div>
        <div className="cadence-cap">
          The government&rsquo;s cash balance at the Federal Reserve, day by day across the same month. It falls on
          days when total withdrawals outpace total deposits and rises when the reverse is true. This balance moves
          with Treasury&rsquo;s complete daily cash flow — including the debt issuance and redemptions the chart
          above deliberately excludes — so the two charts will not always move in the same direction on a given day.
          No value is plotted on a weekend or holiday, when none was published.
        </div>
      </div>

      <p className="src">
        Sources:{" "}
        {data.depositsCitation && (
          <>
            {data.depositsCitation.agency}, {data.depositsCitation.dataset}
            {" ("}
            <a href={data.depositsCitation.datasetUrl} target="_blank" rel="noopener noreferrer">
              deposits ↗
            </a>
            {")"}
            {"; "}
          </>
        )}
        {data.withdrawalsCitation && (
          <>
            {data.withdrawalsCitation.dataset}
            {" ("}
            <a href={data.withdrawalsCitation.datasetUrl} target="_blank" rel="noopener noreferrer">
              withdrawals ↗
            </a>
            {")"}
            {"; "}
          </>
        )}
        {data.tgaCitation.agency}, {data.tgaCitation.dataset}
        {" ("}
        <a href={data.tgaCitation.datasetUrl} target="_blank" rel="noopener noreferrer">
          TGA balance ↗
        </a>
        {"). "}
        Publication cadence:{" "}
        <a href="https://fiscaldata.treasury.gov/datasets/daily-treasury-statement/" target="_blank" rel="noopener noreferrer">
          the Daily Treasury Statement publishes for every business day
        </a>
        ;{" "}
        <a href="https://www.fiscal.treasury.gov/reports-statements/mts/current.html" target="_blank" rel="noopener noreferrer">
          the Monthly Treasury Statement (Act I and Act II, above) publishes once, on the eighth business day after
          each month ends
        </a>
        {" "}— which is why a month&rsquo;s full category breakdown lags behind its daily cash detail. Accessed{" "}
        {formatDateHuman(todayIso())}.
      </p>
    </>
  );
}
