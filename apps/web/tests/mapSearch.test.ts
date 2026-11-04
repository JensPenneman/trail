import { describe, expect, it } from "vitest";
import { resolveHeatMeasure } from "../src/pages/map/heat/useHeatChoice";
import type { MapPerson } from "../src/pages/map/MapPerson";
import {
  withDay,
  withDevices,
  withHeatPeriod,
  withList,
  withoutCamera,
  withoutLens,
  withPerson,
  withRange,
  withView,
} from "../src/pages/map/mapSearchUpdates";
import { shownView, viewsFor } from "../src/pages/map/mapViews";
import { parseCamera, parseHeatPeriod, parseMapSearch } from "../src/pages/map/parseMapSearch";
import { resolveMapSelection } from "../src/pages/map/resolveMapSelection";

const today = "2026-10-26";
const anna = "0199a0f2-11c4-7e0b-9c1d-2f5a8e4b7a60";
const bob = "0199a0f2-22d5-7f1c-8d2e-3a6b9f5c8b71";
const parse = (search: string) => parseMapSearch(new URLSearchParams(search), today);

describe("the People page's URL", () => {
  it("defaults to Live, nobody selected, every device and today", () => {
    expect(parse("")).toEqual({
      view: "live",
      person: null,
      list: null,
      devices: null,
      period: { mode: "day", from: today, to: today },
      heat: null,
      heatPeriod: null,
      camera: null,
    });
  });

  it("reads a level below the root only where nobody is selected", () => {
    expect(parse("list=hidden").list).toBe("hidden");
    expect(parse("list=nonsense").list).toBeNull();
    expect(parse("person=me&list=hidden").list).toBeNull();
  });

  it("drops the level when someone is selected, and sets it again", () => {
    const hidden = withList(new URLSearchParams("view=history&list=hidden"), "hidden");
    expect(hidden.toString()).toBe("view=history&list=hidden");
    expect(withPerson(hidden, "me").toString()).toBe("view=history&person=me");
    expect(withList(hidden, null).toString()).toBe("view=history");
  });

  it("reads the view, the person, the devices and History's day or period", () => {
    expect(
      parse(`view=history&person=${anna.toUpperCase()}&devices=a,b&from=2026-10-01&to=2026-10-07`),
    ).toEqual({
      view: "history",
      person: anna,
      list: null,
      devices: ["a", "b"],
      period: { mode: "range", from: "2026-10-01", to: "2026-10-07" },
      heat: null,
      heatPeriod: { from: "2026-10-01", to: "2026-10-07" },
      camera: null,
    });
    expect(parse("view=heat&date=2026-10-20").period).toEqual({
      mode: "day",
      from: "2026-10-20",
      to: "2026-10-20",
    });
  });

  it("falls back instead of failing on hand-edited links", () => {
    expect(parse("view=explore").view).toBe("live");
    expect(parse("person=nobody").person).toBeNull();
    expect(parse(`person=nobody&people=${anna}`).person).toBe(anna);
    expect(parse("date=2099-01-01").period.from).toBe(today);
  });

  it("changes one thing at a time and keeps the rest", () => {
    const start = new URLSearchParams("date=2026-10-20&devices=a&level=raw&style=dark");
    expect(withView(start, "history").toString()).toBe(
      "date=2026-10-20&devices=a&level=raw&style=dark&view=history",
    );
    expect(withView(new URLSearchParams("view=heat&devices=a"), "live").toString()).toBe("");
    expect(withDevices(start, null).toString()).toBe("date=2026-10-20&level=raw&style=dark");
    expect(withDevices(start, ["a", "b"]).get("devices")).toBe("a,b");
    expect(withDay(start, "2026-10-19", today).get("date")).toBe("2026-10-19");
    expect(withDay(start, today, today).has("date")).toBe(false);
    expect(withRange(start, "2026-10-01", "2026-10-07").toString()).toBe(
      "devices=a&level=raw&style=dark&from=2026-10-01&to=2026-10-07",
    );
  });

  it("reads links from before the single selection", () => {
    // One person selects them; several mean the overview.
    expect(parse(`people=${anna}`).person).toBe(anna);
    expect(parse(`people=me,${anna},${anna}`).person).toBeNull();
    expect(parse("people=me").person).toBe("me");
    expect(parse(`people=,nobody,${anna},${anna}`).person).toBe(anna);
    // A link to one move is a link to one's own.
    expect(parse("view=history&segment=abc").person).toBe("me");
    expect(parse(`segment=abc&person=${anna}`).person).toBe(anna);
    expect(parse("segment=abc&people=me,x").person).toBe("me");
  });

  it("leaves Heat's device filter behind when nobody is selected, and keeps it with a person", () => {
    const heat = new URLSearchParams("view=heat&devices=a");
    expect(withView(heat, "live").toString()).toBe("");
    expect(withView(heat, "history").toString()).toBe("view=history");
    expect(withView(new URLSearchParams("view=heat&person=me&devices=a"), "live").toString()).toBe(
      "person=me&devices=a",
    );
    // From another view the filter stays: it is a person's there.
    expect(withView(new URLSearchParams("devices=a"), "heat").toString()).toBe(
      "devices=a&view=heat",
    );
  });

  it("selects one person at a time and drops what belongs to the last", () => {
    const start = new URLSearchParams(
      `view=history&date=2026-10-20&level=raw&style=dark&devices=a&people=me,${anna}&segment=s`,
    );
    expect(withPerson(start, anna).toString()).toBe(
      `view=history&date=2026-10-20&level=raw&style=dark&person=${anna}`,
    );
    // Back to the overview takes the move along, or its link would select Me again.
    expect(
      withPerson(new URLSearchParams(`person=me&segment=s&from=2026-10-01`), null).toString(),
    ).toBe("from=2026-10-01");
  });
});

