/**
 * Renders a parsed chapter (lib/chapter/parse.ts) to React, against the
 * real tag vocabulary the narrative agent authored chapter-1.mdx in — see
 * that file's header comment for the full contract and its documented
 * gaps (SankeyStage stage-switching — packages/viz's FiscalSankey has no
 * per-node emphasis/focus prop yet — and `<Num>`'s `at`/`fiscalYear`/`format`/
 * `of` attributes, still parsed but not yet applied).
 *
 * `<Ref>` resolves against content/SOURCES.md (lib/chapter/sources.ts) and
 * renders a real link into the reference list this component renders at the
 * foot of its own output; an id with no SOURCES.md entry is a visible error,
 * never a silently-accepted typo. `<Term id="concept.*">` resolves against
 * content/definitions.yaml's `concepts:` map (lib/chapter/definitions.ts); a
 * real @buck/registry series id keeps using the registry's own definition.
 *
 * Async because RegistryFigure (behind every `<Num>`) is itself an async
 * Server Component doing its own DB read — every nested async call is
 * awaited directly here (never invoked via JSX) so the whole tree resolves
 * to a plain synchronous React tree before this function returns. JSX-
 * invoking an async function component hands React an unresolved thenable
 * as an element type, which a non-streaming renderer can't handle — see the
 * WEB agent handoff report for the concrete failure this avoids.
 */
import { Fragment, type ReactNode } from "react";
import { getSeries, type SeriesId } from "@buck/registry";
import RegistryFigure from "./registry-figure";
import SankeyEmbed from "./sankey-embed";
import { getSourceEntry } from "@/lib/chapter/sources";
import { getConceptDefinition } from "@/lib/chapter/definitions";
import type { ChapterBlock, ContainerBlock, EmbedToken, InlineToken, TermToken } from "@/lib/chapter/types";
import type { PeriodType } from "@/lib/types";

const VALID_PERIOD_TYPES: readonly PeriodType[] = ["day", "month", "fiscal_ytd", "year"];

function isPeriodType(value: string | undefined): value is PeriodType {
  return value !== undefined && (VALID_PERIOD_TYPES as readonly string[]).includes(value);
}

function isExternal(href: string): boolean {
  return /^https?:\/\//.test(href);
}

async function renderEmbed(embed: EmbedToken, key: string): Promise<ReactNode> {
  if (embed.tag === "SankeyStage") {
    // The living Sankey is rendered once, at the top of the page (see
    // app/report/where-the-money-goes/page.tsx) — packages/viz's
    // FiscalSankey has no per-node emphasis/focus prop yet, so there is no
    // scroll-synced "stage" to switch to here. A no-op, not a broken embed.
    return null;
  }

  if (embed.tag === "Ref") {
    const id = embed.attrs.id;
    if (!id) {
      return (
        <sup className="ref-marker ref-marker-error" key={key} role="alert">
          [missing ref id]
        </sup>
      );
    }
    // Per the placeholder contract: "Build must fail on an id with no entry
    // in SOURCES.md." A full build failure would take down every chapter
    // page over one typo'd id; a loud, visible, reviewable error achieves
    // the same "never ships silently" outcome without that blast radius —
    // the same tradeoff RegistryFigure's own "Unknown series id" makes.
    if (!getSourceEntry(id)) {
      return (
        <sup className="ref-marker ref-marker-error" key={key} role="alert" title={`Unknown reference id: "${id}" has no entry in content/SOURCES.md`}>
          [{id}?]
        </sup>
      );
    }
    return (
      <sup className="ref-marker" key={key}>
        <a href={`#ref-${id}`}>[{id}]</a>
      </sup>
    );
  }

  // tag === "Num"
  const seriesId = embed.attrs.seriesId;
  const def = seriesId ? getSeries(seriesId) : undefined;
  if (!seriesId || !def) {
    return (
      <span className="rf-error" role="alert" key={key}>
        Unknown series id in chapter content: {seriesId ?? "(missing seriesId attribute)"}
      </span>
    );
  }
  const periodType = isPeriodType(embed.attrs.period) ? embed.attrs.period : undefined;
  const sign = embed.attrs.sign === "absolute" ? "absolute" : undefined;
  const node = await RegistryFigure({ id: seriesId as SeriesId, periodType, sign, className: "rf-inline" });
  return <Fragment key={key}>{node}</Fragment>;
}

/** `<Term id="...">…</Term>` — a defined-term marker. When `id` is itself a
 * @buck/registry series id, its `definition` (already in hand, no extra
 * fetch needed) becomes the hover/title text — the registry stays the
 * single source of truth for series semantics. A `concept.*` id instead
 * resolves against content/definitions.yaml's `concepts:` map, the
 * authored, sourced plain-language explanation for chapter vocabulary that
 * isn't a series (receipt, outlay, deficit, fiscal year, ...). Only an id
 * that is neither falls back to a generic pointer. */
