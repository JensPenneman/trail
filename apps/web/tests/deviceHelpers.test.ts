import { describe, expect, it } from "vitest";
import { describeMovement } from "../src/devices/describeMovement";
import { tripModeLabel } from "../src/devices/tripModeLabel";
import { createFormatter } from "../src/format/createFormatter";
import { device } from "./support/fixtures";

const format = createFormatter("en-GB", "Europe/Brussels");

/** The fixture's position with this speed (m/s) and motion activity. */
function moving(speed: number | null, motion: string[]) {
  const location = device().lastLocation;
  if (location === null) throw new Error("fixture without location");
  return { ...location, speed, motion };
}

describe("device helpers", () => {
  it("describe the movement in the words of the motion activity", () => {
    expect(describeMovement(moving(12, ["automotive"]), format)).toBe("43 km/h · driving");
    expect(describeMovement(moving(0, ["walking"]), format)).toBe("walking");
    expect(describeMovement(moving(0, ["stationary"]), format)).toBe("Standing still");
    expect(describeMovement(moving(0, ["on_foot"]), format)).toBe("on foot");
  });

  it("take motions named like every object's properties for unknown ones", () => {
    expect(describeMovement(moving(0, ["constructor"]), format)).toBe("constructor");
    expect(describeMovement(moving(0, ["__proto__"]), format)).toBe("  proto  ");
  });

  it("name trip modes for a sentence, unknown ones as they are", () => {
    expect(tripModeLabel("bicycle")).toBe("bike ride");
    expect(tripModeLabel("hot_air_balloon")).toBe("hot air balloon");
    expect(tripModeLabel("constructor")).toBe("constructor");
    expect(tripModeLabel("__proto__")).toBe("  proto  ");
  });
});
