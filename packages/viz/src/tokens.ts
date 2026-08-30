/**
 * Token layer for @buck/viz — one place light/dark values live, consumed
 * only by role from components (dataviz skill: categorical hues assigned
 * by the job they do, never cycled; validated with
 * scripts/validate_palette.js — blue/orange/aqua as a 3-slot categorical
 * set clears CVD separation + normal-vision floor in both light and dark,
 * light-mode aqua carries a contrast WARN mitigated by always pairing it
 * with a visible label + hatch pattern, never color alone).
 *
 * Color here means "receipts" vs. "outlays" vs. "the balancing flow" —
 * NOT good/bad. The balancing flow (borrowing or surplus) never uses a
 * status/alert color: CLAUDE.md's neutral-register rule forbids editorial
 * color, and "the deficit is red" is exactly that kind of editorializing.
 */
export const FISCAL_SANKEY_CLASS = "buck-fiscal-sankey";

export const fiscalSankeyStyleTag = `
.${FISCAL_SANKEY_CLASS} {
  color-scheme: light;
  --bfs-surface:      #fcfcfb;
  --bfs-text-primary: #0b0b0b;
  --bfs-text-secondary: #52514e;
  --bfs-muted:        #898781;
  --bfs-gridline:     #e1e0d9;
  --bfs-hub:          #52514e;
  --bfs-receipt:      #2a78d6;
  --bfs-outlay:       #eb6834;
  --bfs-balancing:    #1baf7a;
  --bfs-focus-ring:   #2a78d6;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .${FISCAL_SANKEY_CLASS} {
    color-scheme: dark;
    --bfs-surface:      #1a1a19;
    --bfs-text-primary: #ffffff;
    --bfs-text-secondary: #c3c2b7;
    --bfs-muted:        #898781;
    --bfs-gridline:     #2c2c2a;
    --bfs-hub:          #c3c2b7;
    --bfs-receipt:      #3987e5;
    --bfs-outlay:       #d95926;
    --bfs-balancing:    #199e70;
    --bfs-focus-ring:   #3987e5;
  }
}
:root[data-theme="dark"] .${FISCAL_SANKEY_CLASS} {
  color-scheme: dark;
  --bfs-surface:      #1a1a19;
  --bfs-text-primary: #ffffff;
  --bfs-text-secondary: #c3c2b7;
  --bfs-muted:        #898781;
  --bfs-gridline:     #2c2c2a;
  --bfs-hub:          #c3c2b7;
  --bfs-receipt:      #3987e5;
  --bfs-outlay:       #d95926;
  --bfs-balancing:    #199e70;
  --bfs-focus-ring:   #3987e5;
}
.${FISCAL_SANKEY_CLASS} text {
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  fill: var(--bfs-text-primary);
}
.${FISCAL_SANKEY_CLASS} .bfs-muted-text { fill: var(--bfs-text-secondary); }
.${FISCAL_SANKEY_CLASS} .bfs-node,
.${FISCAL_SANKEY_CLASS} .bfs-link {
  cursor: pointer;
}
.${FISCAL_SANKEY_CLASS} .bfs-node:focus-visible,
.${FISCAL_SANKEY_CLASS} .bfs-link:focus-visible {
  outline: 2px solid var(--bfs-focus-ring);
  outline-offset: 2px;
}
@media (prefers-reduced-motion: no-preference) {
  .${FISCAL_SANKEY_CLASS} .bfs-link,
  .${FISCAL_SANKEY_CLASS} .bfs-node rect {
    transition: opacity 150ms ease, fill-opacity 150ms ease;
  }
}
`;

/** Diagonal-hatch pattern id shared by the balancing flow AND any reversed
 * (negative-valued) category ribbon — see sankeyGeometry.ts's `reversed`
 * flag. The pattern's line color is `currentColor`, deliberately, so a
 * caller sets `color` on the wrapping element to reuse this one pattern for
 * both the balancing-flow hue and a category's own side color. */
export const HATCH_PATTERN_ID = "bfs-hatch";

export function colorForSide(side: "receipt" | "outlay" | "hub"): string {
  switch (side) {
    case "receipt":
      return "var(--bfs-receipt)";
    case "outlay":
      return "var(--bfs-outlay)";
    case "hub":
      return "var(--bfs-hub)";
  }
}

export const BALANCING_COLOR = "var(--bfs-balancing)";
