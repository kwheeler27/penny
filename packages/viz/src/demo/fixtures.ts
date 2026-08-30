/**
 * Fixture-driven demo data — ILLUSTRATIVE/SYNTHETIC numbers, not a real
 * Treasury release (no live ingest exists yet; this package never
 * fetches). Built to exercise <FiscalSankey> end to end without apps/web:
 * every category the registry defines is represented, including the two
 * "missing data" paths the layout math must handle —
 * `undistributed_offsetting_receipts` is omitted as not-yet-modeled
 * (`value: undefined`) and `allowances` is an explicit zero reading
 * (`value: "0"`) — both must disappear from the render, never show as a
 * zero-height ghost. Series definitions/citations come from the REAL
 * @buck/registry catalog, so the demo's detail panel shows genuine
 * agency/dataset/citation text even though the dollar figures are made up.
 */
import { SERIES } from "@buck/registry";
import type { FiscalFlowInput, SeriesCatalog } from "../types";

export const fiscalFlowSeriesCatalog: SeriesCatalog = SERIES;

const receiptValues: Record<string, string> = {
  "fiscal.mts.receipts.category.individual_income_tax": "180000",
  "fiscal.mts.receipts.category.corporation_income_tax": "35000",
  "fiscal.mts.receipts.category.social_insurance_retirement": "120000",
  "fiscal.mts.receipts.category.excise_taxes": "7000",
  "fiscal.mts.receipts.category.estate_and_gift_taxes": "2500",
  "fiscal.mts.receipts.category.customs_duties": "6000",
  "fiscal.mts.receipts.category.miscellaneous_receipts": "4500",
};

const outlayValues: Record<string, string | undefined> = {
  "fiscal.mts.outlays.category.national_defense": "80000",
  "fiscal.mts.outlays.category.social_security": "130000",
  "fiscal.mts.outlays.category.medicare": "95000",
  "fiscal.mts.outlays.category.health": "60000",
  "fiscal.mts.outlays.category.income_security": "55000",
  "fiscal.mts.outlays.category.net_interest": "70000",
  "fiscal.mts.outlays.category.veterans_benefits_and_services": "22000",
  "fiscal.mts.outlays.category.education_training_employment_social_services": "9000",
  "fiscal.mts.outlays.category.transportation": "8000",
  "fiscal.mts.outlays.category.international_affairs": "4000",
  "fiscal.mts.outlays.category.general_government": "3000",
  "fiscal.mts.outlays.category.administration_of_justice": "3500",
  "fiscal.mts.outlays.category.natural_resources_and_environment": "3000",
  "fiscal.mts.outlays.category.agriculture": "2500",
  "fiscal.mts.outlays.category.community_and_regional_development": "1200",
  "fiscal.mts.outlays.category.general_science_space_technology": "2200",
  "fiscal.mts.outlays.category.energy": "1000",
  "fiscal.mts.outlays.category.commerce_and_housing_credit": "1500",
  // Explicit zero reading this month — must be omitted, not rendered as a zero-height flow.
  "fiscal.mts.outlays.category.allowances": "0",
  // Not modeled in this fixture (ordinarily negative — see FiscalSankey known-gaps note on negative-valued categories) — absent, must be omitted.
  "fiscal.mts.outlays.category.undistributed_offsetting_receipts": undefined,
};

export const fiscalFlowFixture: FiscalFlowInput = {
  period: { periodType: "month", periodEnd: "2026-07-31", fiscalYear: 2026 },
  unit: "usd",
  // Every fiscal.mts.* series in the real registry is published in magnitude
  // "ones" (FiscalData returns MTS amounts in whole dollars and cents, not
  // the printed PDF's "$ millions" framing) — this fixture combines its
  // illustrative dollar figures with the REAL registry catalog
  // (fiscalFlowSeriesCatalog above), so declaring anything other than "ones"
  // here would silently mismatch detail.ts's per-series magnitude lookup
  // (which always uses the real "ones") against this demo's own graph-level
  // magnitude — exactly the magnitude-mixing bug CLAUDE.md forbids.
  magnitude: "ones",
  receiptsTotalSeriesId: "fiscal.mts.receipts.total",
  outlaysTotalSeriesId: "fiscal.mts.outlays.total",
  deficitSeriesId: "fiscal.mts.deficit.total",
  receipts: Object.entries(receiptValues).map(([seriesId, value]) => ({ seriesId: seriesId as FiscalFlowInput["receiptsTotalSeriesId"], value })),
  outlays: Object.entries(outlayValues).map(([seriesId, value]) => ({ seriesId: seriesId as FiscalFlowInput["outlaysTotalSeriesId"], value })),
};
