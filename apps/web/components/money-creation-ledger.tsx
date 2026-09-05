"use client";

/**
 * The four-ledger stepper (beat 5's centerpiece) — step pills + prev/next,
 * active-box highlighting, delta chips, and the per-step story + money-
 * quantity line + takeaway, all copy verbatim from the approved mockup
 * (penny-money-creation.html). All arithmetic comes from lib/ledger-steps.ts
 * (a pure, exhaustively tested engine — see test/ledger-steps.test.ts); this
 * component only renders it and owns the "which step is showing" UI state.
 *
 * Recomputes the full balance snapshot from START every render
 * (`applyDeltasThroughStep(cur)`, never a running accumulator this
 * component mutates step by step) — the same reason stepping to the end and
 * back to Start always reproduces START exactly, verified in
 * ledger-steps.test.ts, holds here too: there is no accumulated client
 * state to drift.
 *
 * Server-renders the Start state correctly (this component's default
 * `cur = 0` matches STEPS[0], so SSR output before hydration already shows
 * the real starting position — the page works without JS; stepping needs
 * it, which is fine per the build spec). `prefers-reduced-motion` is
 * respected by CSS alone (globals.css's `.ledger-bal`/`.ledger-box`
 * transitions are disabled under that media query, matching how the
 * approved mockup itself guards its own transitions) — nothing here reads
 * that preference in JS.
 */
import { useState, type CSSProperties } from "react";
import {
  applyDeltasThroughStep,
  formatLedgerBalance,
  formatLedgerDelta,
  LAST_STEP_INDEX,
  STEPS,
  TAKEAWAYS,
  type LedgerBalanceKey,
  type LedgerBoxId,
} from "@/lib/ledger-steps";

interface BoxRow {
  readonly key: LedgerBalanceKey;
  readonly label: string;
}

interface BoxDef {
  readonly id: LedgerBoxId;
  readonly title: string;
  readonly sub: string;
  /** A `var(--token)` reference — resolved by the page's own CSS, matching
   * every chart color prop elsewhere in this codebase. */
  readonly colorVar: string;
  readonly rows: readonly BoxRow[];
}

// Verbatim from the mockup's own box markup — titles, sub-labels, and every
// row label, in the mockup's own declaration order. Box colors are BOX
// identities, a separate registry from series hues (docs/DESIGN_PRINCIPLES.md
// §7 "two registries, kept distinct"): You wears muted ink, Your bank the
// outlays orange, The Fed the borrowing green — and The Treasury wears
// --series-tga, the TGA's own entity hue, so this box rhymes with the TGA
// line in the chart below it (the box IS the TGA — its sub says so).
const BOX_DEFS: readonly BoxDef[] = [
  {
    id: "you",
    title: "You",
    sub: "a household’s ledger",
    colorVar: "var(--text-muted)",
    rows: [
      { key: "you.dep", label: "Deposit at your bank" },
      { key: "you.tsy", label: "Treasuries you hold" },
      { key: "you.loan", label: "What you owe the bank" },
    ],
  },
  {
    id: "bank",
    title: "Your bank",
    sub: "reserves are its money; deposits are its IOUs to you",
    colorVar: "var(--series-outlays)",
    rows: [
      { key: "bank.res", label: "Reserves at the Fed" },
      { key: "bank.dep", label: "Deposits owed to customers" },
      { key: "bank.loans", label: "Loans outstanding" },
    ],
  },
  {
    id: "tsy",
    title: "The Treasury",
    sub: "the government’s checking account (beat 3’s TGA)",
    colorVar: "var(--series-tga)",
    rows: [{ key: "tsy.tga", label: "TGA balance at the Fed" }],
  },
  {
    id: "fed",
    title: "The Fed",
    sub: "everyone else’s ledger lives inside this one",
    colorVar: "var(--series-borrowing)",
    rows: [
      { key: "fed.soma", label: "Treasuries held (SOMA)" },
      { key: "fed.resl", label: "Reserves owed to banks" },
      { key: "fed.tgal", label: "TGA owed to Treasury" },
    ],
  },
];

type BoxColorStyle = CSSProperties & { "--bxc"?: string };

export default function MoneyCreationLedger() {
  const [cur, setCur] = useState(0);
  const bal = applyDeltasThroughStep(cur);
  const step = STEPS[cur]!;
  const takeaway = TAKEAWAYS[cur]!;

  return (
    <div className="ledger-wrap">
      <div className="ledger-steps-nav" role="group" aria-label="Transactions">
        {STEPS.map((s, i) => (
          <button key={s.label} type="button" aria-pressed={i === cur} onClick={() => setCur(i)}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="ledger-step-story">
        <div className="ledger-st-title">{step.title}</div>
        <div className="ledger-st-body">{step.body}</div>
        <div className="ledger-st-money">
          {step.money.map((seg, i) => (seg.bold ? <b key={i}>{seg.text}</b> : <span key={i}>{seg.text}</span>))}
        </div>
      </div>

      <div className="ledger-boxes">
        {BOX_DEFS.map((box) => {
          const active = step.active.includes(box.id);
          const style: BoxColorStyle = { "--bxc": box.colorVar };
          return (
            <div key={box.id} className={active ? "ledger-box active" : "ledger-box"} style={style}>
              <h3>
                <span className="ledger-dot" aria-hidden="true" />
                {box.title}
              </h3>
              <div className="ledger-box-sub">{box.sub}</div>
              {box.rows.map((row) => {
                const delta = step.deltas[row.key];
                const moved = delta !== undefined;
                return (
                  <div key={row.key} className={moved ? "ledger-bal moved" : "ledger-bal"}>
                    <span className="ledger-bl">{row.label}</span>
                    <span className="ledger-bv">
                      <span className="ledger-n">{formatLedgerBalance(bal[row.key])}</span>
                      {/* Always mounted so the opacity transition can run — the
                          fade needs the element to exist before .moved lands. */}
                      <span className={`ledger-delta ${moved ? (delta! > 0 ? "up" : "down") : ""}`} aria-hidden={!moved}>
                        {moved ? formatLedgerDelta(delta!) : " "}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="ledger-foot">
        <div className="ledger-pn">
          <button type="button" onClick={() => setCur((c) => Math.max(0, c - 1))} disabled={cur === 0}>
            ‹ Previous
          </button>
          <button type="button" onClick={() => setCur((c) => Math.min(LAST_STEP_INDEX, c + 1))} disabled={cur === LAST_STEP_INDEX}>
            Next ›
          </button>
        </div>
        <div className="ledger-foot-note">
          Mirrors stay consistent by construction: the bank’s reserves and the Fed’s “reserves owed” always match; so do
          the TGA lines.
        </div>
      </div>

      <p className="ledger-takeaway">{takeaway}</p>
    </div>
  );
}
