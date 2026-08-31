import { describe, expect, it } from "vitest";
import { placeLabels } from "../src/layout/labelPlacement";

describe("placeLabels — collision handling", () => {
  it("labels a band tall enough for text inline, at its center", () => {
    const placements = placeLabels([{ id: "a", start: 0, end: 40, text: "Social Security" }]);
    expect(placements[0]).toMatchObject({ id: "a", visible: true, anchor: "inline", position: 20 });
  });

  it("pushes a thin band's label outside when there is room before the next label", () => {
    const placements = placeLabels([
      { id: "a", start: 0, end: 6, text: "Allowances" },
      { id: "b", start: 200, end: 206, text: "Energy" },
    ]);
    expect(placements.find((p) => p.id === "a")).toMatchObject({ anchor: "outside", visible: true });
    expect(placements.find((p) => p.id === "b")).toMatchObject({ anchor: "outside", visible: true });
  });

  it("hides a thin band's label when it would collide with the previous visible label", () => {
    const placements = placeLabels([
      { id: "a", start: 0, end: 6, text: "Allowances" },
      { id: "b", start: 8, end: 14, text: "Energy" }, // center 11, only 3px from a's center (3) — well under minInlinePx
    ]);
    const a = placements.find((p) => p.id === "a")!;
    const b = placements.find((p) => p.id === "b")!;
    expect(a.visible).toBe(true); // first one always gets a shot
    expect(b.visible).toBe(false); // too close to the previous visible label
  });

  it("never overlaps: every pair of visible label positions is at least minInlinePx apart", () => {
    const bands = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, start: i * 5, end: i * 5 + 4, text: `n${i}` }));
    const placements = placeLabels(bands, { minInlinePx: 14 });
    const visible = placements.filter((p) => p.visible).sort((a, b) => a.position - b.position);
    for (let i = 1; i < visible.length; i++) {
      const current = visible[i];
      const previous = visible[i - 1];
      if (!current || !previous) throw new Error("unreachable: index within bounds");
      expect(current.position - previous.position).toBeGreaterThanOrEqual(14);
    }
  });

  it("is order-independent: shuffled input band order produces the same placements", () => {
    const bands = [
      { id: "a", start: 0, end: 30, text: "a" },
      { id: "b", start: 30, end: 34, text: "b" },
      { id: "c", start: 34, end: 40, text: "c" },
    ];
    const [bandA, bandB, bandC] = bands;
    if (!bandA || !bandB || !bandC) throw new Error("unreachable: fixed-length array literal");
    const forward = placeLabels(bands);
    const shuffled = placeLabels([bandC, bandA, bandB]);
    const sortById = (arr: typeof forward) => [...arr].sort((x, y) => x.id.localeCompare(y.id));
    expect(sortById(shuffled)).toEqual(sortById(forward));
  });
});
