/**
 * RegistryFigure — THE core primitive (ORCHESTRATION_PROMPT.md core flow 2).
 * Every number on every page renders through this component. Its `id` prop
 * is typed as `SeriesId` — the generated union of every id in
 * packages/registry/series/**\/*.yaml — so passing anything that isn't a
 * real registry series is a TypeScript compile error in first-party code.
 * The one place a raw string reaches this component's *logic* is the
 * narrative-content pipeline (lib/chapter/parse.ts), which validates the
 * string against `getSeries()` itself before ever constructing this
 * component — see that file. The `getSeries(id)` check below is defense in
 * depth for that path, not the primary enforcement mechanism.
 *
 * It is an async Server Component: it fetches its own reading from
 * @buck/db, so a page (or a chapter block) only has to say *which* series
 * and *which period* — never a value, never a hardcoded number.
 */
import { citationFor, getSeries, type SeriesId } from "@buck/registry";
import { formatIndexPoint, formatSeriesUsd, describePeriod } from "@/lib/format";
import { getLatestReading } from "@/lib/series-data";
import type { PeriodType } from "@/lib/types";

export interface RegistryFigureProps {
  /** A real @buck/registry series id — the only way a number reaches the page. */
  id: SeriesId;
  /** Which period reading to show. Required for a series that publishes
   * more than one period_type per date (every MTS series publishes both
   * `month` and `fiscal_ytd`) — omit only for series with a single natural
   * period_type (daily stocks like debt/TGA, or CPI). */
  periodType?: PeriodType;
  /** Decimal places to display. Defaults per unit+magnitude — see lib/format.ts. */
  precision?: number;
  /** Visible source/as-of caption below the value. Default true — Buck's
   * trust rule is that sourcing is not something a reader has to go
   * looking for. */
  showCaption?: boolean;
  /** Override the label shown in the caption (default: the registry label). */
  label?: string;
  className?: string;
}

export default async function RegistryFigure({
  id,
  periodType,
  precision,
  showCaption = true,
  label,
  className,
}: RegistryFigureProps) {
  const def = getSeries(id);
  if (!def) {
    // Unreachable through any TypeScript-checked call site; reachable only
    // if the chapter-content pipeline's own guard were ever bypassed. Fails
    // loudly and visibly rather than rendering a number with no source.
    return (
      <span className="rf rf-error" role="alert">
        Unknown series id: {String(id)}
      </span>
    );
  }

  const reading = await getLatestReading(id, periodType);
  const classes = ["rf", className].filter(Boolean).join(" ");

  if (!reading) {
    return (
      <figure className={`${classes} rf-gap`}>
        <span className="rf-value rf-gap-value">No report yet</span>
        <figcaption className="rf-caption">
          {def.agency} · {def.dataset}
          {periodType ? ` · ${periodType.replace("_", " ")}` : ""} — not yet ingested.
        </figcaption>
      </figure>
    );
  }

  const display =
    def.unit === "usd" ? formatSeriesUsd(reading.value, def.magnitude, precision).display : formatIndexPoint(reading.value, precision);

  return (
    <figure className={classes}>
      <span className="rf-value">{display}</span>
      {showCaption && (
        <figcaption className="rf-caption">
          <span className="rf-source">
            {label ?? def.label} — {def.agency}
          </span>
          <span className="rf-asof"> · {describePeriod(reading.periodType, reading.periodEnd, reading.fiscalYear)}</span>
          <details className="rf-details">
            <summary>What is this?</summary>
            <p>{def.definition}</p>
            <p className="rf-citation">
              {citationFor(id, reading.periodEnd)}{" "}
              <a href={def.datasetUrl} target="_blank" rel="noopener noreferrer">
                Source ↗
              </a>
            </p>
            {def.notes.length > 0 && (
              <ul className="rf-notes">
                {def.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </details>
        </figcaption>
      )}
    </figure>
  );
}
