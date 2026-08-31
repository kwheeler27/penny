import Link from "next/link";
import SankeyEmbed from "@/components/sankey-embed";

export const revalidate = 900;

export default function Home() {
  return (
    <div className="page">
      <div className="prose-width">
        <h1>The penny stops here.</h1>
        <p className="page-lede">
          Penny makes the US dollar system legible: where federal money comes from, where every dollar of spending
          goes, how the Treasury&apos;s and the Federal Reserve&apos;s plumbing works, and how it transmits to
          markets and the rates people pay. Built entirely on primary sources, with every number traceable to the
          agency of record.
        </p>
      </div>

      <div className="section">
        <div className="section-heading">
          <h2>Receipts, outlays, and the deficit</h2>
          <Link href="/report/where-the-money-goes">Read the chapter →</Link>
        </div>
        <p className="page-lede" style={{ marginBottom: "1.5rem" }}>
          Every dollar the government collected and spent, for the latest month and for the fiscal year to date. The
          deficit is what&apos;s left over — a balancing figure, not a category of spending.
        </p>
        <SankeyEmbed idPrefix="home-flow" />
      </div>

      <div className="section">
        <div className="tile-grid">
          <Link href="/now" className="tile">
            <span className="tile-label">Now</span>
            <p>The debt, the Treasury&apos;s cash balance, and the fiscal-year-to-date deficit — dated and sourced.</p>
          </Link>
          <Link href="/report/where-the-money-goes" className="tile">
            <span className="tile-label">Report</span>
            <p>Chapter 1: Where the money goes — a plain-language walk through the fiscal machine.</p>
          </Link>
          <Link href="/data" className="tile">
            <span className="tile-label">Data</span>
            <p>Every series Penny uses: the agency, the dataset, the unit, the definition.</p>
          </Link>
        </div>
      </div>
    </div>
  );
}
