import { describe, expect, it } from "vitest";
import { latToTileY, lonToTileX } from "../../src/heatmap/tileMath";
import {
  groupPlaces,
  localDaysOf,
  placeCellOf,
  placeDays,
  placeOf,
} from "../../src/insights/groupPlaces";
import { localHours } from "../../src/insights/localHours";
import type { PlaceStay } from "../../src/insights/placeStays";

const hour = 3_600_000;
const zone = "Europe/Brussels";
const at = (iso: string) => Date.parse(iso);

/** A degree of latitude is 111 km, a z18 cell about 70 m east-west and 100 m north-south at 51° N. */
const home = { lat: 51.0362, lon: 3.7104 };
const stay = (
  deviceId: string,
  from: string,
  to: string,
  place: { lat: number; lon: number } = home,
): PlaceStay => ({ deviceId, startMs: at(from), endMs: at(to), ...place });

const period = (from: string, to: string) => {
  const hours = localHours(from, to, zone);
  return {
    hours,
    window: { startMs: hours[0]?.start ?? 0, endMs: hours.at(-1)?.end ?? 0 },
  };
};

describe("the cell of a place", () => {
  it("is the zoom-18 tile the position lies in, as the heatmap's maths has it", () => {
    expect(placeCellOf(home.lat, home.lon)).toBe(
      `${lonToTileX(home.lon, 18)}.${latToTileY(home.lat, 18)}`,
    );
    const key = placeCellOf(home.lat, home.lon);
    expect(key).toMatch(/^\d{1,6}\.\d{1,6}$/);
  });
});

describe("stays → places", () => {
  const { window } = period("2026-10-26", "2026-10-26");

  it("adds up the stays of a cell, joins devices instead of adding them, and counts visits by start", () => {
    const groups = groupPlaces(
      [
        stay("phone", "2026-10-26T06:00:00Z", "2026-10-26T08:00:00Z"),
        // The tracker was there for the same two hours and an hour more.
        stay("tracker", "2026-10-26T07:00:00Z", "2026-10-26T09:00:00Z"),
        stay("phone", "2026-10-26T12:00:00Z", "2026-10-26T13:00:00Z"),
      ],
      window,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.durationMs).toBe(4 * hour);
    expect(groups[0]?.visits).toHaveLength(2);
    expect(groups[0]?.deviceIds).toEqual(["phone", "tracker"]);
    expect(groups[0]?.centre).toEqual([3.7104, 51.0362]);
  });

  it("clips a stay to the period, and counts a visit by the start the stay had", () => {
    const { window: day } = period("2026-10-26", "2026-10-26");
    const [group] = groupPlaces(
      [
        // Began the evening before, ends at midnight Brussels time + 2 h; started before the period.
        stay("phone", "2026-10-25T20:00:00Z", "2026-10-26T01:00:00Z"),
        stay("phone", "2026-10-26T22:00:00Z", "2026-10-27T05:00:00Z"),
      ],
      day,
    );
    // The period is the local day 26 Oct (00:00 CEST = 22:00Z the evening before … 23:00Z).
    expect(group?.visits.map((v) => [v.fromMs, v.toMs])).toEqual([
      [day.startMs, at("2026-10-26T01:00:00Z")],
      [at("2026-10-26T22:00:00Z"), day.endMs],
    ]);
    expect(group?.visits[0]?.startedMs).toBe(at("2026-10-25T20:00:00Z"));
  });

  it("leaves out a stay outside the period", () => {
    expect(
      groupPlaces([stay("phone", "2026-10-20T06:00:00Z", "2026-10-20T08:00:00Z")], window),
    ).toEqual([]);
  });

  it("orders places by time, ties by key", () => {
    const near = { lat: 51.1, lon: 3.8 };
    const groups = groupPlaces(
      [
        stay("phone", "2026-10-26T06:00:00Z", "2026-10-26T07:00:00Z", home),
        stay("phone", "2026-10-26T08:00:00Z", "2026-10-26T10:00:00Z", near),
        stay("phone", "2026-10-26T11:00:00Z", "2026-10-26T12:00:00Z", { lat: 50.5, lon: 4.5 }),
      ],
      window,
    );
    expect(groups.map((g) => g.durationMs / hour)).toEqual([2, 1, 1]);
    const [, first, second] = groups;
    expect((first?.key ?? "") < (second?.key ?? "")).toBe(true);
  });
});

