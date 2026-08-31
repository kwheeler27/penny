import { describe, it, expect } from "vitest";
import {
  mtsReceiptsResponseSchema,
  mtsOutlaysByFunctionResponseSchema,
  mtsSummaryResponseSchema,
  debtToPennyResponseSchema,
  operatingCashBalanceResponseSchema,
  interestExpenseResponseSchema,
  blsResponseSchema,
  parseFiscalDataAmount,
  FISCAL_DATA_NULL,
  CPI_U_ALL_ITEMS_SERIES_ID,
} from "../src/index";

// Samples below are shaped from LIVE FiscalData/BLS responses captured
// 2026-08-29 (see db/fixtures/raw for the full captures) — not hand-guessed
// field names. Where a fixture is small enough, the exact live values are
// reused directly so this suite doubles as a "did the schema actually match
// reality" check, not just a shape check.

const fiscalDataMetaSample = {
  count: 1,
  labels: { record_date: "Record Date" },
  dataTypes: { record_date: "DATE" },
  dataFormats: { record_date: "YYYY-MM-DD" },
  "total-count": 1,
  "total-pages": 1,
};

describe("@penny/ingest Zod schemas (FiscalData)", () => {
  it("parses a live MTS Table 4 (receipts) row, net-of-refunds included", () => {
    const sample = {
      data: [
        {
          record_date: "2026-07-31",
          parent_id: "null",
          classification_id: "59083714",
          classification_desc: "Individual Income Taxes",
          current_month_gross_rcpt_amt: "179101083890.41",
          current_month_refund_amt: "null",
          current_month_net_rcpt_amt: "173271094383.06",
          current_fytd_gross_rcpt_amt: "1000000000000.00",
          current_fytd_refund_amt: "50000000000.00",
          current_fytd_net_rcpt_amt: "950000000000.00",
          prior_fytd_gross_rcpt_amt: "900000000000.00",
          prior_fytd_refund_amt: "40000000000.00",
          prior_fytd_net_rcpt_amt: "860000000000.00",
          data_type_cd: "D",
          record_type_cd: "RSG",
          record_fiscal_year: "2026",
          record_fiscal_quarter: "4",
          record_calendar_year: "2026",
          record_calendar_month: "07",
          record_calendar_day: "31",
        },
      ],
      meta: fiscalDataMetaSample,
    };
    const result = mtsReceiptsResponseSchema.safeParse(sample);
    expect(result.success).toBe(true);
    expect(typeof result.data?.data[0]?.current_month_net_rcpt_amt).toBe("string");
    // the "null" sentinel on a genuinely inapplicable field parses, and resolves to a real null via parseFiscalDataAmount.
    expect(parseFiscalDataAmount(result.data!.data[0]!.current_month_refund_amt)).toBeNull();
  });

  it("rejects an MTS receipts response with a non-numeric, non-sentinel amount string", () => {
    const bad = {
      data: [
        {
          record_date: "2026-07-31",
          parent_id: "null",
          classification_id: "59083714",
          classification_desc: "Individual Income Taxes",
          current_month_gross_rcpt_amt: "not-a-number",
          current_month_refund_amt: "0",
          current_month_net_rcpt_amt: "0",
          current_fytd_gross_rcpt_amt: "0",
          current_fytd_refund_amt: "0",
          current_fytd_net_rcpt_amt: "0",
          prior_fytd_gross_rcpt_amt: "0",
          prior_fytd_refund_amt: "0",
          prior_fytd_net_rcpt_amt: "0",
          data_type_cd: "D",
          record_type_cd: "RSG",
          record_fiscal_year: "2026",
          record_fiscal_quarter: "4",
          record_calendar_year: "2026",
          record_calendar_month: "07",
          record_calendar_day: "31",
        },
      ],
      meta: fiscalDataMetaSample,
    };
    expect(mtsReceiptsResponseSchema.safeParse(bad).success).toBe(false);
  });

  it("parses a live MTS Table 9 (outlays by budget function) row", () => {
    const sample = {
      data: [
        {
          record_date: "2026-07-31",
          parent_id: "59085926",
          classification_id: "59085927",
          classification_desc: "National Defense",
          current_month_rcpt_outly_amt: "90571408631.42",
          current_fytd_rcpt_outly_amt: "900000000000.00",
          prior_fytd_rcpt_outly_amt: "850000000000.00",
          data_type_cd: "D",
          record_type_cd: "F",
          record_fiscal_year: "2026",
          record_fiscal_quarter: "4",
          record_calendar_year: "2026",
          record_calendar_month: "07",
          record_calendar_day: "31",
        },
      ],
      meta: fiscalDataMetaSample,
    };
    expect(mtsOutlaysByFunctionResponseSchema.safeParse(sample).success).toBe(true);
  });

  it("parses a live MTS Table 1 (summary) Year-to-Date row with a negative deficit-or-surplus amount", () => {
    const sample = {
      data: [
        {
          record_date: "2026-07-31",
          parent_id: "59083765",
          classification_id: "59083806",
          classification_desc: "Year-to-Date",
          current_month_gross_rcpt_amt: "4485419503881.15",
          current_month_gross_outly_amt: "6284235715734.18",
          current_month_dfct_sur_amt: "-1798816211853.03",
          data_type_cd: "T",
          record_type_cd: "SL",
          record_fiscal_year: "2026",
          record_fiscal_quarter: "4",
          record_calendar_year: "2026",
          record_calendar_month: "07",
          record_calendar_day: "31",
        },
      ],
      meta: fiscalDataMetaSample,
    };
    const result = mtsSummaryResponseSchema.safeParse(sample);
    expect(result.success).toBe(true);
    expect(result.data?.data[0]?.current_month_dfct_sur_amt).toBe("-1798816211853.03");
  });

  it("parses an MTS Table 1 fiscal-year header row whose amounts are all the null sentinel", () => {
    const sample = {
      data: [
        {
          record_date: "2026-07-31",
          parent_id: "null",
          classification_id: "59083765",
          classification_desc: "FY 2026",
          current_month_gross_rcpt_amt: FISCAL_DATA_NULL,
          current_month_gross_outly_amt: FISCAL_DATA_NULL,
          current_month_dfct_sur_amt: FISCAL_DATA_NULL,
          data_type_cd: "S",
          record_type_cd: "SL",
          record_fiscal_year: "2026",
          record_fiscal_quarter: "4",
          record_calendar_year: "2026",
          record_calendar_month: "07",
          record_calendar_day: "31",
        },
      ],
      meta: fiscalDataMetaSample,
    };
    expect(mtsSummaryResponseSchema.safeParse(sample).success).toBe(true);
  });

  it("parses a live Debt to the Penny response, precise to the cent", () => {
    const sample = {
      data: [
        {
          record_date: "2026-08-27",
          debt_held_public_amt: "32313802811901.63",
          intragov_hold_amt: "7763727020041.31",
          tot_pub_debt_out_amt: "40077529831942.94",
          record_fiscal_year: "2026",
          record_fiscal_quarter: "4",
          record_calendar_year: "2026",
          record_calendar_month: "08",
          record_calendar_day: "27",
        },
      ],
      meta: fiscalDataMetaSample,
    };
    const result = debtToPennyResponseSchema.safeParse(sample);
    expect(result.success).toBe(true);
    expect(result.data?.data[0]?.tot_pub_debt_out_amt).toBe("40077529831942.94");
  });

  it("parses a live Operating Cash Balance TGA Closing Balance row, where close_today_bal is the null sentinel and open_today_bal carries the real value", () => {
    const sample = {
      data: [
        {
          record_date: "2026-08-27",
          account_type: "Treasury General Account (TGA) Closing Balance",
          close_today_bal: FISCAL_DATA_NULL,
          open_today_bal: "950804",
          open_month_bal: "950804",
          open_fiscal_year_bal: "950804",
          table_nbr: "I",
          table_nm: "Operating Cash Balance",
          sub_table_name: "Cash Balance Details",
          record_fiscal_year: "2026",
          record_fiscal_quarter: "4",
          record_calendar_year: "2026",
          record_calendar_month: "08",
          record_calendar_day: "27",
        },
      ],
      meta: fiscalDataMetaSample,
    };
    const result = operatingCashBalanceResponseSchema.safeParse(sample);
    expect(result.success).toBe(true);
    expect(result.data?.data[0]?.account_type).toBe("Treasury General Account (TGA) Closing Balance");
    expect(parseFiscalDataAmount(result.data!.data[0]!.close_today_bal)).toBeNull();
    expect(parseFiscalDataAmount(result.data!.data[0]!.open_today_bal)).toBe("950804");
  });

  it("tolerates unknown extra fields (passthrough) without failing validation", () => {
    const sample = {
      data: [
        {
          record_date: "2026-08-27",
          account_type: "Treasury General Account (TGA) Closing Balance",
          close_today_bal: FISCAL_DATA_NULL,
          open_today_bal: "950804",
          record_fiscal_year: "2026",
          record_fiscal_quarter: "4",
          record_calendar_year: "2026",
          record_calendar_month: "08",
          record_calendar_day: "27",
          a_field_fiscaldata_added_later: "surprise",
        },
      ],
      meta: fiscalDataMetaSample,
    };
    expect(operatingCashBalanceResponseSchema.safeParse(sample).success).toBe(true);
  });

  it("parses a live Interest Expense response row (itemized, no total row in this dataset)", () => {
    const sample = {
      data: [
        {
          record_date: "2026-07-31",
          expense_catg_desc: "INTEREST EXPENSE ON PUBLIC ISSUES",
          expense_group_desc: "ACCRUED INTEREST EXPENSE",
          expense_type_desc: "Treasury Notes",
          month_expense_amt: "43854569972.32",
          fytd_expense_amt: "300000000000.00",
          record_fiscal_year: "2026",
          record_fiscal_quarter: "4",
          record_calendar_year: "2026",
          record_calendar_month: "07",
          record_calendar_day: "31",
        },
      ],
      meta: fiscalDataMetaSample,
    };
    expect(interestExpenseResponseSchema.safeParse(sample).success).toBe(true);
  });
});

describe("@penny/ingest Zod schemas (BLS)", () => {
  it("parses a live BLS v1 CPI-U timeseries response", () => {
    const sample = {
      status: "REQUEST_SUCCEEDED",
      responseTime: 87,
      message: [],
      Results: {
        series: [
          {
            seriesID: CPI_U_ALL_ITEMS_SERIES_ID,
            data: [
              {
                year: "2026",
                period: "M07",
                periodName: "July",
                value: "333.918",
                footnotes: [{}],
                latest: "true",
              },
            ],
          },
        ],
      },
    };
    const result = blsResponseSchema.safeParse(sample);
    expect(result.success).toBe(true);
    expect(result.data?.Results?.series[0]?.data[0]?.value).toBe("333.918");
  });

  it("rejects a response with an unrecognized status", () => {
    const bad = { status: "SOMETHING_ELSE", responseTime: 1, message: [] };
    expect(blsResponseSchema.safeParse(bad).success).toBe(false);
  });
});
