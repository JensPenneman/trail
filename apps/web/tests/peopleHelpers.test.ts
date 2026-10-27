import type { TransportMode } from "@trail/contracts/transport";
import { describe, expect, it } from "vitest";
import { createFormatter } from "../src/format/createFormatter";
import { everyoneToggled, selectionShowing } from "../src/pages/people/peopleSelection";
import { sharingSummary } from "../src/pages/people/sharingSummary";
import { assignPersonColors } from "../src/people/assignPersonColors";
import { describeActivity } from "../src/people/describeActivity";
import { describeMe, type MeNow } from "../src/people/describeMe";
import { latestOwnDevice } from "../src/people/latestOwnDevice";
import { appleMapsUrl, googleMapsUrl } from "../src/people/mapLinks";
import { personInitials } from "../src/people/personInitials";
import { primaryDevice } from "../src/people/primaryDevice";
import { summarizePersonTrack } from "../src/people/summarizePersonTrack";
import { devicesText, expiryText, historyText } from "../src/sharing/shareText";
import { car, device, outgoingShare, sharedDevice } from "./support/fixtures";

const format = createFormatter("en-GB", "Europe/Brussels");
const at = (speed: number | null) =>
  ({ ...(sharedDevice().location ?? { lat: 0, lon: 0 }), speed }) as never;

