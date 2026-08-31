/**
 * Loads content/definitions.yaml's `concepts:` map — the reader-facing
 * plain-language explanation for a `<Term id="concept.*">` marker that is
 * NOT a @penny/registry series id. Before this, `concept.*` ids fell through
 * to a generic placeholder string; this file makes the actual authored,
 * sourced text (definitions.yaml's `plain`/`watch_for`) reachable.
 *
 * `series:` entries in the same file stay unused here on purpose — a real
 * registry series id's tooltip comes from `getSeries(id).definition`
 * (chapter-body.tsx), which is the registry's own single source of truth
 * for series semantics (definitions.yaml's own header comment: "this file
 * adds only reader-facing material on top").
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

export interface ConceptDefinition {
  readonly id: string;
  readonly term: string;
  readonly plain: string;
  readonly watchFor: string | undefined;
}

interface RawConceptEntry {
  term?: string;
  plain?: string;
  watch_for?: string;
}

interface DefinitionsFile {
  concepts?: Record<string, RawConceptEntry>;
}

const DEFINITIONS_PATH = path.join(process.cwd(), "content", "definitions.yaml");

let cached: Map<string, ConceptDefinition> | undefined;

function loadConcepts(): Map<string, ConceptDefinition> {
  if (!cached) {
    const raw = readFileSync(DEFINITIONS_PATH, "utf-8");
    const parsed = (parse(raw) as DefinitionsFile | null) ?? {};
    const map = new Map<string, ConceptDefinition>();
    for (const [id, entry] of Object.entries(parsed.concepts ?? {})) {
      if (!entry?.plain) continue;
      map.set(id, {
        id,
        term: entry.term ?? id,
        plain: entry.plain.trim(),
        watchFor: entry.watch_for?.trim(),
      });
    }
    cached = map;
  }
  return cached;
}

/** The authored concept definition for a `concept.*` <Term> id, or
 * undefined when definitions.yaml has no entry — the caller falls back
 * further (never invents text of its own). */
export function getConceptDefinition(id: string): ConceptDefinition | undefined {
  return loadConcepts().get(id);
}
