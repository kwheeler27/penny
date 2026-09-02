/**
 * Parser + known-value tests for the daily/monthly/batch sources other than
 * MTS (see reconciliation.test.ts for MTS). Every fixture here is a real
 * captured API response (db/fixtures/raw) except the CBO CSV, which is a
 * hand-extracted copy of CBO's own published workbook — see that
 * directory's SOURCE.md.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { debtToPennyResponseSchema, operatingCashBalanceResponseSchema, interestExpenseResponseSchema, blsResponseSchema } from "../src/index";
import { parseDebtToPenny } from "../src/jobs/debt-daily";
import { parseTgaClosingBalance } from "../src/jobs/tga-daily";
import { parseInterestExpense } from "../src/jobs/interest-expense-monthly";
import { parseCpi } from "../src/jobs/cpi-monthly";
import { parseCboBaselineCsv } from "../src/cbo/baseline-deficit";
import { parseCboBaselineRows, CBO_BASELINE_CSV_PATH, CBO_BASELINE_PUBLICATION_DATE } from "../src/jobs/cbo-baseline";
import { parseCboBaselineOutlaysCsv } from "../src/cbo/baseline-outlays";
import { parseCboBaselineOutlaysRows, CBO_BASELINE_OUTLAYS_CSV_PATH, CBO_BASELINE_OUTLAYS_PUBLICATION_DATE } from "../src/jobs/cbo-baseline-outlays";
import { parseCboBaselineRevenuesCsv } from "../src/cbo/baseline-revenues";
import { parseCboBaselineRevenuesRows, CBO_BASELINE_REVENUES_CSV_PATH, CBO_BASELINE_REVENUES_PUBLICATION_DATE } from "../src/jobs/cbo-baseline-revenues";
import { loadRawFixture } from "./helpers";

describe("Debt to the Penny", () => {
  const response = debtToPennyResponseSchema.parse(loadRawFixture("fiscaldata/debt_to_penny/2026-06-01_to_2026-08-27.json"));
  const observations = parseDebtToPenny(response);

  it("known-value spot check: total public debt outstanding on 2026-08-27", () => {
    const row = observations.find((o) => o.periodEnd === "2026-08-27");
    expect(row?.value).toBe("40077529831942.94");
    expect(row?.periodType).toBe("day");
    expect(row?.fiscalYear).toBe(2026);
  });

  it("weekends/holidays are absent, never a zero or carried-forward row", () => {
    const daysInRange = Math.round((new Date("2026-08-27").getTime() - new Date("2026-06-01").getTime()) / 86_400_000) + 1;
    // 63 business-day rows in the fixture over an 88-calendar-day span — proves gaps were genuinely skipped, not "trivially every day happened to be present."
    expect(observations.length).toBeLessThan(daysInRange);
    expect(observations.find((o) => o.periodEnd === "2026-06-06")).toBeUndefined(); // a Saturday.
    expect(observations.find((o) => o.periodEnd === "2026-06-07")).toBeUndefined(); // a Sunday.
    expect(observations.every((o) => o.value !== "0")).toBe(true);
  });
});

describe("TGA closing balance (Daily Treasury Statement, operating cash balance)", () => {
  const response = operatingCashBalanceResponseSchema.parse(
    loadRawFixture("fiscaldata/operating_cash_balance/2026-06-01_to_2026-08-27.json"),
  );
  const observations = parseTgaClosingBalance(response);

  it("known-value spot check: TGA closing balance on 2026-08-27, read from open_today_bal per the documented field-swap", () => {
    const row = observations.find((o) => o.periodEnd === "2026-08-27");
    expect(row?.value).toBe("950804");
  });

  it("only the Closing Balance account_type is ingested (not Opening Balance / Deposits / Withdrawals rows also present in this dataset)", () => {
    // one row per business day, not up to 4 (the dataset's other account_type rows for the same day must be filtered out).
    const byDate = new Map<string, number>();
    for (const o of observations) byDate.set(o.periodEnd, (byDate.get(o.periodEnd) ?? 0) + 1);
    expect([...byDate.values()].every((n) => n === 1)).toBe(true);
  });

  it("weekends/holidays are absent gaps", () => {
    expect(observations.find((o) => o.periodEnd === "2026-06-06")).toBeUndefined();
  });
});

describe("Interest expense on the public debt (computed aggregate — this dataset has no total row)", () => {
  const response = interestExpenseResponseSchema.parse(
    loadRawFixture("fiscaldata/interest_expense/2024-08-31_to_2026-07-31.json"),
  );
  const observations = parseInterestExpense(response);

  it("July 2026's monthly total is the exact sum of that month's 38 itemized rows", () => {
    const row = observations.find((o) => o.periodType === "month" && o.periodEnd === "2026-07-31");
    expect(row?.value).toBe("117573576107.24");
  });

  it("covers all 24 months present in the fixture", () => {
    const months = observations.filter((o) => o.periodType === "month");
    expect(months).toHaveLength(24);
  });
});

describe("CPI-U, all items (BLS)", () => {
  const response = blsResponseSchema.parse(loadRawFixture("bls/cpi_u_all_items/2021_to_2026.json"));
  const fetchedAt = "2026-08-29T12:00:00Z";
  const observations = parseCpi(response, fetchedAt);

  it("known-value spot checks", () => {
    const july2026 = observations.find((o) => o.periodEnd === "2026-07-31");
    expect(july2026?.value).toBe("333.918");
    expect(july2026?.fiscalYear).toBeNull(); // an index has no fiscal-year semantics.
    const jan2021 = observations.find((o) => o.periodEnd === "2021-01-31");
    expect(jan2021?.value).toBe("261.582");
  });

  it("covers 66 of the 67 calendar months from 2021-01 through 2026-07, no annual M13 rows — October 2025 is a genuine published gap, not an ingest bug", () => {
    // BLS returned the literal string "-" for 2025-10 (footnote: "Data
    // unavailable due to the 2025 lapse in appropriations") rather than
    // omitting the data point outright. A non-numeric sentinel value must
    // never reach a `numeric` column or get coerced to 0 — parseDataPoint
    // treats it as the gap it is, so 2025-10 is legitimately absent here.
    expect(observations).toHaveLength(66);
    expect(observations.find((o) => o.periodEnd === "2025-10-31")).toBeUndefined();
  });
});

describe("CBO baseline deficit projection (batch CSV, not a cron)", () => {
  const csv = readFileSync(CBO_BASELINE_CSV_PATH, "utf8");
  const rows = parseCboBaselineCsv(csv);
  const observations = parseCboBaselineRows(rows, CBO_BASELINE_PUBLICATION_DATE);

  it("loads 11 projected fiscal years (2026-2036), excluding CBO's 'Actual,' 2025 column", () => {
    expect(observations).toHaveLength(11);
    expect(observations.every((o) => o.periodType === "year")).toBe(true);
    expect(observations.find((o) => o.fiscalYear === 2025)).toBeUndefined();
  });

  it("known-value spot checks, in CBO's own published magnitude (billions)", () => {
    const fy2026 = observations.find((o) => o.fiscalYear === 2026);
    expect(fy2026?.value).toBe("-1852.703");
    const fy2030 = observations.find((o) => o.fiscalYear === 2030);
    expect(fy2030?.value).toBe("-2200.642");
    expect(fy2030?.periodStart).toBe("2029-10-01");
    expect(fy2030?.periodEnd).toBe("2030-09-30");
  });

  it("every projected year is negative (a projected deficit, not a surplus) for this baseline", () => {
    expect(observations.every((o) => o.value.startsWith("-"))).toBe(true);
  });
});

describe("CBO baseline outlays projection (batch CSV, not a cron)", () => {
  const csv = readFileSync(CBO_BASELINE_OUTLAYS_CSV_PATH, "utf8");
  const rows = parseCboBaselineOutlaysCsv(csv);
  const observations = parseCboBaselineOutlaysRows(rows, CBO_BASELINE_OUTLAYS_PUBLICATION_DATE);

  it("loads 11 projected fiscal years (2026-2036), excluding CBO's 'Actual,' 2025 column", () => {
    expect(observations).toHaveLength(11);
    expect(observations.every((o) => o.periodType === "year")).toBe(true);
    expect(observations.find((o) => o.fiscalYear === 2025)).toBeUndefined();
  });

  it("known-value spot checks, in CBO's own published magnitude (billions)", () => {
    const fy2026 = observations.find((o) => o.fiscalYear === 2026);
    expect(fy2026?.value).toBe("7448.619");
    const fy2030 = observations.find((o) => o.fiscalYear === 2030);
    expect(fy2030?.value).toBe("8795.641");
    expect(fy2030?.periodStart).toBe("2029-10-01");
    expect(fy2030?.periodEnd).toBe("2030-09-30");
  });

  it("every projected year is positive (outlays are always positive in this baseline)", () => {
    expect(observations.every((o) => !o.value.startsWith("-"))).toBe(true);
  });

  it("reconciles with the deficit series: revenues - outlays = deficit for every fiscal year, to the workbook's own rounding", () => {
    const deficitCsv = readFileSync(CBO_BASELINE_CSV_PATH, "utf8");
    const deficitObservations = parseCboBaselineRows(parseCboBaselineCsv(deficitCsv), CBO_BASELINE_PUBLICATION_DATE);
    const revenuesCsv = readFileSync(CBO_BASELINE_REVENUES_CSV_PATH, "utf8");
    const revenuesObservations = parseCboBaselineRevenuesRows(parseCboBaselineRevenuesCsv(revenuesCsv), CBO_BASELINE_REVENUES_PUBLICATION_DATE);
    for (const outlays of observations) {
      const revenues = revenuesObservations.find((o) => o.fiscalYear === outlays.fiscalYear)!;
      const deficit = deficitObservations.find((o) => o.fiscalYear === outlays.fiscalYear)!;
      expect(Number(revenues.value) - Number(outlays.value)).toBeCloseTo(Number(deficit.value), 3);
    }
  });
});

describe("CBO baseline revenues projection (batch CSV, not a cron)", () => {
  const csv = readFileSync(CBO_BASELINE_REVENUES_CSV_PATH, "utf8");
  const rows = parseCboBaselineRevenuesCsv(csv);
  const observations = parseCboBaselineRevenuesRows(rows, CBO_BASELINE_REVENUES_PUBLICATION_DATE);

  it("loads 11 projected fiscal years (2026-2036), excluding CBO's 'Actual,' 2025 column", () => {
    expect(observations).toHaveLength(11);
    expect(observations.every((o) => o.periodType === "year")).toBe(true);
    expect(observations.find((o) => o.fiscalYear === 2025)).toBeUndefined();
  });

  it("known-value spot checks, in CBO's own published magnitude (billions)", () => {
    const fy2026 = observations.find((o) => o.fiscalYear === 2026);
    expect(fy2026?.value).toBe("5595.916");
    const fy2030 = observations.find((o) => o.fiscalYear === 2030);
    expect(fy2030?.value).toBe("6594.999");
    expect(fy2030?.periodStart).toBe("2029-10-01");
    expect(fy2030?.periodEnd).toBe("2030-09-30");
  });

  it("every projected year is positive (revenues are always positive in this baseline)", () => {
    expect(observations.every((o) => !o.value.startsWith("-"))).toBe(true);
  });
});
