/**
 * Act III's "how the borrowing actually happens" mechanism block — static
 * narrative copy, per the approved mockup, with three corrections verified
 * live against the primary sources on 2026-08-31 (see the source links
 * below for what each claim actually rests on):
 *
 *  - "banks required to bid" -> the New York Fed's primary-dealers page
 *    says dealers are *expected* to bid "on a pro-rata basis in all
 *    Treasury auctions at reasonably competitive prices" (never "required"
 *    outside of SEC registration/reporting), and the current dealer list is
 *    broker-dealers (several bank-affiliated), not banks themselves.
 *  - the mortgage/car-loan "benchmark" claim — unsupported by either source
 *    this block cites — is dropped rather than asserted uncited in Penny's
 *    voice (CLAUDE.md: every factual claim carries a citation).
 *  - "The Federal Reserve doesn't bid at auctions... bought them
 *    secondhand" is the *opposite* of the New York Fed's own rollover FAQ:
 *    the Desk places noncompetitive bids directly at Treasury auctions to
 *    roll over maturing SOMA holdings (treated as add-ons to the announced
 *    auction size); the Fed buys *additional* Treasuries, beyond a rollover,
 *    in the secondary market.
 */
import Link from "next/link";

export default function HowBorrowingWorks() {
  return (
    <div className="how">
      <div className="how-title">How the borrowing actually happens</div>
      <ol className="how-steps">
        <li>
          <b>
            The Treasury <Link href="/auctions">schedules an auction</Link>.
          </b>{" "}
          It sells bills (four weeks to 52 weeks), notes (2, 3, 5, 7, or 10 years), and bonds (20 or 30 years) on a
          published calendar — week in, week out.
        </li>
        <li>
          <b>Investors bid.</b> Primary dealers — broker-dealers the New York Fed expects to bid in every auction —
          plus money-market funds, pensions, insurers, and foreign governments state how much yield they demand to
          lend.
        </li>
        <li>
          <b>The auction clears at one yield: the government’s cost to borrow.</b> Every successful bidder pays that
          same yield, published within hours of the auction’s close.
        </li>
        <li>
          <b>Money changes hands.</b> The buyer’s bank balance goes down; the Treasury’s account at the Fed — the
          TGA in the strip up top — goes up. Then it flows back out as spending.
        </li>
      </ol>
      <div className="how-note">
        (The Federal Reserve does not bid competitively at auctions: the New York Fed’s Desk submits noncompetitive
        tenders to roll over maturing Treasury holdings, treated as add-ons to the announced auction size, and buys
        any additional Treasuries in the secondary market. That distinction matters later.)
      </div>
      <div className="how-segue">
        Step 4 raises the real question: if everyone is paying with dollars,{" "}
        <Link href="/report/where-dollars-come-from">
          <em>where do dollars come from in the first place?</em>
        </Link>{" "}
        That’s the money-creation story — the chapter Penny builds next, auction by auction.
      </div>
      <p className="src">
        Sources:{" "}
        <a href="https://www.treasurydirect.gov/marketable-securities/" target="_blank" rel="noopener noreferrer">
          TreasuryDirect, About Treasury Marketable Securities ↗
        </a>
        ; <a href="https://www.treasurydirect.gov/auctions/how-auctions-work/" target="_blank" rel="noopener noreferrer">
          TreasuryDirect, How Auctions Work ↗
        </a>
        ; <a href="https://www.newyorkfed.org/markets/primarydealers.html" target="_blank" rel="noopener noreferrer">
          Federal Reserve Bank of New York, Primary Dealers ↗
        </a>
        ; <a href="https://www.newyorkfed.org/markets/treasury-rollover-faq" target="_blank" rel="noopener noreferrer">
          Federal Reserve Bank of New York, FAQs: Treasury Rollovers ↗
        </a>
        .
      </p>
    </div>
  );
}
