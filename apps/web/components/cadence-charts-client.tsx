"use client";

/**
 * @penny/viz's chart components are plain React library code with no "use
 * client" directive of their own — but its package entrypoint is one barrel
 * (src/index.ts) that also re-exports hook-using scrollytelling primitives
 * (useScrollSteps, FiscalSankey, ...), so importing anything from
 * "@penny/viz" into a Server Component pulls that whole module graph in and
 * fails Next's Server/Client boundary check. This is that boundary — the
 * same one-line-per-component pass-through pattern components/fiscal-sankey-
 * client.tsx already established — so components/cadence-section.tsx (a
 * Server Component doing no DB work of its own, just laying out markup
 * around data it's handed) can render these without itself becoming a
 * client component.
 */
import { DailyCadenceChart, type DailyCadenceChartProps, TgaMonthChart, type TgaMonthChartProps } from "@penny/viz";

export function DailyCadenceChartClient(props: DailyCadenceChartProps) {
  return <DailyCadenceChart {...props} />;
}

export function TgaMonthChartClient(props: TgaMonthChartProps) {
  return <TgaMonthChart {...props} />;
}
