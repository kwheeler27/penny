/**
 * The living Sankey embed (ORCHESTRATION_PROMPT.md core flow 6). Fetches
 * the latest-month and fiscal-year-to-date MTS flow, converts each to
 * @penny/viz's FiscalFlowInput contract (lib/fiscal-flow-input.ts), and
 * renders @penny/viz's real <FiscalSankey> for each — behind the
 * dependency-free PeriodToggle so a reader can switch between "this month"
 * and "fiscal year to date" without JS (see components/period-toggle.tsx).
 *
 * A period with nothing ingested yet renders as an explicit "no report"
 * message instead of an empty/degenerate diagram — CLAUDE.md: missing data
 * is a gap, never a zero (and a Sankey with every category omitted would
 * draw as a zero-size hub, which reads as a bug, not honesty).
 */
import { SERIES } from "@penny/registry";
import FiscalSankeyClient from "./fiscal-sankey-client";
import PeriodToggle from "./period-toggle";
import { toFiscalFlowInput } from "@/lib/fiscal-flow-input";
import { getMtsFlow } from "@/lib/series-data";
import { todayIso } from "@/lib/format";

function NoReportYet() {
  return (
    <div className="flow-empty">
      No Monthly Treasury Statement data has been ingested yet for this view. Run <code>pnpm seed</code> once the
      ingest workstream lands fixtures.
    </div>
  );
}

/** toFiscalFlowInput throws when a referenced series' magnitude doesn't
 * match the flow's shared magnitude (a real data-integrity problem — see
 * that function's doc comment) — caught here so one bad series definition
 * renders a loud, visible error for that one diagram instead of a 500 for
 * the whole page, matching @penny/viz's own FiscalSankey error affordance. */
function safeToFiscalFlowInput(flow: Parameters<typeof toFiscalFlowInput>[0]): { input: ReturnType<typeof toFiscalFlowInput>; error: string | null } {
  try {
    return { input: toFiscalFlowInput(flow), error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[SankeyEmbed] failed to build FiscalFlowInput:", message);
    return { input: null, error: message };
  }
}

function FlowBuildError({ message }: { message: string }) {
  return (
    <div className="flow-empty" role="alert">
      This diagram couldn&apos;t be built: {message}
    </div>
  );
}

export default async function SankeyEmbed({ idPrefix = "sankey" }: { idPrefix?: string }) {
  const [monthFlow, fytdFlow] = await Promise.all([getMtsFlow("month"), getMtsFlow("fiscal_ytd")]);
  const { input: monthInput, error: monthError } = safeToFiscalFlowInput(monthFlow);
  const { input: fytdInput, error: fytdError } = safeToFiscalFlowInput(fytdFlow);
  const accessDate = todayIso();

  if (!monthInput && !fytdInput && !monthError && !fytdError) {
    return <NoReportYet />;
  }

  return (
    <PeriodToggle
      idPrefix={idPrefix}
      month={monthError ? <FlowBuildError message={monthError} /> : monthInput ? <FiscalSankeyClient input={monthInput} seriesCatalog={SERIES} accessDate={accessDate} /> : <NoReportYet />}
      fiscalYtd={fytdError ? <FlowBuildError message={fytdError} /> : fytdInput ? <FiscalSankeyClient input={fytdInput} seriesCatalog={SERIES} accessDate={accessDate} /> : <NoReportYet />}
    />
  );
}
