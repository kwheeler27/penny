/**
 * Exhaustive tests for the four-ledger stepper's pure engine (beat 5,
 * lib/ledger-steps.ts). Every expected balance snapshot below was derived
 * independently (by hand, then cross-checked with a throwaway script run
 * against the exact same START/deltas — see the WEB agent handoff notes) —
 * never copy-pasted from applyDeltasThroughStep's own output, so this test
 * suite can actually catch a wrong delta, not just confirm the function
 * agrees with itself.
 */
import { describe, expect, it } from "vitest";
import {
  applyDeltasThroughStep,
  bankNetWorth,
  baseMoney,
  fedNetWorth,
  formatLedgerBalance,
  formatLedgerDelta,
  LAST_STEP_INDEX,
  LEDGER_BALANCE_KEYS,
  ledgerMirrorsHold,
  spendableMoney,
  START,
  STEPS,
  TAKEAWAYS,
  youNetWorth,
  type LedgerBalances,
} from "../lib/ledger-steps";

// The complete, hand-verified balances at all six states (Start, then each
// of the five transactions applied in order) — every one of the ten keys,
// every state. This is the "assert the specific known-good post-step
// balances for all 6 states" requirement, literally: not a derived
// assertion, a hardcoded expectation for every cell.
const EXPECTED_STATES: readonly LedgerBalances[] = [
  // 0 — Start
  {
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
  },
  // 1 — you pay $1,000 in taxes
  {
    "you.dep": 4000,
    "you.tsy": 0,
    "you.loan": 0,
    "bank.res": 19000,
    "bank.dep": 4000,
    "bank.loans": 0,
    "tsy.tga": 11000,
    "fed.soma": 30000,
    "fed.resl": 19000,
    "fed.tgal": 11000,
  },
  // 2 — government spends $1,000 (exact reverse of step 1 — back to Start)
  {
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
  },
  // 3 — you buy a $1,000 Treasury at auction
  {
    "you.dep": 4000,
    "you.tsy": 1000,
    "you.loan": 0,
    "bank.res": 19000,
    "bank.dep": 4000,
    "bank.loans": 0,
    "tsy.tga": 11000,
    "fed.soma": 30000,
    "fed.resl": 19000,
    "fed.tgal": 11000,
  },
  // 4 — the Fed buys your $1,000 Treasury (base money created here)
  {
    "you.dep": 5000,
    "you.tsy": 0,
    "you.loan": 0,
    "bank.res": 20000,
    "bank.dep": 5000,
    "bank.loans": 0,
    "tsy.tga": 11000,
    "fed.soma": 31000,
    "fed.resl": 20000,
    "fed.tgal": 11000,
  },
  // 5 — your bank lends you $1,000 (spendable money created here)
  {
    "you.dep": 6000,
    "you.tsy": 0,
    "you.loan": 1000,
    "bank.res": 20000,
    "bank.dep": 6000,
    "bank.loans": 1000,
    "tsy.tga": 11000,
    "fed.soma": 31000,
    "fed.resl": 20000,
    "fed.tgal": 11000,
  },
];

describe("STEPS/START/TAKEAWAYS shape", () => {
  it("has exactly six states (Start + five transactions), matching TAKEAWAYS 1:1", () => {
    expect(STEPS).toHaveLength(6);
    expect(TAKEAWAYS).toHaveLength(6);
    expect(LAST_STEP_INDEX).toBe(5);
  });

  it("Start has no deltas and no active boxes", () => {
    expect(STEPS[0]!.deltas).toEqual({});
    expect(STEPS[0]!.active).toEqual([]);
  });
});

