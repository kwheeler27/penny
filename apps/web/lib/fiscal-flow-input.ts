/**
 * Pure transform: an MtsFlow (lib/series-data.ts's DB-shaped read) -> the
 * FiscalFlowInput @buck/viz's <FiscalSankey> renders from. Kept separate
 * from the DB call so it's unit-testable against a hand-built MtsFlow
 * fixture, no database involved.
 *
 * @buck/viz owns all the arithmetic here — it sums the category values
 * itself (via buildFiscalFlowGraph) rather than trusting the published
 * total, so this function passes exact decimal-string values straight
 * through and does no scaling/rounding of its own. The one judgment call
 * this file makes is deciding when there's nothing to show at all: null
 * means "don't render a Sankey for this period," not "render an empty one."
 */
import { getSeries, type Magnitude } from "@buck/registry";
import type { MtsFlow } from "./series-data";
import type { FiscalFlowInput } from "@buck/viz";

const RECEIPTS_TOTAL_ID = "fiscal.mts.receipts.total" as const;
const OUTLAYS_TOTAL_ID = "fiscal.mts.outlays.total" as const;
const DEFICIT_ID = "fiscal.mts.deficit.total" as const;

function sharedMagnitude(): Magnitude {
  // Every fiscal.mts.* series is published in the same magnitude within one
  // MTS release (the FiscalData API returns MTS amounts in whole dollars and
  // cents, i.e. magnitude "ones" — the printed PDF's own "$ millions" framing
  // describes that report, not this API) — this reads it from the registry
  // rather than hardcoding a value so a future magnitude change to the
  // registry YAML is the only place that has to move.
  return getSeries(RECEIPTS_TOTAL_ID)?.magnitude ?? "ones";
}

/**
 * Returns null when there is nothing to show for this period at all — no
 * receipts total, no outlays total, no fiscal year known. Never returns an
 * "empty" FiscalFlowInput; a caller passing all-omitted categories to
 * <FiscalSankey> would render a degenerate zero-size diagram instead of an
 * honest "no report yet" message, so that decision happens here, once.
 */
export function toFiscalFlowInput(flow: MtsFlow): FiscalFlowInput | null {
  if (!flow.periodEnd || flow.fiscalYear == null) return null;
  const hasAnyReading =
    flow.receipts.categories.some((c) => c.reading) || flow.outlays.categories.some((c) => c.reading);
  if (!hasAnyReading) return null;

  return {
    period: {
      periodType: flow.periodType === "fiscal_ytd" ? "fiscal_ytd" : "month",
      periodEnd: flow.periodEnd,
      fiscalYear: flow.fiscalYear,
    },
    unit: "usd",
    magnitude: sharedMagnitude(),
    receiptsTotalSeriesId: RECEIPTS_TOTAL_ID,
    outlaysTotalSeriesId: OUTLAYS_TOTAL_ID,
    deficitSeriesId: DEFICIT_ID,
    receipts: flow.receipts.categories.map((c) => ({ seriesId: c.id, value: c.reading?.value })),
    outlays: flow.outlays.categories.map((c) => ({ seriesId: c.id, value: c.reading?.value })),
  };
}
