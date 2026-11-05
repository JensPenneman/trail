import { describe, expect, it } from "vitest";
import { speedRamp, timeTones } from "../src/map/pathColour/pathPalette";
import { contrast, deficiencies, deltaE, oklabL } from "./support/colourMaths";

/*
 * The paths' colours are validated by computation, not by eye: contrast against the map's
 * backgrounds (the casing sets the worst case: light maps #f2f2f2, dark ones #303031 and, over
 * bright imagery, down to #0c0c0e), distinct neighbours, steps in order of lightness and distinct
 * under every colour-vision deficiency.
 */
const lightGround = ["#f2f2f2"];
const darkGrounds = ["#303031", "#0c0c0e"];

describe("the speed ramp", () => {
  it("has five steps in each scheme", () => {
    expect(speedRamp.light).toHaveLength(5);
    expect(speedRamp.dark).toHaveLength(5);
  });

  it("keeps every step at 3:1 or more against the ground of its scheme", () => {
    for (const color of speedRamp.light) {
      for (const ground of lightGround)
        expect(contrast(color, ground), color).toBeGreaterThanOrEqual(3);
    }
    for (const color of speedRamp.dark) {
      for (const ground of darkGrounds)
        expect(contrast(color, ground), color).toBeGreaterThanOrEqual(3);
    }
  });

  it("goes monotonically from slow to fast in lightness: darker on light maps, brighter on dark", () => {
    const light = speedRamp.light.map(oklabL);
    const dark = speedRamp.dark.map(oklabL);
    for (let index = 1; index < 5; index += 1) {
      expect(light[index], `light ${index}`).toBeLessThan(light[index - 1] ?? 0);
      expect(dark[index], `dark ${index}`).toBeGreaterThan(dark[index - 1] ?? 1);
    }
  });

  it("tells neighbouring steps apart, also under every colour-vision deficiency", () => {
    for (const ramp of [speedRamp.light, speedRamp.dark]) {
      for (let index = 1; index < ramp.length; index += 1) {
        const [a, b] = [ramp[index - 1] ?? "", ramp[index] ?? ""];
        expect(deltaE(a, b), `${a} ${b}`).toBeGreaterThanOrEqual(10);
        for (const deficiency of deficiencies) {
          expect(deltaE(a, b, deficiency), `${a} ${b} ${deficiency}`).toBeGreaterThanOrEqual(6.5);
        }
      }
    }
  });
});

describe("the time-of-day tones", () => {
  it("keep 3:1 against the ground of their scheme", () => {
    for (const color of timeTones.light)
      expect(contrast(color, "#f2f2f2"), color).toBeGreaterThanOrEqual(3);
    for (const color of timeTones.dark) {
      for (const ground of darkGrounds)
        expect(contrast(color, ground), color).toBeGreaterThanOrEqual(3);
    }
  });

  it("are four categories told apart, also under every deficiency", () => {
    for (const tones of [timeTones.light, timeTones.dark]) {
      for (let a = 0; a < tones.length; a += 1) {
        for (let b = a + 1; b < tones.length; b += 1) {
          const [x, y] = [tones[a] ?? "", tones[b] ?? ""];
          expect(deltaE(x, y), `${x} ${y}`).toBeGreaterThanOrEqual(14);
          for (const deficiency of deficiencies) {
            expect(deltaE(x, y, deficiency), `${x} ${y} ${deficiency}`).toBeGreaterThanOrEqual(5);
          }
        }
      }
    }
  });
});
