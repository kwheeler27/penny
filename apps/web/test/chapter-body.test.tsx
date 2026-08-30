/**
 * End-to-end chapter pipeline test: parseChapter -> ChapterBody -> static
 * HTML, against a real (empty) in-memory DB, using the real tag vocabulary
 * the narrative agent authored chapter-1.mdx in (Num/Ref/Term/Step/Aside/
 * SankeyStage) — see lib/chapter/parse.ts's header comment. No MTS
 * observations are seeded here on purpose: this test exercises the
 * pipeline's wiring and gap-safety, not @buck/viz's own FiscalSankey
 * rendering (covered by that package's own test suite).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getDb, seedSeriesCatalog } from "@buck/db";
import ChapterBody from "../components/chapter-body";
import { parseChapter } from "../lib/chapter/parse";
import { ensureMigrated } from "../lib/db";

beforeAll(async () => {
  await ensureMigrated();
  await seedSeriesCatalog(getDb());
});

const SAMPLE = `---
title: Where the money goes
chapter: 1
---

{/* placeholder-contract notes that must never render */}

<Step id="open" stage="whole">

## Where the money goes

The government collected <Num seriesId="fiscal.mts.receipts.total" period="fiscal_ytd" /> so far this fiscal year.<Ref id="mts-report" />

A <Term id="concept.receipt">**receipt**</Term> is money the government collects.

> Some economists call this **unsustainable**; others disagree — see [the debate](https://example.com/debate).

<SankeyStage focus="whole" />

<Aside id="cash-versus-books" title="A note on cash vs. budget">

These are different measurements.

</Aside>

An *unrecognized* tag like <Nope foo="bar" /> stays visible as text.

</Step>
`;

describe("ChapterBody (full parse -> render pipeline, real tag vocabulary)", () => {
  it("renders headings, inline formatting, links, and blockquotes inside a Step section", async () => {
    const { blocks } = parseChapter(SAMPLE);
    const html = renderToStaticMarkup(await ChapterBody({ blocks }));
    expect(html).toContain('<section class="chapter-step" id="open" data-stage="whole">');
    expect(html).toContain("<h2>Where the money goes</h2>");
    expect(html).toContain("<strong>unsustainable</strong>");
    expect(html).toContain('href="https://example.com/debate"');
    expect(html).toContain("<blockquote>");
    // the JSX placeholder-contract comment never reaches the page
    expect(html).not.toContain("placeholder-contract");
  });

  it("embeds a RegistryFigure for a <Num>, as a gap when no reading exists", async () => {
    const { blocks } = parseChapter(SAMPLE);
    const html = renderToStaticMarkup(await ChapterBody({ blocks }));
    expect(html).toContain("No report yet");
  });

  it("renders a <Ref> as a real link into a rendered reference list at the foot of the page, resolved against content/SOURCES.md", async () => {
    const { blocks } = parseChapter(SAMPLE);
    const html = renderToStaticMarkup(await ChapterBody({ blocks }));
    expect(html).toContain("[mts-report]");
    expect(html).toContain('href="#ref-mts-report"');
    expect(html).toContain('id="ref-mts-report"');
    // the reference list itself carries the real SOURCES.md title, not a bare id
    expect(html).toMatch(/Monthly Treasury Statement/);
  });

  it("renders a visible error for a <Ref> id with no entry in content/SOURCES.md, rather than accepting a typo silently", async () => {
    const { blocks } = parseChapter('A claim with a bad citation.<Ref id="not-a-real-source" />');
    const html = renderToStaticMarkup(await ChapterBody({ blocks }));
    expect(html).toContain("ref-marker-error");
    expect(html).toMatch(/not-a-real-source/);
  });

  it("renders a <Term> with the registry's own definition as its tooltip for a real series id", async () => {
    const { blocks } = parseChapter(SAMPLE);
    const html = renderToStaticMarkup(await ChapterBody({ blocks }));
    expect(html).toContain('class="term"');
    expect(html).toContain("<strong>receipt</strong>");
  });

  it("resolves a concept.* <Term> against content/definitions.yaml's own authored explanation, not the generic fallback", async () => {
    const { blocks } = parseChapter(SAMPLE);
    const html = renderToStaticMarkup(await ChapterBody({ blocks }));
    // concept.receipt's real definitions.yaml `plain` text (content/definitions.yaml)
    expect(html).toMatch(/sovereign powers/);
    expect(html).not.toContain("Defined term — see /data for the full citation");
  });

  it("renders an <Aside> nested inside the <Step>, with its title", async () => {
    const { blocks } = parseChapter(SAMPLE);
    const html = renderToStaticMarkup(await ChapterBody({ blocks }));
    expect(html).toContain('<aside class="chapter-aside" id="cash-versus-books">');
    expect(html).toContain("A note on cash vs. budget");
  });

  it("treats <SankeyStage> as a no-op (the diagram is shown once at the page level, not per-stage)", async () => {
    const { blocks } = parseChapter(SAMPLE);
    const html = renderToStaticMarkup(await ChapterBody({ blocks }));
    expect(html).not.toContain("No Monthly Treasury Statement");
  });

  it("keeps an unrecognized tag visible as literal text rather than dropping it silently", async () => {
    const { blocks } = parseChapter(SAMPLE);
    const html = renderToStaticMarkup(await ChapterBody({ blocks }));
    expect(html).toContain("&lt;Nope foo=&quot;bar&quot; /&gt;");
  });

  it("uses a registry series definition as a <Term>'s tooltip when the id is a real series", async () => {
    const { blocks } = parseChapter('<Term id="fiscal.tga.closing_balance">**TGA**</Term> is the account.');
    const html = renderToStaticMarkup(await ChapterBody({ blocks }));
    expect(html).toContain("Federal Reserve at the close of a given business day");
  });
});
