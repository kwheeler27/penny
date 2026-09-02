"use client";

/**
 * @penny/viz's chart components are plain React library code with no "use
 * client" directive of their own — but its package entrypoint is one barrel
 * that also re-exports hook-using scrollytelling primitives, so importing
 * anything from "@penny/viz" into a Server Component pulls that whole
 * module graph in and fails Next's Server/Client boundary check. This is
 * that boundary for the two new auction charts — the same one-line-per-
 * component pass-through pattern components/cadence-charts-client.tsx and
 * components/fiscal-sankey-client.tsx already established — so
 * components/auction-history-charts.tsx (a Server Component doing no DB
 * work of its own) can render these without itself becoming a client
 * component.
 */
import { AuctionDotChart, type AuctionDotChartProps, AuctionLineChart, type AuctionLineChartProps } from "@penny/viz";

export function AuctionDotChartClient(props: AuctionDotChartProps) {
  return <AuctionDotChart {...props} />;
}

export function AuctionLineChartClient(props: AuctionLineChartProps) {
  return <AuctionLineChart {...props} />;
}
