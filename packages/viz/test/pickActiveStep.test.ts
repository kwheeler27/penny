import { describe, expect, it } from "vitest";
import { pickActiveStep, type StepIntersection } from "../src/scroll/pickActiveStep";

function entry(overrides: Partial<StepIntersection> & { index: number }): StepIntersection {
  return { isIntersecting: true, intersectionRatio: 1, distanceFromActiveLine: 0, ...overrides };
}

describe("pickActiveStep", () => {
  it("picks the only intersecting step", () => {
    const result = pickActiveStep([entry({ index: 0, isIntersecting: false }), entry({ index: 1 })], null);
    expect(result).toBe(1);
  });

  it("among several intersecting steps, picks the one closest to the active line", () => {
    const result = pickActiveStep(
      [
        entry({ index: 0, distanceFromActiveLine: -300 }),
        entry({ index: 1, distanceFromActiveLine: 20 }),
        entry({ index: 2, distanceFromActiveLine: -5 }),
      ],
      null,
    );
    expect(result).toBe(2);
  });

  it("uses signed distance's magnitude, not raw value (a step above the line can still win over one further below)", () => {
    const result = pickActiveStep([entry({ index: 0, distanceFromActiveLine: -50 }), entry({ index: 1, distanceFromActiveLine: 10 })], null);
    expect(result).toBe(1);
  });

  it("breaks a distance tie toward higher intersection ratio", () => {
    const result = pickActiveStep(
      [
        entry({ index: 0, distanceFromActiveLine: 10, intersectionRatio: 0.4 }),
        entry({ index: 1, distanceFromActiveLine: -10, intersectionRatio: 0.9 }),
      ],
      null,
    );
    expect(result).toBe(1);
  });

  it("breaks a full tie (distance and ratio) toward the lower index, deterministically", () => {
    const result = pickActiveStep([entry({ index: 3, distanceFromActiveLine: 0 }), entry({ index: 1, distanceFromActiveLine: 0 })], null);
    expect(result).toBe(1);
  });

  it("keeps the previous active step when nothing currently intersects, rather than flickering to null", () => {
    const result = pickActiveStep([entry({ index: 0, isIntersecting: false }), entry({ index: 1, isIntersecting: false })], 1);
    expect(result).toBe(1);
  });

  it("returns null when nothing intersects and there was no previous step", () => {
    const result = pickActiveStep([entry({ index: 0, isIntersecting: false })], null);
    expect(result).toBeNull();
  });
});
