import { FiscalSankey } from "../components/FiscalSankey";
import { fiscalFlowFixture, fiscalFlowSeriesCatalog } from "./fixtures";

/**
 * Story-style export: exercises <FiscalSankey> against the fixture data
 * without needing apps/web. A host page (or a future Storybook/Ladle
 * setup) can render `<FiscalSankeyDemo />` directly; test/demo.test.ts
 * exercises the underlying fixture + graph without a DOM, which is the
 * part CI can actually run today (see packages/viz's handoff report for
 * why component rendering itself isn't part of the vitest run yet).
 */
export function FiscalSankeyDemo() {
  return (
    <FiscalSankey
      input={fiscalFlowFixture}
      seriesCatalog={fiscalFlowSeriesCatalog}
      accessDate="2026-08-29"
      onSelect={(detail) => {
        if (detail?.node) {
          // eslint-disable-next-line no-console -- demo-only visibility into the interaction wiring.
          console.log("[FiscalSankeyDemo] selected", detail.node.id, detail.formattedValue);
        }
      }}
    />
  );
}
