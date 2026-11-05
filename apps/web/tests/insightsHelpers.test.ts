import { describe, expect, it } from "vitest";
import { createFormatter } from "../src/format/createFormatter";
import { bucketLabels } from "../src/pages/insights/bucketLabels";
import { foldModes } from "../src/pages/insights/foldModes";
import { axisFormats, changeOf } from "../src/pages/insights/insightsFormat";
import { keyOf, levelOf } from "../src/pages/insights/insightsLevels";
import { moveOnMap, placeLink } from "../src/pages/insights/insightsLinks";
import {
  longestFact,
  modeFamily,
  roadsFact,
  speedFact,
  whenFact,
} from "../src/pages/insights/modeFacts";
import { placeLabel } from "../src/pages/insights/placeLabel";
import { modeInsights } from "./support/insightsFixtures";

const format = createFormatter("en-GB", "Europe/Brussels");
describe("Insights' words and numbers", () => {
  it("says how a number changed against the period before", () => {
    const options = (kind: "amount" | "count") => ({ kind, format });
    expect(changeOf(110, 100, "the 7 days before", options("amount"))).toEqual({
      text: "10% more than the 7 days before",
      direction: "up",
    });
    expect(changeOf(50, 100, "the 7 days before", options("amount"))?.text).toBe(
      "50% less than the 7 days before",
    );
    expect(changeOf(100.2, 100, "the 7 days before", options("amount"))).toEqual({
      text: "About the same as the 7 days before",
      direction: "flat",
    });
    expect(changeOf(3, 5, "the day before", options("count"))).toEqual({
      text: "2 fewer than the day before",
      direction: "down",
    });
    expect(changeOf(4, 4, "the day before", options("count"))?.direction).toBe("flat");
    expect(changeOf(0, 0, "the day before", options("count"))).toBeNull();
  });

  it("says when there was none in the days compared with", () => {
    const options = (kind: "amount" | "count") => ({ kind, format });
    expect(changeOf(12, 0, "September", options("amount"))).toEqual({
      text: "None in September",
      direction: "up",
    });
    expect(changeOf(3, 0, "the 12 days before", options("count"))?.text).toBe(
      "None in the 12 days before",
    );
    expect(changeOf(12, 100, "September", options("amount"))?.text).toBe("88% less than September");
  });

  it("writes compact ticks", () => {
    const axes = axisFormats(format);
    expect(axes.distance(0)).toBe("0");
    expect(axes.distance(500)).toBe("500 m");
    expect(axes.distance(12_500)).toBe("12.5 km");
    expect(axes.duration(1800)).toBe("30 mins");
    expect(axes.duration(5400)).toBe("1.5 hrs");
  });

  it("names the steps of a series", () => {
    expect(bucketLabels("day", "en-GB").label("2026-10-26")).toBe("Monday, 26 October 2026");
    expect(bucketLabels("day", "en-GB").tick("2026-10-26")).toBe("Mon 26");
    expect(bucketLabels("week", "en-GB").label("2026-10-26")).toBe("Week of 26 October 2026");
    expect(bucketLabels("month", "en-GB").label("2026-10-01")).toBe("October 2026");
  });

  it("folds the smallest modes into one past seven, colours kept by mode", () => {
    const modes = (
      ["walking", "cycling", "car", "bus", "train", "tram", "metro", "boat"] as const
    ).map((mode, index) => ({ mode, distanceM: (index + 1) * 1000 }));
    expect(foldModes(modes)).toEqual({
      shown: ["car", "bus", "tram", "metro", "train", "boat"],
      folded: ["walking", "cycling"],
    });
    expect(foldModes(modes.slice(0, 7)).folded).toEqual([]);
    expect(foldModes(modes.slice(0, 2)).shown).toEqual(["walking", "cycling"]);
  });
});

