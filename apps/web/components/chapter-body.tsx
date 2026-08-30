/**
 * Renders a parsed chapter (lib/chapter/parse.ts) to React, against the
 * real tag vocabulary the narrative agent authored chapter-1.mdx in — see
 * that file's header comment for the full contract and its documented
 * gaps (SankeyStage stage-switching, Term's full definitions.yaml lookup,
 * Ref's SOURCES.md resolution — none of those block a correct, honest
 * render; they're noted simplifications, not silent ones).
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
    // Not yet resolved against content/SOURCES.md's reference list (see
    // this file's header comment) — the id itself is still a real,
    // checkable pointer, just not a numbered footnote yet.
    return (
      <sup className="ref-marker" key={key} title={`Citation: ${id} — see content/SOURCES.md`}>
        [{id}]
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
  const node = await RegistryFigure({ id: seriesId as SeriesId, periodType, className: "rf-inline" });
  return <Fragment key={key}>{node}</Fragment>;
}

/** `<Term id="...">…</Term>` — a defined-term marker. When `id` is itself a
 * @buck/registry series id, its `definition` (already in hand, no extra
 * fetch or YAML parsing needed) becomes the hover/title text; a `concept.*`
 * id gets a generic pointer instead (definitions.yaml's fuller explanations
 * aren't wired up yet — see this file's header comment). */
async function renderTerm(term: TermToken, key: string): Promise<ReactNode> {
  const def = getSeries(term.id);
  const title = def ? def.definition : "Defined term — see /data for the full citation, or content/definitions.yaml for the reader-facing explanation.";
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

export default async function ChapterBody({ blocks }: { blocks: ChapterBlock[] }) {
  const rendered = await Promise.all(blocks.map((block, i) => renderBlock(block, `b${i}`)));
  return <div className="chapter">{rendered}</div>;
}