describe("the views there are", () => {
  it("offer Heat while nobody or the signed-in person is selected, whose heatmap it is", () => {
    expect(viewsFor(true)).toEqual(["live", "history", "heat"]);
    expect(viewsFor(false)).toEqual(["live", "history"]);
  });

  it("show Live for Heat with someone else selected, and Heat again with Me", () => {
    expect(shownView("heat", false)).toBe("live");
    expect(shownView("heat", true)).toBe("heat");
    expect(shownView("history", false)).toBe("history");
    expect(shownView("live", false)).toBe("live");
  });
});

describe("the map's selection", () => {
  const people: MapPerson[] = [
    {
      key: "me",
      name: "Me",
      devices: [
        { id: "phone", name: "iPhone" },
        { id: "car", name: "Car" },
      ],
    },
    { key: anna, name: "Anna", devices: [{ id: "anna-phone", name: "Anna's iPhone" }] },
  ];

  it("selects nobody in the overview, which still shows everyone's devices", () => {
    const overview = resolveMapSelection({ person: null, devices: null }, people, true);
    expect(overview.selected).toBeNull();
    expect(overview.own).toEqual({ deviceIds: null });
    expect(overview.devicesOf("me")).toEqual(["phone", "car"]);
    expect(overview.devicesOf(anna)).toEqual(["anna-phone"]);
  });

  it("shows the signed-in person's devices, all of them unless filtered", () => {
    const all = resolveMapSelection({ person: "me", devices: null }, people, true);
    expect(all.selected?.key).toBe("me");
    expect(all.own).toEqual({ deviceIds: null });
    expect(all.devicesOf("me")).toEqual(["phone", "car"]);
    const filtered = resolveMapSelection({ person: "me", devices: ["car"] }, people, true);
    expect(filtered.own).toEqual({ deviceIds: ["car"] });
    expect(filtered.filter).toEqual(["car"]);
    expect(filtered.devicesOf(anna)).toEqual(["anna-phone"]);
  });

  it("shows someone else with the devices they share, and none of one's own tracks", () => {
    const selection = resolveMapSelection({ person: anna, devices: null }, people, true);
    expect(selection.selected?.key).toBe(anna);
    expect(selection.devicesOf(anna)).toEqual(["anna-phone"]);
    // One's own devices are not asked for: the heatmap and the tracks follow Me.
    expect(selection.own).toEqual({ deviceIds: null });
    // The filter is the selected person's: another person's device ids do not count.
    expect(
      resolveMapSelection({ person: anna, devices: ["phone"] }, people, true).filter,
    ).toBeNull();
  });

  it("selects the owner of the devices a link names", () => {
    expect(
      resolveMapSelection({ person: null, devices: ["car"] }, people, true).selected?.key,
    ).toBe("me");
    expect(
      resolveMapSelection({ person: null, devices: ["anna-phone"] }, people, true).selected?.key,
    ).toBe(anna);
    // Devices of several people: no one owner, the overview.
    expect(
      resolveMapSelection({ person: null, devices: ["car", "anna-phone"] }, people, true).selected,
    ).toBeNull();
    // While loading, a device's own page most likely links to one's own.
    expect(resolveMapSelection({ person: null, devices: ["car"] }, [], false).selected?.key).toBe(
      "me",
    );
  });

  it("applies a device filter to one's own devices in Heat and selects nobody", () => {
    const heat = resolveMapSelection({ person: null, devices: ["car"] }, people, true, true);
    expect(heat.selected).toBeNull();
    expect(heat.filter).toEqual(["car"]);
    expect(heat.own).toEqual({ deviceIds: ["car"] });
    expect(heat.devicesOf("me")).toEqual(["car"]);
    expect(heat.devicesOf(anna)).toEqual(["anna-phone"]);
    // Anyone else's device is no filter of one's heatmap.
    expect(
      resolveMapSelection({ person: null, devices: ["anna-phone"] }, people, true, true).own,
    ).toEqual({ deviceIds: null });
  });

  it("drops what nobody knows once everything has loaded, and keeps it until then", () => {
    const pending = resolveMapSelection({ person: bob, devices: ["gone"] }, people, false);
    expect(pending.selected?.key).toBe(bob);
    const loaded = resolveMapSelection({ person: bob, devices: ["gone"] }, people, true);
    expect(loaded.selected).toBeNull();
    expect(loaded.filter).toBeNull();
    expect(loaded.own).toEqual({ deviceIds: null });
  });
});