describe("the facts on a mode's rows", () => {
  const cycling = (overrides: Parameters<typeof modeInsights>[0] = {}) =>
    modeInsights({ mode: "cycling", rail: null, stationStops: null, ...overrides });

  it("names the busiest weekday and hour", () => {
    // The fixture's busiest weekday is Wednesday, at 08:00.
    expect(whenFact(cycling(), format)).toBe("Mostly Wednesdays · busiest at 08:00");
    const quiet = cycling({
      byHour: modeInsights().byHour.map((entry) => ({ ...entry, durationS: 0 })),
    });
    expect(whenFact(quiet, format)).toBeNull();
  });

  it("says how much was on the way the mode travels on", () => {
    expect(
      roadsFact(
        cycling({
          roads: {
            distanceM: 6000,
            mappedM: 6000,
            kinds: [
              { kind: "residential", distanceM: 2280, share: 0.38 },
              { kind: "cycleway", distanceM: 3720, share: 0.62 },
            ],
          },
        }),
        format,
      ),
    ).toBe("62% on cycleways");
    expect(roadsFact(modeInsights({ mode: "train" }), format)).toBe("96% on railway track");
    expect(
      roadsFact(
        modeInsights({ mode: "boat", rail: null, ferry: { distanceM: 800, share: 0.8 } }),
        format,
      ),
    ).toBe("80% on ferry routes");
    // No map data, or a mode that is not laid onto the map: nothing.
    expect(
      roadsFact(cycling({ roads: { distanceM: 6000, mappedM: 0, kinds: [] } }), format),
    ).toBeNull();
    expect(roadsFact(modeInsights({ mode: "plane" }), format)).toBeNull();
    expect(modeFamily("plane")).toBeNull();
    expect(modeFamily("stationary")).toBeNull();
    expect(modeFamily("metro")).toBe("rail");
  });

  it("states the typical speed and the longest move", () => {
    expect(speedFact(modeInsights(), format)).toBe("Typically 96 km/h");
    const unknown = modeInsights();
    expect(
      speedFact({ ...unknown, totals: { ...unknown.totals, typicalSpeedKmh: null } }, format),
    ).toBeNull();
    expect(longestFact(modeInsights(), format)).toBe("60.0 km · Wed 21 Oct");
  });

  it("links a move to its local day in History, as the person themselves", () => {
    const [move] = modeInsights().topMoves.longest;
    if (move === undefined) throw new Error("no move");
    expect(moveOnMap({ ...move, startedAt: "2026-10-26T23:30:00.000Z" }, "Europe/Brussels")).toBe(
      `/?view=history&date=2026-10-27&person=me&segment=${move.segmentId}`,
    );
  });

  it("counts the parts of a mode as a level below it", () => {
    expect(levelOf("/insights")).toBe(0);
    expect(levelOf("/insights/")).toBe(0);
    expect(levelOf("/insights/time")).toBe(1);
    expect(levelOf("/insights/transport/car")).toBe(1);
    expect(levelOf("/insights/transport/car/speed")).toBe(2);
    expect(levelOf("/insights/places")).toBe(1);
    expect(levelOf("/insights/place")).toBe(2);
    expect(levelOf("/insights/place/days")).toBe(3);
  });

  it("tells the screens of two places apart by their key, and others by their path", () => {
    const at = (pathname: string, search = "") => keyOf({ pathname, search });
    expect(at("/insights/place", "?period=2026-10&place=134217.89012")).toBe(
      "/insights/place?place=134217.89012",
    );
    expect(at("/insights/place/days", "?place=134217.89012&period=year")).toBe(
      "/insights/place/days?place=134217.89012",
    );
    expect(at("/insights/place", "?place=134300.89100")).not.toBe(
      at("/insights/place", "?place=134217.89012"),
    );
    expect(at("/insights/transport/car/", "?place=1.2")).toBe("/insights/transport/car");
    expect(at("/insights/places", "?period=2026-10")).toBe("/insights/places");
  });

  it("puts the place in the query, with the period and devices, never in the path", () => {
    const current = new URLSearchParams("period=2026-10&devices=&mode=car&view=x");
    expect(placeLink("/insights/place", current, "134217.89012")).toBe(
      "/insights/place?period=2026-10&place=134217.89012",
    );
    expect(placeLink("/insights/place/days", new URLSearchParams(), "1.2")).toBe(
      "/insights/place/days?place=1.2",
    );
  });
});

describe("what a place is called", () => {
  const centre: [number, number] = [3.7104, 51.0362];
  const stop = (distanceM: number) => ({
    centre,
    name: { text: "Korenmarkt", source: "stop" as const, kind: "tram_stop" as const, distanceM },
  });

  it.each([
    [0, "Korenmarkt"],
    [12, "Korenmarkt"],
    // The stop itself up to 30 m; near it from there to 150 m.
    [30, "Korenmarkt"],
    [31, "Near Korenmarkt"],
    [150, "Near Korenmarkt"],
  ])("a stop %i m away is %s", (distanceM, title) => {
    expect(placeLabel(stop(distanceM), format)).toEqual({ title, detail: null });
  });

  it("is the road where a stay was on one, and the coordinates where there is no name", () => {
    expect(
      placeLabel(
        { centre, name: { text: "Kerkstraat", source: "road", kind: null, distanceM: 0 } },
        format,
      ),
    ).toEqual({ title: "Kerkstraat", detail: null });
    expect(placeLabel({ centre, name: null }, format)).toEqual({
      title: "Unnamed place",
      detail: "51.0362° N, 3.7104° E",
    });
  });
});
