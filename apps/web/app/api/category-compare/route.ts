/**
 * "Compare the big five" endpoint (Act I only, spending-history-scrub beat)
 * — GET /api/category-compare, no query params. Server-computes, from the
 * SAME getFullCategoryMonthlyHistory query the /api/category-history route
 * already uses, the five fixed outlay categories (Medicare, Social
 * Security, Net interest, National defense, Health — a FIXED set, never a
 * dynamic top-5, so color assignment never drifts as spending shifts which
 * category happens to be biggest) plus an "everything else" aggregate of
 * every OTHER published fiscal.mts.outlays.category.* series — including
 * the negative undistributed_offsetting_receipts, never excluded — each as
 * a rolling 12-month total, and the server-computed spike annotation (see
 * lib/category-compare-transform.ts, which owns every rule this route just
 * orchestrates against the database).
 *
 * Lazily fetched by components/ranked-bar-chart.tsx's "Compare the big
 * five" panel, only once a reader opens it — never inlined on every
 * front-door load, the same lazy-fetch convention GET /api/category-history
 * already established (see that route's own doc comment).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSeries, SERIES_IDS, type SeriesId } from "@penny/registry";
import { getFullCategoryMonthlyHistory, type CategoryHistoryPoint } from "@/lib/series-data";
import { buildCategoryCompareData, type CompareCategoryInput } from "@/lib/category-compare-transform";
import { formatDateHuman, todayIso } from "@/lib/format";

// The fixed five, in the approved mockup's own display order (Frame B,
// spending-history-scrub) — apps/web assigns each of these one fixed color
// token; this route never reorders or resizes this list dynamically.
// Exported (rather than kept module-private) so a test can assert this list
// agrees with components/ranked-bar-chart.tsx's independently-defined
// BIG_FIVE_COLOR_VARS — the two have no shared import (a server route
// constant vs. a "use client" component constant), so nothing else stops
// them drifting apart, which would silently restyle a real category as the
// gray dashed "everything else" aggregate (found in review).
export const BIG_FIVE_IDS = [
  "fiscal.mts.outlays.category.medicare",
  "fiscal.mts.outlays.category.social_security",
  "fiscal.mts.outlays.category.net_interest",
  "fiscal.mts.outlays.category.national_defense",
  "fiscal.mts.outlays.category.health",
] as SeriesId[];
const BIG_FIVE_SET = new Set<string>(BIG_FIVE_IDS);

// Every OTHER published outlay function, in registry order —
// undistributed_offsetting_receipts (ordinarily negative) included, per
// this route's own doc comment above.
const OTHER_OUTLAY_IDS = SERIES_IDS.filter((id) => id.startsWith("fiscal.mts.outlays.category.") && !BIG_FIVE_SET.has(id)) as SeriesId[];

// No query params on this route — an empty, strict schema still gives it
// the same Zod-validated-input guarantee every other endpoint in this app
// carries (CLAUDE.md), and rejects a caller that passes something this
// route doesn't understand rather than silently ignoring it.
const querySchema = z.object({}).strict();

function toCompareInput(id: SeriesId, rawBySeriesId: Map<SeriesId, CategoryHistoryPoint[]>): CompareCategoryInput {
  const def = getSeries(id);
  return { id, label: def?.label ?? id, magnitude: def?.magnitude ?? "ones", rawPoints: rawBySeriesId.get(id) ?? [] };
}

// Static CBO attribution (fetch-verified 2026-09-03) — the primary source
// for the annotation's pandemic-era framing. A citation is not a
// statistic: it is a deliberate, named-source constant, never derived from
// this route's own database query (CLAUDE.md: an interpretation like "the
// deficit was larger because of the pandemic" is attributed to a named
// source, never asserted in Penny's own voice).
const CBO_CITATION = {
  title: "Monthly Budget Review: Summary for Fiscal Year 2021",
  url: "https://www.cbo.gov/publication/57539",
  sentence: "deficits were much larger... because of the economic effects of the coronavirus pandemic and legislation enacted in response",
} as const;

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "unexpected query parameters" }, { status: 400 });
  }

  const raw = await getFullCategoryMonthlyHistory([...BIG_FIVE_IDS, ...OTHER_OUTLAY_IDS]);
  const fixed = BIG_FIVE_IDS.map((id) => toCompareInput(id, raw));
  const other = OTHER_OUTLAY_IDS.map((id) => toCompareInput(id, raw));

  const result = buildCategoryCompareData(fixed, other);

  // Every fiscal.mts.outlays.category.* series shares the same
  // agency/dataset/datasetUrl (Table 9) — any one of them stands in for the
  // table-level citation this chart needs; the per-category `citation`
  // string itself is deliberately NOT used here, since it names one
  // specific budget function ("... Table 9, budget function 570
  // 'Medicare'"), which would misrepresent a chart spanning all of them.
  const tableDef = getSeries(BIG_FIVE_IDS[0]!)!;
  const accessDate = todayIso();

  return NextResponse.json(
    {
      series: result.series,
      annotation: result.annotation,
      citation: {
        agency: tableDef.agency,
        dataset: tableDef.dataset,
        datasetUrl: tableDef.datasetUrl,
        accessedDisplay: formatDateHuman(accessDate),
      },
      cboCitation: CBO_CITATION,
    },
    { headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=86400" } },
  );
}
