import { describe, expect, it } from "vitest";
import { DATASETS, DATASET_IDS, getDataset, datasetCitationFor } from "../src/index";

describe("@penny/registry generated dataset catalog", () => {
  it("seeds the TreasuryDirect auctions dataset citation", () => {
    expect(DATASET_IDS).toContain("treasurydirect.auctions");
  });

  it("every dataset carries the fields the objectivity hard rule requires", () => {
    for (const id of DATASET_IDS) {
      const def = DATASETS[id];
      expect(def.agency, id).toBeTruthy();
      expect(def.dataset, id).toBeTruthy();
      expect(def.datasetUrl, id).toMatch(/^https:\/\//);
      expect(def.citation, id).toBeTruthy();
      expect(def.label.length, id).toBeGreaterThanOrEqual(3);
    }
  });

  it("getDataset returns undefined (not a throw) for an unknown id", () => {
    expect(getDataset("not.a.real.dataset")).toBeUndefined();
  });

  it("datasetCitationFor substitutes {access_date} and never leaves the token behind", () => {
    const text = datasetCitationFor("treasurydirect.auctions", "2026-09-01");
    expect(text).toContain("2026-09-01");
    for (const id of DATASET_IDS) {
      expect(datasetCitationFor(id, "2026-09-01")).not.toContain("{access_date}");
    }
  });

  it("the TreasuryDirect auctions entry names the Bureau of the Fiscal Service as agency of record", () => {
    const def = DATASETS["treasurydirect.auctions"];
    expect(def.agency).toMatch(/Bureau of the Fiscal Service/);
    expect(def.datasetUrl).toMatch(/^https:\/\/www\.treasurydirect\.gov\//);
  });
});
