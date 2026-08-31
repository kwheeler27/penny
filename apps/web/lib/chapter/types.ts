/**
 * The chapter content AST. Tag vocabulary matches what the narrative agent
 * actually authored in apps/web/content/chapter-1.mdx (discovered mid-build
 * — see parse.ts's header comment and the WEB agent handoff report for the
 * two-independently-designed-contracts story). `Num`/`Ref`/`SankeyStage` are
 * self-closing; `Term` wraps inline children; `Step`/`Aside` are block
 * containers that can nest (an `Aside` appears inside a `Step` in the real
 * file) and can contain any of the block types below, including further
 * headings/paragraphs — everything is parsed recursively.
 */

/** Self-closing tags that resolve to a single embedded value/reference. */
export type EmbedTag = "Num" | "Ref" | "SankeyStage";

export interface EmbedToken {
  type: "embed";
  tag: EmbedTag;
  attrs: Record<string, string>;
}

/** `<Term id="...">…inline children…</Term>` — a defined-term marker. */
export interface TermToken {
  type: "term";
  id: string;
  inline: InlineToken[];
}

export type InlineToken =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  | { type: "link"; text: string; href: string }
  | EmbedToken
  | TermToken;

export type ContainerTag = "Step" | "Aside";

export interface ContainerBlock {
  type: "container";
  tag: ContainerTag;
  attrs: Record<string, string>;
  children: ChapterBlock[];
}

export type ChapterBlock =
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "paragraph"; inline: InlineToken[] }
  | { type: "blockquote"; inline: InlineToken[] }
  | { type: "hr" }
  | EmbedToken
  | ContainerBlock;

/** Parsed YAML-ish frontmatter (a flat `key: value` block only — see
 * parse.ts's parseFrontmatter). Multi-line `>` block scalars are folded to a
 * single space-joined string, matching YAML's own folding rule closely
 * enough for the two fields this app actually reads (title, standfirst). */
export interface ChapterFrontmatter {
  [key: string]: string;
}

export interface ParsedChapter {
  frontmatter: ChapterFrontmatter;
  blocks: ChapterBlock[];
}
