import { readFile } from "node:fs/promises";
import path from "node:path";
import ChapterBody from "@/components/chapter-body";
import SankeyEmbed from "@/components/sankey-embed";
import { parseChapter } from "@/lib/chapter/parse";

export const metadata = { title: "Chapter 1: Where the money goes" };

// Revalidate periodically rather than fully static: the embedded
// RegistryFigure/Sankey reads reflect whatever's currently ingested, and a
// public instrument about "the current fiscal picture" shouldn't need a
// redeploy to pick up a new month's MTS report.
export const revalidate = 3600;

// apps/web/content/chapter-1.mdx is the narrative agent's file — this page
// deliberately never hardcodes chapter prose (WEB agent ownership excludes
// apps/web/content/). Until that file exists, the honest state is "not
// published yet," not a placeholder chapter pretending to be real content.
const CONTENT_PATH = path.join(process.cwd(), "content", "chapter-1.mdx");

async function loadChapterSource(): Promise<string | null> {
  try {
    return await readFile(CONTENT_PATH, "utf8");
  } catch {
    return null;
  }
}

export default async function WhereTheMoneyGoesPage() {
  const source = await loadChapterSource();

  if (!source) {
    return (
      <div className="page">
        <div className="prose-width">
          <p className="tag">Chapter 1</p>
          <h1>Where the money goes</h1>
        </div>
        <div className="chapter-missing">
          <p>
            This chapter hasn&apos;t been published yet. In the meantime, the same figures are on{" "}
            <a href="/now">/now</a> and every source is indexed on <a href="/data">/data</a>.
          </p>
        </div>
      </div>
    );
  }

  const { frontmatter, blocks } = parseChapter(source);

  return (
    <div className="page">
      <div className="prose-width">
        <p className="tag">Chapter {frontmatter.chapter ?? "1"}</p>
        <h1>{frontmatter.title ?? "Where the money goes"}</h1>
        {frontmatter.standfirst && <p className="page-lede">{frontmatter.standfirst}</p>}
      </div>

      {/* The living Sankey, shown once up front — see components/chapter-body.tsx
          on why <SankeyStage> markers inside the prose don't each render
          their own copy (packages/viz's FiscalSankey has no stage/emphasis
          prop yet, so there is nothing for them to switch between). */}
      <div className="section">
        <SankeyEmbed idPrefix="chapter-top" />
      </div>

      <ChapterBody blocks={blocks} />
    </div>
  );
}
