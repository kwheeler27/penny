import { SERIES, SERIES_IDS } from "@penny/registry";
import { describePeriod } from "@/lib/format";
import { getLatestReading } from "@/lib/series-data";

export const metadata = { title: "Data & methods" };
export const revalidate = 3600;

const MAGNITUDE_LABEL: Record<string, string> = {
  ones: "ones",
  thousands: "thousands",
  millions: "millions",
  billions: "billions",
};

// Every unit the registry can declare (packages/db's unitEnum) — a headcount
// (persons/households) is a real, distinct accounting concept from a dollar
// figure or a BLS index point, and this table's whole job is to make that
// concept visible, never to collapse it into a binary "USD or not" choice.
const UNIT_LABEL: Record<string, string> = {
  usd: "USD",
  index_point: "Index point",
  persons: "Persons",
  households: "Households",
};

export default async function DataPage() {
  const latest = await Promise.all(
    SERIES_IDS.map(async (id) => ({ id, reading: await getLatestReading(id) })),
  );
  const latestById = new Map(latest.map((l) => [l.id, l.reading]));

  return (
    <div className="page">
      <div className="prose-width">
        <h1>Data &amp; methods</h1>
        <p className="page-lede">
          Every series Penny can show, exactly as published by the agency of record. This page IS the citation index —
          every number on every other page traces back to one row here.
        </p>
      </div>

      <div className="section citation-table-wrap">
        <table className="citation-table">
          <thead>
            <tr>
              <th>Series</th>
              <th>Agency &amp; dataset</th>
              <th>Unit</th>
              <th>Cadence</th>
              <th>Concept</th>
              <th>Latest ingested</th>
            </tr>
          </thead>
          <tbody>
            {SERIES_IDS.map((id) => {
              const def = SERIES[id];
              const reading = latestById.get(id);
              return (
                <tr key={id}>
                  <td>
                    <strong>{def.label}</strong>
                    <div className="mono">{id}</div>
                    <div>{def.definition}</div>
                  </td>
                  <td>
                    <div>{def.agency}</div>
                    <div>
                      <a href={def.datasetUrl} target="_blank" rel="noopener noreferrer">
                        {def.dataset} ↗
                      </a>
                    </div>
                  </td>
                  <td>
                    {UNIT_LABEL[def.unit] ?? def.unit}
                    {def.magnitude !== "ones" && <div className="tag">{MAGNITUDE_LABEL[def.magnitude]}</div>}
                  </td>
                  <td>{def.cadence}</td>
                  <td>
                    <span className="tag">{def.accountingConcept.replace("_", " ")}</span>
                  </td>
                  <td>
                    {reading ? describePeriod(reading.periodType, reading.periodEnd, reading.fiscalYear) : "not yet ingested"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