describe("folding neighbouring cells", () => {
  const { window } = period("2026-10-26", "2026-10-26");
  const cell = placeCellOf(home.lat, home.lon);
  const [x = 0, y = 0] = cell.split(".").map(Number);
  /** The middle of the cell offset by (dx, dy) from home's. */
  const centreOf = (dx: number, dy: number) => {
    const tiles = 2 ** 18;
    const lon = ((x + dx + 0.5) / tiles) * 360 - 180;
    const lat =
      (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + dy + 0.5)) / tiles))) * 180) / Math.PI;
    return { lat, lon };
  };

  it("folds the neighbours of the cell with most time into it, at most 3 × 3", () => {
    const groups = groupPlaces(
      [
        stay("phone", "2026-10-26T06:00:00Z", "2026-10-26T10:00:00Z", centreOf(0, 0)),
        stay("phone", "2026-10-26T10:00:00Z", "2026-10-26T11:00:00Z", centreOf(1, 1)),
        stay("phone", "2026-10-26T11:00:00Z", "2026-10-26T12:00:00Z", centreOf(-1, 0)),
        // Two cells away: its own place.
        stay("phone", "2026-10-26T12:00:00Z", "2026-10-26T13:00:00Z", centreOf(2, 0)),
      ],
      window,
    );
    expect(groups).toHaveLength(2);
    expect(groups[0]?.key).toBe(cell);
    expect(groups[0]?.cells.sort()).toEqual([cell, `${x + 1}.${y + 1}`, `${x - 1}.${y}`].sort());
    expect(groups[0]?.durationMs).toBe(6 * hour);
    expect(groups[1]?.cells).toEqual([`${x + 2}.${y}`]);
  });

  it("takes the same places whatever order the stays come in", () => {
    const stays = [
      stay("a", "2026-10-26T06:00:00Z", "2026-10-26T08:00:00Z", centreOf(0, 0)),
      stay("a", "2026-10-26T08:00:00Z", "2026-10-26T10:00:00Z", centreOf(1, 0)),
      stay("b", "2026-10-26T10:00:00Z", "2026-10-26T12:00:00Z", centreOf(2, 0)),
      stay("b", "2026-10-26T12:00:00Z", "2026-10-26T13:00:00Z", centreOf(3, 0)),
    ];
    const keys = (list: PlaceStay[]) =>
      groupPlaces(list, window).map((g) => [g.key, [...g.cells].sort()]);
    expect(keys([...stays].reverse())).toEqual(keys(stays));
    // A chain of four cells: the two with most time (equal: the lower key first) claim 2 each.
    expect(keys(stays)).toEqual([
      [`${x}.${y}`, [`${x}.${y}`, `${x + 1}.${y}`].sort()],
      [`${x + 2}.${y}`, [`${x + 2}.${y}`, `${x + 3}.${y}`].sort()],
    ]);
  });

  it("orders cells by their joined time: two devices at once are not twice as much", () => {
    // The home cell: two devices for the same 3 hours (3 h joined, 6 h summed). The cell next to
    // it: 4 hours. By joined time the neighbour claims home; by a plain sum home would.
    const groups = groupPlaces(
      [
        stay("a", "2026-10-26T06:00:00Z", "2026-10-26T09:00:00Z", centreOf(0, 0)),
        stay("b", "2026-10-26T06:00:00Z", "2026-10-26T09:00:00Z", centreOf(0, 0)),
        stay("a", "2026-10-26T10:00:00Z", "2026-10-26T14:00:00Z", centreOf(1, 0)),
      ],
      window,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe(`${x + 1}.${y}`);
    expect(groups[0]?.durationMs).toBe(7 * hour);
  });

  it("keeps each stay's device and its real arrival and departure, clipped or not", () => {
    const { window: day } = period("2026-10-26", "2026-10-26");
    const [group] = groupPlaces(
      [
        stay("a", "2026-10-25T20:00:00Z", "2026-10-26T01:00:00Z"),
        stay("b", "2026-10-26T06:00:00Z", "2026-10-26T07:00:00Z"),
      ],
      day,
    );
    expect(group?.stays).toEqual([
      { deviceId: "a", startMs: at("2026-10-25T20:00:00Z"), endMs: at("2026-10-26T01:00:00Z") },
      { deviceId: "b", startMs: at("2026-10-26T06:00:00Z"), endMs: at("2026-10-26T07:00:00Z") },
    ]);
  });

  it("resolves any folded cell to its place", () => {
    const groups = groupPlaces(
      [
        stay("phone", "2026-10-26T06:00:00Z", "2026-10-26T10:00:00Z", centreOf(0, 0)),
        stay("phone", "2026-10-26T10:00:00Z", "2026-10-26T11:00:00Z", centreOf(1, 0)),
      ],
      window,
    );
    expect(placeOf(groups, `${x + 1}.${y}`)?.key).toBe(cell);
    expect(placeOf(groups, cell)?.key).toBe(cell);
    expect(placeOf(groups, `${x + 5}.${y}`)).toBeNull();
  });

  it("puts the centre where the time was, weighted", () => {
    const [group] = groupPlaces(
      [
        stay("phone", "2026-10-26T06:00:00Z", "2026-10-26T09:00:00Z", centreOf(0, 0)),
        stay("phone", "2026-10-26T09:00:00Z", "2026-10-26T10:00:00Z", centreOf(1, 0)),
      ],
      window,
    );
    const one = centreOf(0, 0);
    const two = centreOf(1, 0);
    const expected = Math.round(((3 * one.lon + two.lon) / 4) * 10_000) / 10_000;
    expect(group?.centre[0]).toBe(expected);
  });
});

