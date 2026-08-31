import { describe, expect, it } from "vitest";
import { chooseOrientation, VERTICAL_BREAKPOINT_PX } from "../src/layout/orientation";

describe("chooseOrientation", () => {
  it("is vertical (stacked) below the breakpoint, including at 375px (the required mobile width)", () => {
    expect(chooseOrientation(375)).toBe("vertical");
    expect(chooseOrientation(320)).toBe("vertical");
    expect(chooseOrientation(VERTICAL_BREAKPOINT_PX - 1)).toBe("vertical");
  });

  it("is horizontal at and above the breakpoint", () => {
    expect(chooseOrientation(VERTICAL_BREAKPOINT_PX)).toBe("horizontal");
    expect(chooseOrientation(1024)).toBe("horizontal");
    expect(chooseOrientation(1440)).toBe("horizontal");
  });
});
