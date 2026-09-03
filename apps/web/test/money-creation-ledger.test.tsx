/**
 * Component-markup test for MoneyCreationLedger — rendered to static HTML
 * via react-dom/server, matching test/category-history-chart.test.tsx's own
 * convention (no jsdom/RTL in this repo's test setup, so only the
 * server-rendered default state — Start — is checked here; the pure
 * stepping/invariant logic itself is exhaustively covered against no React
 * at all in test/ledger-steps.test.ts).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MoneyCreationLedger from "../components/money-creation-ledger";

describe("MoneyCreationLedger — server-rendered Start state", () => {
  const html = renderToStaticMarkup(<MoneyCreationLedger />);

  it("renders the Start step's title, body, and money line verbatim", () => {
    expect(html).toContain("The starting position");
    // React HTML-escapes the apostrophe as &#x27;.
    expect(html).toContain(
      "Four ledgers at rest. Note the mirrors: your $5,000 deposit is your bank&#x27;s $5,000 liability; the bank&#x27;s $20,000 of reserves and the Treasury&#x27;s $10,000 TGA are both entries on the Fed&#x27;s ledger.",
    );
    expect(html).toContain("Dollars you can spend: ");
    expect(html).toContain("<b>$5,000</b>");
    expect(html).toContain("<b>$20,000</b>");
  });

  it("renders all six step pills, the first one pressed", () => {
    expect((html.match(/aria-pressed="true"/g) || []).length).toBe(1);
    expect((html.match(/aria-pressed="false"/g) || []).length).toBe(5);
    expect(html).toContain(">Start<");
    expect(html).toContain(">1 · You pay tax<");
    expect(html).toContain(">5 · The bank lends<");
  });

  it("disables Previous but not Next at Start", () => {
    expect(html).toContain('<button type="button" disabled="">‹ Previous</button>');
    expect(html).toContain('<button type="button">Next ›</button>');
  });

  it("renders all 10 balances at their START values, with no delta chips (Start has no deltas)", () => {
    expect(html).toContain("$5,000"); // you.dep and bank.dep both start here
    expect(html).toContain("$20,000"); // bank.res and fed.resl
    expect(html).toContain("$10,000"); // tsy.tga and fed.tgal
    expect(html).toContain("$30,000"); // fed.soma
    expect(html).not.toContain("ledger-bal moved");
    expect(html).not.toContain("ledger-delta up");
    expect(html).not.toContain("ledger-delta down");
  });

  it("highlights no box as active at Start (STEPS[0].active is empty)", () => {
    expect(html).not.toContain("ledger-box active");
  });

  it("renders all four boxes with their verbatim titles and sub-labels", () => {
    for (const title of [">You<", ">Your bank<", ">The Treasury<", ">The Fed<"]) expect(html).toContain(title);
    expect(html).toContain("a household’s ledger");
    expect(html).toContain("reserves are its money; deposits are its IOUs to you");
    expect(html).toContain("the government’s checking account (beat 3’s TGA)");
    expect(html).toContain("everyone else’s ledger lives inside this one");
  });

  it("renders every balance row's verbatim label", () => {
    for (const label of [
      "Deposit at your bank",
      "Treasuries you hold",
      "What you owe the bank",
      "Reserves at the Fed",
      "Deposits owed to customers",
      "Loans outstanding",
      "TGA balance at the Fed",
      "Treasuries held (SOMA)",
      "Reserves owed to banks",
      "TGA owed to Treasury",
    ]) {
      expect(html).toContain(label);
    }
  });

  it("renders the mirrors footnote and the Start takeaway verbatim", () => {
    expect(html).toContain("the bank’s reserves and the Fed’s “reserves owed” always match");
    expect(html).toContain("“where do dollars come from?” has two answers, and the ledgers show both.");
  });
});
