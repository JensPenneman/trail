import { describe, expect, it } from "vitest";
import type { MapPerson } from "../src/pages/map/MapPerson";
import {
  withDay,
  withDevices,
  withPerson,
  withRange,
  withView,
} from "../src/pages/map/mapSearchUpdates";
import { shownView, viewsFor } from "../src/pages/map/mapViews";
import { parseMapSearch } from "../src/pages/map/parseMapSearch";
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
      devices: null,
      period: { mode: "day", from: today, to: today },
    });
  });

  it("reads the view, the person, the devices and History's day or period", () => {
    expect(
      parse(`view=history&person=${anna.toUpperCase()}&devices=a,b&from=2026-10-01&to=2026-10-07`),
    ).toEqual({
      view: "history",
      person: anna,
      devices: ["a", "b"],
      period: { mode: "range", from: "2026-10-01", to: "2026-10-07" },
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
