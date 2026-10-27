import { describe, expect, it } from "vitest";
import type { MapPerson } from "../src/pages/map/MapPerson";
import {
  withDay,
  withDevices,
  withPeople,
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
  it("defaults to Live, the signed-in person, every device and today", () => {
    expect(parse("")).toEqual({
      view: "live",
      people: ["me"],
      devices: null,
      period: { mode: "day", from: today, to: today },
    });
  });

  it("reads the view, the people, the devices and History's day or period", () => {
    expect(
      parse(
        `view=history&people=me,${anna.toUpperCase()}&devices=a,b&from=2026-10-01&to=2026-10-07`,
      ),
    ).toEqual({
      view: "history",
      people: ["me", anna],
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
    expect(parse(`people=,nobody,${anna},${anna}`).people).toEqual([anna]);
    expect(parse("people=nobody").people).toEqual(["me"]);
    expect(parse("date=2099-01-01").period.from).toBe(today);
  });

  it("changes one thing at a time and keeps the rest", () => {
    const start = new URLSearchParams("date=2026-10-20&devices=a&level=raw&style=dark");
    expect(withView(start, "history").toString()).toBe(
      "date=2026-10-20&devices=a&level=raw&style=dark&view=history",
    );
    expect(withView(new URLSearchParams("view=heat&devices=a"), "live").toString()).toBe(
      "devices=a",
    );
    expect(withDevices(start, null).toString()).toBe("date=2026-10-20&level=raw&style=dark");
    expect(withDevices(start, ["a", "b"]).get("devices")).toBe("a,b");
    expect(withDay(start, "2026-10-19", today).get("date")).toBe("2026-10-19");
    expect(withDay(start, today, today).has("date")).toBe(false);
    expect(withRange(start, "2026-10-01", "2026-10-07").toString()).toBe(
      "devices=a&level=raw&style=dark&from=2026-10-01&to=2026-10-07",
    );
  });

  it("keeps a device filter fitting when people come and go", () => {
    const devicesOf = (person: string) =>
      ({ me: ["phone", "car"], [anna]: ["anna-phone"], [bob]: ["bob-phone", "bob-watch"] })[
        person
      ] ?? [];
    // Nobody filtered: nothing to adjust.
    expect(withPeople(new URLSearchParams(), ["me", anna], devicesOf).toString()).toBe(
      `people=me%2C${anna}`,
    );
    // Someone who joins shows all their devices; someone who leaves takes theirs along.
    const filtered = new URLSearchParams(`people=me,${anna}&devices=phone,anna-phone`);
    expect(withPeople(filtered, ["me", bob], devicesOf).get("devices")).toBe(
      "phone,bob-phone,bob-watch",
    );
    // A filter that covers everything left is dropped, and Me alone is the default.
    expect(withPeople(filtered, ["me"], devicesOf).get("devices")).toBe("phone");
    expect(
      withPeople(
        new URLSearchParams(`people=me,${anna}&devices=phone,car`),
        ["me"],
        devicesOf,
      ).toString(),
    ).toBe("");
    expect(
      withPeople(
        new URLSearchParams(`people=me,${anna}&devices=anna-phone`),
        ["me"],
        devicesOf,
      ).has("devices"),
    ).toBe(false);
  });
});

describe("the views there are", () => {
  it("offer Heat with the signed-in person only, whose heatmap it is", () => {
    expect(viewsFor(true)).toEqual(["live", "history", "heat"]);
    expect(viewsFor(false)).toEqual(["live", "history"]);
  });

  it("show Live for Heat without Me, and Heat again with Me", () => {
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

  it("shows the signed-in person's devices, all of them unless filtered", () => {
    const all = resolveMapSelection({ people: ["me"], devices: null }, people, true);
    expect(all.people.map((person) => person.key)).toEqual(["me"]);
    expect(all.own).toEqual({ deviceIds: null });
    expect(all.devicesOf("me")).toEqual(["phone", "car"]);
    const filtered = resolveMapSelection({ people: ["me"], devices: ["car"] }, people, true);
    expect(filtered.own).toEqual({ deviceIds: ["car"] });
    expect(filtered.filter).toEqual(["car"]);
  });

  it("shows other people with the devices they share, and nothing of one's own when left out", () => {
    const selection = resolveMapSelection(
      { people: [anna], devices: ["anna-phone"] },
      people,
      true,
    );
    expect(selection.people.map((person) => person.key)).toEqual([anna]);
    expect(selection.devicesOf(anna)).toEqual(["anna-phone"]);
    expect(selection.own).toBeNull();
    expect(
      resolveMapSelection({ people: ["me", anna], devices: ["anna-phone"] }, people, true).own,
    ).toBeNull();
  });

  it("drops what nobody knows once everything has loaded, and keeps it until then", () => {
    const pending = resolveMapSelection({ people: [bob], devices: ["gone"] }, people, false);
    expect(pending.people).toEqual([]);
    expect(pending.own).toBeNull();
    const loaded = resolveMapSelection({ people: [bob], devices: ["gone"] }, people, true);
    expect(loaded.people.map((person) => person.key)).toEqual(["me"]);
    expect(loaded.filter).toBeNull();
    expect(loaded.own).toEqual({ deviceIds: null });
  });
});
