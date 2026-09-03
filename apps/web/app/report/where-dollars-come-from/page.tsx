import MoneyCreationLedger from "@/components/money-creation-ledger";
import { DualCadenceHistoryChartClient } from "@/components/money-creation-chart-client";
import { getMoneyCreationChartData } from "@/lib/money-creation-data";
import { formatDateHuman, todayIso } from "@/lib/format";

// TGA is a daily series (fiscal.tga.closing_balance publishes most business
// days); bank reserves publish weekly. 15 minutes matches the front-door/
// auction-page ISR window (lib/front-door-data.ts, app/auctions/page.tsx) —
// generous for either cadence, never stale by more than a quarter hour.
export const revalidate = 900;

// Route name is officially TBD (ORCHESTRATION_PROMPT.md) — deliberately not
// added to the site nav (Kevin's mockup keeps it there only as the "here"
// breadcrumb; the real nav stays The story / Auctions / Data & sources).
// This page is reached only through its three inbound links: the front
// door's how-borrowing segue, the story page's closing hand-off, and the
// auction page's SOMA definition.
export const metadata = { title: "Where do dollars come from?" };

export default async function WhereDollarsComeFromPage() {
  const chart = await getMoneyCreationChartData();
  const accessed = formatDateHuman(todayIso());
  const hasTga = chart.tga.points.length > 0;
  const hasReserves = chart.reserves.points.length > 0;
  // The chart's own honest window — never a claim about what episode a
  // reader will see, since that depends on how far the TGA daily ingest has
  // backfilled (currently a few months; see money-creation-transform.ts's
  // clipReservesToTgaWindow doc comment). Computed from the actual plotted
  // points, not hardcoded, so this stays true as more history lands.
  const allDates = [...chart.tga.points, ...chart.reserves.points].map((p) => p.date).sort();
  const windowStart = allDates[0];
  const windowEnd = allDates[allDates.length - 1];

  return (
    <div className="page">
      <div className="prose-width mc-hero">
        <div className="mc-kicker">The story · beat 5</div>
        <h1>Where do dollars come from?</h1>
        <p className="page-lede">
          Most dollars are never printed. They come into being as entries in ledgers — and vanish the same way.
          There are only four ledgers that matter: yours, your bank’s, the Treasury’s, and the Fed’s. Walk five
          everyday transactions through them and you’ve seen the whole machine.
        </p>
      </div>

      <section className="section">
        <div className="prose-width">
          <h2>The four ledgers</h2>
          <p className="sub">
            A worked example — $1,000 each time, to keep the arithmetic visible. Click a transaction; watch which
            balances move. Every step is double-entry: nothing appears anywhere without appearing somewhere else,
            with its sign flipped.
          </p>
        </div>
        <div className="act-wide">
          <MoneyCreationLedger />

          {/* Mechanics citation, verified live 2026-09-02 (see this page's
              handoff notes): the approved mockup's own parenthetical quote —
              "…by crediting the reserve accounts of the sellers' banks" —
              doesn't match either Fed source's own published wording
              exactly, so it's replaced here with a real, verbatim quote from
              the Federal Reserve Board's own FAQ, keeping the same
              two-source structure (Open Market Operations + FAQ) and the
              same worked-example disclaimer, per how-borrowing-works.tsx's
              own precedent for correcting an unverifiable mockup quote
              against the primary source rather than shipping it uncited. */}
          <p className="src">
            Mechanics per the primary record: how the Fed pays for securities —{" "}
            <a href="https://www.federalreserve.gov/faqs/money_12853.htm" target="_blank" rel="noopener noreferrer">
              Federal Reserve, FAQ
            </a>{" "}
            (“the increase in the Federal Reserve&rsquo;s holdings of Treasury securities is matched by a
            corresponding increase in reserve balances held by the banking system”); what open market operations
            are —{" "}
            <a href="https://www.federalreserve.gov/monetarypolicy/openmarket.htm" target="_blank" rel="noopener noreferrer">
              Federal Reserve, “Open Market Operations”
            </a>
            ; why the Fed&rsquo;s own auction
            bids (step 4) are noncompetitive rollovers, not competitive bids —{" "}
            <a href="https://www.newyorkfed.org/markets/treasury-rollover-faq" target="_blank" rel="noopener noreferrer">
              Federal Reserve Bank of New York, FAQs: Treasury Rollovers
            </a>
            ; how bank lending creates deposits — attributed below. Worked example amounts are illustrative.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="prose-width">
          <h2>Where the mechanics end and interpretation starts</h2>
        </div>
        <div className="act-wide">
          <div className="mc-attrib">
            Everything the ledger above shows is uncontested bookkeeping — you can verify each move in the
            institutions’ own published accounts. What economists <b>debate</b> is what the mechanics imply: whether
            bank lending or central-bank policy is the binding constraint on money growth, and how much any of it
            matters for inflation. When Penny covers that debate, each position gets a name attached — e.g., the{" "}
            <b>Bank of England’s</b> 2014 bulletin{" "}
            <i>
              <a
                href="https://www.bankofengland.co.uk/quarterly-bulletin/2014/q1/money-creation-in-the-modern-economy"
                target="_blank"
                rel="noopener noreferrer"
              >
                “Money creation in the modern economy”
              </a>
            </i>{" "}
            describes lending as the main way deposits are created (step 5’s framing); the <b>monetarist</b>{" "}
            tradition — canonically Milton Friedman and Anna Schwartz, <i>A Monetary History of the United States,
            1867–1960</i> (1963) — emphasizes the central bank’s balance sheet (step 4). Penny doesn’t referee. The
            ledgers are the facts; the fights are cited.
          </div>
        </div>
      </section>

      <section className="section">
        <div className="prose-width">
          <h2>The plumbing, breathing — in real data</h2>
          <p className="sub">
            The ledger’s claims are checkable, with a caveat: reserves and the TGA are both liabilities on the
            Fed’s own balance sheet, so all else equal, a bigger TGA means fewer reserves — steps 1 and 3’s
            mechanism, at national scale. “All else equal” is doing real work there: the Fed’s own asset holdings,
            the overnight reverse repo facility, and currency in circulation move too, so week to week the two
            lines don’t move in exact lockstep.
          </p>
        </div>
        <div className="act-wide">
          {!hasTga && !hasReserves ? (
            <div className="cadence-empty">
              No TGA or bank-reserves data has been ingested yet — this chart fills in automatically once it has.
            </div>
          ) : (
            <div className="cadence-chart">
              <div className="cadence-chart-title">Two lines, one $ axis: bank reserves &amp; the TGA</div>
              <DualCadenceHistoryChartClient
                a={{ points: chart.tga.points, color: "var(--series-receipts)", label: chart.tga.label, cadenceLabel: chart.tga.cadenceLabel }}
                b={{ points: chart.reserves.points, color: "var(--series-borrowing)", label: chart.reserves.label, cadenceLabel: chart.reserves.cadenceLabel }}
              />
              <div className="cadence-cap">
                {windowStart && windowEnd ? (
                  <>
                    {formatDateHuman(windowStart)} – {formatDateHuman(windowEnd)}, as ingested so far — both are Fed
                    balance-sheet liabilities, so the accounting above governs them, even where day-to-day moves
                    don’t line up one for one. A tax deadline or a debt-limit episode will show up here once the
                    ingested window covers one.
                  </>
                ) : (
                  "Beat 3’s cadence, seen from the Fed’s side of the ledger."
                )}
                {!hasReserves && " Bank reserves aren’t ingested yet — this line fills in automatically once they are."}
                {!hasTga && " The TGA hasn’t been ingested yet — this line fills in automatically once it has."}
              </div>
            </div>
          )}
          <p className="src">
            Sources: {chart.tgaCitation.agency}, {chart.tgaCitation.dataset} (
            <a href={chart.tgaCitation.datasetUrl} target="_blank" rel="noopener noreferrer">
              TGA ↗
            </a>
            ){chart.reservesCitation && (
              <>
                ; {chart.reservesCitation.agency}, {chart.reservesCitation.dataset} (
                <a href={chart.reservesCitation.datasetUrl} target="_blank" rel="noopener noreferrer">
                  reserves ↗
                </a>
                )
              </>
            )}
            . Accessed {accessed}.
          </p>
        </div>
      </section>
    </div>
  );
}
