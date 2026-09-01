import Link from "next/link";
import type { HeroCell } from "@/lib/front-door-data";

/** The front door's top status strip — three sourced, dated figures, each
 * linking through to /now. Server-rendered from lib/front-door-data.ts;
 * this component only lays out markup. */
export default function HeroStrip({ cells }: { cells: HeroCell[] }) {
  return (
    <ul className="hero-strip" aria-label="The system right now">
      {cells.map((cell) => (
        <li key={cell.label}>
          <Link href={cell.href} className="hero-strip-cell">
            <span className="hero-strip-k">{cell.label}</span>
            <span className={cell.valueDisplay ? "hero-strip-v" : "hero-strip-v hero-strip-v--gap"}>{cell.valueDisplay ?? "No report yet"}</span>
            <span className="hero-strip-s">{cell.sourceLine}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
