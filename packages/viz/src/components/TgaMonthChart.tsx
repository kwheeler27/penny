import { computeTgaMonthGeometry, type TgaLayoutDay } from "../layout/tgaMonthLayout";

export interface TgaMonthChartDay extends TgaLayoutDay {
  /** Precomputed display string for the hover title, or null when `valueWhole` is null (a gap day). */
  readonly display: string | null;
}

export interface TgaMonthChartProps {
  /** Every calendar day of the month, ascending — including gap days. */
  readonly days: readonly TgaMonthChartDay[];
  readonly color: string;
  readonly width?: number;
  readonly height?: number;
}

const PAD = { padLeft: 8, padRight: 8, padTop: 12, padBottom: 12 };

/**
 * The TGA-through-the-month line (beat 3): the Treasury's cash balance
 * across the days of one calendar month, connecting only the days that
 * actually published a reading — a weekend/holiday gap widens the segment
 * between two real points rather than being interpolated or zero-filled.
 * Exact figures are on each point's native `<title>` (hover / assistive
 * tech) — no client JS state.
 */
export function TgaMonthChart({ days, color, width = 640, height = 140 }: TgaMonthChartProps) {
  if (days.length === 0) return null;
  const geometry = computeTgaMonthGeometry(days, { width, height, ...PAD });
  if (geometry.points.length === 0) return null;

  const byDate = new Map(days.map((d) => [d.date, d]));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ height: "auto" }} role="img" aria-label={`Treasury General Account balance across ${days.length} days`}>
      <path d={geometry.path} fill="none" stroke={color} strokeWidth={2} />
      {geometry.points.map((p) => (
        <circle key={p.date} cx={p.x} cy={p.y} r={2.5} fill={color}>
          <title>{`${p.date}: ${byDate.get(p.date)?.display ?? ""}`}</title>
        </circle>
      ))}
    </svg>
  );
}
