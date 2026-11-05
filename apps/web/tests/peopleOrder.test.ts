import type { Person } from "@trail/contracts/person";
import { describe, expect, it } from "vitest";
import { fold } from "../src/format/fold";
import { filterPeople, searchFrom } from "../src/pages/people/filterPeople";
import { orderPeople } from "../src/pages/people/orderPeople";
import { confirmationText } from "../src/pages/people/ShareConfirmations";
import { ana, seenAt, sharedDevice } from "./support/fixtures";

const now = Date.parse("2026-11-04T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

/** Someone sharing, last seen `seen` minutes ago, or with no location at all (null). */
function someone(name: string, seen: number | null): Person {
  const device = sharedDevice();
  return ana({
    userId: `00000000-0000-4000-8000-${String(name.length).padStart(4, "0")}${name.charCodeAt(0).toString(16).padStart(8, "0")}`,
    displayName: name,
    devices: [seenAt(device, seen === null ? null : minutesAgo(seen))],
  });
}

const names = (people: Person[]) => people.map((person) => person.displayName);

describe("orderPeople", () => {
  it("puts those live now first by name, then the last seen newest first, then no location by name", () => {
    const ordered = orderPeople(
      [
        someone("Zed", null),
        someone("Old", 600),
        someone("Bea", 5),
        someone("Recent", 40),
        someone("Abe", 1),
        someone("Nomad", null),
      ],
      now,
      15,
    );
    expect(names(ordered)).toEqual(["Abe", "Bea", "Recent", "Old", "Nomad", "Zed"]);
  });

  it("does not move live people as their positions come in", () => {
    const people = [someone("Bea", 1), someone("Abe", 9)];
    const before = names(orderPeople(people, now, 15));
    const after = names(orderPeople([someone("Bea", 0), someone("Abe", 14)], now, 15));
    expect(after).toEqual(before);
  });

  it("moves someone down when their position goes stale", () => {
    expect(names(orderPeople([someone("Abe", 30), someone("Bea", 1)], now, 15))).toEqual([
      "Bea",
      "Abe",
    ]);
  });
});

describe("filterPeople", () => {
  const people = [someone("José Álvarez", 1), someone("Zoë", 2), someone("Bob", 3)];

  it("ignores case and accents", () => {
    expect(names(filterPeople(people, "jose"))).toEqual(["José Álvarez"]);
    expect(names(filterPeople(people, "ZOE"))).toEqual(["Zoë"]);
    expect(names(filterPeople(people, "alvarez"))).toEqual(["José Álvarez"]);
  });

  it("keeps everyone for an empty query and no one for a stranger", () => {
    expect(filterPeople(people, "  ")).toHaveLength(3);
    expect(filterPeople(people, "xyz")).toHaveLength(0);
  });

  it("offers the search from eight people", () => {
    expect(searchFrom).toBe(8);
    expect(fold("Åsa")).toBe("asa");
  });
});

describe("confirmationText", () => {
  it("names one, two, three, and counts the rest", () => {
    expect(confirmationText(["Ana"])).toBe("Ana shares their location with you");
    expect(confirmationText(["Ana", "Bob"])).toBe("Ana and Bob share their location with you");
    expect(confirmationText(["Ana", "Bob", "Cy"])).toBe(
      "Ana, Bob and Cy share their location with you",
    );
    expect(confirmationText(["Ana", "Bob", "Cy", "Di", "Ed"])).toBe(
      "Ana, Bob and 3 others share their location with you",
    );
  });
});