describe("applyDeltasThroughStep — exact known-good balances for all 6 states", () => {
  EXPECTED_STATES.forEach((expected, i) => {
    it(`state ${i} (${STEPS[i]!.label}) matches every one of the 10 balances exactly`, () => {
      expect(applyDeltasThroughStep(i)).toEqual(expected);
    });
  });

  it("state 0 is literally the START object's own values", () => {
    expect(applyDeltasThroughStep(0)).toEqual(START);
  });

  it("clamps an out-of-range step index rather than throwing or reading past the array", () => {
    expect(applyDeltasThroughStep(-3)).toEqual(EXPECTED_STATES[0]);
    expect(applyDeltasThroughStep(99)).toEqual(EXPECTED_STATES[5]);
  });
});

describe("mirror invariants — hold at EVERY state, not just spot-checked ones", () => {
  for (let i = 0; i <= LAST_STEP_INDEX; i++) {
    it(`state ${i}: bank.res === fed.resl and tsy.tga === fed.tgal`, () => {
      const bal = applyDeltasThroughStep(i);
      expect(bal["bank.res"]).toBe(bal["fed.resl"]);
      expect(bal["tsy.tga"]).toBe(bal["fed.tgal"]);
      expect(ledgerMirrorsHold(bal)).toBe(true);
    });
  }
});

describe("per-box double-entry identity — assets minus liabilities matches what each box actually gained/gave up", () => {
  it("the bank's net worth (reserves + loans − deposits owed) never changes — every step it participates in is a pure pass-through, never a gain or loss to the bank itself", () => {
    for (let i = 0; i <= LAST_STEP_INDEX; i++) {
      expect(bankNetWorth(applyDeltasThroughStep(i))).toBe(15000);
    }
  });

  it("the Fed's net worth (SOMA holdings − reserves owed − TGA owed) never changes, INCLUDING step 4 where it buys a Treasury — QE grows both sides of the Fed's balance sheet equally, it doesn't create Fed equity", () => {
    for (let i = 0; i <= LAST_STEP_INDEX; i++) {
      expect(fedNetWorth(applyDeltasThroughStep(i))).toBe(0);
    }
  });

  it("your net worth (deposit + Treasuries held − loan owed) moves only at steps 1 and 2 (paying tax / receiving a payment) — every swap (buying a bond, the Fed buying your bond, borrowing from your bank) leaves it exactly unchanged", () => {
    const expected = [5000, 4000, 5000, 5000, 5000, 5000];
    for (let i = 0; i <= LAST_STEP_INDEX; i++) {
      expect(youNetWorth(applyDeltasThroughStep(i))).toBe(expected[i]);
    }
    // The two steps that actually move it move it by exactly $1,000, in the
    // direction the narrative claims: tax reduces it, the government payment
    // restores it.
    expect(youNetWorth(applyDeltasThroughStep(1)) - youNetWorth(applyDeltasThroughStep(0))).toBe(-1000);
    expect(youNetWorth(applyDeltasThroughStep(2)) - youNetWorth(applyDeltasThroughStep(1))).toBe(1000);
  });
});

describe("stepping forward to the end then back to Start restores START exactly", () => {
  it("state 5 then state 0 again equals START, key for key — no cumulative drift", () => {
    const end = applyDeltasThroughStep(LAST_STEP_INDEX);
    expect(end).not.toEqual(START); // sanity: the walk actually went somewhere
    const backToStart = applyDeltasThroughStep(0);
    expect(backToStart).toEqual(START);
  });

  it("walking every step forward 0→5 and back 5→0 always reproduces the same six snapshots, in either direction", () => {
    const forward = EXPECTED_STATES.map((_, i) => applyDeltasThroughStep(i));
    const backward = [...EXPECTED_STATES].map((_, i) => applyDeltasThroughStep(LAST_STEP_INDEX - i)).reverse();
    expect(forward).toEqual(backward);
  });
});

