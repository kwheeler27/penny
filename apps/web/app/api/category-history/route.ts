/**
 * Per-category history endpoint (beat 1, "HISTORY PANELS v2") — the fix for
 * the front door inlining every category's full monthly history (~137
 * months x ~27 categories) into every page load regardless of which panel a
 * visitor ever expands. components/ranked-bar-chart.tsx now fetches THIS
 * route, lazily, only for the one category a reader actually clicks open
 * (see that file's fetch effect) — so the eager server-side
 * getFullCategoryMonthlyHistory(allCategoryIds) call this replaces
 * (previously in lib/front-door-data.ts) is gone, and the cost of a v2
 * history line is now paid once, per category, only by a reader who asks
 * for it.
 *
 * Zod-validated input at this boundary (CLAUDE.md: "Every endpoint:
 * Zod-validated input"), scoped to exactly the receipts/outlays category ids
 * the front door's ranked charts render — never an arbitrary registry series
 * id — even though this is a public, unauthenticated instrument with no
 * tenant to scope by.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { SERIES_IDS, type SeriesId } from "@penny/registry";
import { getFullCategoryMonthlyHistory } from "@/lib/series-data";
import { buildCategoryHistoryLineSeries } from "@/lib/front-door-transform";

// Exactly the ids RankedBarChart can ever render a row for (front-door-data.ts's
// own allCategoryIds) — never the full SERIES_IDS catalog, which also
// contains totals, daily DTS series, Census, CPI, and CBO ids that have no
// "click a bar to expand its history" affordance at all.
const CATEGORY_HISTORY_IDS = new Set<string>(
  SERIES_IDS.filter((id) => id.startsWith("fiscal.mts.receipts.category.") || id.startsWith("fiscal.mts.outlays.category.")),
);

const querySchema = z.object({ id: z.string().min(1).max(200) });

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({ id: request.nextUrl.searchParams.get("id") ?? "" });
  if (!parsed.success || !CATEGORY_HISTORY_IDS.has(parsed.data.id)) {
    return NextResponse.json({ error: "unknown category id" }, { status: 404 });
  }

  const id = parsed.data.id as SeriesId;
  const raw = await getFullCategoryMonthlyHistory([id]);
  // Returns null (never a fabricated shape) when the category has 4 or
  // fewer ingested months — components/ranked-bar-chart.tsx's caller falls
  // back to the already-fetched 4-point dot plot in that case, exactly as
  // it did when this data was computed eagerly server-side.
  const lineSeries = buildCategoryHistoryLineSeries(id, raw.get(id) ?? []);

  return NextResponse.json({ series: lineSeries }, { headers: { "Cache-Control": "public, max-age=0, s-maxage=900, stale-while-revalidate=86400" } });
}
