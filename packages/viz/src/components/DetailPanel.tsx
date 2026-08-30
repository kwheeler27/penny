import type { FlowDetail } from "../types";
import { resolveNodeLabel } from "../layout/buildFiscalFlowGraph";
import type { SeriesCatalog } from "../types";

export interface DetailPanelProps {
  readonly detail: FlowDetail | null;
  readonly catalog: SeriesCatalog;
  readonly onClose?: () => void;
}

/**
 * The hover/tap detail affordance: value, plain-language definition, and
 * full citation (agency, dataset, as-of date) for whatever node or flow is
 * selected. Definition/citation text is exactly what the caller passed in
 * via `catalog` / FlowDetail — this component never invents copy.
 */
export function DetailPanel({ detail, catalog, onClose }: DetailPanelProps) {
  if (!detail || !detail.node) return null;
  const label = resolveNodeLabel(detail.node, catalog);

  return (
    <div
      role="region"
      aria-live="polite"
      aria-label={`Detail: ${label}`}
      style={{
        border: "1px solid var(--bfs-gridline)",
        borderRadius: 8,
        padding: "12px 16px",
        background: "var(--bfs-surface)",
        color: "var(--bfs-text-primary)",
        maxWidth: 480,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <strong style={{ fontSize: 15 }}>{label}</strong>
        <span style={{ fontSize: 20 }}>{detail.formattedValue}</span>
      </div>
      {detail.series ? (
        <>
          <p style={{ margin: "8px 0 0", fontSize: 13, lineHeight: 1.5, color: "var(--bfs-text-secondary)" }}>
            {detail.series.definition}
          </p>
          <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.4, color: "var(--bfs-muted)" }}>{detail.citation}</p>
        </>
      ) : null}
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close detail"
          style={{ marginTop: 8, fontSize: 12, background: "none", border: "none", color: "var(--bfs-text-secondary)", cursor: "pointer", padding: 0 }}
        >
          Close
        </button>
      ) : null}
    </div>
  );
}
