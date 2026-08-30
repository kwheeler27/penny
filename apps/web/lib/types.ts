/**
 * Shared types for the data-access + rendering layer. These describe what a
 * "reading" of a registry series looks like once pulled out of `@buck/db` —
 * the shape every page and the Number primitive is built against.
 */
import type { SeriesId } from "@buck/registry";

/** Mirrors packages/db's periodTypeEnum. Duplicated as a literal union (not
 * imported from @buck/db's pg-core enum) because the enum's `.enumValues` is
 * a runtime array, not a type-level export — see lib/db.ts for the one place
 * that bridges the two. */
export type PeriodType = "day" | "month" | "fiscal_ytd" | "year";

/** One observation, as read back for display. `value` stays the exact
 * decimal string from Postgres/PGlite — never coerced to a JS number here.
 * Scaling/rounding for display happens only in lib/format.ts, at the
 * presentation boundary, per CLAUDE.md's magnitude rule. */
export interface Reading {
  seriesId: SeriesId;
  periodType: PeriodType;
  periodStart: string;
  periodEnd: string;
  fiscalYear: number | null;
  value: string;
  publicationTime: string;
  revisionOf: number | null;
}

/**
 * The result of asking for "the latest reading of series X": either a
 * Reading, or an explicit Gap describing why there isn't one. Never a zero —
 * this type makes "no data" a distinct, renderable case rather than a value
 * a caller could accidentally treat as 0.
 */
export type ReadingResult =
  | { kind: "ok"; reading: Reading }
  | { kind: "gap"; reason: string }
  | { kind: "unknown_series"; id: string };
