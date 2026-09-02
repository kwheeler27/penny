/**
 * The four-ledger stepper's pure engine (beat 5, "Where do dollars come
 * from?" — the approved mockup at penny-money-creation.html). This module
 * owns the worked example's numbers ($1,000 each time, four ledgers: you,
 * your bank, the Treasury, and the Fed) and nothing else — no React, no
 * DOM, no formatting decisions beyond the two tiny display helpers below.
 * apps/web/components/money-creation-ledger.tsx renders it; apps/web/test/
 * ledger-steps.test.ts is where every invariant below is actually checked.
 *
 * START/STEPS/TAKEAWAYS are transcribed VERBATIM from the approved mockup's
 * own <script> block (same ten balance keys, same six steps including
 * "Start", same deltas, same copy) — the mockup's JS object literals were
 * extracted directly into this file rather than retyped by hand, specifically
 * to eliminate transcription risk on numbers that double as the accounting
 * spec. The one intentional restructuring: each step's `money` line (raw
 * HTML in the mockup, e.g. "Dollars you can spend: <b>$5,000</b>.") is
 * reshaped into a plain array of `{ text, bold? }` segments so the
 * component can render it with ordinary JSX — never `dangerouslySetInnerHTML`
 * — while the concatenated text, including which spans were bold, is
 * unchanged.
 *
 * TWO corrections made against the mockup's own copy after review (never
 * touching the deltas/balances above — every number stays exactly as
 * specified):
 *
 *  1. Step 4's body said "the Fed doesn't bid at auction," which is the
 *     *opposite* of the New York Fed's own rollover FAQ — the Desk places
 *     noncompetitive bids directly at Treasury auctions to roll over
 *     maturing SOMA holdings (add-ons to the announced auction size). Fixed
 *     to match the wording `components/how-borrowing-works.tsx` already
 *     corrected the same claim to; see that file's own doc comment and the
 *     citation added alongside this page's mechanics source note.
 *  2. Every step's "Base money" line originally meant "bank reserves + the
 *     TGA balance" — a made-up aggregate, not what the Federal Reserve
 *     itself means by "the monetary base" (currency in circulation plus
 *     reserve balances; the TGA is a non-reserve Treasury deposit, not part
 *     of it). Redefined `baseMoney` to bank reserves alone — the closest
 *     this four-ledger example gets to the Fed's real definition, since
 *     physical currency isn't one of the four ledgers modeled here (noted
 *     inline at Start). Consequence, now accurate rather than backwards:
 *     paying tax or buying a bond (steps 1 and 3) *shrinks* base money by
 *     $1,000 each — reserves leaving the banking system for the TGA — and
 *     government spending (step 2) is the exact reverse. This is also the
 *     mechanism the page's TGA-vs-reserves chart is about, so the ledger and
 *     the chart now teach the same lesson instead of contradicting it.
 *
 * Every balance is a whole-dollar JS number (never a decimal string needing
 * exact BigInt arithmetic like every other money value on this site) —
 * deliberately: this is a labeled, illustrative $1,000 worked example, not a
 * registry-sourced figure, and CLAUDE.md's exact-decimal-arithmetic rule
 * exists to protect real published figures from float error, not a fixed
 * teaching example whose only operations are +1000/-1000 on values well
 * within float's exact-integer range.
 */

export type LedgerBalanceKey =
  | "you.dep"
  | "you.tsy"
  | "you.loan"
  | "bank.res"
  | "bank.dep"
  | "bank.loans"
  | "tsy.tga"
  | "fed.soma"
  | "fed.resl"
  | "fed.tgal";

/** Every balance key, in the mockup's own declaration order — the set
 * `applyDeltasThroughStep` walks and every exhaustive test iterates. */
export const LEDGER_BALANCE_KEYS: readonly LedgerBalanceKey[] = [
  "you.dep",
  "you.tsy",
  "you.loan",
  "bank.res",
  "bank.dep",
  "bank.loans",
  "tsy.tga",
  "fed.soma",
  "fed.resl",
  "fed.tgal",
];

export type LedgerBoxId = "you" | "bank" | "tsy" | "fed";

export type LedgerBalances = Readonly<Record<LedgerBalanceKey, number>>;

