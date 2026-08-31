"use client";

/**
 * @penny/viz's <FiscalSankey> uses hooks and DOM event handlers, so it needs
 * a Client Component boundary — but it's a plain React library component,
 * not a Next.js one, so it doesn't (and shouldn't) carry Next's "use
 * client" directive itself. This is that boundary: a one-line pass-through
 * so components/sankey-embed.tsx (a Server Component doing the actual DB
 * read) can render it without itself needing to become a client component.
 */
import { FiscalSankey, type FiscalSankeyProps } from "@penny/viz";

export default function FiscalSankeyClient(props: FiscalSankeyProps) {
  return <FiscalSankey {...props} />;
}
