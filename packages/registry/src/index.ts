// Public surface of @penny/registry. Downstream packages (db seed, ingest,
// apps/web) import from here — never reach into src/generated directly, so
// the generated module can be regenerated freely without churning imports.
export {
  SERIES,
  SERIES_IDS,
  getSeries,
  citationFor,
  incomparabilityReason,
} from "./generated/series.gen";
export type {
  SeriesDef,
  SeriesId,
  Unit,
  Magnitude,
  AccountingConcept,
  Cadence,
  RevisionStatus,
} from "./generated/series.gen";