/** One run of a step's "money" line — `bold` marks the spans the mockup
 * wrapped in `<b>`. Rendered as plain JSX (never dangerouslySetInnerHTML);
 * concatenating every segment's `text` reproduces the mockup's line exactly. */
export interface LedgerMoneySegment {
  readonly text: string;
  readonly bold?: true;
}

export interface LedgerStep {
  readonly label: string;
  readonly title: string;
  readonly body: string;
  readonly money: readonly LedgerMoneySegment[];
  /** Only the keys this step actually moves — every other key holds. */
  readonly deltas: Readonly<Partial<Record<LedgerBalanceKey, number>>>;
  /** Which boxes this step touches, for the component's "active box" highlight. */
  readonly active: readonly LedgerBoxId[];
}

/** State 0 — "at rest," before any of the five transactions. Verbatim from
 * the mockup's `const START`. */
export const START: LedgerBalances = {
  "you.dep": 5000,
  "you.tsy": 0,
  "you.loan": 0,
  "bank.res": 20000,
  "bank.dep": 5000,
  "bank.loans": 0,
  "tsy.tga": 10000,
  "fed.soma": 30000,
  "fed.resl": 20000,
  "fed.tgal": 10000,
};

/** Six states: STEPS[0] is "Start" (empty deltas, the baseline above);
 * STEPS[1..5] are the five transactions, verbatim from the mockup's own
 * `const STEPS` — label/title/body/deltas/active transcribed unchanged, only
 * `money`'s markup reshaped into segments (see this file's header comment). */
export const STEPS: readonly LedgerStep[] = [
  {
    label: "Start",
    title: "The starting position",
    body: "Four ledgers at rest. Note the mirrors: your $5,000 deposit is your bank's $5,000 liability; the bank's $20,000 of reserves and the Treasury's $10,000 TGA are both entries on the Fed's ledger.",
    money: [
      { text: "Dollars you can spend: " },
      { text: "$5,000", bold: true },
      { text: ". Base money (bank reserves at the Fed — the Fed's own definition; it also includes cash in circulation, not modeled here): " },
      { text: "$20,000", bold: true },
      { text: "." },
    ],
    deltas: {},
    active: [],
  },
  {
    label: "1 · You pay tax",
    title: "You pay $1,000 in taxes",
    body: "Your deposit falls; your bank settles by transferring reserves; the Fed moves the balance from the bank's reserve account to the Treasury's TGA. Nothing is destroyed — but your dollars have left the private economy and now sit in the government's account.",
    money: [
      { text: "Dollars you can spend: " },
      { text: "−$1,000", bold: true },
      { text: ". Base money: " },
      { text: "−$1,000", bold: true },
      { text: " — reserves left the banking system for the TGA, which the Fed's base-money count doesn't include." },
    ],
    deltas: { "you.dep": -1000, "bank.dep": -1000, "bank.res": -1000, "fed.resl": -1000, "fed.tgal": 1000, "tsy.tga": 1000 },
    active: ["you", "bank", "tsy", "fed"],
  },
  {
    label: "2 · Government spends",
    title: "The government pays someone $1,000",
    body: "A Social Security payment, say — beat 1's outlays, one at a time. The exact reverse of a tax payment: TGA down, reserves up, the recipient's deposit up. Government spending puts deposits into the private economy the same way taxes pull them out.",
    money: [
      { text: "Private-sector deposits: " },
      { text: "+$1,000", bold: true },
      { text: ". Base money: " },
      { text: "+$1,000", bold: true },
      { text: " — the exact reverse of step 1, reserves flowing back out of the TGA." },
    ],
    deltas: { "tsy.tga": -1000, "fed.tgal": -1000, "fed.resl": 1000, "bank.res": 1000, "bank.dep": 1000, "you.dep": 1000 },
    active: ["tsy", "fed", "bank", "you"],
  },
  {
    label: "3 · You buy a bond",
    title: "You buy a $1,000 Treasury at auction",
    body: "Beat 4's auction, from the buyer's side. Your deposit falls, reserves move to the TGA — and you hold a bond instead. No money was created or destroyed: you swapped a spendable deposit for a security. This is what 'financing the deficit' looks like on the ledgers.",
    money: [
      { text: "Dollars you can spend: " },
      { text: "−$1,000", bold: true },
      { text: " (you hold a bond now). Base money: " },
      { text: "−$1,000", bold: true },
      { text: " again — same mechanism as step 1: reserves move to the TGA to settle the purchase." },
    ],
    deltas: { "you.dep": -1000, "you.tsy": 1000, "bank.dep": -1000, "bank.res": -1000, "fed.resl": -1000, "fed.tgal": 1000, "tsy.tga": 1000 },
    active: ["you", "bank", "tsy", "fed"],
  },
  {
    label: "4 · The Fed buys",
    title: "The Fed buys your $1,000 Treasury",
    body: "Secondhand, in the open market — the Fed doesn't bid competitively at auction (beat 4); its only auction bids are noncompetitive add-ons that roll over its own maturing holdings. It pays by crediting your bank's reserve account, a balance only it can expand. Your bond becomes a deposit again; the banking system's reserves grow. THIS is the step where new base money comes into existence — an entry, not a printing press.",
    money: [
      { text: "Dollars you can spend: " },
      { text: "+$1,000", bold: true },
      { text: ". Base money: " },
      { text: "+$1,000 — created here", bold: true },
      { text: "." },
    ],
    deltas: { "you.tsy": -1000, "you.dep": 1000, "fed.soma": 1000, "fed.resl": 1000, "bank.res": 1000, "bank.dep": 1000 },
    active: ["fed", "bank", "you"],
  },
  {
    label: "5 · The bank lends",
    title: "Your bank lends you $1,000",
    body: "The bank doesn't hand over someone else's deposits — it writes two entries: a loan (its asset) and a new deposit in your account (its liability). Your spendable dollars grew without anyone else's shrinking and without any reserves moving. Most dollars in existence were born exactly this way. When you repay, the entries reverse and those dollars vanish.",
    money: [
      { text: "Dollars you can spend: " },
      { text: "+$1,000 — created here", bold: true },
      { text: ", by a commercial bank. Base money: " },
      { text: "unchanged", bold: true },
      { text: "." },
    ],
    deltas: { "bank.loans": 1000, "bank.dep": 1000, "you.dep": 1000, "you.loan": 1000 },
    active: ["bank", "you"],
  },
];

