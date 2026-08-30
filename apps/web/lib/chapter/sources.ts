/**
 * Loads content/SOURCES.md's reference list — the id -> {title, url} map
 * `<Ref id="…" />` resolves against (see chapter-1.mdx's placeholder
 * contract: "Renders as a superscript link to the reference list at the
 * foot of the page ... Build must fail on an id with no entry in
 * SOURCES.md"). SOURCES.md is hand-written Markdown, not YAML, so this is a
 * small purpose-built regex parser in the same spirit as parse.ts's own
 * tag-tree tokenizer — no MDX/Markdown dependency for one structural
 * pattern (`### \`id\`` headings).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export interface SourceEntry {
  readonly id: string;
  /** A short, human-readable title for the footnote list — best-effort
   * extraction of the entry's own bold lead-in text, never invented. */
  readonly title: string;
  /** The first URL named in the entry's section, if any — what the
   * reference-list link actually points a reader at to reach the primary
   * source. */
  readonly url: string | undefined;
}

const SOURCES_PATH = path.join(process.cwd(), "content", "SOURCES.md");
const HEADING_RE = /^###\s+`([A-Za-z0-9._-]+)`\s*$/gm;
const TITLE_RE = /\*\*(.+?)\*\*/s;
const URL_RE = /<(https?:\/\/[^\s>]+)>|\((https?:\/\/[^\s)]+)\)/;

function parseSourcesMarkdown(raw: string): Map<string, SourceEntry> {
  const entries = new Map<string, SourceEntry>();
  const matches = [...raw.matchAll(HEADING_RE)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const id = m[1]!;
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1]!.index ?? raw.length) : raw.length;
    const section = raw.slice(start, end);
    const titleMatch = TITLE_RE.exec(section);
    const title = titleMatch ? titleMatch[1]!.replace(/\s+/g, " ").trim() : id;
    const urlMatch = URL_RE.exec(section);
    const url = urlMatch ? (urlMatch[1] ?? urlMatch[2]) : undefined;
    entries.set(id, { id, title, url });
  }
  return entries;
}

let cached: Map<string, SourceEntry> | undefined;

/** Reads and parses content/SOURCES.md once per server process (static
 * content, not user data — safe to cache for the process lifetime). */
function loadSources(): Map<string, SourceEntry> {
  if (!cached) {
    cached = parseSourcesMarkdown(readFileSync(SOURCES_PATH, "utf-8"));
  }
  return cached;
}

/** The reference entry for a `<Ref id>` / `source_refs:` id, or undefined
 * when SOURCES.md has no matching entry — the caller must render that as a
 * visible error, per the documented contract, never resolve it silently. */
export function getSourceEntry(id: string): SourceEntry | undefined {
  return loadSources().get(id);
}
