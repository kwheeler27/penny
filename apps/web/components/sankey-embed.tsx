/**
 * The living Sankey embed (ORCHESTRATION_PROMPT.md core flow 6). Fetches
 * the latest-month and fiscal-year-to-date MTS flow, converts each to
 * @buck/viz's FiscalFlowInput contract (lib/fiscal-flow-input.ts), and
 * renders @buck/viz's real <FiscalSankey> for each — behind the
 * dependency-free PeriodToggle so a reader can switch between "this month"
 * and "fiscal year to date" without JS (see components/period-toggle.tsx).
 *
 * A period with nothing ingested yet renders as an explicit "no report"
 * message instead of an empty/degenerate diagram — CLAUDE.md: missing data
 * is a gap, never a zero (and a Sankey with every category omitted would
 * draw as a zero-size hub, which reads as a bug, not honesty).
 */
import { SERIES } from "@buck/registry";
import FiscalSankeyClient from "./fiscal-sankey-client";
import PeriodToggle from "./period-toggle";
import { toFiscalFlowInput } from "@/lib/fiscal-flow-input";
import { getMtsFlow } from "@/lib/series-data";

function todayIso(): string {
  // "Today" for a citation access-date, not a stored calendar value — same
  // convention @buck/registry's own citationFor() default uses.
  return new Date().toISOString().slice(0, 10);
}

function NoReportYet() {
  return (
    <div className="flow-empty">
      No Monthly Treasury Statement data has been ingested yet for this view. Run <code>pnpm seed</code> once the
      ingest workstream lands fixtures.
    </div>
  );
}

export default async function SankeyEmbed({ idPrefix = "sankey" }: { idPrefix?: string }) {
  const [monthFlow, fytdFlow] = await Promise.all([getMtsFlow("month"), getMtsFlow("fiscal_ytd")]);
  const monthInput = toFiscalFlowInput(monthFlow);
  const fytdInput = toFiscalFlowInput(fytdFlow);
  const accessDate = todayIso();

  if (!monthInput && !fytdInput) {
    return <NoReportYet />;
  }

  return (
    <PeriodToggle
      idPrefix={idPrefix}
      month={monthInput ? <FiscalSankeyClient input={monthInput} seriesCatalog={SERIES} accessDate={accessDate} /> : <NoReportYet />}
      fiscalYtd={fytdInput ? <FiscalSankeyClient input={fytdInput} seriesCatalog={SERIES} accessDate={accessDate} /> : <NoReportYet />}
    />
  );
}