export const LAST_STEP_INDEX = STEPS.length - 1;

/** Verbatim from the mockup's own `const TAKEAWAYS` — one per state,
 * TAKEAWAYS[i] pairs with STEPS[i]. */
export const TAKEAWAYS: readonly string[] = [
  "Five transactions, one lesson: “where do dollars come from?” has two answers, and the ledgers show both.",
  "Taxes don't feed a vault — they move balances from your side of the Fed's ledger to the government's.",
  "Spending is taxing in reverse. The deficit is just step 2 happening more than step 1.",
  "Bond sales fund the gap without creating money — they swap deposits for securities. That's why beat 4's auctions exist.",
  "New base money is born when the Fed buys assets — created by keystroke, extinguished the same way when it sells.",
  "New spendable money is mostly born when banks lend — which is why “how much money exists” isn't a number the government simply decides.",
];

/** Recomputes the ledger's balances from START through `stepIndex`
 * (inclusive), fresh from START every call — never a running accumulator a
 * component could drift out of sync by mutating in place. This is what
 * guarantees "step to N, then back to 0, restores START exactly": step 0
 * always recomputes to literally the START object's values, by construction,
 * not by trusting some other code path to undo what it did. `stepIndex` is
 * clamped to [0, LAST_STEP_INDEX] so an out-of-range caller degrades to a
 * valid state rather than throwing.
 */
export function applyDeltasThroughStep(stepIndex: number): LedgerBalances {
  const clamped = Math.max(0, Math.min(stepIndex, LAST_STEP_INDEX));
  const bal: Record<LedgerBalanceKey, number> = { ...START };
  for (let i = 1; i <= clamped; i++) {
    const step = STEPS[i];
    if (!step) continue;
    for (const key of LEDGER_BALANCE_KEYS) {
      const delta = step.deltas[key];
      if (delta !== undefined) bal[key] += delta;
    }
  }
  return bal;
}

