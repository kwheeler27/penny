import { describe, expect, it } from "vitest";
import { parseChapter } from "../lib/chapter/parse";

describe("parseChapter — frontmatter and comment stripping", () => {
  it("parses frontmatter and strips the JSX comment block from the body", () => {
    const source = `---
title: Where the money goes
chapter: 1
standfirst: >
  Line one of the standfirst
  and line two, folded together.
---

{/* a placeholder-contract comment
spanning several lines */}

## A heading
`;
    const { frontmatter, blocks } = parseChapter(source);
    expect(frontmatter.title).toBe("Where the money goes");
    expect(frontmatter.chapter).toBe("1");
    expect(frontmatter.standfirst).toBe("Line one of the standfirst and line two, folded together.");
    expect(blocks).toEqual([{ type: "heading", level: 2, text: "A heading" }]);
  });

  it("parses normally with no frontmatter at all", () => {
    const { frontmatter, blocks } = parseChapter("## Just a heading");
    expect(frontmatter).toEqual({});
    expect(blocks).toEqual([{ type: "heading", level: 2, text: "Just a heading" }]);
  });
});

describe("parseChapter — plain block/inline grammar", () => {
  it("parses headings at two levels", () => {
    const { blocks } = parseChapter("## A section\n\n### A subsection");
    expect(blocks).toEqual([
      { type: "heading", level: 2, text: "A section" },
      { type: "heading", level: 3, text: "A subsection" },
    ]);
  });

  it("parses a plain paragraph with bold, italic, and a link", () => {
    const { blocks } = parseChapter("The government collected **a lot** of money, *allegedly*, per [the report](https://example.com).");
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    if (block.type !== "paragraph") throw new Error("unreachable");
    expect(block.inline).toEqual([
      { type: "text", text: "The government collected " },
      { type: "bold", text: "a lot" },
      { type: "text", text: " of money, " },
      { type: "italic", text: "allegedly" },
      { type: "text", text: ", per " },
      { type: "link", text: "the report", href: "https://example.com" },
      { type: "text", text: "." },
    ]);
  });

  it("parses a blockquote, joining consecutive lines", () => {
    const { blocks } = parseChapter("> Some say this is unsustainable,\n> according to Economist X.");
    const block = blocks[0]!;
    expect(block.type).toBe("blockquote");
    if (block.type !== "blockquote") throw new Error("unreachable");
    expect(block.inline).toEqual([{ type: "text", text: "Some say this is unsustainable, according to Economist X." }]);
  });

  it("parses a section-break hr", () => {
    expect(parseChapter("---").blocks).toEqual([{ type: "hr" }]);
  });
});

describe("parseChapter — the real content vocabulary (Num/Ref/Term/Step/Aside/SankeyStage)", () => {
  it("parses a <Num> that is the only thing on its own line as a paragraph wrapping one embed token", () => {
    // Every real <Num> in chapter-1.mdx sits mid-sentence inside a
    // multi-line paragraph (no blank line separates it from surrounding
    // prose) — a solo Num on its own block is not how the real content
    // uses it, but should still parse to something renderable rather than
    // erroring: a one-token paragraph.
    const { blocks } = parseChapter('<Num seriesId="fiscal.mts.receipts.total" period="fiscal_ytd" />');
    expect(blocks).toEqual([
      { type: "paragraph", inline: [{ type: "embed", tag: "Num", attrs: { seriesId: "fiscal.mts.receipts.total", period: "fiscal_ytd" } }] },
    ]);
  });

  it("parses an inline <Num> mid-sentence", () => {
    const { blocks } = parseChapter('Receipts were <Num seriesId="fiscal.mts.receipts.total" period="month" /> this month.');
    const block = blocks[0]!;
    if (block.type !== "paragraph") throw new Error("unreachable");
    expect(block.inline).toContainEqual({
      type: "embed",
      tag: "Num",
      attrs: { seriesId: "fiscal.mts.receipts.total", period: "month" },
    });
  });

  it("parses an inline <Ref>", () => {
    const { blocks } = parseChapter('A sentence with a citation.<Ref id="mts-report" />');
    const block = blocks[0]!;
    if (block.type !== "paragraph") throw new Error("unreachable");
    expect(block.inline.at(-1)).toEqual({ type: "embed", tag: "Ref", attrs: { id: "mts-report" } });
  });

  it("parses a <Term> as a term token with its own tokenized inline children", () => {
    const { blocks } = parseChapter('A <Term id="concept.receipt">**receipt**</Term> is money collected.');
    const block = blocks[0]!;
    if (block.type !== "paragraph") throw new Error("unreachable");
    const term = block.inline.find((t) => t.type === "term");
    expect(term).toBeDefined();
    if (term?.type !== "term") throw new Error("unreachable");
    expect(term.id).toBe("concept.receipt");
    expect(term.inline).toEqual([{ type: "bold", text: "receipt" }]);
  });

  it("parses a <Step> as a container, recursively parsing its multi-paragraph body", () => {
    const source = `<Step id="open" stage="whole">

## A dollar in, a dollar out

First paragraph. Receipts were <Num seriesId="fiscal.mts.receipts.total" period="month" />.

Second paragraph.

</Step>`;
    const { blocks } = parseChapter(source);
    expect(blocks).toHaveLength(1);
    const container = blocks[0]!;
    expect(container.type).toBe("container");
    if (container.type !== "container") throw new Error("unreachable");
    expect(container.tag).toBe("Step");
    expect(container.attrs).toEqual({ id: "open", stage: "whole" });
    expect(container.children.map((b) => b.type)).toEqual(["heading", "paragraph", "paragraph"]);
  });

  it("parses an <Aside> nested inside a <Step>", () => {
    const source = `<Step id="s" stage="tga">

Some prose.

<Aside id="cash-versus-books" title="A note">

The aside's own paragraph.

</Aside>

</Step>`;
    const { blocks } = parseChapter(source);
    const step = blocks[0]!;
    if (step.type !== "container") throw new Error("unreachable");
    expect(step.children).toHaveLength(2);
    const aside = step.children[1]!;
    expect(aside.type).toBe("container");
    if (aside.type !== "container") throw new Error("unreachable");
    expect(aside.tag).toBe("Aside");
    expect(aside.attrs).toEqual({ id: "cash-versus-books", title: "A note" });
    expect(aside.children).toEqual([{ type: "paragraph", inline: [{ type: "text", text: "The aside's own paragraph." }] }]);
  });

  it("parses a <SankeyStage /> marker on its own line", () => {
    const { blocks } = parseChapter('Some prose.\n\n<SankeyStage focus="outlays-functions" />\n\nMore prose.');
    const hasSankeyStage = blocks.some(
      (b) => b.type === "paragraph" && b.inline.some((t) => t.type === "embed" && t.tag === "SankeyStage" && t.attrs.focus === "outlays-functions"),
    );
    expect(hasSankeyStage).toBe(true);
  });

  it("keeps an unrecognized self-closing tag visible as literal text", () => {
    const { blocks } = parseChapter('This has a <Typo id="x" /> in it.');
    const block = blocks[0]!;
    if (block.type !== "paragraph") throw new Error("unreachable");
    expect(block.inline.some((t) => t.type === "text" && t.text.includes('<Typo id="x" />'))).toBe(true);
  });
});