describe("base money / spendable money — the money-line copy's own claims, checked against the arithmetic", () => {
  // "Base money" = bank reserves alone (the Fed's own definition, minus the
  // currency in circulation this four-ledger example doesn't model — step
  // 0's own copy: "Base money (bank reserves at the Fed...): $20,000").
  // Falls by $1,000 at steps 1 and 3 (reserves leaving for the TGA), rises
  // by $1,000 at steps 2 and 4 (the reverse, and the Fed's own purchase),
  // and is unchanged at step 5 (bank lending never touches reserves).
  it("equals $20,000 at Start — bank reserves alone, exactly matching the copy", () => {
    expect(baseMoney(applyDeltasThroughStep(0))).toBe(20000);
  });

  it("falls by $1,000 at steps 1 and 3 — reserves leaving the banking system for the TGA, which base money doesn't count", () => {
    for (const i of [1, 3]) {
      const before = baseMoney(applyDeltasThroughStep(i - 1));
      const after = baseMoney(applyDeltasThroughStep(i));
      expect(after - before).toBe(-1000);
    }
  });

  it("rises by $1,000 at step 2 — the exact reverse of step 1, reserves flowing back out of the TGA", () => {
    const before = baseMoney(applyDeltasThroughStep(1));
    const after = baseMoney(applyDeltasThroughStep(2));
    expect(after - before).toBe(1000);
  });

  it("is unchanged at step 5 — the bank lending doesn't move reserves at all", () => {
    const before = baseMoney(applyDeltasThroughStep(4));
    const after = baseMoney(applyDeltasThroughStep(5));
    expect(after - before).toBe(0);
  });

  it("grows by exactly +$1,000 at step 4 — new base money, created when the Fed buys the Treasury", () => {
    const before = baseMoney(applyDeltasThroughStep(3));
    const after = baseMoney(applyDeltasThroughStep(4));
    expect(after - before).toBe(1000);
  });

  // "Dollars you can spend" = your bank deposit alone (a Treasury security
  // isn't spendable without selling it first).
  it("matches every step's own money-line claim about the direction and size of the change", () => {
    const deltas = [null, -1000, 1000, -1000, 1000, 1000]; // step 0 has no "change" (it's the baseline)
    for (let i = 1; i <= LAST_STEP_INDEX; i++) {
      const before = spendableMoney(applyDeltasThroughStep(i - 1));
      const after = spendableMoney(applyDeltasThroughStep(i));
      expect(after - before).toBe(deltas[i]);
    }
  });
});

describe("each step's deltas only ever move keys, and every key it moves is a real ledger key", () => {
  for (let i = 1; i <= LAST_STEP_INDEX; i++) {
    it(`step ${i}'s active boxes cover every box a moved key belongs to`, () => {
      const step = STEPS[i]!;
      const touchedBoxes = new Set<string>();
      for (const key of Object.keys(step.deltas)) {
        expect(LEDGER_BALANCE_KEYS).toContain(key);
        touchedBoxes.add(key.split(".")[0]!);
      }
      for (const box of touchedBoxes) {
        expect(step.active).toContain(box);
      }
    });
  }
});

describe("display formatters", () => {
  it("formatLedgerBalance mirrors the mockup's own fmt() — \"$\" + grouped digits, no sign case (every real balance is non-negative)", () => {
    expect(formatLedgerBalance(5000)).toBe("$5,000");
    expect(formatLedgerBalance(30000)).toBe("$30,000");
    expect(formatLedgerBalance(0)).toBe("$0");
  });

  it("every one of the 6 states' 10 balances is non-negative — formatLedgerBalance's no-sign-case assumption actually holds", () => {
    for (let i = 0; i <= LAST_STEP_INDEX; i++) {
      const bal = applyDeltasThroughStep(i);
      for (const key of LEDGER_BALANCE_KEYS) {
        expect(bal[key]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("formatLedgerDelta uses a true minus sign (U+2212), matching the mockup's delta-chip logic and this site's lib/format.ts sign convention", () => {
    expect(formatLedgerDelta(1000)).toBe("+$1,000");
    expect(formatLedgerDelta(-1000)).toBe("−$1,000");
    expect(formatLedgerDelta(-1000)).not.toContain("-$"); // never a plain hyphen
  });
});
