import Link from "next/link";
import type { ForScaleFact } from "@/lib/front-door-transform";

/**
 * One "for scale" illustrative fact card. When `fact` is null (a gap — the
 * underlying series has no reading, or in the Census facts' case doesn't
 * exist in the registry catalog yet), renders the same honest gap treatment
 * RegistryFigure uses elsewhere: an em dash, never a stand-in zero, plus
 * what would be shown once the source lands. Every card links to /data —
 * the citation index — so "(Census Bureau, ... estimate)" is never a dead
 * end for a reader who wants to verify it (CLAUDE.md: the reader's
 * independence means they can verify us, not just believe us).
 */
export default function ForScaleFactCard({ fact, gapDescription }: { fact: ForScaleFact | null; gapDescription: string }) {
  if (!fact) {
    return (
      <Link href="/data" className="for-scale-fact for-scale-fact--gap">
        <div className="for-scale-fact-value">—</div>
        <div className="for-scale-fact-label">{gapDescription}</div>
        <div className="for-scale-fact-source">Not yet ingested.</div>
      </Link>
    );
  }
  return (
    <Link href="/data" className="for-scale-fact">
      <div className="for-scale-fact-value">{fact.valueDisplay}</div>
      <div className="for-scale-fact-label">{fact.label}</div>
      <div className="for-scale-fact-source">{fact.sourceLine}</div>
    </Link>
  );
}