async function renderTerm(term: TermToken, key: string): Promise<ReactNode> {
  const seriesDef = getSeries(term.id);
  const conceptDef = seriesDef ? undefined : getConceptDefinition(term.id);
  const title = seriesDef
    ? seriesDef.definition
    : conceptDef
      ? [conceptDef.plain, conceptDef.watchFor].filter(Boolean).join(" ")
      : "Defined term — see /data for the full citation, or content/definitions.yaml for the reader-facing explanation.";
  return (
    <span className="term" title={title} key={key}>
      {await renderInline(term.inline, `${key}-t`)}
    </span>
  );
}

async function renderInline(tokens: InlineToken[], keyPrefix: string): Promise<ReactNode[]> {
  return Promise.all(
    tokens.map(async (token, i) => {
      const key = `${keyPrefix}-${i}`;
      switch (token.type) {
        case "text":
          return token.text;
        case "bold":
          return <strong key={key}>{token.text}</strong>;
        case "italic":
          return <em key={key}>{token.text}</em>;
        case "link":
          return (
            <a key={key} href={token.href} target={isExternal(token.href) ? "_blank" : undefined} rel={isExternal(token.href) ? "noopener noreferrer" : undefined}>
              {token.text}
            </a>
          );
        case "embed":
          return renderEmbed(token, key);
        case "term":
          return renderTerm(token, key);
      }
    }),
  );
}

async function renderContainer(container: ContainerBlock, key: string): Promise<ReactNode> {
  const children = await Promise.all(container.children.map((block, i) => renderBlock(block, `${key}-${i}`)));
  const id = container.attrs.id;
  if (container.tag === "Aside") {
    return (
      <aside className="chapter-aside" id={id} key={key}>
        {container.attrs.title && <p className="chapter-aside-title">{container.attrs.title}</p>}
        {children}
      </aside>
    );
  }
  // Step — a scroll section. Deep-linkable (id becomes the fragment); the
  // sticky-graphic stage-sync itself is out of scope this pass (see header
  // comment) so this is a plain sectioning wrapper, not yet a pinned one.
  return (
    <section className="chapter-step" id={id} data-stage={container.attrs.stage} key={key}>
      {children}
    </section>
  );
}

async function renderBlock(block: ChapterBlock, key: string): Promise<ReactNode> {
  switch (block.type) {
    case "heading": {
      const Tag = block.level === 2 ? "h2" : "h3";
      return <Tag key={key}>{block.text}</Tag>;
    }
    case "hr":
      return <hr key={key} />;
    case "paragraph":
      return <p key={key}>{await renderInline(block.inline, key)}</p>;
    case "blockquote":
      return <blockquote key={key}>{await renderInline(block.inline, key)}</blockquote>;
    case "embed":
      return (
        <div className="chapter-embed" key={key}>
          {await renderEmbed(block, key)}
        </div>
      );
    case "container":
      return renderContainer(block, key);
  }
}

/** Recursively collects every `<Ref id>` used anywhere in the chapter, in
 * first-use order, deduped — a pure pass over the already-parsed blocks
 * (never touches rendering) so the reference list can be built once, up
 * front, independent of render order/timing. */
function collectRefIds(blocks: readonly ChapterBlock[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  const take = (id: string | undefined) => {
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  };
  const visitInline = (tokens: readonly InlineToken[]) => {
    for (const t of tokens) {
      if (t.type === "embed" && t.tag === "Ref") take(t.attrs.id);
      else if (t.type === "term") visitInline(t.inline);
    }
  };
  const visitBlock = (block: ChapterBlock) => {
    switch (block.type) {
      case "paragraph":
      case "blockquote":
        visitInline(block.inline);
        break;
      case "embed":
        if (block.tag === "Ref") take(block.attrs.id);
        break;
      case "container":
        block.children.forEach(visitBlock);
        break;
      case "heading":
      case "hr":
        break;
    }
  };
  blocks.forEach(visitBlock);
  return ids;
}

/** The reference list at the foot of the page — the anchor target every
 * `<Ref id>` links to (per the placeholder contract), and the only place a
 * reader can actually reach the primary source a citation marker points at. */
function ReferenceList({ ids }: { ids: readonly string[] }) {
  if (ids.length === 0) return null;
  return (
    <section className="chapter-references" aria-label="References">
      <h2>References</h2>
      <ol>
        {ids.map((id) => {
          const source = getSourceEntry(id);
          return (
            <li id={`ref-${id}`} key={id}>
              {source ? (
                <>
                  <span className="ref-title">{source.title}</span>
                  {source.url && (
                    <>
                      {" — "}
                      <a href={source.url} target="_blank" rel="noopener noreferrer">
                        Source ↗
                      </a>
                    </>
                  )}
                </>
              ) : (
                <span className="ref-marker-error" role="alert">
                  Unknown reference id &quot;{id}&quot; — no entry in content/SOURCES.md.
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default async function ChapterBody({ blocks }: { blocks: ChapterBlock[] }) {
  const rendered = await Promise.all(blocks.map((block, i) => renderBlock(block, `b${i}`)));
  return (
    <div className="chapter">
      {rendered}
      <ReferenceList ids={collectRefIds(blocks)} />
    </div>
  );
}