describe("days of a place", () => {
  it("are split at local midnight, with the visit counted on the day its stay began", () => {
    const { hours, window } = period("2026-10-26", "2026-10-27");
    const days = localDaysOf(hours);
    const [group] = groupPlaces(
      // 22:00 to 02:00 local (CET after 25 Oct is UTC+1; CEST ended 25 Oct, so UTC+1): 21:00Z–01:00Z.
      [stay("phone", "2026-10-26T21:00:00Z", "2026-10-27T01:00:00Z")],
      window,
    );
    if (group === undefined) throw new Error("no place");
    const rows = placeDays(group, days);
    expect(rows.map((r) => [r.date, r.durationMs / hour, r.visits])).toEqual([
      ["2026-10-26", 2, 1],
      ["2026-10-27", 2, 0],
    ]);
    expect(rows[0]?.lastMs).toBe(days[0]?.end);
    expect(rows[1]?.firstMs).toBe(days[1]?.start);
  });

  it("follow the clock on the days summer time starts and ends", () => {
    // 29 March 2026 has 23 hours, 25 October 2026 has 25: a stay lasting all day is that long.
    for (const [date, hoursInDay] of [
      ["2026-03-29", 23],
      ["2026-10-25", 25],
    ] as const) {
      const { hours, window } = period(date, date);
      const days = localDaysOf(hours);
      expect(days).toHaveLength(1);
      const [group] = groupPlaces(
        [{ deviceId: "p", startMs: window.startMs - hour, endMs: window.endMs + hour, ...home }],
        window,
      );
      if (group === undefined) throw new Error("no place");
      const [row] = placeDays(group, days);
      expect(row?.durationMs, date).toBe(hoursInDay * hour);
    }
  });

  it("have no row for a day without time there", () => {
    const { hours, window } = period("2026-10-26", "2026-10-30");
    const [group] = groupPlaces(
      [stay("phone", "2026-10-28T08:00:00Z", "2026-10-28T09:00:00Z")],
      window,
    );
    if (group === undefined) throw new Error("no place");
    expect(placeDays(group, localDaysOf(hours)).map((r) => r.date)).toEqual(["2026-10-28"]);
  });
});
