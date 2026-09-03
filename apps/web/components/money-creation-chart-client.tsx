"use client";

/**
 * @penny/viz's chart components are plain React library code with no "use
 * client" directive of their own — but its package entrypoint is one barrel
 * that also re-exports hook-using scrollytelling primitives, so importing
 * anything from "@penny/viz" into a Server Component pulls that whole
 * module graph in and fails Next's Server/Client boundary check. This is
 * that boundary for beat 5's TGA<->reserves chart — the same one-line-per-
 * component pass-through pattern components/cadence-charts-client.tsx and
 * components/auction-charts-client.tsx already established — so
 * components/money-creation-section.tsx (a Server Component doing no DB
 * work of its own) can render it without itself becoming a client component.
 */
import { DualCadenceHistoryChart, type DualCadenceHistoryChartProps } from "@penny/viz";

export function DualCadenceHistoryChartClient(props: DualCadenceHistoryChartProps) {
  return <DualCadenceHistoryChart {...props} />;
}
