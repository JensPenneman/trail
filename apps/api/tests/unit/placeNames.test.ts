import { describe, expect, it } from "vitest";
import { roadNameFrom, stopNameFor } from "../../src/insights/placeNames";

const centre: [number, number] = [3.7104, 51.0362];
/** Metres north of the centre as degrees of latitude. */
const north = (metres: number) => 51.0362 + metres / 111_195;
const stop = (name: string, metres: number, kind = "station" as const) => ({
  name,
  kind,
  lat: north(metres),
  lon: 3.7104,
});

describe("naming a place after a stop", () => {
  it("takes the nearest stop within 150 m, and says how far", () => {
    expect(stopNameFor(centre, [stop("Far", 120), stop("Near", 20)])).toEqual({
      text: "Near",
      source: "stop",
      kind: "station",
      distanceM: 20,
    });
    expect(stopNameFor(centre, [stop("Edge", 149)])?.distanceM).toBe(149);
  });

  it("takes none beyond 150 m", () => {
    expect(stopNameFor(centre, [stop("Too far", 151), stop("Further", 400)])).toBeNull();
    expect(stopNameFor(centre, [])).toBeNull();
  });

  it("keeps the distance for the reader to tell 'at' (30 m) from 'near'", () => {
    expect(stopNameFor(centre, [stop("At", 29)])?.distanceM).toBeLessThanOrEqual(30);
    expect(stopNameFor(centre, [stop("Near", 31)])?.distanceM).toBeGreaterThan(30);
  });

  it("decides a tie by the shorter name, then alphabetically", () => {
    expect(stopNameFor(centre, [stop("Zuid-station", 50), stop("Zuid", 50)])?.text).toBe("Zuid");
    expect(stopNameFor(centre, [stop("Bb", 50), stop("Aa", 50)])?.text).toBe("Aa");
  });

  it("keeps a name to 200 characters", () => {
    expect(stopNameFor(centre, [stop("x".repeat(300), 10)])?.text).toHaveLength(200);
  });
});

describe("naming a place after its road", () => {
  it("takes the most frequent name, ties alphabetically", () => {
    expect(roadNameFrom(["Kerkstraat", "Dorpsstraat", "Kerkstraat"])).toEqual({
      text: "Kerkstraat",
      source: "road",
      kind: null,
      distanceM: 0,
    });
    expect(roadNameFrom(["B", "A"])?.text).toBe("A");
  });

  it("gives none without names", () => {
    expect(roadNameFrom([])).toBeNull();
  });
});