describe("Heat in the People page's URL", () => {
  it("reads the measure, and nothing for what it does not know", () => {
    expect(parse("view=heat&heat=time").heat).toBe("time");
    expect(parse("heat=visits").heat).toBe("visits");
    for (const bad of ["", "sped", "TIME", "points,time"]) {
      expect(parse(`heat=${bad}`).heat).toBeNull();
    }
  });

  it("resolves address, then the browser's choice, then the preference, then points", () => {
    expect(resolveHeatMeasure("visits", "time", "points")).toBe("visits");
    expect(resolveHeatMeasure(null, "time", "visits")).toBe("time");
    expect(resolveHeatMeasure(null, null, "visits")).toBe("visits");
    expect(resolveHeatMeasure(null, null, undefined)).toBe("points");
    // An address that is not a measure is no address.
    expect(resolveHeatMeasure("sped", "time", "visits")).toBe("time");
  });

  it("reads a period of up to three years, which History would cut to 93 days", () => {
    expect(parseHeatPeriod(new URLSearchParams("from=2025-11-01&to=2026-10-01"), today)).toEqual({
      from: "2025-11-01",
      to: "2026-10-01",
    });
    expect(parse("view=history&from=2025-11-01&to=2026-10-01").period.to).toBe("2026-02-01");
    // Reversed dates are put in order, the future is pulled back to today, three years is the end.
    expect(parseHeatPeriod(new URLSearchParams("from=2026-10-20&to=2026-10-01"), today)).toEqual({
      from: "2026-10-01",
      to: "2026-10-20",
    });
    expect(parseHeatPeriod(new URLSearchParams("from=2026-10-01&to=2027-01-01"), today)).toEqual({
      from: "2026-10-01",
      to: today,
    });
    expect(parseHeatPeriod(new URLSearchParams("from=2020-01-01&to=2026-10-01"), today)).toEqual({
      from: "2020-01-01",
      to: "2022-12-31",
    });
    for (const half of ["from=2026-10-01", "to=2026-10-01", "from=x&to=y", ""]) {
      expect(parseHeatPeriod(new URLSearchParams(half), today)).toBeNull();
    }
  });

  it("changes the period as a step of its own, keeping the day, and all time drops both", () => {
    const next = withHeatPeriod(new URLSearchParams("view=heat&date=2026-10-20"), {
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(next.toString()).toBe("view=heat&date=2026-10-20&from=2026-10-01&to=2026-10-31");
    expect(withHeatPeriod(next, null).toString()).toBe("view=heat&date=2026-10-20");
  });

  it("takes a period over 93 days along to no other view, and a shorter one along", () => {
    const long = new URLSearchParams("view=heat&heat=time&from=2026-01-01&to=2026-10-01");
    expect(withView(long, "history").has("from")).toBe(false);
    expect(withView(long, "history").has("to")).toBe(false);
    expect(withView(long, "history").get("heat")).toBe("time");
    const short = new URLSearchParams("view=heat&from=2026-10-01&to=2026-10-10");
    expect(withView(short, "history").get("from")).toBe("2026-10-01");
    // From another view to Heat nothing is dropped.
    const history = new URLSearchParams("view=history&from=2026-10-01&to=2026-10-31");
    expect(withView(history, "heat").get("to")).toBe("2026-10-31");
    // Not dates: left alone.
    expect(withView(new URLSearchParams("view=heat&from=a&to=b"), "live").get("from")).toBe("a");
  });

  it("takes the lens off together: measure, period and mode, keeping the rest", () => {
    const lensed = new URLSearchParams(
      "view=heat&heat=visits&from=2026-10-01&to=2026-10-31&mode=cycling&devices=a&date=2026-10-02",
    );
    expect(withoutLens(lensed).toString()).toBe("view=heat&devices=a&date=2026-10-02");
  });
});

describe("the camera of a link", () => {
  it("reads lon, lat and zoom, within the world", () => {
    expect(parseCamera("3.7174,51.0543,14.5")).toEqual({ lon: 3.7174, lat: 51.0543, zoom: 14.5 });
    expect(parseCamera("-180,-85.0511,0")).toEqual({ lon: -180, lat: -85.0511, zoom: 0 });
    expect(parse("view=heat&c=3.7,51,12").camera).toEqual({ lon: 3.7, lat: 51, zoom: 12 });
  });

  it("ignores what is not a camera", () => {
    for (const bad of [
      null,
      "",
      "3.7,51",
      "3.7,51,12,1",
      "a,b,c",
      "181,51,12",
      "3.7,86,12",
      "3.7,51,23",
      "3.7,51,-1",
      "3.7,51,",
      "1e3,51,12",
      "NaN,51,12",
    ]) {
      expect(parseCamera(bad), String(bad)).toBeNull();
    }
  });

  it("is dropped by itself, keeping the rest", () => {
    expect(withoutCamera(new URLSearchParams("view=heat&c=3.7,51,12&heat=time")).toString()).toBe(
      "view=heat&heat=time",
    );
  });
});
