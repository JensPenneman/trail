import { describe, expect, it } from "vitest";
import { classifyPoi } from "../../src/processing/classifyPoi";
import { classifyWay } from "../../src/processing/classifyWay";

describe("classifyWay", () => {
  it("maps OSM's highway and railway values to Trail's way kinds", () => {
    expect(classifyWay({ highway: "motorway_link" })).toBe("motorway");
    expect(classifyWay({ highway: "trunk" })).toBe("trunk");
    expect(classifyWay({ highway: "unclassified" })).toBe("tertiary");
    expect(classifyWay({ highway: "living_street" })).toBe("residential");
    expect(classifyWay({ highway: "pedestrian" })).toBe("footway");
    expect(classifyWay({ highway: "bridleway" })).toBe("path");
    expect(classifyWay({ highway: "raceway" })).toBe("other");
    expect(classifyWay({ railway: "narrow_gauge" })).toBe("rail");
    expect(classifyWay({ railway: "light_rail" })).toBe("light_rail");
    expect(classifyWay({ railway: "subway" })).toBe("subway");
  });

  it("puts a tram before the street it runs in, a ferry before both", () => {
    expect(classifyWay({ highway: "pedestrian", railway: "tram" })).toBe("tram");
    expect(classifyWay({ route: "ferry", highway: "service" })).toBe("ferry");
  });

  it("skips what nobody travels on", () => {
    expect(classifyWay({ highway: "construction" })).toBeNull();
    expect(classifyWay({ highway: "proposed" })).toBeNull();
    expect(classifyWay({ railway: "abandoned" })).toBeNull();
    expect(classifyWay({ building: "yes" })).toBeNull();
  });
});

describe("classifyPoi", () => {
  it("knows stations, halts and the stops of trams, metros, buses and ferries", () => {
    expect(classifyPoi({ railway: "station" })).toBe("station");
    expect(classifyPoi({ railway: "station", station: "subway" })).toBe("subway_station");
    expect(classifyPoi({ railway: "halt" })).toBe("halt");
    expect(classifyPoi({ railway: "tram_stop" })).toBe("tram_stop");
    expect(classifyPoi({ highway: "bus_stop" })).toBe("bus_stop");
    expect(classifyPoi({ amenity: "ferry_terminal" })).toBe("ferry_terminal");
    expect(classifyPoi({ aeroway: "aerodrome" })).toBe("aerodrome");
    expect(classifyPoi({ amenity: "cafe" })).toBeNull();
  });
});
