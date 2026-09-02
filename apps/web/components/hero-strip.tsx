import Link from "next/link";
import type { HeroCell } from "@/lib/front-door-data";
import type { ToplineCell } from "@/lib/front-door-transform";

/** The front door's top status strip. Server-rendered from
 * lib/front-door-data.ts; this component only lays out markup — every value
 * it renders already flowed through the registry citation path.
 *
 * Two tiers, matching the dek's own promise ("where federal money goes,
 * where it comes from, and how the difference is borrowed"):
 *   - `topline`: three cells (spending, revenue, the borrowed gap), each
 *     pairing Treasury's observed fiscal-year-to-date figure against CBO's
 *     projected full-year figure — two different accounting concepts, shown
 *     side by side, never blended into one number.
 *   - `secondary`: a visually lighter row beneath — debt, TGA, the latest
 *     auction — dated point-in-time figures, not this fiscal year's flow. */
export default function HeroStrip({ topline, secondary }: { topline: ToplineCell[]; secondary: HeroCell[] }) {
  return (
    <div className="hero-strip-wrap">
      <ul className="hero-strip hero-strip--topline" aria-label="Spending, revenue, and borrowing this fiscal year">
        {topline.map((cell) => (
          <li key={cell.label}>
            <Link href={cell.href} className="hero-strip-cell hero-strip-cell--topline">
              <span className="hero-strip-k">{cell.label}</span>
              <span className={cell.observedDisplay ? "hero-strip-v" : "hero-strip-v hero-strip-v--gap"}>
                {cell.observedDisplay ?? "No report yet"}
              </span>
              <span className="hero-strip-s">{cell.observedSourceLine}</span>
              <span className={cell.projectedLine ? "hero-strip-proj" : "hero-strip-proj hero-strip-proj--gap"}>
                {cell.projectedLine ?? "CBO's full-year baseline projection hasn't been loaded yet."}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <ul className="hero-strip hero-strip--secondary" aria-label="Debt, Treasury cash, and the latest auction">
        {secondary.map((cell) => (
          <li key={cell.label}>
            <Link href={cell.href} className="hero-strip-cell hero-strip-cell--secondary">
              <span className="hero-strip-k">{cell.label}</span>
              <span className={cell.valueDisplay ? "hero-strip-v" : "hero-strip-v hero-strip-v--gap"}>{cell.valueDisplay ?? "No report yet"}</span>
              <span className="hero-strip-s">{cell.sourceLine}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