describe("people helpers", () => {
  it("give people colours in the order they started sharing", () => {
    const slots = assignPersonColors([
      { userId: "b", share: { createdAt: "2026-10-22T00:00:00Z" } },
      { userId: "a", share: { createdAt: "2026-10-20T00:00:00Z" } },
      { userId: "c", share: { createdAt: "2026-10-20T00:00:00Z" } },
    ]);
    expect([...slots]).toEqual([
      ["a", 0],
      ["c", 1],
      ["b", 2],
    ]);
  });

  it("make initials of one or two letters", () => {
    expect(personInitials("Ana Bell")).toBe("AB");
    expect(personInitials("jens")).toBe("J");
    expect(personInitials("jean-luc picard")).toBe("JP");
    expect(personInitials("  ")).toBe("?");
    expect(personInitials("Émile Zola")).toBe("ÉZ");
  });

  it("link to Apple Maps and Google Maps", () => {
    expect(appleMapsUrl(51.05, 3.71, "Ana & Bo")).toBe(
      "https://maps.apple.com/?ll=51.05%2C3.71&q=Ana+%26+Bo",
    );
    expect(googleMapsUrl(51.05, 3.71)).toBe(
      "https://www.google.com/maps/search/?api=1&query=51.05%2C3.71",
    );
  });

  it("describe what someone is doing with whatever the share includes", () => {
    const now = { live: true };
    const activity = (mode: TransportMode | null, tripMode: string | null, motion: string[]) => ({
      mode,
      tripMode,
      motion,
    });
    expect(describeActivity(at(12), activity("train", null, ["automotive"]), format, now)).toBe(
      "By train · 43 km/h",
    );
    expect(describeActivity(at(4), activity(null, "bicycle", ["cycling"]), format, now)).toBe(
      "On a bike ride · 14 km/h",
    );
    expect(describeActivity(at(0), activity(null, null, ["walking"]), format, now)).toBe("Walking");
    expect(describeActivity(at(0), activity("stationary", null, []), format, now)).toBe(
      "Standing still",
    );
    expect(describeActivity(at(3), null, format, now)).toBe("11 km/h");
    expect(describeActivity(at(null), null, format, now)).toBeNull();
    expect(describeActivity(null, null, format, now)).toBeNull();
    expect(describeActivity(at(2), activity("unknown", null, []), format, now)).toBe("7 km/h");
    // A moving speed beats a stop that is over.
    expect(describeActivity(at(5), activity("stationary", null, []), format, now)).toBe("18 km/h");
  });

  it("say what an older position was doing, not how fast", () => {
    const activity = (mode: TransportMode | null, motion: string[]) => ({
      mode,
      tripMode: null,
      motion,
    });
    const old = { live: false };
    expect(describeActivity(at(5), activity(null, ["cycling"]), format, old)).toBe("Cycling");
    expect(describeActivity(at(12), activity("train", []), format, old)).toBe("By train");
    expect(describeActivity(at(0), activity(null, []), format, old)).toBe("Standing still");
    expect(describeActivity(at(5), activity("stationary", []), format, old)).toBe("Standing still");
    // Moving then, how is unknown, and now is unknown too.
    expect(describeActivity(at(5), null, format, old)).toBeNull();
  });

  it("take motions and trip modes named like every object's properties for unknown ones", () => {
    const now = { live: true };
    const activity = (tripMode: string | null, motion: string[]) => ({
      mode: null,
      tripMode,
      motion,
    });
    expect(describeActivity(at(0), activity(null, ["constructor", "__proto__"]), format, now)).toBe(
      "Standing still",
    );
    expect(describeActivity(at(0), activity(null, ["__proto__", "walking"]), format, now)).toBe(
      "Walking",
    );
    expect(describeActivity(at(0), activity("constructor", []), format, now)).toBe(
      "On a constructor",
    );
  });

  it("describe the signed-in person now, from the device that reported last", () => {
    const now = Date.parse("2026-10-27T10:00:00Z");
    const thresholds = { liveMinutes: 15, staleHours: 12 };
    const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
    const me = (overrides: Partial<MeNow> = {}): MeNow => ({
      location: { recordedAt: ago(1), speed: 5, motion: ["cycling"] },
      current: null,
      tripMode: null,
      ...overrides,
    });
    const moving = (mode: "cycling" | "train", setByUser: boolean) => ({
      mode,
      setByUser,
      since: ago(20),
      segmentId: null,
    });
    const describe = (state: MeNow) => describeMe(state, now, thresholds, format);

    expect(describe(me())).toBe("Cycling · 18 km/h");
    expect(describe(me({ current: moving("train", false) }))).toBe("By train · 18 km/h");
    // The quick toggle in force is the current mode.
    expect(describe(me({ current: moving("train", true) }))).toBe("By train · 18 km/h");
    expect(describe(me({ current: undefined, tripMode: "bicycle" }))).toBe(
      "On a bike ride · 18 km/h",
    );
    // A stop that started today, and one that started yesterday (Brussels).
    expect(
      describe(
        me({
          current: {
            ...moving("cycling", false),
            mode: "stationary",
            since: "2026-10-27T07:12:00Z",
          },
        }),
      ),
    ).toBe("At the same place since 08:12");
    expect(
      describe(
        me({
          current: {
            ...moving("cycling", false),
            mode: "stationary",
            since: "2026-10-26T17:03:00Z",
          },
        }),
      ),
    ).toMatch(/^At the same place since Mon 26 Oct, 18:03$/);
    // Not live: what it was doing, without a speed of then.
    expect(describe(me({ location: { recordedAt: ago(40), speed: 5, motion: ["cycling"] } }))).toBe(
      "Cycling",
    );
    expect(
      describe(me({ location: { recordedAt: ago(90), speed: 0, motion: ["stationary"] } })),
    ).toBe("Standing still");
    // Past the live window of a share: nothing about now.
    expect(describe(me({ location: { recordedAt: ago(13 * 60), speed: 0, motion: [] } }))).toBe(
      "No recent location",
    );
    expect(describe(me({ location: null }))).toBe("No recent location");
    expect(describe(me({ location: { recordedAt: ago(1), speed: null, motion: [] } }))).toBeNull();
  });

  it("pick the signed-in person's device that reported last", () => {
    const phone = device();
    const parked = car();
    expect(latestOwnDevice([parked, phone])?.id).toBe(phone.id);
    // Without positions: the one that uploaded last.
    const unplaced = [
      { ...parked, lastLocation: null },
      { ...phone, lastLocation: null },
    ];
    expect(latestOwnDevice(unplaced)?.id).toBe(phone.id);
    const silent = { ...phone, lastLocation: null, lastSeenAt: null };
    expect(latestOwnDevice([silent])?.id).toBe(phone.id);
    expect(latestOwnDevice([])).toBeNull();
  });

  it("sum someone's track up as the device that recorded most, never adding devices", () => {
    const track = (
      deviceId: string,
      distanceM: number,
      total: number,
      first: string,
      last: string,
    ) => ({
      deviceId,
      total,
      returned: total,
      simplified: false,
      distanceM,
      firstAt: first,
      lastAt: last,
      points: [],
    });
    const answer = {
      from: "2026-10-26T23:00:00.000Z",
      to: "2026-10-27T23:00:00.000Z",
      tracks: [
        track("a", 12_000, 300, "2026-10-27T06:58:00.000Z", "2026-10-27T09:42:00.000Z"),
        track("b", 1_250, 20, "2026-10-27T05:30:00.000Z", "2026-10-27T08:00:00.000Z"),
      ],
    };
    // A phone and a tablet on one ride: the busier one, and that two recorded.
    expect(summarizePersonTrack(answer, "2026-10-26T23:00:00.000Z")).toEqual({
      distanceM: 12_000,
      points: 300,
      firstAt: "2026-10-27T06:58:00.000Z",
      lastAt: "2026-10-27T09:42:00.000Z",
      devices: 2,
      limited: false,
    });
    // A device that recorded nothing does not count; on a tie the longer track wins.
    const quiet = track("c", 0, 0, "2026-10-27T06:00:00.000Z", "2026-10-27T06:00:00.000Z");
    const twin = track("d", 12_500, 300, "2026-10-27T07:00:00.000Z", "2026-10-27T09:00:00.000Z");
    expect(
      summarizePersonTrack({ ...answer, tracks: [...answer.tracks, quiet, twin] }, answer.from),
    ).toMatchObject({ distanceM: 12_500, devices: 3 });
    const moved = summarizePersonTrack({ ...answer, tracks: [] }, "2026-10-01T22:00:00.000Z");
    expect(moved).toEqual({
      distanceM: 0,
      points: 0,
      firstAt: null,
      lastAt: null,
      devices: 0,
      limited: true,
    });
  });

  it("pick the device that reported last", () => {
    const old = sharedDevice({ id: "old" });
    const location = sharedDevice().location;
    if (location === null) throw new Error("fixture without location");
    const fresh = sharedDevice({
      id: "fresh",
      location: { ...location, recordedAt: new Date().toISOString() },
    });
    const none = sharedDevice({ id: "none", location: null });
    expect(primaryDevice([old, fresh, none])?.id).toBe("fresh");
    expect(primaryDevice([none])?.id).toBe("none");
    expect(primaryDevice([])).toBeNull();
  });

  it("put shares into words", () => {
    const now = Date.parse("2026-10-26T10:00:00Z");
    expect(expiryText(null, format, now)).toBe("Until stopped");
    expect(expiryText("2026-10-26T22:59:00Z", format, now)).toBe("Until 23:59");
    expect(expiryText("2026-10-27T09:00:00Z", format, now)).toMatch(/^Until Tue 27 Oct, 10:00$/);
    expect(expiryText("2026-10-26T09:00:00Z", format, now)).toBe("Ended");
    expect(historyText(null)).toBe("Live only");
    expect(historyText(1)).toBe("Last 24 hours");
    expect(historyText(7)).toBe("Last 7 days");
    const devices = [
      { id: "p", name: "Phone" },
      { id: "w", name: "Watch" },
    ];
    expect(devicesText(null, devices, format)).toBe("All devices");
    expect(devicesText([], devices, format)).toBe("No devices");
    expect(devicesText(["w", "p"], devices, format)).toBe("Phone and Watch");
  });

  it("show someone alone from their card, unless the map shows them already", () => {
    expect(selectionShowing(["me"], "ana")).toEqual(["ana"]);
    expect(selectionShowing(["ana", "bob"], "me")).toEqual(["me"]);
    // On the map already, alone or with others: the camera moves, the choice stays.
    expect(selectionShowing(["me", "ana"], "ana")).toBeNull();
    expect(selectionShowing(["ana"], "ana")).toBeNull();
  });

  it("show everyone, and the signed-in person alone again", () => {
    const everyone = ["me", "ana", "bob"];
    expect(everyoneToggled(["me"], everyone)).toEqual(everyone);
    expect(everyoneToggled(["ana"], everyone)).toEqual(everyone);
    expect(everyoneToggled(["bob", "ana", "me"], everyone)).toEqual(["me"]);
  });

  it("say with how many people one shares, and who waits for a confirmation", () => {
    const count = (value: number) => format.count(value);
    expect(sharingSummary([], count)).toEqual({ line: "You share with nobody", toConfirm: null });
    expect(sharingSummary([outgoingShare()], count)).toEqual({
      line: "You share with 1 person",
      toConfirm: null,
    });
    const joined = outgoingShare({ id: "joined", status: "joined" });
    expect(
      sharingSummary(
        [outgoingShare(), joined, outgoingShare({ id: "pending", status: "pending" })],
        count,
      ),
    ).toEqual({ line: "You share with 3 people", toConfirm: "1 waits for you to confirm" });
    expect(sharingSummary([joined, { ...joined, id: "again" }], count).toConfirm).toBe(
      "2 wait for you to confirm",
    );
  });
});