/** True when both of the ledger's structural mirrors hold: a bank's reserves
 * always equal what the Fed's ledger says it owes that bank in reserves, and
 * the Treasury's TGA balance always equals what the Fed's ledger says it
 * owes the Treasury. These two entries are literally the same dollars,
 * recorded on both sides of a Fed liability — every transaction above is
 * built to preserve that by construction, and this predicate is what the
 * exhaustive test (ledger-steps.test.ts) checks at every one of the six
 * states, not just spot-checked ones. */
export function ledgerMirrorsHold(bal: LedgerBalances): boolean {
  return bal["bank.res"] === bal["fed.resl"] && bal["tsy.tga"] === bal["fed.tgal"];
}

/** A household's net worth: what it holds (a bank deposit, plus any
 * Treasury securities) minus what it owes (a bank loan). One of the three
 * per-box double-entry identities this module exposes for the exhaustive
 * test — see bankNetWorth/fedNetWorth below for the other two, and
 * ledger-steps.test.ts for why each stays flat except at the two steps that
 * actually change this party's own wealth (paying tax, receiving a payment). */
export function youNetWorth(bal: LedgerBalances): number {
  return bal["you.dep"] + bal["you.tsy"] - bal["you.loan"];
}

/** A bank's net worth: its reserves plus its loans outstanding (assets)
 * minus the deposits it owes its customers (its liabilities). Every
 * transaction in this ledger leaves this unchanged — a bank never gets
 * richer or poorer simply by moving money for someone else or by lending
 * (this simplified model carries no interest/spread), which is exactly the
 * "double-entry" claim the per-step deltas are built to satisfy. */
export function bankNetWorth(bal: LedgerBalances): number {
  return bal["bank.res"] + bal["bank.loans"] - bal["bank.dep"];
}

/** The Fed's net worth: the securities it holds (SOMA, its asset) minus what
 * it owes in reserves and in the TGA (its liabilities). Stays flat at every
 * step, including step 4 (the Fed buying a Treasury) — QE grows both sides
 * of the Fed's balance sheet by the same amount, it doesn't create Fed
 * "equity"; the money that's newly created there is a monetary-aggregate
 * fact (see baseMoney below), not a net-worth fact. */
export function fedNetWorth(bal: LedgerBalances): number {
  return bal["fed.soma"] - bal["fed.resl"] - bal["fed.tgal"];
}

/** "Base money" per the Federal Reserve's own definition — currency in
 * circulation plus reserve balances (H.3's monetary base) — NOT reserves
 * plus the TGA, which was this file's own pre-correction copy (see this
 * file's header comment, correction 2). Physical currency isn't one of the
 * four ledgers this worked example models, so `bank.res` alone is the
 * closest this simplified example gets; the Start step's money line notes
 * the omission explicitly rather than pretending currency doesn't exist.
 * The TGA is deliberately excluded: it's a Treasury deposit liability, not
 * a reserve, and this is exactly why steps 1 and 3 now show base money
 * FALLING (reserves leaving for the TGA) rather than the "unchanged" the
 * old, wrong definition produced. */
export function baseMoney(bal: LedgerBalances): number {
  return bal["bank.res"];
}

/** "Dollars you can spend" per the mockup's own money-line copy — a
 * household's bank deposit alone (a Treasury security held isn't spendable
 * without first selling it, so `you.tsy` never counts here; a loan is a
 * liability, not spending money). */
export function spendableMoney(bal: LedgerBalances): number {
  return bal["you.dep"];
}

/** "$5,000" style — mirrors the mockup's own `fmt`. Every ledger balance is
 * non-negative in every one of the six states (verified in
 * ledger-steps.test.ts), so this never needs a sign case. */
export function formatLedgerBalance(value: number): string {
  return "$" + value.toLocaleString("en-US");
}

/** "+$1,000" / "−$1,000" style — mirrors the mockup's own delta-chip
 * logic exactly (a true minus sign, U+2212, matching this site's existing
 * sign convention in lib/format.ts, never a plain hyphen). */
export function formatLedgerDelta(delta: number): string {
  return (delta > 0 ? "+" : "−") + formatLedgerBalance(Math.abs(delta));
}
