import { describe, expect, it } from "vitest";
import {
  defaultPathColour,
  parsePathColour,
  pathColoursFor,
  resolvePathColour,
} from "../src/map/pathColour/pathColours";

describe("what the paths can be coloured by", () => {
  it("is mode, device, speed, time, altitude, accuracy and confidence at Transport, without mode and confidence elsewhere", () => {
    expect(pathColoursFor("inferred")).toEqual([
      "mode",
      "device",
      "speed",
      "time",
      "altitude",
      "accuracy",
      "confidence",
    ]);
    for (const level of ["raw", "averaged", "mapped"] as const) {
      expect(pathColoursFor(level)).toEqual(["device", "speed", "time", "altitude", "accuracy"]);
    }
  });

  it("defaults to mode at Transport and to device elsewhere", () => {
    expect(defaultPathColour("inferred")).toBe("mode");
    expect(defaultPathColour("raw")).toBe("device");
  });

  it("reads only the names it knows", () => {
    expect(parsePathColour("speed")).toBe("speed");
    expect(parsePathColour("confidence")).toBe("confidence");
    for (const bad of [null, "", "height", "Speed"]) expect(parsePathColour(bad)).toBeNull();
  });
});

describe("the colouring of a level", () => {
  it("takes the address, then this browser's choice, then the preference, then the default", () => {
    expect(resolvePathColour("raw", ["speed", "time", "device"])).toBe("speed");
    expect(resolvePathColour("raw", [null, "time", "device"])).toBe("time");
    expect(resolvePathColour("raw", [null, null, "speed"])).toBe("speed");
    expect(resolvePathColour("raw", [null, null, undefined])).toBe("device");
    expect(resolvePathColour("inferred", [null, null, undefined])).toBe("mode");
  });

  it("skips a choice the level does not support, and never rewrites it", () => {
    // The preference is Mode by default: Raw is coloured by device, Transport by mode.
    expect(resolvePathColour("raw", [null, null, "mode"])).toBe("device");
    expect(resolvePathColour("mapped", ["mode", "speed", "mode"])).toBe("speed");
    expect(resolvePathColour("inferred", ["mode", null, undefined])).toBe("mode");
    expect(resolvePathColour("raw", ["nonsense", null, "time"])).toBe("time");
  });
});
