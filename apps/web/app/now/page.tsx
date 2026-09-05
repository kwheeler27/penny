import { getSeries, type SeriesId } from "@penny/registry";
import RegistryFigure from "@/components/registry-figure";
import { buildNowTakeaway } from "@/lib/now-takeaways";
import { getLatestDistinctReadings } from "@/lib/series-data";
import type { PeriodType } from "@/lib/types";

export const metadata = { title: "Now" };
export const revalidate = 900;

interface Tile {
  id: SeriesId;
  periodType: PeriodType;
  label: string;
}

// Every id here is checked against the real @penny/registry SeriesId union at
// compile time — a typo'd or retired series id is a build failure, not a
// silently-broken tile.
const TILES: readonly Tile[] = [
  { id: "fiscal.debt.total_public_debt_outstanding", periodType: "day", label: "Total public debt outstanding" },
  { id: "fiscal.tga.closing_balance", periodType: "day", label: "Treasury General Account balance" },
  // Neutral wording, matching the registry's own sign convention (negative =
  // deficit, positive = surplus — see fiscal.mts.deficit.total's
  // definition): the tile renders the SIGNED reading, so a label that
  // asserts a direction ("...deficit") would contradict the number whenever
  // the period is actually a surplus.
  { id: "fiscal.mts.deficit.total", periodType: "fiscal_ytd", label: "Fiscal-year-to-date deficit or surplus" },
  { id: "fiscal.debt.interest_expense_total", periodType: "month", label: "Interest expense, latest month" },
];

/**
 * One tile: label kicker, a COMPUTED takeaway heading (design principles §1
 * — the finding, derived from the two latest readings, or nothing at all
 * when no honest claim exists), then the figure with its full provenance
 * caption. The takeaway line and RegistryFigure each read the database
 * (RegistryFigure is deliberately self-contained); both queries are tiny
 * and the page is ISR-cached, so clarity wins over a shared fetch.
 */
async function NowTile({ tile }: { tile: Tile }) {
  const def = getSeries(tile.id);
  const readings = await getLatestDistinctReadings(tile.id, tile.periodType, 2);
  const takeaway = def ? buildNowTakeaway(readings, def.magnitude) : null;
  return (
    <div className="tile">
      <span className="tile-label">{tile.label}</span>
      {takeaway && <span className="tile-takeaway">{takeaway}</span>}
      <RegistryFigure id={tile.id} periodType={tile.periodType} />
    </div>
  );
}

export default function NowPage() {
  return (
    <div className="page">
      <div className="prose-width">
        <h1>Now</h1>
        <p className="page-lede">
          The system&apos;s state right now, each figure dated and sourced. A gap means no report has been ingested
          for that reading yet — never a stand-in zero.
        </p>
      </div>

      <div className="section tile-grid">
        {TILES.map((tile) => (
          <NowTile key={tile.id} tile={tile} />
        ))}
      </div>
    </div>
  );
}
